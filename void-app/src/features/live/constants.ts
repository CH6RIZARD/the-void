// Ported verbatim from void2-final.html (LIVE CONNECTION ENGINE / GLOBE WORLD-WALL).
import { streamKey, type StreamSource } from './core';

/**
 * HOW LONG A SOURCE MAY HOLD A LANE BEFORE THE CASCADE GIVES UP ON IT.
 *
 * This was 8-9 SECONDS. There are four lanes, so four dead sources stalled the
 * whole wall for most of ten seconds while the tiles sat there empty - and dead
 * sources are common, because these lists are long and the internet moves.
 * Nothing about that wait was useful: a feed that is alive answers in well under
 * two seconds, and one that has not answered in three is almost never about to.
 *
 * Cut to roughly the time a live feed actually needs. The cost is a slow-but-
 * alive stream on a bad connection being dropped a little early; the cascade
 * simply moves to the next source, and since the pools are now thousands deep
 * rather than a handful, moving on is cheap and standing still is not.
 */
// MEASURED AGAIN, THE OTHER WAY. 8-9s was far too long and stalled the wall;
// 3.2s turned out to be too SHORT - tiles switched source every couple of
// seconds and never settled, because a live HLS stream on a phone connection
// routinely needs four or five seconds to hand over its first segment, and
// YouTube needs longer still. Cutting it off at 3.2s meant walking the whole
// chain and finding nothing, which looks exactly like nothing loading.
//
// 5.5s and 7s: long enough for a real stream to answer, well short of the
// ten-second stalls that started this.
export const CONNECT_TIMEOUT: Record<string, number> = { hls: 5500, mjpeg: 4500, youtube: 7000, iframe: 5500 };

/** Hosts whose iframe embeds actually render (X-Frame friendly). */
export const EMBEDDABLE_IFRAME =
  /(windy\.com|viewsurf\.com|worldcams\.tv|worldcam\.eu|world-livecam\.com|worldlivecamera\.com|seoul\.go\.kr|khh\.travel|ali-nsa\.net|tw\.live|koryo\.tv|worldviewstream\.com)/i;
/** Only a player-embed URL may occupy a tile; portal pages fail in 0ms. */
export const IFRAME_PLAYER_URL = /(\/embed(\/|\?|$)|[?&]embed=|\/player(\/|\?|$)|\/iframe(\/|\?|$))/i;

/** yt-error 100/101/150/153 = removed / embedding disabled: permanent. */
export const YT_DEAD_CODES = new Set([100, 101, 150, 153]);

export const WALL_BATCH = 12;
export const WALL_HEAL_MAX = 2;
export const WALL_HEAL_COOLDOWN = 12000;
/**
 * Mobile connection lanes (web: IS_MOBILE ? 8 : 10). Native: 4. Each lane is a player
 * being created and buffering at once; eight at a time on a low-end phone starved the
 * globe's first frames and the UI thread. Playing tiles do not hold a lane.
 */
export const WALL_LANES = 4;
/**
 * First wall batch waits this long after the build, so the globe paints first.
 *
 * 800ms meant the tiles did not EXIST yet, so their loaders could not move -
 * and with the placement pass throttled behind them the sparkle took around
 * three seconds to appear at all. The globe's first frame is quick now (it
 * carries no textures on this screen), so the wall does not need to stand back
 * nearly that long.
 */
export const FIRST_BATCH_DELAY_MS = 220;
/** Out of sight this long, the wall unmounts its players (see LiveWall SLEEP). */
export const SLEEP_AFTER_MS = 20000;
/** Watchdog period (web setInterval 2500). */
export const WATCHDOG_MS = 2500;
/**
 * YouTube chrome veil: the CEILING, not the wait.
 *
 * The tile is held at opacity 0 while YouTube's own title/branding chrome is on
 * screen, then faded in. This used to be a flat 3200ms timer, so a stream that
 * was up and playing in 300ms still sat behind a black veil for three more
 * seconds - the video was running the whole time, nobody was allowed to see it.
 * That is the 'reels take a second or two' everyone notices.
 *
 * Now playback lifts it: the state-1 message cuts the remaining hold to
 * YT_VEIL_MIN_MS, which is just enough for the chrome to fade on its own. This
 * stays as the cap for a tile that never reports playing.
 */
export const YT_VEIL_MS = 3200;
/** Grace after playback actually starts, before the picture is revealed. */
export const YT_VEIL_MIN_MS = 260;
/** Shadow audio fallback (web 5000). */
export const YT_SHADOW_FALLBACK_MS = 5000;
/** YouTube bootstrap nudge (web 900ms) and shadow kick (web 600ms). */
export const YT_NUDGE_MS = 900;
export const YT_SHADOW_KICK_MS = 600;

/**
 * Origin the YouTube WebViews load under. YouTube needs a real https origin and a
 * Referer (CURSOR #1: without one it returns Error 153 and live_stream never
 * resolves). The HTML is loaded with this as baseUrl — nothing is fetched from it.
 */
export const YT_ORIGIN = 'https://thevoid.app';

/**
 * NATIVE-ONLY memory guard (no web equivalent — the web never unmounts a tile).
 * A phone cannot hold an unbounded number of WebViews/decoders. EVERY TILE IN VIEW
 * PLAYS; the guard only touches tiles that are off-screen.
 *
 * Tiles further than PARK_SCREENS viewport-heights from the visible window are PAUSED
 * (HLS pauses the player, YouTube gets pauseVideo — see StreamTile). Beyond
 * EVICT_SCREENS, once more than MAX_MOUNTED_WEBVIEWS YouTube/iframe players are
 * mounted, the FARTHEST are unmounted and reconnect when scrolled back.
 *
 * Measured on a Helio P35 (2026-09-20): at 3/5/18 the app held ~18 live decoders,
 * 200 MB of graphics memory and ran at 1–2 fps. One screen of parking keeps the
 * visible tiles (a 2-wide wall shows ~6) playing while everything else is idle.
 * MAX_MOUNTED_WEBVIEWS 8 -> 4 (2026-09-22): a parked WebView still keeps its renderer
 * process alive; only unmounting frees it.
 */
export const PARK_SCREENS = 1;
export const EVICT_SCREENS = 2;
export const MAX_MOUNTED_WEBVIEWS = 2;
/**
 * Players of ANY kind mounted at once (HLS decoders included). Pausing an
 * off-screen HLS tile does NOT free its decoder: with only the WebView cap the
 * wall reached 933 MB on the test phone and Android killed the app (2026-09-22).
 *
 * THIS WAS 4, AND THE COMMENT ABOVE IT SAID 'a 2-wide wall shows about 6 tiles, so
 * everything in view still plays'. Four is not six. The eviction pass sheds until
 * it is inside the budget whatever the distance, so two of the six tiles you were
 * actually looking at were let go every pass - which is why the wall never filled
 * and why it looked like roughly two thirds of it was dead.
 *
 * Six, so the visible screen can fill, and no further. The crash that set this cap
 * came from about EIGHTEEN live decoders, not six, and the budget below still
 * drops by one on every decoder failure and stays down for the session - so a
 * phone that cannot serve six settles where it can, on its own, within seconds.
 */
// This is the CEILING the device is willing to serve, not the number of tiles
// that may play. The wall asks for as many as it is actually showing (see
// LiveWall) and this caps that ask. It still drops by one on every decoder
// failure, so a phone that cannot serve eight settles lower on its own.
// Six, not eight. The wall asks for what it is showing and this caps the ask;
// at eight the decoders contend - more streams starting at once means each one
// starts SLOWER, and a wall that filled in about four seconds was taking twenty.
// Six covers a 2-wide screen, which is the point, without that pile-up.
export const MAX_MOUNTED_PLAYERS = 6;
// ─── THE BUDGET LEARNS THE DEVICE ────────────────────────────────────────
// A phone has a fixed number of hardware video decoders (commonly 4-8). Past that
// Android hands out the SOFTWARE decoder, and on the test phone that one dies:
//
//   Decoder failed: c2.android.avc.decoder   (MediaCodec error 0x80000000)
//   Fatal signal 11 (SIGSEGV) in tid ... (ExoPlayer:Playb)
//
// A native segfault on the playback thread takes the whole app down - it cannot be
// caught in JS - so the only defence is not to ask for more decoders than the device
// can serve. The caps above are the opening bid (4 players + 2 web players sits
// inside the usual hardware limit); this budget then drops by one every time a
// decoder actually fails, and stays down for the session. A device with plenty keeps
// the full budget; one like the test phone settles where it can cope.
let playerBudget = MAX_MOUNTED_PLAYERS;
let decoderFailures = 0;
export const PLAYER_BUDGET_FLOOR = 2;
export function playerBudgetNow(): number { return playerBudget; }
export function decoderFailureCount(): number { return decoderFailures; }
/** A player reported a codec failure: ask for one fewer from now on. */
export function noteDecoderFailure(): number {
  decoderFailures++;
  playerBudget = Math.max(PLAYER_BUDGET_FLOOR, playerBudget - 1);
  return playerBudget;
}
/** Test seam. */
export function _resetPlayerBudget(): void { playerBudget = MAX_MOUNTED_PLAYERS; decoderFailures = 0; }
/**
 * How far off screen a tile must be to be given up when the wall is over budget.
 * 0 = anything not fully in view. A tile you can see always keeps playing.
 */
export const EVICT_MARGIN_SCREENS = 0;
/**
 * Per-player buffers for wall tiles. Measured on the test phone: graphics surfaces
 * (EGL 302 MB + GL 49 MB) and decoder buffers dominate the app's memory, so each tile
 * holds the least that still plays smoothly.
 */
export const WALL_BUFFER = { preferredForwardBufferDuration: 4, minBufferForPlayback: 1.5, maxBufferBytes: 4 << 20 };

// ─── One stream, one place on screen (web claimLiveKey/releaseLiveKey) ───────
// Claimed by URL *and* by channel, because the same feed reaches the wall under more
// than one URL: the generated pool carries a channel in several nations' lists, with
// query strings that differ, http vs https, or simply two entries for one broadcaster.
// A URL-only claim let all of those through, which is why one channel could sit in
// several tiles at once (reported 09-23: Sky News AU repeating while scrolling).
const liveClaimed = new Set<string>();
/** Same stream, different address: strip query, fragment and case. */
function urlKey(k: string): string {
  return k.split('?')[0].split('#')[0].toLowerCase();
}
/** Same broadcaster, different entry. Ignores labels too generic to be an identity. */
function labelKey(source: StreamSource): string {
  const raw = String((source as any).label || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (raw.length < 4 || /^d+$/.test(raw)) return '';
  return 'label:' + raw;
}
function claimKeys(source: StreamSource): string[] {
  const out: string[] = [];
  const k = streamKey(source);
  if (k) out.push(urlKey(k));
  const l = labelKey(source);
  if (l) out.push(l);
  return out;
}
export function claimLiveKey(source: StreamSource): boolean {
  const keys = claimKeys(source);
  if (!keys.length) return true;
  if (keys.some(k => liveClaimed.has(k))) return false;
  keys.forEach(k => liveClaimed.add(k));
  return true;
}
export function releaseLiveKey(source: StreamSource): void {
  claimKeys(source).forEach(k => liveClaimed.delete(k));
}
/** Test seam: what a source would claim. */
export function _claimKeysFor(source: StreamSource): string[] { return claimKeys(source); }

/** web liveUrl(): the channel/live-vid embed URL, exact param order. */
export function liveUrl(ch: string | { id: string; vid?: string | null }, mute = 1): string {
  const origin = encodeURIComponent(YT_ORIGIN);
  const obj = typeof ch === 'object' && ch ? ch : null;
  const channelId = obj ? obj.id : (ch as string);
  const vid = obj && obj.vid ? obj.vid : null;
  const common = `autoplay=1&mute=${mute}&controls=0&rel=0&playsinline=1&iv_load_policy=3&fs=0&disablekb=1&enablejsapi=1&origin=${origin}`;
  if (vid) return `https://www.youtube.com/embed/${vid}?${common}`;
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&${common}`;
}

const YT_CLEAN =
  '&autoplay=1&mute=1&playsinline=1&rel=0&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&cc_load_policy=0';

/** attemptSource youtube branch: the exact embed src the web builds. */
export function youtubeEmbedSrc(source: StreamSource, vid: string | null | undefined): string {
  const id = source.id || '';
  const origin = encodeURIComponent(YT_ORIGIN);
  let base: string;
  if (/^(PL|UU|OLAK)/.test(id)) base = 'https://www.youtube.com/embed/videoseries?list=' + id + YT_CLEAN;
  else if (id.length === 11) base = 'https://www.youtube.com/embed/' + id + '?' + YT_CLEAN.slice(1);
  else base = liveUrl(vid ? { id, vid } : id);
  return base + (/enablejsapi/.test(base) ? '' : '&enablejsapi=1&origin=' + origin);
}

/** Instant refusals of attemptSource, before anything is mounted. */
export function iframeAllowed(source: StreamSource): boolean {
  const u = source.url || '';
  return EMBEDDABLE_IFRAME.test(u) && IFRAME_PLAYER_URL.test(u);
}
