-- ============================================================
-- 013_poll_admin.sql — poll admins can edit, accept and remove questions
--
-- The admin page (admin/polls.html) signs in as a normal Void account. Only
-- accounts listed in poll_admins can call these functions; everyone else gets
-- 'not a poll admin'. The tables' RLS is unchanged: the functions are security
-- definer and do their own check.
--
--   poll_admin_edit(id, body)  change the wording of any question
--   poll_admin_accept(id)      run a floor question as The Void's next numbered one
--                              (it goes live: the newest number is the live question)
--   poll_admin_remove(id)      delete a question (its votes and replies go with it)
--
-- Depends on: 010. Idempotent: safe to re-run.
-- ============================================================

create table if not exists poll_admins (
  user_id uuid primary key references profiles(id) on delete cascade
);
alter table poll_admins enable row level security;
drop policy if exists poll_admins_self on poll_admins;
create policy poll_admins_self on poll_admins for select to authenticated using (user_id = (select auth.uid()));
grant select on poll_admins to authenticated;

create or replace function is_poll_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from poll_admins where user_id = auth.uid())
$$;

create or replace function poll_admin_edit(p_id uuid, p_body text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_poll_admin() then raise exception 'not a poll admin'; end if;
  update poll_questions set body = btrim(p_body) where id = p_id;
  if not found then raise exception 'no such question'; end if;
end $$;

create or replace function poll_admin_accept(p_id uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_poll_admin() then raise exception 'not a poll admin'; end if;
  perform 1 from poll_questions where id = p_id and kind = 'floor' for update;
  if not found then raise exception 'not a floor question'; end if;
  select coalesce(max(no), 0) + 1 into n from poll_questions where kind = 'void';
  update poll_questions set kind = 'void', no = n, created_at = now() where id = p_id;
  return n;
end $$;

create or replace function poll_admin_remove(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_poll_admin() then raise exception 'not a poll admin'; end if;
  delete from poll_questions where id = p_id;
end $$;

revoke all on function poll_admin_edit(uuid, text), poll_admin_accept(uuid), poll_admin_remove(uuid) from public, anon;
grant execute on function is_poll_admin(), poll_admin_edit(uuid, text), poll_admin_accept(uuid), poll_admin_remove(uuid) to authenticated;

-- The owner's account. If this adds nothing (different email), the admin page
-- shows your user id and the one-line insert to run instead.
insert into poll_admins (user_id)
  select u.id from auth.users u join profiles p on p.id = u.id
   where lower(u.email) = 'daniel4chigs@gmail.com'
on conflict do nothing;

-- check: select * from poll_admins;   -- 1 row
