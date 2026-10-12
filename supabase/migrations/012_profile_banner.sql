-- 012 · profile banner (6p-f): the landscape photo behind the profile header.
-- Uploaded like avatars (post-media, the user's prefix); the URL lives on the row.
-- The existing profiles policies already let you write only your own row.
-- Additive and idempotent: safe to re-run.
alter table profiles add column if not exists banner_url text;
