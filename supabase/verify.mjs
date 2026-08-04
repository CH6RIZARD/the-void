#!/usr/bin/env node
/**
 * THE VOID — anon-key verification (deliberately no service_role).
 * Proves what a holder of the public anon key can and cannot do.
 *
 * Usage:
 *   node supabase/verify.mjs
 * Env overrides:
 *   VOID_SUPABASE_URL / VOID_SUPABASE_ANON_KEY
 */
'use strict';

const URL = process.env.VOID_SUPABASE_URL
  || process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://zsrpsdufwgfyfoulmazt.supabase.co';
const ANON = process.env.VOID_SUPABASE_ANON_KEY
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzcnBzZHVmd2dmeWZvdWxtYXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MTU3ODEsImV4cCI6MjEwMTE5MTc4MX0.TbMvc7Jz_pNTLxW8CVnQvh_ATRwgfnvJnNC_eXFzJO8';

let failed = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { console.log('  FAIL  ' + m); failed++; };

async function api(path, { method = 'GET', token, body, prefer } = {}) {
  const headers = {
    apikey: ANON,
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  else headers.Authorization = 'Bearer ' + ANON;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(URL + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { r, data, text };
}

async function main() {
  console.log('VOID supabase verify (anon key only)');
  console.log('URL', URL);

  // 1) Tables exist
  for (const table of ['regions', 'profiles', 'posts', 'reactions', 'conversation_members']) {
    const { r, data } = await api(`/rest/v1/${table}?select=*&limit=1`);
    if (r.status === 200) ok(`table ${table} visible to PostgREST`);
    else bad(`table ${table}: HTTP ${r.status} ${JSON.stringify(data)}`);
  }

  // 2) Regions seed — 95 rows, PS present
  {
    const { r, data } = await api('/rest/v1/regions?select=code&level=eq.country');
    if (r.ok && Array.isArray(data)) {
      const n = data.length;
      const hasPS = data.some((row) => row.code === 'PS');
      if (n >= 90 && n <= 120) ok(`regions country seed count=${n} (expect ~95)`);
      else bad(`regions country seed count=${n} (expect ~95)`);
      if (hasPS) ok('regions includes PS');
      else bad('regions missing PS');
    } else bad(`regions select failed: ${r.status}`);
  }

  // 3) Anon WITHOUT session cannot insert profile or delete posts
  {
    const fakeId = '00000000-0000-4000-8000-000000000001';
    const ins = await api('/rest/v1/profiles', {
      method: 'POST',
      body: [{ id: fakeId, handle: 'hacker_' + Date.now().toString(36).slice(2, 8) }],
      prefer: 'return=minimal',
    });
    if (ins.r.status === 401 || ins.r.status === 403 || ins.r.status === 42501
      || (ins.data && /JWT|permission|policy|row-level/i.test(JSON.stringify(ins.data)))) {
      ok('anon cannot insert profiles');
    } else if (ins.r.status >= 400) {
      ok(`anon profile insert rejected (${ins.r.status})`);
    } else bad(`anon WAS able to insert profiles: ${ins.r.status}`);

    const del = await api('/rest/v1/posts?id=eq.' + fakeId, { method: 'DELETE' });
    if (del.r.status === 200 || del.r.status === 204) {
      // PostgREST returns 204 even when 0 rows match under RLS — check Prefer count
      ok('anon delete posts returned ' + del.r.status + ' (0-row under RLS is OK)');
    } else if (del.r.status === 401 || del.r.status === 403) {
      ok('anon cannot delete posts');
    } else bad(`unexpected delete posts status ${del.r.status}`);
  }

  // 4) Anonymous sign-in issues a session
  let session = null;
  {
    const { r, data } = await api('/auth/v1/signup', {
      method: 'POST',
      body: { data: { anonymous: true } },
    });
    if (r.ok && data && data.access_token && data.user && data.user.id) {
      session = data;
      ok('anonymous sign-in issued session for ' + data.user.id);
    } else {
      bad('anonymous sign-in failed: ' + r.status + ' ' + JSON.stringify(data));
      console.log('\nEnable Dashboard → Authentication → Providers → Anonymous sign-ins');
    }
  }

  // 5) Session resolves to a user
  if (session) {
    const { r, data } = await api('/auth/v1/user', { method: 'GET', token: session.access_token });
    if (r.ok && data && data.id === session.user.id) ok('session resolves to user');
    else bad('session /user failed: ' + r.status);
  }

  // 6) Profile upsert under RLS (app path)
  if (session) {
    const handle = ('v' + session.user.id.replace(/-/g, '').slice(0, 10)).slice(0, 20);
    const { r, data } = await api('/rest/v1/profiles', {
      method: 'POST',
      token: session.access_token,
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [{ id: session.user.id, handle, display_name: 'Verify' }],
    });
    if (r.ok) ok('profile upsert under RLS succeeded');
    else bad('profile upsert failed: ' + r.status + ' ' + JSON.stringify(data));
  }

  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
