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
