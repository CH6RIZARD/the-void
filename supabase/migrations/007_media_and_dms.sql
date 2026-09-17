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
