-- Phase 2 fixtures for local / Railway Postgres (after 000+001+002+003).
-- Safe to re-run. Creates two users, a DM, posts near the antimeridian, and prekeys.

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

INSERT INTO profiles (id, handle, display_name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'alice', 'Alice'),
  ('22222222-2222-4222-8222-222222222222', 'bob', 'Bob')
ON CONFLICT DO NOTHING;

INSERT INTO posts (id, author_id, body, location) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   'Lagos market chatter', ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
   'antimeridian east', ST_SetSRID(ST_MakePoint(178.0, 0), 4326)::geography),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111',
   'antimeridian west', ST_SetSRID(ST_MakePoint(-178.0, 0), 4326)::geography)
ON CONFLICT DO NOTHING;

-- alice ↔ bob DM (security definer start_dm needs auth.uid())
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT start_dm('22222222-2222-4222-8222-222222222222');

INSERT INTO devices (id, user_id, registration_id, identity_key) VALUES
  ('d1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 1, decode('01','hex')),
  ('d2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 2, decode('02','hex'))
ON CONFLICT DO NOTHING;

INSERT INTO signed_prekeys (device_id, key_id, public_key, signature) VALUES
  ('d1111111-1111-4111-8111-111111111111', 1, decode('11','hex'), decode('11','hex')),
  ('d2222222-2222-4222-8222-222222222222', 1, decode('22','hex'), decode('22','hex'))
ON CONFLICT DO NOTHING;

INSERT INTO one_time_prekeys (device_id, key_id, public_key) VALUES
  ('d1111111-1111-4111-8111-111111111111', 1, decode('a1','hex')),
  ('d1111111-1111-4111-8111-111111111111', 2, decode('a2','hex')),
  ('d2222222-2222-4222-8222-222222222222', 1, decode('b1','hex')),
  ('d2222222-2222-4222-8222-222222222222', 2, decode('b2','hex'))
ON CONFLICT DO NOTHING;
