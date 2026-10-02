// EVERY REQUEST HAS A DEADLINE.
//
// React Native's Android HTTP client has no read timeout by default and iOS waits
// about 60 s per stalled request, so a single connection that opens and then says
// nothing used to hang a whole surface for the rest of the session: the feed's
// `feedLoading`, reels' `_reelLoading` and the composer's `dropping` are all
// single-flight locks that only clear when their fetch settles. On a fresh install
// (no cached posts) that is a permanently blank feed under "SCANNING VERIFIED PUBLIC
// SOURCES…", with TAP TO RETRY doing nothing - reproduced on the test phone.
//
// An aborted request rejects, which those callers already treat as a failed pull, so
// the surface can show its empty/retry state instead of waiting forever.
/** Plain reads: long enough for a slow mobile network, short enough to retry. */
export const READ_TIMEOUT_MS = 12000;
/** Uploads: a photo or voice note on a weak uplink legitimately takes a while. */
export const UPLOAD_TIMEOUT_MS = 90000;

function isUpload(init?: any): boolean {
  const body: any = init?.body;
  if (!body) return false;
  if (typeof body === 'string') return body.length > 1 << 20; // a big JSON payload
  return true; // FormData / Blob / ArrayBuffer / stream
}

/**
 * fetch with a deadline. A caller's own AbortSignal still works: whichever fires
 * first wins. Never swallows the error - the caller sees an AbortError and can retry.
 */
export function fetchWithDeadline(input: any, init?: any, ms?: number): Promise<Response> {
  const g: any = globalThis;
  const limit = ms ?? (isUpload(init) ? UPLOAD_TIMEOUT_MS : READ_TIMEOUT_MS);
  if (typeof AbortController === 'undefined') return g.fetch(input, init);
  const ctl = new AbortController();
  const outer = init?.signal as AbortSignal | undefined;
  if (outer) {
    if (outer.aborted) ctl.abort();
    else outer.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), limit);
  return g
    .fetch(input, { ...(init || {}), signal: ctl.signal })
    .finally(() => clearTimeout(timer));
}
