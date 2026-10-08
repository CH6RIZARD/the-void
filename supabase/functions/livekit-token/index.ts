// supabase/functions/livekit-token/index.ts
//
// LiveKit join token for a 1:1 DM call.
//
//   POST /functions/v1/livekit-token
//   Authorization: Bearer <the user's access token>
//   apikey: <anon key>
//   body: { "conversation_id": "<uuid>" }
//   200 → { token, url, room, identity, expires_in }
//   400 → { error: "invalid", message }        body missing / not a uuid
//   401 → { error: "invalid_session", message } no or bad bearer token
//   403 → { error: "not_a_member", message }    caller is not in that thread (or is blocked)
//   500 → { error: "server_not_configured" }    LIVEKIT_* secrets missing
//
// The app never holds the LiveKit API key: it asks here, this verifies the
// Supabase JWT (the user id comes from the verified token only, never from
// the body — same rule as delete-account), checks conversation_members with
// the service role, and mints a token scoped to room `dm_<conversation_id>`.
// Membership is the only check needed: start_dm() is the sole writer of
// conversation_members, so a member is by construction one of the two sides.
//
// Secrets (supabase secrets set ...): LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
// LIVEKIT_URL (wss://...). The url is returned so the app needs no build-time
// config for it. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected.
// Deploy WITH JWT verification (the default): callers must be signed in.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2.19.1";
import { mintCallToken, roomFor } from "./mint.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL") ?? "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

// `message` is included because VoidAPI._sb surfaces data.message as the
// error text the user sees.
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return json(500, { error: "server_not_configured", message: "Calls are not set up on the server yet." });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json(401, { error: "missing_bearer_token", message: "Sign in to call." });

  let conversationId = "";
  try {
    const b = await req.json();
    conversationId = String(b?.conversation_id ?? "").trim();
  } catch {
    return json(400, { error: "invalid", message: "Bad request." });
  }
  if (!UUID_RE.test(conversationId)) return json(400, { error: "invalid", message: "Bad request." });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Verify against GoTrue: a forged or expired token (or the anon key) fails here.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (userErr || !uid) return json(401, { error: "invalid_session", message: "Sign in to call." });

  // Membership with the service role (RLS would also work, but the admin
  // client is already here and the answer is the same: a member or not).
  const { data: member } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", uid)
    .maybeSingle();
  if (!member) return json(403, { error: "not_a_member", message: "You can't call this thread." });

  // Blocked pairs cannot ring each other (calls_insert in 009 already refuses
  // the row); refusing the media token too means a stale call row cannot be
  // used to join the room after a block.
  const { data: others } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .neq("user_id", uid);
  // (blocks is read directly: void_users_blocked() is granted to `authenticated`
  // only, and the service role bypasses RLS on blocks anyway.) Both ids are
  // uuids from GoTrue / the table, never from the request.
  for (const o of others ?? []) {
    const { data: blocked } = await admin
      .from("blocks")
      .select("blocker_id")
      .or(`and(blocker_id.eq.${uid},blocked_id.eq.${o.user_id}),and(blocker_id.eq.${o.user_id},blocked_id.eq.${uid})`)
      .limit(1);
    if ((blocked ?? []).length > 0) return json(403, { error: "not_a_member", message: "You can't call this thread." });
  }

  const { data: prof } = await admin.from("profiles").select("handle, display_name").eq("id", uid).maybeSingle();
  const name = (prof?.display_name || prof?.handle || "").toString();

  const token = await mintCallToken(AccessToken, {
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
    userId: uid,
    name,
    conversationId,
  });

  return json(200, { token, url: LIVEKIT_URL, room: roomFor(conversationId), identity: uid, expires_in: 3600 });
});
