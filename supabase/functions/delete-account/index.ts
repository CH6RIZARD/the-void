// supabase/functions/delete-account/index.ts
//
// In-app account deletion (Apple 5.1.1(v), Google Play account deletion policy).
//
//   POST /functions/v1/delete-account
//   Authorization: Bearer <the user's access token>   (anonymous users included)
//   apikey: <anon key>
//   body (optional JSON): { "apple_refresh_token": "...", "apple_access_token": "..." }
//
// Steps:
//   1. Verify the caller's JWT with GoTrue (auth.getUser). The user id comes from
//      the verified token only, never from the request body.
//   2. SQL cleanup: rpc delete_user_data(p_user) with the service role
//      (supabase/migrations/005_account_deletion.sql). Returns a JSON report and
//      the storage objects the user owns.
//   3. Remove those storage objects through the Storage API (direct SQL deletes
//      on storage.objects are blocked on current Supabase projects).
//   4. Apple: if the user signed in with Apple AND the APPLE_* env vars are set
//      AND the client sent an Apple token, revoke it at appleid.apple.com. Apple
//      requires a client secret (an ES256 JWT signed with the .p8 key) for that,
//      so without the env vars this step is skipped and reported, not faked.
//      Supabase does not keep Apple's refresh token server-side; the client only
//      has it as provider_refresh_token right after the Apple sign-in redirect.
//   5. auth.admin.deleteUser(id) (hard delete).
//   6. Clear any queued row in account_deletion_requests.
//
// Env (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected by
// Supabase automatically):
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, APPLE_PRIVATE_KEY   optional
//   ALLOWED_ORIGINS   optional comma list; default "*" (safe: bearer auth, no cookies)

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  // file:// pages and some app WebViews send "Origin: null" or no Origin at all.
  let allow = "*";
  if (!ALLOWED.includes("*")) {
    allow = origin && (ALLOWED.includes(origin) || (origin === "null" && ALLOWED.includes("null")))
      ? origin
      : ALLOWED[0];
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// ---------- Apple token revoke ----------

function b64url(bytes: Uint8Array | string): string {
  const s = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function appleClientSecret(teamId: string, keyId: string, clientId: string, pem: string): Promise<string> {
  const der = Uint8Array.from(
    atob(pem.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: teamId, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId,
  }));
  // WebCrypto ECDSA returns IEEE P1363 (r||s), which is exactly JWS ES256.
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`),
  ));
  return `${header}.${payload}.${b64url(sig)}`;
}

async function revokeApple(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const clientId = Deno.env.get("APPLE_CLIENT_ID");
  const pem = Deno.env.get("APPLE_PRIVATE_KEY");
  if (!teamId || !keyId || !clientId || !pem) {
    return { attempted: false, reason: "APPLE_* env vars not set; Apple token not revoked" };
  }
  const refresh = typeof body.apple_refresh_token === "string" ? body.apple_refresh_token : "";
  const access = typeof body.apple_access_token === "string" ? body.apple_access_token : "";
  const token = refresh || access;
  if (!token) {
    return { attempted: false, reason: "client sent no Apple token; nothing to revoke with" };
  }
  try {
    const secret = await appleClientSecret(teamId, keyId, clientId, pem);
    const r = await fetch("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        token,
        token_type_hint: refresh ? "refresh_token" : "access_token",
      }),
    });
    return { attempted: true, ok: r.ok, status: r.status };
  } catch (e) {
    return { attempted: true, ok: false, error: String((e as Error)?.message ?? e) };
  }
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(req, 500, { error: "server_not_configured" });

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json(req, 401, { error: "missing_bearer_token" });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Verify. getUser checks the token against GoTrue, so a forged or expired
  //    token (or the anon key itself) fails here.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return json(req, 401, { error: "invalid_session" });
  const uid = user.id;

  const providers = new Set<string>([
    ...((user.app_metadata?.providers as string[] | undefined) ?? []),
    ...(user.identities ?? []).map((i) => i.provider),
  ]);

  // 2. Data.
  const { data: report, error: rpcErr } = await admin.rpc("delete_user_data", { p_user: uid });
  if (rpcErr) {
    // Do NOT delete the login if the data could not be deleted: that would leave
    // orphaned personal data with no account left to request its removal.
    return json(req, 500, { error: "data_cleanup_failed", detail: rpcErr.message });
  }

  // 3. Storage.
  const storage: Record<string, unknown> = { removed: 0, errors: [] as string[] };
  const objects = (((report as Record<string, unknown>)?.storage_objects as { bucket: string; name: string }[]) ?? []);
  const byBucket = new Map<string, string[]>();
  for (const o of objects) {
    if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, []);
    byBucket.get(o.bucket)!.push(o.name);
  }
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const { data, error } = await admin.storage.from(bucket).remove(names.slice(i, i + 100));
      if (error) (storage.errors as string[]).push(`${bucket}: ${error.message}`);
      else storage.removed = (storage.removed as number) + (data?.length ?? 0);
    }
  }

  // 4. Apple.
  const apple = providers.has("apple") ? await revokeApple(body) : { attempted: false, reason: "not an Apple account" };

  // 5. Login.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid, false);
  if (delErr) {
    await admin.from("account_deletion_requests").upsert({
      user_id: uid, data_deleted: true, report,
    });
    return json(req, 500, {
      error: "auth_delete_failed",
      detail: delErr.message,
      data_deleted: true,
      note: "Your data was deleted; the login record is queued for removal.",
    });
  }

  // 6. Clear any queue row left by an earlier RPC-path attempt.
  await admin.from("account_deletion_requests").delete().eq("user_id", uid);

  const { storage_objects: _omit, ...counts } = (report ?? {}) as Record<string, unknown>;
  return json(req, 200, {
    ok: true,
    user_id: uid,
    auth_user_deleted: true,
    anonymous: !!(user as { is_anonymous?: boolean }).is_anonymous,
    deleted: counts,
    storage,
    apple,
    via: "edge",
  });
});
