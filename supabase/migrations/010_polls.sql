-- ============================================================
-- 010_polls.sql — Polls: The Void's question, the archive, the floor
--
-- The Polls section (handoff THE-VOID-22b §4) shipped reading a JSON blob on the
-- phone, so a suggested question was visible to one person. This is the shared
-- version: one table of questions (kind 'void' = set by The Void, numbered; kind
-- 'floor' = suggested by a user), one vote per user per question (+1 / -1, delete
-- to clear), replies ("chime in") on any question, and one like per user per reply.
--
-- poll_board is the read model the app pulls: every question with its author's
-- handle, up / down totals and reply count, in one request. It is security_invoker
-- so the tables' own RLS applies through it.
--
-- Reads are public (anon), the same as posts after 008. Writes are the signed-in
-- user's own rows only; a user can only create 'floor' questions, never 'void' ones.
--
-- Depends on: 001 (profiles). Idempotent: safe to re-run.
-- APPLIED 2026-10-09 via the dashboard SQL editor (3 void rows returned). Re-running is safe;
-- the checks at the bottom are there for a fresh project.
-- ============================================================

create table if not exists poll_questions (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid references profiles(id) on delete cascade,   -- null = set by The Void
  body       text not null check (char_length(body) between 12 and 140),
  kind       text not null default 'floor' check (kind in ('floor','void')),
  no         integer,                                           -- The Void's numbering
  created_at timestamptz not null default now(),
  check (kind = 'void' or author_id is not null),
  check (kind = 'floor' or no is not null)
);
create unique index if not exists poll_questions_void_no on poll_questions (no) where kind = 'void';
create index if not exists poll_questions_kind_idx on poll_questions (kind, created_at desc);

create table if not exists poll_votes (
  question_id uuid not null references poll_questions(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  dir         smallint not null check (dir in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (question_id, user_id)
);

create table if not exists poll_replies (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references poll_questions(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists poll_replies_q_idx on poll_replies (question_id, created_at);

create table if not exists poll_reply_likes (
  reply_id   uuid not null references poll_replies(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id)
);

-- ---------- read model ----------
create or replace view poll_board as
  select q.id, q.kind, q.no, q.body, q.author_id, q.created_at,
         p.handle::text as by_handle,
         coalesce(sum(case when v.dir =  1 then 1 end), 0)::int as up,
         coalesce(sum(case when v.dir = -1 then 1 end), 0)::int as down,
         (select count(*) from poll_replies r where r.question_id = q.id)::int as replies
    from poll_questions q
    left join profiles p on p.id = q.author_id
    left join poll_votes v on v.question_id = q.id
   group by q.id, p.handle;
alter view poll_board set (security_invoker = on);

-- ---------- RLS ----------
alter table poll_questions   enable row level security;
alter table poll_votes       enable row level security;
alter table poll_replies     enable row level security;
alter table poll_reply_likes enable row level security;

drop policy if exists poll_questions_read on poll_questions;
create policy poll_questions_read on poll_questions for select using (true);
drop policy if exists poll_questions_insert on poll_questions;
create policy poll_questions_insert on poll_questions for insert to authenticated
  with check (author_id = (select auth.uid()) and kind = 'floor');

drop policy if exists poll_votes_read on poll_votes;
create policy poll_votes_read on poll_votes for select using (true);
drop policy if exists poll_votes_write on poll_votes;
create policy poll_votes_write on poll_votes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists poll_replies_read on poll_replies;
create policy poll_replies_read on poll_replies for select using (true);
drop policy if exists poll_replies_insert on poll_replies;
create policy poll_replies_insert on poll_replies for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists poll_reply_likes_read on poll_reply_likes;
create policy poll_reply_likes_read on poll_reply_likes for select using (true);
drop policy if exists poll_reply_likes_write on poll_reply_likes;
create policy poll_reply_likes_write on poll_reply_likes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on poll_questions, poll_votes, poll_replies, poll_reply_likes, poll_board to anon, authenticated;
grant insert (author_id, body, kind) on poll_questions to authenticated;
grant insert, update, delete on poll_votes to authenticated;
grant insert (question_id, author_id, body) on poll_replies to authenticated;
grant insert, delete on poll_reply_likes to authenticated;

-- ---------- The Void's questions so far ----------
-- Fixed ids so the archive numbering is stable across re-runs. No. 3 is live.
insert into poll_questions (id, kind, no, body, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'void', 1, 'Which country''s feed surprised you most once you actually scrolled it?', '2026-09-24 09:00+00'),
  ('00000000-0000-4000-8000-000000000002', 'void', 2, 'Does watching a place live make you care about it more, or only feel like you do?', '2026-10-01 09:00+00'),
  ('00000000-0000-4000-8000-000000000003', 'void', 3, 'Which live cam do you keep going back to, and what are you waiting to see?', '2026-10-07 09:00+00')
on conflict (id) do nothing;

-- ---------- checks ----------
-- select kind, no, body, up, down, replies from poll_board order by kind, created_at;   -- 3 void rows
-- As a signed-in user:
--   insert into poll_votes (question_id, user_id, dir) values ('00000000-0000-4000-8000-000000000003', auth.uid(), 1);
--   insert into poll_questions (author_id, body) values (auth.uid(), 'Should every post show where it was filmed?');
--   insert into poll_questions (author_id, body, kind, no) values (auth.uid(), 'x', 'void', 9);  -- must FAIL (RLS)
