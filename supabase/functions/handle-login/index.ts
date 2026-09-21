// supabase/functions/handle-login/index.ts
//
// LOGIN with handle + password (the Signal Card, route 1 in HANDOFF.md).
//
//   POST /functions/v1/handle-login
//   apikey: <anon key>
//   body: { "handle": "someone", "password": "..." }
//   200 → the GoTrue session ({ access_token, refresh_token, expires_in, user, ... })
//   400 → { error: "invalid" }   unknown handle, no email on it, or wrong password
//   429 → { error: "slow down" }
//
// GoTrue only signs in by email. Mapping handle → email in the app would mean
// publishing every account's email, so the lookup happens here with the service
// role and the email never leaves the server: the caller gets a session or nothing.
//
// Unknown handle and wrong password answer identically. (Handles themselves are
// public — profiles are world-readable — so this hides nothing that isn't already.)
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected).
// Deploy with --no-verify-jwt: the caller is by definition not signed in yet.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

// Per-IP attempt limit, per warm instance. Instances are short-lived and can run in
// parallel, so this is a speed bump against scripted guessing, not the only guard:
// GoTrue's own token rate limit applies behind it (the client IP is forwarded).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();
function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 5000) attempts.clear();
  return true;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!allow(ip)) return json(429, { error: "slow down" });

  let handle = "", password = "";
  try {
    const b = await req.json();
    handle = String(b?.handle ?? "").trim().replace(/^@/, "").toLowerCase();
    password = String(b?.password ?? "");
  } catch {
    return json(400, { error: "invalid" });
  }
  if (!HANDLE_RE.test(handle) || !password || password.length > 256) return json(400, { error: "invalid" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: prof } = await admin.from("profiles").select("id").eq("handle", handle).maybeSingle();
  if (!prof?.id) return json(400, { error: "invalid" });
  const { data: u } = await admin.auth.admin.getUserById(prof.id);
  const email = u?.user?.email;
  if (!email) return json(400, { error: "invalid" }); // anonymous / provider-only card: no password to check

  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 429) return json(429, { error: "slow down" });
  if (!r.ok) return json(400, { error: "invalid" });
  return json(200, await r.json());
});
