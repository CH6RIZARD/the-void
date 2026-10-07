-- ============================================================
-- 008 — signed-out reads of posts work again
--
-- 006 rewrote posts_read to hide posts from authors the reader blocked:
--   not exists (select 1 from blocks b where b.blocker_id = auth.uid() ...)
-- and revoked everything on blocks from anon. Postgres checks table
-- privileges for every table a policy touches, even when auth.uid() is null,
-- so EVERY anon select on posts (and post_media, whose policy reads posts)
-- failed: "permission denied for table blocks". Measured 2026-10-07 with the
-- public anon key against /rest/v1/posts.
--
-- Granting SELECT to anon exposes nothing: blocks_select is `to authenticated`
-- only, so anon matches no policy and sees zero rows.
--
-- Safe to re-run.
-- ============================================================

grant select on blocks to anon;
