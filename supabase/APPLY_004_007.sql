-- THE VOID — migrations 004 → 007 combined for the Supabase SQL Editor.
-- Paste this whole file into Dashboard → SQL Editor → New query → Run.
-- Order matters: 004 ranking/security, 005 account deletion, 006 moderation, 007 media + DMs.
-- Each part is written to be idempotent (safe to re-run).

-- ════════════════════════════════════════════════════════════
-- migrations/004_ranking_security.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- migrations/005_account_deletion.sql
-- ════════════════════════════════════════════════════════════
-- ============================================================
-- 005_account_deletion.sql
--
-- In-app account deletion: Apple App Review 5.1.1(v) and Google Play's
-- account-deletion policy. A user (anonymous ones included) must be able to
-- delete their account AND its data from inside the app.
--
-- Two entry points share one implementation:
--
--   delete_user_data(p_user uuid)  service_role ONLY. Called by the Edge Function
--                                  supabase/functions/delete-account after it has
--                                  verified the caller's JWT. Removes every row
--                                  the user owns and returns a JSON report,
--                                  including the storage objects the Edge
--                                  Function must still remove through the
--                                  Storage API.
--
--   delete_my_account()            authenticated (anonymous users are
--                                  `authenticated` too). The RPC fallback for
--                                  when the Edge Function is not deployed yet.
--                                  Same cleanup for auth.uid(), then TRIES to
--                                  delete the auth.users row. If this project's
--                                  `postgres` role is not allowed to do that, the
--                                  data is still gone and the user id is queued
--                                  in account_deletion_requests for the Edge
--                                  Function / an operator to finish with
--                                  auth.admin.deleteUser.
--
-- WHAT IS COVERED (001 + 004; see the per-table notes below)
--   profiles, posts (and, by 001's reply_to cascade, replies other people made
--   to them), post_media, reactions (the user's own, and reactions on the
--   user's posts), follows (both directions), notifications (to AND from the
--   user), devices, signed_prekeys, one_time_prekeys, message_envelopes,
--   messages, conversation_members, conversations (DMs the user was in, and any
--   conversation left with no members), taste_profiles (004), plus, if they
--   exist when this runs, any later user-owned table (reports, blocks, DM
--   media, ...) found by the column sweep in step 9, and storage.objects owned
--   by the user or under a "<user id>/" prefix.
--
-- Idempotent: safe to re-run. NOT EXECUTED by the author of this file (no
-- database credentials were available); apply to a scratch project first.
-- ============================================================


-- ------------------------------------------------------------
-- Queue for auth users whose data is gone but whose auth.users row could not
-- be removed from SQL. Service-role only; no client can read or write it.
-- No FK to auth.users on purpose: the row must outlive the user it names.
-- ------------------------------------------------------------
create table if not exists account_deletion_requests (
  user_id      uuid primary key,
  requested_at timestamptz not null default now(),
  data_deleted boolean not null default false,
  completed_at timestamptz,
  report       jsonb
);

alter table account_deletion_requests enable row level security;
-- No policies: RLS denies every client role. service_role bypasses RLS.
revoke all on account_deletion_requests from anon;
revoke all on account_deletion_requests from authenticated;


-- ------------------------------------------------------------
-- delete_user_data: the one implementation.
-- ------------------------------------------------------------
create or replace function delete_user_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report   jsonb := '{}'::jsonb;
  n        bigint;
  rec      record;
  storage_list jsonb := '[]'::jsonb;
begin
  if p_user is null then
    raise exception 'no user' using errcode = '22004';
  end if;

  -- 1. Storage objects: COLLECT first. Supabase blocks direct DELETE on
  --    storage.objects (storage.protect_delete) on current projects, so the
  --    Edge Function removes these through the Storage API with this list.
  --    `owner` (uuid, older) and `owner_id` (text, newer) both exist on current
  --    projects; the dynamic SQL keeps this working if either is missing.
  begin
    if to_regclass('storage.objects') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name)), '[]'::jsonb)
          from storage.objects o
         where o.owner = $1
            or (storage.foldername(o.name))[1] = $1::text
      $q$ into storage_list using p_user;
    end if;
  exception when others then
    storage_list := '[]'::jsonb;
    report := report || jsonb_build_object('storage_list_error', sqlerrm);
  end;
  report := report || jsonb_build_object('storage_objects', storage_list);

  -- 2. Messaging (001 section 8).
  --    DMs are deleted whole: a one-to-one thread with a deleted account has no
  --    remaining purpose, and its envelopes to the other party's devices would
  --    otherwise keep the deleted user's (ciphertext) messages alive.
  --    conversations -> conversation_members, messages -> message_envelopes all
  --    cascade.
  delete from conversations c
   where c.kind = 'dm'
     and exists (select 1 from conversation_members m
                  where m.conversation_id = c.id and m.user_id = p_user);
  get diagnostics n = row_count;
  report := report || jsonb_build_object('conversations_dm', n);

  -- Group conversations: remove only the user's own messages and membership.
  delete from messages where sender_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('messages', n);

  delete from conversation_members where user_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('conversation_members', n);

  -- A conversation left with no members is unreachable (conv_read requires
  -- membership); drop it rather than leaving orphans.
  delete from conversations c
   where not exists (select 1 from conversation_members m where m.conversation_id = c.id);

  -- devices cascade to signed_prekeys, one_time_prekeys, message_envelopes
  -- addressed to them, and messages sent from them.
  delete from devices where user_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('devices', n);

  -- 3. Reactions the user made. Deleting them runs apply_reaction_score, which
  --    correctly takes their rank/slash back out of other people's posts.
  delete from reactions where user_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('reactions', n);

  -- 4. Follows, both directions.
  delete from follows where follower_id = p_user or followee_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('follows', n);

  -- 5. Notifications to the user and caused by the user.
  delete from notifications where user_id = p_user or actor_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('notifications', n);

  -- 6. Posts. Cascades post_media, reactions ON these posts, notifications that
  --    point at them, and (posts.reply_to on delete cascade, 001) replies other
  --    users wrote under them. Replies the user wrote elsewhere are posts with
  --    author_id = p_user and go here too.
  delete from posts where author_id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('posts', n);

  -- 7. taste_profiles (004). Cascades from profiles too; explicit so the report
  --    says so, and so it still goes if that FK ever changes.
  if to_regclass('public.taste_profiles') is not null then
    execute 'delete from public.taste_profiles where user_id = $1' using p_user;
    get diagnostics n = row_count;
    report := report || jsonb_build_object('taste_profiles', n);
  end if;

  -- 8. Tables added by later migrations that are not in 001/004 yet
  --    (moderation, blocks, DM media). Explicit names first.
  for rec in
    select * from (values
      ('reports',       'reporter_id'),
      ('reports',       'target_user_id'),
      ('blocks',        'blocker_id'),
      ('blocks',        'blocked_id'),
      ('user_blocks',   'blocker_id'),
      ('user_blocks',   'blocked_id'),
      ('message_media', 'owner_id'),
      ('media_uploads', 'owner_id'),
      ('push_tokens',   'user_id')
    ) as t(tbl, col)
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = rec.tbl and column_name = rec.col) then
      begin
        execute format('delete from public.%I where %I = $1', rec.tbl, rec.col) using p_user;
        get diagnostics n = row_count;
        report := report || jsonb_build_object(rec.tbl || '.' || rec.col, n);
      exception when others then
        report := report || jsonb_build_object(rec.tbl || '.' || rec.col || '_error', sqlerrm);
      end;
    end if;
  end loop;

  -- 9. Sweep: any other public table with a uuid column that plainly names a
  --    user. Catches tables added after this migration without editing it.
  --    Reference tables (regions, places, topics, topic_sources) have no such
  --    columns. profiles is handled last in step 10.
  for rec in
    select c.table_name as tbl, c.column_name as col
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type = 'uuid'
       and c.table_name not in ('profiles', 'account_deletion_requests')
       and c.column_name in ('user_id','author_id','owner_id','sender_id','actor_id',
                             'reporter_id','target_user_id','blocker_id','blocked_id',
                             'follower_id','followee_id','recipient_id','created_by')
  loop
    begin
      execute format('delete from public.%I where %I = $1', rec.tbl, rec.col) using p_user;
      get diagnostics n = row_count;
      if n > 0 then
        report := report || jsonb_build_object('sweep:' || rec.tbl || '.' || rec.col, n);
      end if;
    exception when others then
      report := report || jsonb_build_object('sweep:' || rec.tbl || '.' || rec.col || '_error', sqlerrm);
    end;
  end loop;

  -- 10. The profile itself (cascades anything still pointing at it).
  delete from profiles where id = p_user;
  get diagnostics n = row_count;
  report := report || jsonb_build_object('profiles', n);

  -- 11. Storage: best effort from SQL for the RPC path. Expected to fail on
  --     projects with storage.protect_delete; the Edge Function uses the API.
  if jsonb_array_length(storage_list) > 0 then
    begin
      execute $q$
        delete from storage.objects o
         where o.owner = $1 or (storage.foldername(o.name))[1] = $1::text
      $q$ using p_user;
      get diagnostics n = row_count;
      report := report || jsonb_build_object('storage_deleted_sql', n);
    exception when others then
      report := report || jsonb_build_object('storage_deleted_sql', 0,
                                             'storage_sql_note', sqlerrm);
    end;
  end if;

  return report;
end;
$$;

revoke execute on function delete_user_data(uuid) from public;
revoke execute on function delete_user_data(uuid) from anon;
revoke execute on function delete_user_data(uuid) from authenticated;
grant  execute on function delete_user_data(uuid) to service_role;


-- ------------------------------------------------------------
-- delete_my_account: the caller deletes themselves. RPC fallback.
-- ------------------------------------------------------------
create or replace function delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := (select auth.uid());
  report jsonb;
  auth_deleted boolean := false;
  auth_note text;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  report := delete_user_data(me);

  -- Try to remove the login itself. Works where `postgres` may write auth.users;
  -- otherwise queue it. Either way the user's data above is already deleted, and
  -- a re-used token cannot recreate anything that was removed.
  begin
    delete from auth.users where id = me;
    auth_deleted := found;
  exception when others then
    auth_deleted := false;
    auth_note := sqlerrm;
  end;

  if not auth_deleted then
    insert into account_deletion_requests (user_id, data_deleted, report)
    values (me, true, report)
    on conflict (user_id) do update
      set requested_at = now(), data_deleted = true, report = excluded.report;
  end if;

  return report || jsonb_build_object(
    'user_id', me,
    'auth_user_deleted', auth_deleted,
    'auth_note', auth_note,
    'via', 'rpc'
  );
end;
$$;

revoke execute on function delete_my_account() from public;
revoke execute on function delete_my_account() from anon;
grant  execute on function delete_my_account() to authenticated;

-- ============================================================
-- VERIFY (scratch project)
-- 1. As user A (anonymous is fine) with a post, a reaction on B's post, a follow
--    of B and a DM with B: select delete_my_account();
--    -> A's rows are gone from every table above; B's post rank_score dropped by
--    A's reaction; the A-B DM is gone; B's own posts are untouched.
-- 2. As anon (no JWT): rpc delete_my_account -> permission denied.
-- 3. As authenticated: rpc delete_user_data('<B>') -> permission denied.
-- 4. select * from account_deletion_requests; -> empty if auth.users delete
--    worked, else A's id with data_deleted = true.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- migrations/006_moderation.sql
-- ════════════════════════════════════════════════════════════
-- ============================================================
-- 006_moderation.sql  —  UGC safety (Apple 1.2 / Google Play UGC policy)
--
--   A. profiles.terms_accepted_at      EULA acceptance before posting
--   B. blocks                          block abusive users (own rows only)
--   C. reports                         report posts / users / aggregated items
--   D. posts.hidden_at + auto-hide     >= 3 distinct reporters hides a post
--                                      pending moderator review
--   E. read-path RLS                   posts, post_media, reactions,
--                                      notifications, DMs honour blocks + hides
--   F. start_dm / messages             no DM across a block (either direction)
--   G. moderation_queue                service_role-only review view + RPCs
--
-- Depends on 001 (APPLY.sql) and 004. Numbered 006 because 005 is
-- 005_account_deletion.sql. Idempotent: safe to re-run.
-- NOT EXECUTED by its author (no Postgres available). Apply to a scratch DB and
-- run the VERIFY block at the bottom first.
--
-- Design notes
--   * Feed/thread reads hide authors *I* blocked. Authors who blocked *me* are
--     NOT hidden from public reads: that would reveal the block (and anon can
--     read posts anyway). For DMs both directions are enforced.
--   * Every policy subquery qualifies the outer table by name (see the RECURSION
--     note in APPLY.sql §9): an unqualified column fails open.
--   * blocks is only readable by its blocker, so the "blocked me" checks go
--     through a SECURITY DEFINER helper that returns a boolean and nothing else.
-- ============================================================


-- ============================================================
-- A. TERMS ACCEPTANCE
-- profiles_write (001) is owner-only `for all`, and profiles has no column
-- grants, so the owner can stamp their own row. The client sends now(); the
-- trigger below replaces it with the server clock and forbids un-accepting.
-- ============================================================

alter table profiles add column if not exists terms_accepted_at timestamptz;

create or replace function stamp_terms_accepted()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.terms_accepted_at is not null then
    new.terms_accepted_at := old.terms_accepted_at;          -- first acceptance sticks
  elsif new.terms_accepted_at is not null then
    new.terms_accepted_at := now();                           -- server clock, not client
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_stamp_terms on profiles;
create trigger profiles_stamp_terms
  before insert or update of terms_accepted_at on profiles
  for each row execute function stamp_terms_accepted();

-- Posting requires accepted terms. Enforced server-side too, so a client that
-- skips the sheet still cannot post. Replaces posts_insert from 001.
drop policy if exists posts_insert on posts;
create policy posts_insert on posts for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (select 1 from profiles pr
                where pr.id = posts.author_id
                  and pr.terms_accepted_at is not null)
  );


-- ============================================================
-- B. BLOCKS
-- ============================================================

create table if not exists blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on blocks (blocked_id);

alter table blocks enable row level security;

drop policy if exists blocks_select on blocks;
drop policy if exists blocks_insert on blocks;
drop policy if exists blocks_delete on blocks;
create policy blocks_select on blocks for select to authenticated
  using ((select auth.uid()) = blocker_id);
create policy blocks_insert on blocks for insert to authenticated
  with check ((select auth.uid()) = blocker_id);
create policy blocks_delete on blocks for delete to authenticated
  using ((select auth.uid()) = blocker_id);
-- No UPDATE policy: a block is inserted or deleted, never moved.

revoke all on blocks from anon;
revoke all on blocks from authenticated;
grant select, insert, delete on blocks to authenticated;

-- Blocking someone also drops the follow in both directions, so a blocked user
-- does not keep a follow edge (and its notifications) into the blocker.
create or replace function blocks_drop_follows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists blocks_after_insert on blocks;
create trigger blocks_after_insert after insert on blocks
  for each row execute function blocks_drop_follows();

-- Either-direction check for the CURRENT user. SECURITY DEFINER because the
-- caller may not read the other party's rows; it only ever returns a boolean
-- about a pair that includes the caller.
create or replace function is_blocked_either_way(other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = other)
       or (b.blocker_id = other and b.blocked_id = (select auth.uid()))
  );
$$;

revoke execute on function is_blocked_either_way(uuid) from public;
revoke execute on function is_blocked_either_way(uuid) from anon;
grant  execute on function is_blocked_either_way(uuid) to authenticated;


-- ============================================================
-- C. REPORTS
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_reason') then
    create type report_reason as enum
      ('spam','harassment','hate','violence','sexual','misinformation','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_status') then
    create type report_status as enum ('open','actioned','dismissed');
  end if;
end
$$;

create table if not exists reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references profiles(id) on delete cascade,
  target_post_id   uuid references posts(id) on delete set null,
  target_user_id   uuid references profiles(id) on delete set null,
  -- Aggregated third-party content (Bluesky/Mastodon/Lemmy/news) that has no
  -- row here: a stable key such as 'bluesky:someone.bsky.social' plus its URL.
  target_external  text check (target_external is null or char_length(target_external) <= 500),
  reason           report_reason not null,
  note             text check (note is null or char_length(note) <= 1000),
  status           report_status not null default 'open',
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      text,                         -- moderator identifier (service side)
  resolution       text,
  check (target_post_id is not null or target_user_id is not null or target_external is not null)
);

create index if not exists reports_status_idx on reports (status, created_at);
create index if not exists reports_post_idx   on reports (target_post_id) where target_post_id is not null;
create index if not exists reports_user_idx   on reports (target_user_id) where target_user_id is not null;
-- One report per reporter per post: repeat taps cannot stack toward auto-hide.
create unique index if not exists reports_one_per_post
  on reports (reporter_id, target_post_id) where target_post_id is not null;

alter table reports enable row level security;

drop policy if exists reports_insert on reports;
drop policy if exists reports_select on reports;
create policy reports_insert on reports for insert to authenticated
  with check ((select auth.uid()) = reporter_id);
-- A reporter can see their own reports (and their status); nobody else's.
create policy reports_select on reports for select to authenticated
  using ((select auth.uid()) = reporter_id);
-- No UPDATE/DELETE policy: only service_role (moderators) resolves reports.

revoke all on reports from anon;
revoke all on reports from authenticated;
grant select on reports to authenticated;
grant insert (reporter_id, target_post_id, target_user_id, target_external, reason, note)
  on reports to authenticated;


-- ============================================================
-- D. AUTO-HIDE: >= 3 distinct reporters hides a post pending review
--
-- hidden_at      set by the trigger (or a moderator); cleared by a moderator
-- review_cleared_at  a moderator kept the post; only reports AFTER this count
-- Neither column is client-writable: 001 grants UPDATE (body, location) only and
-- 004 grants INSERT on (id, author_id, body, location, reply_to) only.
-- ============================================================

alter table posts add column if not exists hidden_at         timestamptz;
alter table posts add column if not exists review_cleared_at timestamptz;

create index if not exists posts_hidden_idx on posts (hidden_at) where hidden_at is not null;

create or replace function reports_auto_hide()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if new.target_post_id is null then return new; end if;
  select count(distinct r.reporter_id) into n
    from reports r
    join posts p on p.id = r.target_post_id
   where r.target_post_id = new.target_post_id
     and r.status <> 'dismissed'
     and r.created_at > coalesce(p.review_cleared_at, '-infinity'::timestamptz);
  if n >= 3 then
    update posts set hidden_at = now()
     where id = new.target_post_id and hidden_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_after_insert on reports;
create trigger reports_after_insert after insert on reports
  for each row execute function reports_auto_hide();


-- ============================================================
-- E. READ PATHS
--
-- posts_read (001) was `using (true)`. Now a row is visible when:
--   * it is not hidden, or the viewer is its author; and
--   * the viewer has not blocked its author.
-- posts_in_bbox and region_view are plain (SECURITY INVOKER) SQL functions, so
-- they inherit this policy — no function changes needed. Replies are posts
-- (reply_to), so thread reads are covered by the same policy.
-- anon: auth.uid() is null, the NOT EXISTS is trivially true, hidden rows drop.
-- ============================================================

drop policy if exists posts_read on posts;
create policy posts_read on posts for select
  using (
    (posts.hidden_at is null or posts.author_id = (select auth.uid()))
    and not exists (
      select 1 from blocks b
      where b.blocker_id = (select auth.uid())
        and b.blocked_id = posts.author_id)
  );

-- Media follows its post (the subquery runs under posts_read).
drop policy if exists media_read on post_media;
create policy media_read on post_media for select
  using (exists (select 1 from posts p where p.id = post_media.post_id));

-- Notifications from someone I blocked are not shown.
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select to authenticated
  using (
    (select auth.uid()) = notifications.user_id
    and (notifications.actor_id is null or not exists (
      select 1 from blocks b
      where b.blocker_id = (select auth.uid())
        and b.blocked_id = notifications.actor_id))
  );

-- ...and are not written in the first place when the recipient blocked the
-- actor (the triggers run as definer, so they read blocks directly).
create or replace function notify_on_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  select author_id into target from posts where id = new.post_id;
  if target is not null and target <> new.user_id
     and not exists (select 1 from blocks b where b.blocker_id = target and b.blocked_id = new.user_id) then
    insert into notifications (user_id, actor_id, type, post_id)
    values (target, new.user_id, new.kind, new.post_id);
  end if;
  return new;
end;
$$;

create or replace function notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from blocks b where b.blocker_id = new.followee_id and b.blocked_id = new.follower_id) then
    insert into notifications (user_id, actor_id, type)
    values (new.followee_id, new.follower_id, 'follow');
  end if;
  return new;
end;
$$;

create or replace function notify_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if new.reply_to is null then return new; end if;
  select author_id into target from posts where id = new.reply_to;
  if target is not null and target <> new.author_id
     and not exists (select 1 from blocks b where b.blocker_id = target and b.blocked_id = new.author_id) then
    insert into notifications (user_id, actor_id, type, post_id)
    values (target, new.author_id, 'reply', new.id);
  end if;
  return new;
end;
$$;

-- A blocked user cannot follow the blocker (follows_write from 001 + this).
drop policy if exists follows_write on follows;
create policy follows_write on follows for all to authenticated
  using ((select auth.uid()) = follower_id)
  with check ((select auth.uid()) = follower_id
              and not is_blocked_either_way(follows.followee_id));

-- A blocked user cannot react to the blocker's posts. (Reads of the post are
-- already gone for the blocker; this stops the reverse direction.)
drop policy if exists reactions_write on reactions;
create policy reactions_write on reactions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
              and not exists (select 1 from posts p
                              where p.id = reactions.post_id
                                and is_blocked_either_way(p.author_id)));


-- ============================================================
-- F. DIRECT MESSAGES — blocks apply in BOTH directions
-- ============================================================

-- Same body as APPLY.sql §9 plus the block check.
create or replace function start_dm(other_user uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := (select auth.uid());
  key  text;
  conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user = me then raise exception 'cannot DM yourself'; end if;
  if not exists (select 1 from profiles where id = other_user) then
    raise exception 'no such user';
  end if;
  if exists (select 1 from blocks b
             where (b.blocker_id = me and b.blocked_id = other_user)
                or (b.blocker_id = other_user and b.blocked_id = me)) then
    raise exception 'dm_blocked' using errcode = '42501';
  end if;

  key := least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);

  insert into conversations (kind, dm_key) values ('dm', key)
  on conflict (dm_key) do nothing
  returning id into conv;

  if conv is null then
    select id into conv from conversations where dm_key = key;
  else
    insert into conversation_members (conversation_id, user_id)
    values (conv, me), (conv, other_user);
  end if;

  return conv;
end;
$$;

-- Reading: messages from a sender blocked in either direction are not returned
-- (my own messages always are).
drop policy if exists messages_read on messages;
create policy messages_read on messages for select to authenticated
  using (
    is_conversation_member(messages.conversation_id)
    and (messages.sender_id = (select auth.uid())
         or not is_blocked_either_way(messages.sender_id))
  );

-- Writing: no message into a conversation that has a member blocked either way.
drop policy if exists messages_write on messages;
create policy messages_write on messages for insert to authenticated
  with check (
    (select auth.uid()) = messages.sender_id
    and is_conversation_member(messages.conversation_id)
    and exists (select 1 from devices d
                where d.id = messages.sender_device_id
                  and d.user_id = (select auth.uid()))
    and not exists (select 1 from conversation_members m
                    where m.conversation_id = messages.conversation_id
                      and m.user_id <> (select auth.uid())
                      and is_blocked_either_way(m.user_id))
  );


-- ============================================================
-- G. MODERATION QUEUE (service_role only)
-- Moderators work from the Supabase dashboard / SQL editor with service_role.
-- See void-app/store/moderation-process.md.
-- ============================================================

create or replace view moderation_queue
with (security_invoker = true) as
  select r.id                 as report_id,
         r.created_at,
         r.reason,
         r.note,
         r.status,
         r.target_post_id,
         p.body               as post_body,
         p.hidden_at          as post_hidden_at,
         coalesce(r.target_user_id, p.author_id) as target_user_id,
         pr.handle            as target_handle,
         r.target_external,
         rp.handle            as reporter_handle,
         (select count(distinct r2.reporter_id) from reports r2
           where r2.target_post_id = r.target_post_id and r2.status = 'open') as open_reports_on_post
    from reports r
    left join posts    p  on p.id  = r.target_post_id
    left join profiles pr on pr.id = coalesce(r.target_user_id, p.author_id)
    left join profiles rp on rp.id = r.reporter_id
   where r.status = 'open'
   order by r.created_at;

revoke all on moderation_queue from anon;
revoke all on moderation_queue from authenticated;

-- Resolve a post: 'remove' deletes it (cascades replies + media), 'keep' unhides
-- and marks it cleared so only NEW reports can re-trigger auto-hide.
create or replace function moderate_post(p_post uuid, p_action text, p_moderator text, p_resolution text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_action = 'remove' then
    update reports set status = 'actioned', reviewed_at = now(), reviewed_by = p_moderator, resolution = coalesce(p_resolution,'post removed')
     where target_post_id = p_post and status = 'open';
    delete from posts where id = p_post;
  elsif p_action = 'keep' then
    update posts set hidden_at = null, review_cleared_at = now() where id = p_post;
    update reports set status = 'dismissed', reviewed_at = now(), reviewed_by = p_moderator, resolution = coalesce(p_resolution,'no violation')
     where target_post_id = p_post and status = 'open';
  else
    raise exception 'action must be remove or keep';
  end if;
end;
$$;

revoke execute on function moderate_post(uuid, text, text, text) from public;
revoke execute on function moderate_post(uuid, text, text, text) from anon;
revoke execute on function moderate_post(uuid, text, text, text) from authenticated;
-- service_role keeps EXECUTE (it bypasses grants as owner-equivalent in Supabase).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function moderate_post(uuid, text, text, text) to service_role';
    execute 'grant select on moderation_queue to service_role';
  end if;
end $$;


-- ============================================================
-- VERIFY (run as each role in a scratch DB)
-- ============================================================
-- 1. As A without terms: insert into posts (author_id, body) values (A,'x')  -> RLS violation.
--    update profiles set terms_accepted_at = now() where id = A; retry -> ok.
-- 2. As A: insert into blocks values (A, B). select * from posts where author_id = B -> 0 rows.
--    As B: select * from blocks -> 0 rows (cannot see A's block).
--    As B: select * from posts where author_id = A -> still visible (no reveal).
-- 3. As B: select start_dm(A) -> 'dm_blocked'. Existing conversation: B inserting a
--    message -> RLS violation; A reading B's old messages -> 0 rows.
-- 4. As C: select * from reports -> only C's own rows. update reports ... -> permission denied.
-- 5. Three distinct users report post P -> posts.hidden_at set; anon/others get 0 rows
--    for P; P's author still sees it. moderate_post(P,'keep','mod') -> visible again,
--    and two further reports do not re-hide it until a third new reporter.
-- 6. insert into reports (reporter_id, target_post_id, reason, status) values (me,P,'spam','actioned')
--    -> permission denied (status is not in the column grant).


-- ════════════════════════════════════════════════════════════
-- migrations/007_media_and_dms.sql
-- ════════════════════════════════════════════════════════════
-- ============================================================
-- 007_media_and_dms.sql
--
-- Two store-review blockers, both "demo feature" rejections:
--
--   A. POST MEDIA. The composer attached photos / videos / voice notes as local
--      blob: URLs that never left the device. This adds the `post-media` Storage
--      bucket (public read, owner-prefix writes, mime + size limits), the columns
--      post_media needs to describe a file, and create_post() so a post and its
--      media land atomically (a failed second request can no longer leave a
--      media post with no media).
--
--   B. DIRECT MESSAGES. 001 modelled DMs for Signal-style E2EE only: `messages`
--      carries no body and requires a sender device, and the ciphertext lives in
--      message_envelopes. No client implements that protocol, so the app shipped
--      a localStorage mock. This adds a plaintext `messages.body` path, stored on
--      the server under the SAME members-only RLS. It is NOT end-to-end
--      encrypted and the client says so. The envelope path is left intact for a
--      future real E2EE client (a row carries a body OR a sender device).
--
--   Blocks: 006_moderation adds `blocks (blocker_id, blocked_id)` and already
--   redefines start_dm / messages_read / messages_write with block checks. 007
--   runs AFTER 006 and re-creates start_dm and messages_write, so both keep
--   006's either-direction block rule (same 'dm_blocked' error). The check goes
--   through void_users_blocked(), which returns false if `blocks` is absent, so
--   007 also applies cleanly on a project where 006 was skipped.
--   006's posts_insert (terms accepted) and messages_read are NOT touched;
--   create_post is SECURITY INVOKER, so the terms rule still applies to it.
--
-- Depends on: 001, 004 (column grants on posts), 006 if present (see above). Idempotent: safe to re-run.
-- NOT EXECUTED by the author (no database credentials were available). Apply in
-- the SQL editor, then run the checks at the bottom.
-- ============================================================


-- ============================================================
-- A1. STORAGE BUCKET
--
-- Bucket-level limits are enforced by the Storage API before any bytes are
-- stored: 100 MB (the largest per-kind cap) and the mime allow-list. The
-- per-kind caps (image 10 MB, audio 20 MB, video 100 MB) are enforced by the
-- insert policy below against the object metadata the Storage API writes.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media', 'post-media', true, 104857600,
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/webm','audio/ogg','audio/mp4','audio/mpeg'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Byte cap for an object key, by extension. NULL = extension not allowed.
-- webm is shared by video and audio; the client names audio takes *.weba so
-- the 20 MB audio cap applies to them.
create or replace function public.post_media_max_bytes(object_name text)
returns bigint
language sql immutable set search_path = public as $$
  select case lower(coalesce(substring(object_name from '\.([A-Za-z0-9]+)$'), ''))
    when 'jpg'  then 10485760  when 'jpeg' then 10485760
    when 'png'  then 10485760  when 'webp' then 10485760
    when 'gif'  then 10485760
    when 'mp4'  then 104857600 when 'webm' then 104857600
    when 'mov'  then 104857600
    when 'weba' then 20971520  when 'ogg'  then 20971520
    when 'oga'  then 20971520  when 'm4a'  then 20971520
    when 'mp3'  then 20971520
    else null
  end;
$$;

-- Objects: `<auth.uid()>/<file>` only — exactly one folder level, and it must
-- be the caller's id. metadata is NULL during the Storage API's pre-upload
-- permission probe and populated (size, mimetype) on the real write; the
-- coalesce lets the probe through and the real write is checked.
drop policy if exists post_media_insert_own on storage.objects;
create policy post_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 1
    and public.post_media_max_bytes(name) is not null
    and coalesce((metadata->>'size')::bigint, 0) <= public.post_media_max_bytes(name)
  );

-- Public bucket: reads go through /object/public/ and need no policy. This
-- select policy only lets an owner see (and therefore delete) their own keys;
-- it does not allow listing anyone else's prefix.
drop policy if exists post_media_select_own on storage.objects;
create policy post_media_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'post-media'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists post_media_delete_own on storage.objects;
create policy post_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-media'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No UPDATE policy: an uploaded object is immutable (the client never upserts).

-- Belt and braces for the per-kind caps. Depending on the Storage API version,
-- the row that carries metadata.size may be written by a privileged role after
-- the RLS probe, in which case the policy above never sees the size. A trigger
-- fires for every role. Wrapped: if this project's `postgres` role cannot
-- create triggers on storage.objects, the migration continues and says so
-- (the 100 MB bucket cap still applies).
create or replace function public.post_media_enforce_size()
returns trigger language plpgsql set search_path = public as $$
declare cap bigint;
begin
  if new.bucket_id = 'post-media' and new.metadata ? 'size' then
    cap := public.post_media_max_bytes(new.name);
    if cap is null or (new.metadata->>'size')::bigint > cap then
      raise exception 'post-media object % exceeds its size cap (% bytes)', new.name, cap
        using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists post_media_size_guard on storage.objects';
  execute 'create trigger post_media_size_guard
             before insert or update on storage.objects
             for each row execute function public.post_media_enforce_size()';
exception when insufficient_privilege then
  raise notice '007: could not create post_media_size_guard on storage.objects (%). Per-kind caps rely on the insert policy only.', sqlerrm;
end $$;


-- ============================================================
-- A2. post_media — describe the file
-- ============================================================

alter table post_media add column if not exists kind text not null default 'image';
alter table post_media add column if not exists mime text;
alter table post_media add column if not exists duration_s integer;

alter table post_media drop constraint if exists post_media_kind_check;
alter table post_media add  constraint post_media_kind_check
  check (kind in ('image','video','audio'));

alter table post_media drop constraint if exists post_media_duration_check;
alter table post_media add  constraint post_media_duration_check
  check (duration_s is null or duration_s between 0 and 86400);

alter table post_media drop constraint if exists post_media_ordinal_check;
alter table post_media add  constraint post_media_ordinal_check
  check (ordinal between 0 and 9) not valid;

-- Only this project's post-media bucket may be referenced: no hotlinked
-- tracking pixels or arbitrary third-party URLs in the feed. NOT VALID so any
-- pre-existing rows do not block the migration; every new row is checked.
alter table post_media drop constraint if exists post_media_url_check;
alter table post_media add  constraint post_media_url_check
  check (url ~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/post-media/[0-9a-f-]{36}/[A-Za-z0-9._-]+$')
  not valid;

-- RESTRICTIVE: ANDed with media_write (001). A row may only reference an object
-- under the author's own prefix, so nobody can attach someone else's upload.
drop policy if exists media_own_prefix_insert on post_media;
create policy media_own_prefix_insert on post_media
  as restrictive for insert to authenticated
  with check (split_part(split_part(url, '/post-media/', 2), '/', 1) = (select auth.uid())::text);

drop policy if exists media_own_prefix_update on post_media;
create policy media_own_prefix_update on post_media
  as restrictive for update to authenticated
  using (true)
  with check (split_part(split_part(url, '/post-media/', 2), '/', 1) = (select auth.uid())::text);


-- ============================================================
-- A3. posts.body may be empty (a photo / voice-note drop needs no caption)
--
-- 001 declared `check (char_length(body) between 1 and 4000)` inline, so its
-- name is generated (posts_body_check). Drop whatever check constrains
-- char_length(body) rather than trusting the name. Emptiness is enforced by
-- create_post() instead: body OR media, never neither.
-- ============================================================

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.posts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%char_length(body)%'
      and conname <> 'posts_body_len'
  loop
    execute format('alter table public.posts drop constraint %I', c.conname);
  end loop;
end $$;

alter table posts drop constraint if exists posts_body_len;
alter table posts add  constraint posts_body_len check (char_length(body) <= 4000);


-- ============================================================
-- A4. create_post — one transaction for the post and its media
--
-- SECURITY INVOKER: every insert runs as the caller, so posts_insert,
-- media_write, media_own_prefix_insert, the 004 column grants and
-- guard_post_insert all still apply. This function adds no privilege.
-- p_media: [{"url": "...", "kind": "image|video|audio", "mime": "...",
--            "duration_s": 12}, ...] in display order.
-- ============================================================

create or replace function create_post(
  p_id       uuid,
  p_body     text,
  p_media    jsonb default '[]'::jsonb,
  p_reply_to uuid  default null
)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  me  uuid := (select auth.uid());
  m   jsonb;
  i   integer := 0;
  pid uuid := coalesce(p_id, gen_random_uuid());
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  p_body  := coalesce(p_body, '');
  p_media := coalesce(p_media, '[]'::jsonb);
  if jsonb_typeof(p_media) <> 'array' then raise exception 'media must be an array'; end if;
  if jsonb_array_length(p_media) > 10 then raise exception 'too many media items'; end if;
  if btrim(p_body) = '' and jsonb_array_length(p_media) = 0 then
    raise exception 'empty post';
  end if;

  insert into posts (id, author_id, body, reply_to)
  values (pid, me, p_body, p_reply_to);

  for m in select value from jsonb_array_elements(p_media) loop
    insert into post_media (post_id, url, ordinal, kind, mime, duration_s)
    values (pid, m->>'url', i, coalesce(m->>'kind', 'image'), m->>'mime',
            nullif(m->>'duration_s', '')::integer);
    i := i + 1;
  end loop;

  return pid;
end;
$$;

revoke all on function create_post(uuid, text, jsonb, uuid) from public, anon;
grant execute on function create_post(uuid, text, jsonb, uuid) to authenticated;


-- ============================================================
-- B1. BLOCKS (guarded — 006 may or may not be applied)
-- ============================================================

create or replace function void_users_blocked(a uuid, b uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean := false;
begin
  if a is null or b is null or to_regclass('public.blocks') is null then
    return false;
  end if;
  begin
    execute 'select exists (select 1 from public.blocks
               where (blocker_id = $1 and blocked_id = $2)
                  or (blocker_id = $2 and blocked_id = $1))'
      into r using a, b;
  exception when undefined_column then
    r := false;          -- 006 used different column names; fail open, loudly documented
  end;
  return coalesce(r, false);
end;
$$;

-- True when the caller and any other member of `conv` have a block either way.
create or replace function dm_blocked(conv uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_members o
    where o.conversation_id = conv
      and o.user_id <> (select auth.uid())
      and void_users_blocked((select auth.uid()), o.user_id)
  );
$$;

revoke all on function void_users_blocked(uuid, uuid) from public, anon;
revoke all on function dm_blocked(uuid)               from public, anon;
grant execute on function void_users_blocked(uuid, uuid) to authenticated;
grant execute on function dm_blocked(uuid)               to authenticated;


-- ============================================================
-- B2. start_dm — same body as 006 (001 + block check), via the guarded helper
-- ============================================================

create or replace function start_dm(other_user uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := (select auth.uid());
  key  text;
  conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user = me then raise exception 'cannot DM yourself'; end if;
  if not exists (select 1 from profiles where id = other_user) then
    raise exception 'no such user';
  end if;
  if void_users_blocked(me, other_user) then
    raise exception 'dm_blocked' using errcode = '42501';   -- same error 006 raises
  end if;

  key := least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);

  insert into conversations (kind, dm_key) values ('dm', key)
  on conflict (dm_key) do nothing
  returning id into conv;

  if conv is null then                      -- lost the race; reuse the winner
    select id into conv from conversations where dm_key = key;
  else
    insert into conversation_members (conversation_id, user_id)
    values (conv, me), (conv, other_user);
  end if;

  return conv;
end;
$$;

revoke all on function start_dm(uuid) from public, anon;
grant execute on function start_dm(uuid) to authenticated;


-- ============================================================
-- B3. messages — plaintext body (server-stored, NOT end-to-end encrypted)
-- ============================================================

alter table messages add column if not exists body text;
alter table messages alter column sender_device_id drop not null;

alter table messages drop constraint if exists messages_body_len;
alter table messages add  constraint messages_body_len
  check (body is null or char_length(body) between 1 and 2000);

-- A row is either a plaintext message (body) or an E2EE message (sender device
-- + envelopes). Never neither.
alter table messages drop constraint if exists messages_payload;
alter table messages add  constraint messages_payload
  check (body is not null or sender_device_id is not null);

drop policy if exists messages_write on messages;
create policy messages_write on messages for insert to authenticated
  with check ((select auth.uid()) = sender_id
              and is_conversation_member(conversation_id)
              and (messages.sender_device_id is null
                   or exists (select 1 from devices d
                              where d.id = messages.sender_device_id
                                and d.user_id = (select auth.uid())))
              and not dm_blocked(conversation_id));

-- created_at stays server-assigned (a client timestamp would reorder threads).
revoke insert on messages from anon;
revoke insert on messages from authenticated;
grant  insert (id, conversation_id, sender_id, sender_device_id, envelope_version, body)
  on messages to authenticated;
-- 001 grants no UPDATE/DELETE policy on messages: sent messages are immutable.


-- ============================================================
-- CHECKS (run after applying; as two different signed-in users A and B)
--
-- 1. Bucket:  select id, public, file_size_limit, allowed_mime_types
--             from storage.buckets where id = 'post-media';
-- 2. Upload as A to post-media/<B's id>/x.webp          -> 403 (RLS)
--    Upload as A to post-media/<A's id>/x.exe           -> 400/403 (mime/ext)
--    Upload a 15 MB jpeg as A                            -> 403 (image cap)
-- 3. select create_post(gen_random_uuid(), '', '[]');   -> 'empty post'
--    create_post with a media url under B's prefix, as A -> RLS violation
-- 4. As A: select start_dm('<B>');  twice                -> same uuid
--    As A: insert into messages (conversation_id, sender_id, body)
--          values ('<conv>', auth.uid(), 'hi');          -> ok
--    As C (not a member): select * from messages where conversation_id='<conv>' -> 0 rows
--    As C: insert into that conversation                 -> RLS violation
-- 5. With 006 applied and A blocking B: start_dm / insert  -> 'blocked' / RLS violation
-- ============================================================

