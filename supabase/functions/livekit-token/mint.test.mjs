// Offline check for the grant livekit-token mints. No network, no Supabase:
// runs mint.ts (the same module index.ts uses) with the real livekit-server-sdk
// and verifies the JWT with the sdk's own TokenVerifier.
//
//   cd supabase/functions/livekit-token && npm install && npm test
//
// node >= 22.6 strips the types in mint.ts natively; nothing is transpiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { mintCallToken, roomFor, ROOM_PREFIX } from "./mint.ts";

const API_KEY = "APItestkey";
const API_SECRET = "s".repeat(32); // the sdk refuses secrets shorter than 32 bytes
const CONV = "4b2f6c1e-9d3a-4f1b-8e7c-2a5d6f7e8c9b";
const USER = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";

test("token is scoped to the DM room, identifies the caller, lasts one hour", async () => {
  const before = Math.floor(Date.now() / 1000);
  const jwt = await mintCallToken(AccessToken, {
    apiKey: API_KEY, apiSecret: API_SECRET, userId: USER, name: "Dan", conversationId: CONV,
  });

  // Signature + issuer check with the sdk: a token minted with another secret
  // would throw here.
  const claims = await new TokenVerifier(API_KEY, API_SECRET).verify(jwt);
  assert.equal(claims.sub, USER, "identity is the Supabase user id");
  assert.equal(claims.name, "Dan");
  assert.equal(claims.iss, API_KEY);

  const grant = claims.video;
  assert.equal(grant.room, `${ROOM_PREFIX}${CONV}`);
  assert.equal(grant.room, roomFor(CONV));
  assert.equal(grant.roomJoin, true);
  assert.equal(grant.canPublish, true);
  assert.equal(grant.canSubscribe, true);
  // Nothing that reaches past this one room.
  assert.ok(!grant.roomCreate && !grant.roomList && !grant.roomAdmin && !grant.roomRecord,
    "no room-level admin grants");

  // ttl '1h' → exp ≈ iat + 3600 (sdk sets iat itself; allow a few seconds of skew).
  assert.ok(claims.exp - before >= 3600 - 5 && claims.exp - before <= 3600 + 5,
    `exp is one hour out (got ${claims.exp - before}s)`);
});

test("a token minted with a different secret does not verify", async () => {
  const jwt = await mintCallToken(AccessToken, {
    apiKey: API_KEY, apiSecret: "x".repeat(32), userId: USER, name: "Dan", conversationId: CONV,
  });
  await assert.rejects(() => new TokenVerifier(API_KEY, API_SECRET).verify(jwt));
});

test("two conversations never share a room", () => {
  assert.notEqual(roomFor(CONV), roomFor("ffffffff-0000-4000-8000-000000000000"));
});
