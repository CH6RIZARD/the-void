-- ============================================================
-- 004_ranking_security.sql
--
-- Two things:
--   A. Close the remaining client write paths into the feed ranking.
--   B. taste_profiles — opt-in, end-to-end-encrypted taste sync.
--
-- WHAT 001 ALREADY COVERED (not repeated here)
--   * UPDATE of posts.rank_score / region_code: column grants at 001:565-566.
--   * One reaction per user per post: reactions PRIMARY KEY (post_id, user_id).
--     That is STRICTER than a (user_id, post_id, kind) unique key — a user cannot
--     hold both a rank and a slash on one post — so no extra constraint is added.
--   * DELETE of a reaction reverses its score: apply_reaction_score's else-branch
--     (001:156-157) subtracts a rank and adds back a slash.
--
-- Idempotent: safe to re-run.
-- NOT EXECUTED by the author of this file — no Postgres was available. Apply to
-- a scratch database, then run scripts/railway/test_rls_and_derived.sh.
-- ============================================================


-- ============================================================
-- A1. POSTS — INSERT can no longer carry a rank_score
--
-- posts_insert (001:558) checks only author_id, and 001 never restricted INSERT
-- columns, so `insert into posts (author_id, body, rank_score) values (me, 'x',
-- 999999)` put a post straight at the top of posts_rank_idx, posts_in_bbox and
-- region_view. Two layers, either of which alone closes it:
--
--   1. Column grants: authenticated may only name author-writable columns.
--   2. A guard trigger that forces the derived columns for EVERY role, so the
--      service_role / owner paths (seeds, imports, Edge Functions) cannot
--      introduce a score that no reaction backs either.
--
-- rank_score = 0 is correct for every insert, not just client ones: reactions
-- reference posts(id), so a row being inserted cannot have reactions yet. This
-- also keeps a COPY-based restore consistent — posts land at 0 and the restored
-- reactions rows re-add their deltas through reactions_score.
-- ============================================================

create or replace function guard_post_insert()
returns trigger language plpgsql as $$
begin
  new.rank_score  := 0;      -- only apply_reaction_score may move this
  new.region_code := null;   -- recomputed from location by set_post_region
  return new;
end;
$$;

-- TRIGGER ORDER: same-timing row triggers fire in NAME order. 'posts_guard_insert'
-- sorts before 'posts_set_region' ('g' < 's'), so the clear runs first and
-- set_post_region then derives region_code from location. Renaming either
-- trigger past the other would silently null every post's region — keep the
-- names ordered.
drop trigger if exists posts_guard_insert on posts;
create trigger posts_guard_insert
  before insert on posts
  for each row execute function guard_post_insert();

-- Column list derived from 001:73-82:
--   id          client-writable (client-generated uuids for optimistic UI; PK
--               uniqueness is the only thing it can affect)
--   author_id   bound to auth.uid() by posts_insert
--   body        content
--   location    content; region_code is derived from it
--   reply_to    content (VoidAPI.reply sends it)
-- Excluded:
--   region_code DERIVED (set_post_region)
--   rank_score  DERIVED (apply_reaction_score)
--   created_at  a client-chosen future timestamp would pin a post to the top of
--               every created_at-desc read and cursor. Server default only.
revoke insert on posts from authenticated;
revoke insert on posts from anon;
grant  insert (id, author_id, body, location, reply_to) on posts to authenticated;


-- ============================================================
-- A2. REACTIONS — a reaction cannot be moved to another post
--
-- apply_reaction_score's UPDATE branch computes the delta from the kinds only
-- and applies it to coalesce(new.post_id, old.post_id) — the NEW post. So
--     insert (A, me, 'rank')  -> A +1
--     update set post_id = B  -> B +0, A keeps its +1
--     insert (A, me, 'rank')  -> A +1 again
-- pumps A without bound, one row at a time. reactions_write (001:574) is `for
-- all` with no column restriction, so any user could run that loop.
--
-- Why a trigger and not `grant update (kind)`: VoidAPI.bolt upserts with
-- PostgREST `Prefer: resolution=merge-duplicates`, which emits
-- `on conflict (post_id, user_id) do update set post_id = excluded.post_id,
-- user_id = excluded.user_id, kind = excluded.kind` — that needs UPDATE privilege
-- on every column it names, even when the values are unchanged. A column grant
-- would break the live client; a trigger that rejects only actual CHANGES does
-- not. kind may still flip rank <-> slash; that delta is computed correctly.
-- Applies to every role: moving a reaction is never a legitimate operation.
-- ============================================================

create or replace function lock_reaction_keys()
returns trigger language plpgsql as $$
begin
  if new.post_id is distinct from old.post_id
     or new.user_id is distinct from old.user_id then
    raise exception 'reaction_keys_immutable'
      using errcode = '42501',
            hint = 'Delete the reaction and insert a new one instead of moving it.';
  end if;
  return new;
end;
$$;

drop trigger if exists reactions_lock_keys on reactions;
create trigger reactions_lock_keys
  before update on reactions
  for each row execute function lock_reaction_keys();

-- Belt and braces for the one-reaction-per-user-per-post invariant: 001 names the
-- PK implicitly (reactions_pkey). If a later migration ever drops it, this makes
-- the absence loud rather than letting duplicate rows pump rank_score.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.reactions'::regclass
      and c.contype in ('p','u')
      and (select array_agg(a.attname::text order by a.attname::text)
             from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any (c.conkey))
          = array['post_id','user_id']
  ) then
    alter table reactions add constraint reactions_one_per_user_post
      unique (post_id, user_id);
  end if;
end
$$;


-- ============================================================
-- B. TASTE_PROFILES — opt-in, end-to-end-encrypted taste sync
--
-- Same rule as section 8 of 001: the server stores CIPHERTEXT only. The client
-- encrypts with AES-GCM under a PBKDF2 key from a sync passphrase; iv and salt
-- are public parameters, stored so any of the user's devices can derive and
-- decrypt. No server-side feature may read, index or rank on the plaintext.
--
-- rev is an optimistic-concurrency counter. Writes go through
-- upsert_taste_profile(), which only advances rev when the caller proves it saw
-- the current one — two devices can never silently overwrite each other; the
-- loser gets 'taste_rev_conflict', pulls, merges, and retries.
-- ============================================================

create table if not exists taste_profiles (
  user_id    uuid primary key references profiles(id) on delete cascade,
  ciphertext text not null,
  iv         text not null,
  salt       text not null,
  rev        integer not null default 0,
  updated_at timestamptz not null default now()
);

do $$
begin
  -- 1 MB of base64 is far above any real taste profile; the cap exists so one
  -- account cannot use this table as free blob storage.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.taste_profiles'::regclass
                   and conname = 'taste_profiles_ciphertext_len') then
    alter table taste_profiles add constraint taste_profiles_ciphertext_len
      check (length(ciphertext) <= 1000000);
  end if;
  -- iv (12 bytes) and salt (16-32 bytes) are tiny in any encoding.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.taste_profiles'::regclass
                   and conname = 'taste_profiles_params_len') then
    alter table taste_profiles add constraint taste_profiles_params_len
      check (length(iv) <= 256 and length(salt) <= 256);
  end if;
end
$$;

create or replace function touch_taste_profile()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists taste_profiles_touch on taste_profiles;
create trigger taste_profiles_touch
  before insert or update on taste_profiles
  for each row execute function touch_taste_profile();

alter table taste_profiles enable row level security;

-- Owner-only on every verb. No public read surface: even ciphertext length and
-- updated_at are an activity signal, so nobody else sees the row exists.
drop policy if exists taste_select on taste_profiles;
drop policy if exists taste_insert on taste_profiles;
drop policy if exists taste_update on taste_profiles;
drop policy if exists taste_delete on taste_profiles;

create policy taste_select on taste_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy taste_insert on taste_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy taste_update on taste_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy taste_delete on taste_profiles for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Railway's 000 default privileges hand anon SELECT on new tables, and Supabase
-- hands anon ALL. RLS already denies anon (every policy is `to authenticated`);
-- revoking makes that hold even if RLS is ever disabled by mistake.
revoke all on taste_profiles from anon;
grant select, insert, update, delete on taste_profiles to authenticated;

-- SECURITY INVOKER on purpose: it runs under the caller's RLS, so it can only
-- ever touch the caller's own row. It needs no powers the table does not
-- already grant; it just makes the compare-and-swap atomic.
--
-- Returns the new rev. p_expected_rev is the rev the client last pulled
-- (0 when it has never synced).
--   row exists, rev matches  -> overwrite, rev + 1
--   no row                   -> insert at rev 1 (whatever was expected: there
--                               is nothing to overwrite)
--   row exists, rev differs  -> raise 'taste_rev_conflict'
--   concurrent first inserts -> one wins; the other hits ON CONFLICT and raises
create or replace function upsert_taste_profile(
  p_ciphertext   text,
  p_iv           text,
  p_salt         text,
  p_expected_rev integer
)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  me      uuid := (select auth.uid());
  new_rev integer;
  cur_rev integer;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update taste_profiles
     set ciphertext = p_ciphertext, iv = p_iv, salt = p_salt, rev = rev + 1
   where user_id = me and rev = p_expected_rev
  returning rev into new_rev;
  if found then return new_rev; end if;

  insert into taste_profiles (user_id, ciphertext, iv, salt, rev)
  values (me, p_ciphertext, p_iv, p_salt, 1)
  on conflict (user_id) do nothing
  returning rev into new_rev;
  if found then return new_rev; end if;

  select rev into cur_rev from taste_profiles where user_id = me;
  raise exception 'taste_rev_conflict'
    using errcode = 'P0001',
          detail  = format('expected rev %s, server has rev %s', p_expected_rev, cur_rev),
          hint    = 'Pull the current profile, merge, and retry with its rev.';
end;
$$;

revoke execute on function upsert_taste_profile(text, text, text, integer) from public;
revoke execute on function upsert_taste_profile(text, text, text, integer) from anon;
grant  execute on function upsert_taste_profile(text, text, text, integer) to authenticated;

-- ============================================================
-- VERIFY — scripts/railway/test_rls_and_derived.sh covers all of these.
-- ============================================================
--
-- 1. As an author: insert into posts (author_id, body, rank_score) values (me,'x',999);
--    must fail (permission denied). Without rank_score it succeeds at 0.
-- 2. Inserting the same (post_id, user_id) reaction twice fails (reactions_pkey).
-- 3. update reactions set post_id = <other> where user_id = me; fails
--    (reaction_keys_immutable). update ... set kind = 'slash' still works.
-- 4. As B: select * from taste_profiles where user_id = A; returns 0 rows, and
--    update/delete of A's row affects 0 rows.
-- 5. upsert_taste_profile(..., <stale rev>) raises taste_rev_conflict.
