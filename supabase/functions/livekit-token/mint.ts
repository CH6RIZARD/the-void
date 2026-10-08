// supabase/functions/livekit-token/mint.ts
//
// The one place the LiveKit grant is shaped. index.ts (Deno) and mint.test.mjs
// (node) both run THIS code; they only differ in where AccessToken comes from
// (`npm:livekit-server-sdk` vs the installed package), so the class is passed
// in instead of imported here. Keeps the test honest: it checks the grant the
// function actually mints, not a copy of it.

export const ROOM_PREFIX = "dm_";
export const TOKEN_TTL = "1h";

export function roomFor(conversationId: string): string {
  return ROOM_PREFIX + conversationId;
}

// Minimal shape of livekit-server-sdk's AccessToken we rely on.
export interface AccessTokenLike {
  addGrant(grant: Record<string, unknown>): void;
  toJwt(): Promise<string>;
}
export type AccessTokenCtor = new (
  apiKey: string,
  apiSecret: string,
  options: { identity: string; name?: string; ttl?: string },
) => AccessTokenLike;

export interface MintInput {
  apiKey: string;
  apiSecret: string;
  userId: string;          // LiveKit identity = Supabase user id
  name: string;            // display name shown to the other participant
  conversationId: string;
}

export async function mintCallToken(AccessToken: AccessTokenCtor, input: MintInput): Promise<string> {
  const at = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.userId,
    name: input.name,
    ttl: TOKEN_TTL,
  });
  // Scoped to exactly one room. No roomCreate/roomList/roomAdmin: the room is
  // auto-created on first join and a member of thread X must not be able to
  // enumerate or join thread Y's room with this token.
  at.addGrant({
    room: roomFor(input.conversationId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return await at.toJwt();
}
