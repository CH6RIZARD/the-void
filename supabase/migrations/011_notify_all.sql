-- 011 · every notification routes to Mail
--
-- Before this, only bolts (rank), follows and replies on drops wrote a row. These
-- events reached nobody:
--   mention     @handle in a drop                       -> the mentioned user
--   mention     @handle in a poll reply ("chime")        -> the mentioned user
--   chime       someone chimes in on your poll question  -> the question's author
--   chime_bolt  someone bolts your chime                 -> the chime's author
--   void        The Void puts your floor question up     -> the question's author
-- Like 001 / 006: trigger-written only (security definer), never to yourself, and not
-- written at all when the recipient blocked the actor. A reply already notifies the
-- parent's author, so a mention of that same person in the reply is not doubled.
-- Additive and idempotent: safe to re-run.

-- ---------- schema ----------
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('rank','slash','follow','reply','message','mention','chime','chime_bolt','void'));

alter table notifications add column if not exists question_id   uuid references poll_questions(id) on delete cascade;
alter table notifications add column if not exists poll_reply_id uuid references poll_replies(id)   on delete cascade;
create index if not exists notifications_question_idx on notifications (question_id) where question_id is not null;

-- @handles in a text, as profile ids. Handles are ^[a-z0-9_]{3,20}$ (citext).
create or replace function mentioned_ids(p_body text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id
    from regexp_matches(coalesce(p_body, ''), '(?:^|[^a-z0-9_@])@([a-z0-9_]{3,20})', 'gi') as m(h)
    join profiles p on p.handle = m.h[1]::citext
   limit 10;
$$;
revoke all on function mentioned_ids(text) from public, anon, authenticated;

-- ---------- mentions in drops ----------
create or replace function notify_on_post_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_author uuid;
begin
  if new.reply_to is not null then
    select author_id into parent_author from posts where id = new.reply_to;
  end if;
  insert into notifications (user_id, actor_id, type, post_id)
  select m, new.author_id, 'mention', new.id
    from mentioned_ids(new.body) as m
   where m <> new.author_id
     and m is distinct from parent_author
     and not exists (select 1 from blocks b where b.blocker_id = m and b.blocked_id = new.author_id);
  return new;
end;
$$;
drop trigger if exists posts_notify_mention on posts;
create trigger posts_notify_mention after insert on posts
  for each row execute function notify_on_post_mention();

-- ---------- chimes (poll replies) ----------
create or replace function notify_on_chime()
returns trigger language plpgsql security definer set search_path = public as $$
declare q_author uuid;
begin
  select author_id into q_author from poll_questions where id = new.question_id;
  if q_author is not null and q_author <> new.author_id
     and not exists (select 1 from blocks b where b.blocker_id = q_author and b.blocked_id = new.author_id) then
    insert into notifications (user_id, actor_id, type, question_id, poll_reply_id)
    values (q_author, new.author_id, 'chime', new.question_id, new.id);
  end if;
  insert into notifications (user_id, actor_id, type, question_id, poll_reply_id)
  select m, new.author_id, 'mention', new.question_id, new.id
    from mentioned_ids(new.body) as m
   where m <> new.author_id
     and m is distinct from q_author
     and not exists (select 1 from blocks b where b.blocker_id = m and b.blocked_id = new.author_id);
  return new;
end;
$$;
drop trigger if exists poll_replies_notify on poll_replies;
create trigger poll_replies_notify after insert on poll_replies
  for each row execute function notify_on_chime();

-- ---------- bolts on a chime ----------
create or replace function notify_on_chime_bolt()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select author_id, question_id into r from poll_replies where id = new.reply_id;
  if r.author_id is not null and r.author_id <> new.user_id
     and not exists (select 1 from blocks b where b.blocker_id = r.author_id and b.blocked_id = new.user_id) then
    insert into notifications (user_id, actor_id, type, question_id, poll_reply_id)
    values (r.author_id, new.user_id, 'chime_bolt', r.question_id, new.reply_id);
  end if;
  return new;
end;
$$;
drop trigger if exists poll_reply_likes_notify on poll_reply_likes;
create trigger poll_reply_likes_notify after insert on poll_reply_likes
  for each row execute function notify_on_chime_bolt();

-- ---------- The Void puts your question up ----------
create or replace function notify_on_void_pick()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'void' and old.kind = 'floor' and new.author_id is not null then
    insert into notifications (user_id, actor_id, type, question_id)
    values (new.author_id, null, 'void', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists poll_questions_notify_void on poll_questions;
create trigger poll_questions_notify_void after update of kind on poll_questions
  for each row execute function notify_on_void_pick();

-- ---------- checks ----------
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_type_check';
-- select tgname from pg_trigger where tgname in ('posts_notify_mention','poll_replies_notify','poll_reply_likes_notify','poll_questions_notify_void');
