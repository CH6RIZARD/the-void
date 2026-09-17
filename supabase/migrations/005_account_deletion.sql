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
