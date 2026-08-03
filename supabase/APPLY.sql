-- THE VOID — APPLY.sql
-- 001 + 002 + 003 (Supabase-native). Do NOT include 000 (Railway-only shim).

-- ========== BEGIN 001_void_schema.sql ==========
-- ============================================================
-- THE VOID — v1 schema (rev 3)
-- Supabase / Postgres + PostGIS. Run as a single migration.
--
-- rev 3 = rev 2 + every fix from SCHEMA_REVIEW.md:
--   A. claim_prekey_bundle locks ONE prekey per device (LATERAL + LIMIT 1).
--      rev 2 locked the user's whole unclaimed pool, so concurrent callers got
--      no one-time prekey at all and silently lost forward secrecy.
--   B. set_post_region short-circuits when location is unchanged. rev 2 fired a
--      ST_Covers point-in-polygon on EVERY reaction, via apply_reaction_score's
--      UPDATE on posts — the hottest write path in the system.
--   C. topic_sources seeds 'gdelt' (free, region-native, already allowlisted).
--   D. topics carries CONTRACTS.md provenance.
--   E. envelopes_write binds recipient_device_id to conversation membership.
--   F. devices exposes keys but not display_name / last_seen_at.
--   G. posts_in_bbox handles the antimeridian.
--   H. reply notifications.
--   I. handle is matched case-insensitively.
--
-- NOT EXECUTED by the author of this file — no Postgres was available. Run it
-- against a scratch project first and work through VERIFY at the bottom.
-- ============================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ============================================================
-- 1. REGIONS  (ISO 3166-2 canonical key)
-- ============================================================

create table regions (
  code         text primary key,                 -- 'US-TX', 'NG-RI', 'JP-13', 'NG'
  name         text not null,
  level        text not null check (level in ('country','subdivision')),
  parent_code  text references regions(code),
  centroid     geography(Point,4326),
  geom         geography(MultiPolygon,4326),
  custom       boolean not null default false,
  created_at   timestamptz not null default now()
);

create index regions_geom_gix   on regions using gist (geom);
create index regions_parent_idx on regions (parent_code);
create index regions_level_idx  on regions (level);

comment on column regions.custom is
  'true for codes not in ISO 3166-2 (contested or disputed territories). Never hardcode region codes in an enum — add rows here.';

-- Seed from Natural Earth admin-0 (iso_a2 -> country) and admin-1
-- (iso_3166_2 -> subdivision). parent_code for a subdivision is the substring
-- before the hyphen. Seeding runs as service_role: regions has read-only RLS.

-- ============================================================
-- 2. PROFILES
-- ============================================================

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  -- FIX I: citext makes uniqueness case-insensitive, but a case-SENSITIVE check
  -- rejected 'Bob' outright at signup instead of folding it. ~* matches
  -- case-insensitively; lowercase on write in the client for a canonical value.
  handle       citext unique not null check (handle ~* '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 3. POSTS
-- ============================================================

create table posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  location    geography(Point,4326),             -- the place the post is ABOUT
  region_code text references regions(code),     -- DERIVED — see set_post_region
  rank_score  integer not null default 0,        -- DERIVED — see apply_reaction_score
  reply_to    uuid references posts(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index posts_location_gix on posts using gist (location);
create index posts_region_idx   on posts (region_code, created_at desc);
create index posts_author_idx   on posts (author_id, created_at desc);
create index posts_reply_idx    on posts (reply_to) where reply_to is not null;
create index posts_rank_idx     on posts (rank_score desc, created_at desc);

create table post_media (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references posts(id) on delete cascade,
  url      text not null,
  ordinal  smallint not null,                    -- preserves carousel order
  unique (post_id, ordinal)
);

create index post_media_post_idx on post_media (post_id, ordinal);

-- FIX B. Fires on ANY insert/update so region_code can never be hand-set, but
-- returns immediately when location did not change. Without the short-circuit,
-- every rank/slash ran ST_Covers against admin-1 MultiPolygons, because
-- apply_reaction_score() UPDATEs posts. The unchanged branch still discards any
-- client-supplied region_code by forcing it back to the stored value.
create or replace function set_post_region()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.location is not distinct from old.location then
    new.region_code := old.region_code;
    return new;
  end if;

  if new.location is null then
    new.region_code := null;
    return new;
  end if;

  select r.code into new.region_code
  from regions r
  where r.geom is not null
    and ST_Covers(r.geom, new.location)
  order by (r.level = 'subdivision') desc          -- prefer state over country
  limit 1;

  return new;
end;
$$;

create trigger posts_set_region
  before insert or update on posts
  for each row execute function set_post_region();

-- ============================================================
-- 4. REACTIONS
-- ============================================================

create table reactions (
  post_id    uuid not null references posts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null check (kind in ('rank','slash')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index reactions_user_idx on reactions (user_id, created_at desc);

create or replace function apply_reaction_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare delta integer;
begin
  if tg_op = 'INSERT' then
    delta := case when new.kind = 'rank' then 1 else -1 end;
  elsif tg_op = 'UPDATE' then
    delta := (case when new.kind = 'rank' then 1 else -1 end)
           - (case when old.kind = 'rank' then 1 else -1 end);
  else
    delta := case when old.kind = 'rank' then -1 else 1 end;
  end if;

  update posts set rank_score = rank_score + delta
   where id = coalesce(new.post_id, old.post_id);

  return coalesce(new, old);
end;
$$;

create trigger reactions_score
  after insert or update or delete on reactions
  for each row execute function apply_reaction_score();

-- ============================================================
-- 5. FOLLOWS
-- ============================================================

create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_followee_idx on follows (followee_id);

-- ============================================================
-- 6. NOTIFICATIONS  (trigger-written only)
-- ============================================================

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete cascade,
  type       text not null check (type in ('rank','slash','follow','reply','message')),
  post_id    uuid references posts(id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx   on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

create or replace function notify_on_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  select author_id into target from posts where id = new.post_id;
  if target is not null and target <> new.user_id then
    insert into notifications (user_id, actor_id, type, post_id)
    values (target, new.user_id, new.kind, new.post_id);
  end if;
  return new;
end;
$$;

create trigger reactions_notify after insert on reactions
  for each row execute function notify_on_reaction();

create or replace function notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');
  return new;
end;
$$;

create trigger follows_notify after insert on follows
  for each row execute function notify_on_follow();

-- FIX H. notifications.type permitted 'reply' but nothing emitted it, so thread
-- replies were silent while the notification feed is a stated requirement.
-- 'message' stays unemitted here on purpose: a DM notification must be written
-- client-side after local decryption, because nothing server-side may read
-- message content.
create or replace function notify_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if new.reply_to is null then return new; end if;
  select author_id into target from posts where id = new.reply_to;
  if target is not null and target <> new.author_id then
    insert into notifications (user_id, actor_id, type, post_id)
    values (target, new.author_id, 'reply', new.id);
  end if;
  return new;
end;
$$;

create trigger posts_notify_reply after insert on posts
  for each row execute function notify_on_reply();

-- ============================================================
-- 7. PLACES + TOPICS
-- ============================================================

create table places (
  id              uuid primary key default gen_random_uuid(),
  region_code     text not null references regions(code),
  name            text not null,
  stream_url      text not null,
  kind            text not null default 'hls' check (kind in ('hls','mjpeg','youtube','embed','other')),
  location        geography(Point,4326),
  -- 'degraded' exists because a 200 from an embed page proves nothing about the
  -- camera behind it. Only hls/mjpeg can earn 'ok'; embeds cap at 'degraded' and
  -- rank below verified-live feeds.
  status          text not null default 'unknown'
                  check (status in ('ok','degraded','down','unknown')),
  last_checked_at timestamptz,
  fail_count      integer not null default 0
);

create index places_region_idx on places (region_code, status);
create index places_geom_gix   on places using gist (location);

-- Lookup table, not a CHECK: adding an ingest source should be an INSERT, not a
-- schema migration, and a CHECK freezes today's cost assumptions into the DB.
create table topic_sources (
  code    text primary key,
  name    text not null,
  enabled boolean not null default true,
  notes   text
);

-- FIX C. 'gdelt' first: free, no key, natively region-keyed via sourcecountry:,
-- already on the CONTRACTS.md allowlist, already proven in void2-final.html.
-- X is disabled by default — new developers get pay-per-use only
-- ($0.005/post read; Basic/Pro closed to new signups; Enterprise ~$42k/mo), and
-- topics is the highest-volume read path, so per-read pricing inverts the model.
insert into topic_sources (code, name, enabled, notes) values
  ('gdelt',  'GDELT',  true,  'Primary. Free, region-native via sourcecountry:. ~1 req/5s; answers over-limit with PLAIN TEXT, not JSON.'),
  ('reddit', 'Reddit', true,  'Per-subreddit, needs a region -> subreddit map.'),
  ('manual', 'Manual', true,  'Hand-seeded topics.'),
  ('x',      'X',      false, 'Pay-per-use only for new developers. Enrichment for a few high-value regions at most; never the seed.');

create table topics (
  id               uuid primary key default gen_random_uuid(),
  region_code      text not null references regions(code),
  source           text not null references topic_sources(code),
  external_id      text,
  title            text not null,
  url              text,
  category         text check (category in (
                     'mature','controversy','explicit','social_tension',
                     'conspiracy','theological_tension','apologetics')),
  contention_score real,
  -- FIX D. CONTRACTS.md provenance. topics is an ingestion path like any other.
  source_host      text not null,
  response_hash    text not null,                -- SHA-256 of raw upstream bytes
  raw_response_url text not null,
  fetched_at       timestamptz not null default now(),
  unique (source, external_id)
);

create index topics_region_idx on topics (region_code, fetched_at desc);

-- ============================================================
-- 8. MESSAGING — END-TO-END ENCRYPTED
-- Server stores CIPHERTEXT and PUBLIC keys only. No server-side feature may
-- ever read message content: no search index, no ranking, no moderation scan,
-- no notification body. Build one and E2EE is over.
-- ============================================================

create table devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  display_name    text,
  registration_id integer not null,
  identity_key    bytea not null,                -- PUBLIC identity key
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz,
  unique (user_id, registration_id)
);

create index devices_user_idx on devices (user_id);

create table signed_prekeys (
  device_id  uuid not null references devices(id) on delete cascade,
  key_id     integer not null,
  public_key bytea not null,
  signature  bytea not null,
  created_at timestamptz not null default now(),
  primary key (device_id, key_id)
);

create table one_time_prekeys (
  device_id  uuid not null references devices(id) on delete cascade,
  key_id     integer not null,
  public_key bytea not null,
  claimed_at timestamptz,
  primary key (device_id, key_id)
);

create index otpk_available_idx on one_time_prekeys (device_id, key_id)
  where claimed_at is null;

create table conversations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'dm' check (kind in ('dm','group')),
  -- Structural dedupe: two concurrent start_dm() calls cannot create parallel
  -- threads, because the second insert violates this unique key. A
  -- check-then-insert inside the function would carry its own race.
  dm_key     text unique,
  created_at timestamptz not null default now(),
  check (kind <> 'dm' or dm_key is not null)
);

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);

create index conv_members_user_idx on conversation_members (user_id);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender_id        uuid not null references profiles(id) on delete cascade,
  sender_device_id uuid not null references devices(id) on delete cascade,
  envelope_version smallint not null default 1,  -- wire format can change without a migration
  created_at       timestamptz not null default now()
);

create index messages_conv_idx on messages (conversation_id, created_at desc);

-- Fan-out on write: one ciphertext row per RECIPIENT DEVICE.
create table message_envelopes (
  message_id          uuid not null references messages(id) on delete cascade,
  recipient_device_id uuid not null references devices(id) on delete cascade,
  ciphertext          bytea not null,
  delivered_at        timestamptz,
  primary key (message_id, recipient_device_id)
);

create index envelopes_device_idx
  on message_envelopes (recipient_device_id) where delivered_at is null;

-- FIX A. rev 2 locked EVERY unclaimed prekey for the target user, because
-- FOR UPDATE locks every row the CTE returns and there was no LIMIT. Those locks
-- are held to commit, so a concurrent caller's SKIP LOCKED skipped the entire
-- pool, got no one-time prekey, and — via the LEFT JOIN — still received a
-- valid-looking bundle. X3DH then proceeded on the signed prekey alone and that
-- session silently lost forward secrecy.
--
-- LATERAL + LIMIT 1 locks exactly one row per device: the lock set equals the
-- result set. This also makes the old `picked` dedupe CTE unnecessary.
create or replace function claim_prekey_bundle(target_user uuid)
returns table (
  device_id       uuid,
  registration_id integer,
  identity_key    bytea,
  spk_id          integer,
  spk_public      bytea,
  spk_signature   bytea,
  otpk_id         integer,
  otpk_public     bytea
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with dev as (
    select d.id, d.registration_id, d.identity_key
    from devices d where d.user_id = target_user
  ),
  spk as (
    select distinct on (s.device_id) s.device_id, s.key_id, s.public_key, s.signature
    from signed_prekeys s join dev on dev.id = s.device_id
    order by s.device_id, s.created_at desc
  ),
  locked as (
    select l.device_id, l.key_id
    from dev
    cross join lateral (
      select o.device_id, o.key_id
      from one_time_prekeys o
      where o.device_id = dev.id
        and o.claimed_at is null
      order by o.key_id
      for update skip locked
      limit 1
    ) l
  ),
  claimed as (
    update one_time_prekeys o set claimed_at = now()
    from locked k
    where o.device_id = k.device_id and o.key_id = k.key_id
    returning o.device_id, o.key_id, o.public_key
  )
  select dev.id, dev.registration_id, dev.identity_key,
         spk.key_id, spk.public_key, spk.signature,
         c.key_id, c.public_key
  from dev
  join spk on spk.device_id = dev.id
  left join claimed c on c.device_id = dev.id;   -- no OTPK left => still usable
end;
$$;

-- Any authenticated user may call the above for any target — that is correct for
-- X3DH, you must fetch a stranger's bundle to open a session. But it also lets an
-- attacker DRAIN a victim's one-time prekeys in a loop, forcing later sessions
-- onto the signed prekey. Rate-limit per caller in the Edge Function that fronts
-- this, and alert on: select device_id, count(*) from one_time_prekeys
-- where claimed_at is null group by 1 having count(*) < 10;

-- ============================================================
-- 9. RLS
--
-- RECURSION: a policy on conversation_members that references
-- conversation_members recurses — policy expressions are evaluated with RLS
-- applied to the tables they reference, so Postgres raises "infinite recursion
-- detected in policy for relation" at query time, and it propagates to conv_read
-- and messages_read. The membership test therefore lives in a SECURITY DEFINER
-- function, which bypasses RLS on the lookup and breaks the cycle.
--
-- Also note: qualify the outer table by name inside every RLS subquery. An
-- unqualified column resolves to the subquery's own FROM and collapses the
-- predicate to a tautology — which fails OPEN and passes naive tests.
-- ============================================================

create or replace function is_conversation_member(conv uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_members m
    where m.conversation_id = conv and m.user_id = (select auth.uid())
  );
$$;

-- Membership writes stay closed; this is the only path that creates a DM.
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

alter table profiles             enable row level security;
alter table posts                enable row level security;
alter table post_media           enable row level security;
alter table reactions            enable row level security;
alter table follows              enable row level security;
alter table notifications        enable row level security;
alter table regions              enable row level security;
alter table places               enable row level security;
alter table topics               enable row level security;
alter table topic_sources        enable row level security;
alter table devices              enable row level security;
alter table signed_prekeys       enable row level security;
alter table one_time_prekeys     enable row level security;
alter table conversations        enable row level security;
alter table conversation_members enable row level security;
alter table messages             enable row level security;
alter table message_envelopes    enable row level security;

-- Public read surfaces
create policy regions_read       on regions       for select using (true);
create policy places_read        on places        for select using (true);
create policy topics_read        on topics        for select using (true);
create policy topic_sources_read on topic_sources for select using (true);
create policy profiles_read      on profiles      for select using (true);
create policy posts_read         on posts         for select using (true);
create policy media_read         on post_media    for select using (true);
create policy reactions_read     on reactions     for select using (true);
create policy follows_read       on follows       for select using (true);

create policy profiles_write on profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Split by verb + column grants: RLS has no column granularity, so a policy
-- alone cannot stop an author writing their own rank_score (which orders the
-- entire feed) or region_code.
create policy posts_insert on posts for insert to authenticated
  with check ((select auth.uid()) = author_id);
create policy posts_update on posts for update to authenticated
  using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy posts_delete on posts for delete to authenticated
  using ((select auth.uid()) = author_id);

revoke update on posts from authenticated;
grant  update (body, location) on posts to authenticated;
-- rank_score is written only by apply_reaction_score(), region_code only by
-- set_post_region(). Both run as table owner and ignore the grants above.

create policy media_write on post_media for all to authenticated
  using (exists (select 1 from posts p where p.id = post_media.post_id and p.author_id = (select auth.uid())))
  with check (exists (select 1 from posts p where p.id = post_media.post_id and p.author_id = (select auth.uid())));

create policy reactions_write on reactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy follows_write on follows for all to authenticated
  using ((select auth.uid()) = follower_id) with check ((select auth.uid()) = follower_id);

create policy notifications_read on notifications for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notifications_update on notifications for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on notifications from authenticated;
grant  update (read_at) on notifications to authenticated;

-- FIX F. rev 2 exposed every device row to any authenticated account, including
-- display_name and last_seen_at — a platform-wide last-seen oracle in a product
-- whose DM pitch is privacy. Session setup only needs the key material, so grant
-- exactly those columns and withhold the rest.
create policy devices_read  on devices for select to authenticated using (true);
create policy devices_write on devices for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke select on devices from authenticated;
grant  select (id, user_id, registration_id, identity_key) on devices to authenticated;

create policy spk_read  on signed_prekeys for select to authenticated using (true);
create policy spk_write on signed_prekeys for all to authenticated
  using (exists (select 1 from devices d where d.id = signed_prekeys.device_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from devices d where d.id = signed_prekeys.device_id and d.user_id = (select auth.uid())));

create policy otpk_read  on one_time_prekeys for select to authenticated using (true);
create policy otpk_write on one_time_prekeys for all to authenticated
  using (exists (select 1 from devices d where d.id = one_time_prekeys.device_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from devices d where d.id = one_time_prekeys.device_id and d.user_id = (select auth.uid())));

-- Conversations: members only. No INSERT policy — start_dm() is the sole path.
create policy conv_read on conversations for select to authenticated
  using (is_conversation_member(id));

create policy conv_members_read on conversation_members for select to authenticated
  using (is_conversation_member(conversation_id));

create policy conv_members_update on conversation_members for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on conversation_members from authenticated;
grant  update (last_read_at) on conversation_members to authenticated;

create policy messages_read on messages for select to authenticated
  using (is_conversation_member(conversation_id));

create policy messages_write on messages for insert to authenticated
  with check ((select auth.uid()) = sender_id
              and is_conversation_member(conversation_id)
              and exists (select 1 from devices d
                          where d.id = messages.sender_device_id
                            and d.user_id = (select auth.uid())));

create policy envelopes_read on message_envelopes for select to authenticated
  using (exists (select 1 from devices d
                 where d.id = message_envelopes.recipient_device_id
                   and d.user_id = (select auth.uid())));

-- FIX E. rev 2 checked only that the caller sent the message; the recipient
-- device was unconstrained, so a sender could address ciphertext to ANY device on
-- the platform. Cryptographically harmless (it will not decrypt) but an
-- unauthenticated write into strangers' undelivered queues. Now the recipient
-- device must belong to a member of that conversation.
create policy envelopes_write on message_envelopes for insert to authenticated
  with check (exists (
    select 1
    from messages msg
    join devices d on d.id = message_envelopes.recipient_device_id
    join conversation_members m
      on m.conversation_id = msg.conversation_id and m.user_id = d.user_id
    where msg.id = message_envelopes.message_id
      and msg.sender_id = (select auth.uid())));

create policy envelopes_update on message_envelopes for update to authenticated
  using (exists (select 1 from devices d
                 where d.id = message_envelopes.recipient_device_id
                   and d.user_id = (select auth.uid())))
  with check (exists (select 1 from devices d
                 where d.id = message_envelopes.recipient_device_id
                   and d.user_id = (select auth.uid())));
revoke update on message_envelopes from authenticated;
grant  update (delivered_at) on message_envelopes to authenticated;

-- ============================================================
-- 10. GLOBE RPCs
-- ============================================================

-- FIX G. ST_MakeEnvelope with min_lng > max_lng (a viewport spanning the
-- antimeridian) yields an inverted box that matches nothing, so the globe
-- returned empty over the Pacific. Split into two envelopes and union.
create or replace function posts_in_bbox(
  min_lng double precision, min_lat double precision,
  max_lng double precision, max_lat double precision,
  limit_n integer default 200
)
returns setof posts language sql stable as $$
  with box as (
    select case
      when min_lng <= max_lng
        then ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
      else ST_Union(
        ST_MakeEnvelope(min_lng, min_lat,  180, max_lat, 4326),
        ST_MakeEnvelope(-180,    min_lat, max_lng, max_lat, 4326))::geography
    end as g
  )
  select p.* from posts p, box
  where p.location is not null
    and ST_Intersects(p.location, box.g)
  order by p.rank_score desc, p.created_at desc
  limit limit_n;
$$;

create or replace function region_view(target_code text, limit_n integer default 100)
returns json language sql stable as $$
  select json_build_object(
    'region', (select row_to_json(r) from regions r where r.code = target_code),
    -- 'ok' first, then 'degraded' (embeds, which cannot prove liveness).
    'places', (select coalesce(json_agg(pl order by pl.status), '[]'::json) from places pl
               where pl.region_code = target_code and pl.status in ('ok','degraded')),
    'topics', (select coalesce(json_agg(t), '[]'::json) from (
                 select * from topics where region_code = target_code
                 order by fetched_at desc limit 25) t),
    'posts',  (select coalesce(json_agg(p), '[]'::json) from (
                 select * from posts where region_code = target_code
                 order by rank_score desc, created_at desc limit limit_n) p)
  );
$$;

-- ============================================================
-- VERIFY — run these after applying, before writing any app code.
-- ============================================================
--
-- 1. Prekey concurrency (the one that matters most). In TWO psql sessions:
--      -- both:  begin; select otpk_id from claim_prekey_bundle('<user-uuid>');
--    They must return DIFFERENT, NON-NULL otpk_id values. If either is null or
--    they match, stop — forward secrecy is broken.
--
-- 2. Membership is not a tautology. As user A (in >=1 conversation, not in
--    conversation X): select count(*) from conversation_members;
--    Must return only A's own rows, never the whole table.
--
-- 3. Derived columns are not client-writable. As the author:
--      update posts set rank_score = 999 where id = '<own post>';   -- must fail
--      update posts set region_code = 'US-TX' where id = '<own post>'; -- must fail
--
-- 4. Reactions are cheap. explain (analyze, buffers)
--      insert into reactions values ('<post>','<user>','rank');
--    Must show NO ST_Covers / regions scan.
--
-- 5. Antimeridian. select count(*) from posts_in_bbox(170, -10, -170, 10);
--    Must not be trivially 0 when posts exist near the date line.
--
-- 6. DM dedupe. Call start_dm(B) twice as A — same uuid both times.
-- ========== END 001_void_schema.sql ==========

-- ========== BEGIN 002_contention_split.sql ==========
-- ============================================================
-- 002_contention_split.sql
--
-- Separates the two DIFFERENT quantities that were about to be conflated into
-- one `contention_score` column.
--
-- WHAT 001 ACTUALLY SHIPPED
-- 001 declares `contention_score real` as a PLAIN nullable column — no generated
-- expression, and no vote columns at all. So the `power(x, 0) = 1` failure is not
-- yet live: the expression that would produce it does not exist. This migration
-- adds the vote storage AND the expression together, with the guard built in from
-- the start, so that failure never gets a chance to ship.
--
-- THE FAILURE BEING PREVENTED
-- The natural expression is
--     power(up + down, least(up,down) / greatest(greatest(up,down),1))
-- For any source with no downvote channel (Bluesky, Mastodon, Hacker News,
-- GDELT), down_count is always 0, so the exponent is 0, and power(x, 0) = 1 for
-- every x. Every row from those sources would score exactly 1.0 — a constant
-- column. That is the same zero-discrimination defect as a hardcoded tag, moved
-- into the ranking signal where it is harder to see.
--
-- THE RULE
-- `contention_score`  is only defined where a true negative signal exists.
--                     NULL elsewhere — honestly unmeasurable, not faked.
-- `contention_proxy`  is reply/quote-derived pressure. A DIFFERENT UNIT.
--
-- Never COALESCE them into one sort key. Sort on contention_score where it is
-- non-null, contention_proxy otherwise. Blending silently ranks a Lemmy vote
-- ratio against a Bluesky quote ratio on a scale neither of them shares.
-- ============================================================

-- ---------- true-negative vote storage ----------

-- Set true ONLY by providers whose upstream reports an explicit negative
-- (Lemmy upvotes/downvotes, PeerTube likes/dislikes). Never inferred.
alter table topics add column has_true_negative boolean not null default false;

alter table topics add column up_count   integer not null default 0;
alter table topics add column down_count integer not null default 0;

-- ---------- reply/quote-derived pressure (separate unit) ----------

alter table topics add column reply_count    integer not null default 0;
alter table topics add column quote_count    integer not null default 0;
-- likes + reposts/boosts: the "agreement" denominator.
alter table topics add column positive_count integer not null default 0;

-- ---------- contention_score: replace the plain column with a guarded expression ----------

-- 001's version is a plain column; there is nothing to preserve since no ingest
-- path writes it yet.
alter table topics drop column contention_score;

alter table topics add column contention_score real
  generated always as (
    case
      -- The guard. No negative channel => the quantity is undefined here, and
      -- NULL says so. Returning a number would be a lie with a constant value.
      when not has_true_negative then null
      when up_count + down_count = 0 then 0
      else power(
             (up_count + down_count)::real,
             least(up_count, down_count)::real
               / greatest(greatest(up_count, down_count), 1)::real
           )
    end
  ) stored;

-- ---------- contention_proxy ----------

-- People quote to argue and like to agree, so a quote is weighted 2x a reply.
-- +1 on the denominator keeps a zero-positive item from dividing by zero and
-- from scoring infinitely contested on one reply.
alter table topics add column contention_proxy real
  generated always as (
    case
      when positive_count + reply_count + quote_count = 0 then 0
      else (reply_count + 2 * quote_count)::real / (positive_count + 1)::real
    end
  ) stored;

-- ---------- indexes ----------

create index topics_contention_proxy_idx
  on topics (region_code, contention_proxy desc);

-- The non-null branch of the sort. Partial, because rows without a true negative
-- are never read through this path.
create index topics_contention_score_idx
  on topics (region_code, contention_score desc)
  where has_true_negative;

-- ---------- invariant ----------

-- A row claiming a true negative must actually carry votes. Without this a
-- provider bug could set the flag with 0/0 and silently reintroduce a constant
-- (contention_score would be 0 for every such row).
alter table topics add constraint topics_true_negative_has_votes
  check (not has_true_negative or (up_count + down_count) > 0);

comment on column topics.contention_score is
  'Vote-balance contention. NULL where the source has no true negative — do not coalesce with contention_proxy; different units.';
comment on column topics.contention_proxy is
  'Reply/quote-derived contention pressure. Used only where contention_score is NULL.';
comment on column topics.has_true_negative is
  'True only for sources reporting an explicit negative (Lemmy, PeerTube). Never inferred.';
-- ========== END 002_contention_split.sql ==========

-- ========== BEGIN 003_regions_seed.sql ==========
-- ============================================================
-- 003_regions_seed.sql
-- Minimal country seed (~95 ISO 3166-1 alpha-2 rows) so verify.mjs
-- and nation feeds have a region graph before Natural Earth loads.
-- Includes PS (Palestine). Geom/centroid left null — seed-regions.sh
-- (ogr2ogr) fills polygons later as service_role / DB owner.
-- Idempotent: ON CONFLICT DO UPDATE name only.
-- ============================================================

insert into regions (code, name, level, parent_code, custom) values
  ('AF','Afghanistan','country',null,false),
  ('AL','Albania','country',null,false),
  ('DZ','Algeria','country',null,false),
  ('AO','Angola','country',null,false),
  ('AR','Argentina','country',null,false),
  ('AM','Armenia','country',null,false),
  ('AU','Australia','country',null,false),
  ('AT','Austria','country',null,false),
  ('AZ','Azerbaijan','country',null,false),
  ('BD','Bangladesh','country',null,false),
  ('BY','Belarus','country',null,false),
  ('BE','Belgium','country',null,false),
  ('BO','Bolivia','country',null,false),
  ('BR','Brazil','country',null,false),
  ('BG','Bulgaria','country',null,false),
  ('KH','Cambodia','country',null,false),
  ('CA','Canada','country',null,false),
  ('CL','Chile','country',null,false),
  ('CN','China','country',null,false),
  ('CO','Colombia','country',null,false),
  ('CD','DR Congo','country',null,false),
  ('CU','Cuba','country',null,false),
  ('CZ','Czechia','country',null,false),
  ('DK','Denmark','country',null,false),
  ('EG','Egypt','country',null,false),
  ('ET','Ethiopia','country',null,false),
  ('FI','Finland','country',null,false),
  ('FR','France','country',null,false),
  ('GE','Georgia','country',null,false),
  ('DE','Germany','country',null,false),
  ('GH','Ghana','country',null,false),
  ('GR','Greece','country',null,false),
  ('HT','Haiti','country',null,false),
  ('HN','Honduras','country',null,false),
  ('HU','Hungary','country',null,false),
  ('IN','India','country',null,false),
  ('ID','Indonesia','country',null,false),
  ('IR','Iran','country',null,false),
  ('IQ','Iraq','country',null,false),
  ('IE','Ireland','country',null,false),
  ('IL','Israel','country',null,false),
  ('IT','Italy','country',null,false),
  ('JP','Japan','country',null,false),
  ('JO','Jordan','country',null,false),
  ('KZ','Kazakhstan','country',null,false),
  ('KE','Kenya','country',null,false),
  ('KP','North Korea','country',null,false),
  ('KR','South Korea','country',null,false),
  ('KW','Kuwait','country',null,false),
  ('LB','Lebanon','country',null,false),
  ('LY','Libya','country',null,false),
  ('MY','Malaysia','country',null,false),
  ('ML','Mali','country',null,false),
  ('MX','Mexico','country',null,false),
  ('MD','Moldova','country',null,false),
  ('MN','Mongolia','country',null,false),
  ('MA','Morocco','country',null,false),
  ('MM','Myanmar','country',null,false),
  ('NP','Nepal','country',null,false),
  ('NL','Netherlands','country',null,false),
  ('NZ','New Zealand','country',null,false),
  ('NG','Nigeria','country',null,false),
  ('NO','Norway','country',null,false),
  ('PK','Pakistan','country',null,false),
  ('PS','Palestine','country',null,true),
  ('PA','Panama','country',null,false),
  ('PE','Peru','country',null,false),
  ('PH','Philippines','country',null,false),
  ('PL','Poland','country',null,false),
  ('PT','Portugal','country',null,false),
  ('QA','Qatar','country',null,false),
  ('RO','Romania','country',null,false),
  ('RU','Russia','country',null,false),
  ('SA','Saudi Arabia','country',null,false),
  ('RS','Serbia','country',null,false),
  ('SG','Singapore','country',null,false),
  ('SO','Somalia','country',null,false),
  ('ZA','South Africa','country',null,false),
  ('ES','Spain','country',null,false),
  ('LK','Sri Lanka','country',null,false),
  ('SD','Sudan','country',null,false),
  ('SE','Sweden','country',null,false),
  ('CH','Switzerland','country',null,false),
  ('SY','Syria','country',null,false),
  ('TW','Taiwan','country',null,true),
  ('TZ','Tanzania','country',null,false),
  ('TH','Thailand','country',null,false),
  ('TN','Tunisia','country',null,false),
  ('TR','Turkey','country',null,false),
  ('UG','Uganda','country',null,false),
  ('UA','Ukraine','country',null,false),
  ('AE','United Arab Emirates','country',null,false),
  ('GB','United Kingdom','country',null,false),
  ('US','United States','country',null,false),
  ('UY','Uruguay','country',null,false),
  ('VE','Venezuela','country',null,false),
  ('VN','Vietnam','country',null,false),
  ('YE','Yemen','country',null,false),
  ('ZW','Zimbabwe','country',null,false)
on conflict (code) do update
  set name = excluded.name,
      level = excluded.level,
      custom = excluded.custom;
-- ========== END 003_regions_seed.sql ==========

