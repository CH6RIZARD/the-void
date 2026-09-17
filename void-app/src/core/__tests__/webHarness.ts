// Loads ORIGINAL functions out of void2-final.html into a vm sandbox, so golden
// tests can run the web implementation and the TS port on the same inputs.
//
// The web app is one ~7,000-line <script> with DOM side effects at top level, so
// it is never run whole. Individual top-level declarations are cut out by name:
// a declaration runs from its first line to the next column-0 statement, extended
// line-block by line-block until the chunk parses (column-0 comments inside an
// object literal, e.g. BIO, would otherwise truncate it).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_HTML = path.resolve(here, '../../../../void2-final.html');

let _lines: string[] | null = null;
function scriptLines(): string[] {
  if (_lines) return _lines;
  const all = fs.readFileSync(WEB_HTML, 'utf8').split('\n');
  // The main app script is the LARGEST <script> block (the file also carries a
  // boot failsafe and a moderation IIFE in their own blocks).
  let best: [number, number] = [0, 0], open = -1;
  for (let i = 0; i < all.length; i++) {
    if (/^<script>\s*$/.test(all[i])) open = i + 1;
    else if (open >= 0 && /^<\/script>/.test(all[i])) {
      if (i - open > best[1] - best[0]) best = [open, i];
      open = -1;
    }
  }
  _lines = all.slice(best[0], best[1]);
  return _lines;
}

const TOP = /^(?:async\s+function\b|function\b|const\b|let\b|var\b|class\b|\/\/|\/\*|[A-Za-z_$][\w$.]*\s*\(|\(|try\s*\{|if\s*\()/;

function parses(src: string): boolean {
  try { new vm.Script(src); return true; } catch { return false; }
}

function chunkFrom(i: number): string {
  const L = scriptLines();
  let j = i + 1;
  for (;;) {
    while (j < L.length && !TOP.test(L[j])) j++;
    const src = L.slice(i, j).join('\n');
    if (parses(src) || j >= L.length) return src;
    j++;
  }
}

/** Source of a top-level declaration (function / const / let) by name. */
export function webSource(name: string): string {
  const L = scriptLines();
  const re = new RegExp('^(?:async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(|^(?:const|let|var)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=');
  const i = L.findIndex(l => re.test(l));
  if (i < 0) throw new Error('web declaration not found: ' + name);
  return chunkFrom(i);
}
/** Source of the first top-level statement whose line starts with `prefix`. */
export function webStatement(prefix: string): string {
  const L = scriptLines();
  const i = L.findIndex(l => l.startsWith(prefix));
  if (i < 0) throw new Error('web statement not found: ' + prefix);
  return chunkFrom(i);
}

/** Deterministic PRNG shared by both sides of a golden test. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    _m: m,
  };
}

export interface WebSandbox {
  ctx: vm.Context;
  load(...names: string[]): void;
  stmt(prefix: string): void;
  run<T = any>(code: string): T;
  setRandom(r: () => number): void;
  setNow(t: number): void;
}

// Minimal DOMParser stand-in for htmlText(): tag strip + entity decode, which is
// what body.textContent yields for the Mastodon/PeerTube HTML the app sees.
function decodeEntities(s: string): string {
  // Browser DOMParser decodes every HTML entity; this covers the ones seen in fedi HTML.
  const named: Record<string, string> = { hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const v = named[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function webSandbox(opts: { seed?: number; now?: number } = {}): WebSandbox {
  let random = mulberry32(opts.seed ?? 1);
  let now = opts.now ?? Date.UTC(2026, 8, 16, 12, 0, 0);
  const RealDate = Date;
  const FakeDate: any = function (this: any, ...a: any[]) {
    return a.length ? new (RealDate as any)(...a) : new RealDate(now);
  };
  FakeDate.now = () => now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  const FakeMath = Object.create(Math);
  FakeMath.random = () => random();
  const sandbox: any = {
    console, URL, URLSearchParams, AbortController, TextEncoder, setTimeout, clearTimeout,
    Math: FakeMath, Date: FakeDate,
    localStorage: memStore(), sessionStorage: memStore(),
    location: { search: '', href: 'https://thevoid.app/', origin: 'https://thevoid.app' },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], hidden: false },
    DOMParser: class { parseFromString(h: string) { return { body: { textContent: decodeEntities(String(h).replace(/<[^>]+>/g, '')) } }; } },
    fetch: async () => { throw new Error('network disabled in golden tests'); },
    addEventListener: () => {}, setInterval: () => 0, requestAnimationFrame: () => 0,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const loaded = new Set<string>();
  return {
    ctx,
    load(...names) {
      for (const n of names) {
        if (loaded.has(n)) continue;
        loaded.add(n);
        vm.runInContext(webSource(n), ctx, { filename: 'void2-final.html#' + n });
      }
    },
    stmt(prefix) {
      if (loaded.has('stmt:' + prefix)) return;
      loaded.add('stmt:' + prefix);
      vm.runInContext(webStatement(prefix), ctx, { filename: 'void2-final.html#stmt' });
    },
    run(code) { return vm.runInContext(code, ctx); },
    setRandom(r) { random = r; },
    setNow(t) { now = t; },
  };
}
