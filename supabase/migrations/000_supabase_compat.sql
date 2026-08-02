-- ============================================================
-- 000_supabase_compat.sql
--
-- ADDED BY CLAUDE for the Cursor #3 Railway pivot. Run FIRST, before 001.
-- Not needed on Supabase — it is idempotent and safe there, but its whole
-- purpose is to make 001 apply to a PLAIN PostgreSQL server.
--
-- WHY THIS EXISTS
-- 001_void_schema.sql was written against Supabase and depends on things that
-- a bare Railway Postgres instance does not have:
--
--   auth.users        1 reference  (profiles.id FK)
--   auth.uid()       24 references (every RLS policy)
--   to authenticated 28 references (every policy + grant)
--   anon              2 references
--   service_role      1 reference
--
-- Without this file, apply-migrations.sh fails on the very first statement of
-- 001 — `create table profiles (... references auth.users(id) ...)` — because
-- the auth schema does not exist. Nothing after it runs.
--
-- READ THIS BEFORE RELYING ON IT
-- This shim makes the SCHEMA apply. It does NOT give you authentication.
-- Supabase Auth is a service (GoTrue) that issues JWTs and populates
-- auth.uid(); Railway Postgres is a database and ships no such thing. So:
--
--   * auth.uid() below reads a per-connection setting (request.jwt.claim.sub).
--     SOMETHING has to set it. Until an API layer does, it returns NULL and
--     every RLS policy denies — which is safe, but means no client can read or
--     write anything.
--   * Rows in auth.users are yours to insert. There is no signup, no password
--     hashing, no OAuth, no email verification behind it.
--
-- So this unblocks migration + Phase 2 testing. It is not a login system.
-- Decision 1 in AGENT_BRIEF.md (Supabase Auth + Apple/Google) assumed the
-- Supabase platform; on Railway that decision needs revisiting — either run
-- Supabase for auth and Railway for nothing, or add an auth service and have
-- it set the GUC below per request.
-- ============================================================

-- ── roles ───────────────────────────────────────────────────
-- Supabase ships these. Created NOLOGIN: they are privilege buckets that an
-- API layer SETs ROLE to, not accounts anyone connects as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- 001 issues `grant update (col) on <table> to authenticated` etc. Those need
-- the role to already hold table-level rights on objects created afterwards,
-- so default privileges are set here rather than repeated per table.
alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- ── auth schema ─────────────────────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Minimal stand-in for Supabase's auth.users. Only the columns 001 actually
-- depends on: profiles.id references auth.users(id). Deliberately NOT a
-- reimplementation of GoTrue — no password column, because storing one here
-- without the surrounding service would invite exactly the wrong thing.
create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  created_at   timestamptz not null default now()
);

comment on table auth.users is
  'Compatibility stand-in for Supabase auth.users (see 000_supabase_compat.sql).
   Rows here are NOT authenticated users — there is no signup, password hashing,
   or OAuth behind this table on Railway. An auth service must own it before any
   of this is a real login system.';

-- ── auth.uid() ──────────────────────────────────────────────
-- Supabase derives this from the request JWT. Here it reads a per-connection
-- GUC that an API layer (or a test harness) must set:
--
--     set local request.jwt.claim.sub = '<uuid>';
--
-- Returns NULL when unset, so RLS denies by default rather than failing open.
-- That is the correct direction to fail, and it is also why an unconfigured
-- deployment will look completely empty rather than broken.
create or replace function auth.uid()
returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Convenience for the Phase 2 test scripts: become a given user for the rest of
-- the transaction. Tests must NOT weaken RLS to pass; they should assume an
-- identity instead.
create or replace function auth.become(target uuid)
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', target::text, true);  -- true = local
end;
$$;

comment on function auth.become(uuid) is
  'Test/API helper: sets request.jwt.claim.sub for the current transaction so
   auth.uid() resolves. Use in Phase 2 verification instead of disabling RLS.';
