// Web number/time formatters used by the search cards and the reel rail.
//   function fmt(n){return n>=1000?(n/1000).toFixed(1)+'k':String(n)}
//   function ago(ts){...s / m / h / d}
export function fmt(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
}

export function ago(ts: number | null | undefined, now = Date.now()): string {
  const d = Math.floor((now - (Number(ts) || now)) / 1000);
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}

/** `p.id.split('~')[0]` — reel cards carry `<id>~<rand>`. */
export const baseId = (id: string | null | undefined) => String(id || '').split('~')[0];
