-- ============================================================
-- 009_calls.sql — 1:1 voice/video call signaling for DMs
--
-- Media runs over LiveKit (room `dm_<conversation_id>`, token minted by the
-- livekit-token Edge Function). This table is only the RING: who is calling
-- whom, in which thread, and what happened to it. The callee's app subscribes
-- to Realtime INSERTs on `calls` filtered to callee_id, the caller's app to
-- UPDATEs filtered to caller_id, so the two phones agree on ringing /
-- accepted / declined / ended without a push service.
--
-- No timer on the server: a ring that nobody answers is marked `missed` by the
-- CALLER's client after 45s. A server-side sweep for callers that die
-- mid-ring is a follow-up (needs pg_cron), not needed for the first pass.
-- The only trigger here guards the status ladder (see calls_guard_status).
--
-- Call rows are NOT copied into `messages` (sent messages are immutable per
-- 007, and a call row changes until it ends). The thread merges `calls` by
-- created_at client-side.
--
-- Safe to re-run.
-- ============================================================

create table if not exists calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  caller_id       uuid not null references profiles(id) on delete cascade,
  callee_id       uuid not null references profiles(id) on delete cascade,
  kind            text not null check (kind in ('audio','video')),
  status          text not null default 'ringing'
                  check (status in ('ringing','accepted','declined','ended','missed')),
  created_at      timestamptz not null default now(),   -- server-assigned: ring order
  answered_at     timestamptz,
  ended_at        timestamptz,
  check (caller_id <> callee_id)
);

-- The ring subscription (callee_id = me, status = 'ringing') and the "any
-- call still open in this thread?" check both hit this.
create index if not exists calls_callee_status_idx on calls (callee_id, status);
create index if not exists calls_conversation_idx  on calls (conversation_id, created_at desc);

alter table calls enable row level security;

-- Read: the two members of the thread, through the SECURITY DEFINER helper
-- from 001 (direct conversation_members references in a policy recurse).
drop policy if exists calls_read on calls;
create policy calls_read on calls for select to authenticated
  using (is_conversation_member(conversation_id));

-- Insert: I am the caller, I am in the thread, the callee is the OTHER member
-- of that thread, and neither of us has blocked the other. The last clause
-- mirrors messages_write in 007: a blocked pair cannot ring each other.
drop policy if exists calls_insert on calls;
create policy calls_insert on calls for insert to authenticated
  with check ((select auth.uid()) = caller_id
              and is_conversation_member(calls.conversation_id)
              and exists (select 1 from conversation_members m
                          where m.conversation_id = calls.conversation_id
                            and m.user_id = calls.callee_id)
              and not dm_blocked(calls.conversation_id));

-- Update: either side moves the status (accept, decline, end, missed). Column
-- grant below keeps the parties, kind and conversation fixed after insert.
drop policy if exists calls_update on calls;
create policy calls_update on calls for update to authenticated
  using ((select auth.uid()) in (caller_id, callee_id))
  with check ((select auth.uid()) in (caller_id, callee_id));

-- Status is a one-way ladder: ringing -> accepted|declined|missed|ended, and
-- accepted -> ended. Both phones PATCH by id with no precondition, so without
-- this the caller's 45s "missed" timer can land on a row the callee accepted
-- a moment earlier, and a cancel racing a decline leaves whichever landed last
-- in history. RLS with-check cannot see OLD; a BEFORE UPDATE trigger can. It
-- raises rather than swallowing: the accept path surfaces the error as
-- "could not answer" (the call really is gone), the end/decline/missed paths
-- already fire-and-forget.
create or replace function calls_guard_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and not (old.status = 'ringing' and new.status in ('accepted','declined','missed','ended'))
     and not (old.status = 'accepted' and new.status = 'ended') then
    raise exception 'call % is %, cannot become %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists calls_guard_status on calls;
create trigger calls_guard_status before update on calls
  for each row execute function calls_guard_status();

-- No DELETE policy: call history stays in the thread like messages do.

-- Explicit grants (new tables are no longer auto-exposed on current projects).
grant select on calls to authenticated;
revoke insert on calls from anon;
revoke insert on calls from authenticated;
grant  insert (conversation_id, caller_id, callee_id, kind) on calls to authenticated;
revoke update on calls from authenticated;
grant  update (status, answered_at, ended_at) on calls to authenticated;

-- Realtime. No other table is in the publication yet (grep publication
-- migrations/*.sql), so this is the first. postgres_changes applies RLS, so
-- the client filter `callee_id=eq.<me>` plus calls_read scope the ring.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table calls;
  end if;
end $$;

-- ============================================================
-- CHECKS (as two signed-in members A and B of conversation C; X is a stranger)
--
-- A: insert into calls (conversation_id, caller_id, callee_id, kind)
--      values (C, A, B, 'audio') returning id;              -- 1 row
-- A: insert ... values (C, A, X, 'audio');                   -- RLS error (X not a member)
-- A: insert ... values (C, A, B, 'screen');                  -- check constraint error
-- X: select * from calls where conversation_id = C;          -- 0 rows
-- B: update calls set status = 'accepted', answered_at = now() where id = <id>;  -- 1 row
-- B: update calls set kind = 'video' where id = <id>;        -- permission denied (column grant)
-- A: update calls set status = 'bogus' where id = <id>;      -- check constraint error
-- A: update calls set status = 'missed', ended_at = now() where id = <id>;
--                                                            -- ERROR "call ... is accepted, cannot become missed"
-- B: update calls set ended_at = now() where id = <id>;      -- 1 row (status unchanged is fine)
-- A: update calls set status = 'ended', ended_at = now() where id = <id>;  -- 1 row
-- B: update calls set status = 'declined' where id = <id>;   -- ERROR (ended is final)
-- A: delete from calls where id = <id>;                      -- 0 rows (no policy)
-- ============================================================
