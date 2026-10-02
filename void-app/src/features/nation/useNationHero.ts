// NATION HERO DRIVER — native port of loadCountryLiveGrid(c, attempt) (void2-final.html).
//
//   token          _clgToken   (a newer load / close stales every await)
//   retryT         _clgRetry   (8 / 20 / 45s backoff while nothing plays; hero hidden)
//   healT          _heroHeal   (4s: a dead hero walks on to the NEXT source, in place)
//   idx            `i`         (the walk index survives heals, like the web closure)
//
// One source at a time is mounted as <StreamTile key={attempt.key} …/>; its
// onSettled(ok) resolves the pending attempt. The web attemptSource() does NOT claim
// the one-stream-one-place key (that line is commented out in the web), so neither
// does the hero: only the instant refusals (refuseInstantly) apply.
import { useCallback, useEffect, useRef, useState } from 'react';
import { _nationLive, nationStreamSources, noteNationLive } from '../../core';
import type { Country, StreamSource as CoreSource } from '../../core/types';
import { refuseInstantly } from '../live/useStreamCascade';
import { rememberStream, type StreamSource } from '../live/core';

export interface HeroAttempt {
  key: string;
  src: StreamSource;
}

export interface NationHeroState {
  /** hero.hidden — no sources at all, or waiting on the retry backoff. */
  hidden: boolean;
  /** hero.classList 'playing'. */
  playing: boolean;
  /** Mounted attempt (null = only the sparkle hold is on the stage). */
  attempt: HeroAttempt | null;
  /** Source nationHeroMeta() describes (null = caption/badge/kind empty). */
  metaSrc: CoreSource | null;
}

const HEAL_MS = 4000;
const RETRY_MS = [8000, 20000, 45000];
const PREFLIGHT_MS = 6000;
const PREFLIGHT_RACE_MS = 600;
let seq = 0;

export function useNationHero(c: Country) {
  const [state, setState] = useState<NationHeroState>({ hidden: false, playing: false, attempt: null, metaSrc: null });
  const r = useRef({
    alive: true,
    token: 0,
    retryT: null as ReturnType<typeof setTimeout> | null,
    healT: null as ReturnType<typeof setInterval> | null,
    needsHeal: false,
    healing: false,
    attemptKey: null as string | null,
    pending: null as null | ((ok: boolean) => void),
  }).current;

  const patch = useCallback((p: Partial<NationHeroState>) => {
    if (r.alive) setState((s) => ({ ...s, ...p }));
  }, [r]);

  /** teardownLiveIn(stage): unmount the player, drop a pending attempt as failed. */
  const teardown = useCallback(() => {
    r.attemptKey = null;
    const p = r.pending;
    r.pending = null;
    if (p) p(false);
    patch({ attempt: null });
  }, [r, patch]);

  const clearTimers = useCallback(() => {
    if (r.retryT) clearTimeout(r.retryT);
    if (r.healT) clearInterval(r.healT);
    r.retryT = null;
    r.healT = null;
  }, [r]);

  const load = useCallback(
    async (attempt: number) => {
      const token = ++r.token;
      clearTimers();
      teardown();
      if (!attempt) _nationLive[c.n] = [];
      r.needsHeal = false;
      r.healing = false;
      patch({ hidden: false, playing: false, metaSrc: null }); // nationHeroMeta(null,c) + sparkleTile(stage,'● SCANNING')
      const sources = (await nationStreamSources(c)) as unknown as StreamSource[];
      if (token !== r.token || !r.alive) return;
      if (!sources.length) {
        patch({ hidden: true });
        return;
      }

      // HLS preflight: dead manifests fail in parallel instead of costing 8s each.
      const pre = new Map<StreamSource, Promise<boolean>>();
      const preflight = (src: StreamSource | undefined): Promise<boolean> | null => {
        if (!src || src.type !== 'hls' || !src.url) return null;
        if (!pre.has(src)) {
          const AC: any = (globalThis as any).AbortController;
          const ctl = AC ? new AC() : null;
          const t = setTimeout(() => {
            try {
              ctl && ctl.abort();
            } catch {}
          }, PREFLIGHT_MS);
          pre.set(
            src,
            fetch(src.url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' } as any)
              .then((res) => (res.ok ? res.text().then((x) => x.slice(0, 256).includes('#EXTM3U')) : false))
              .catch(() => false)
              .finally(() => clearTimeout(t)),
          );
        }
        return pre.get(src)!;
      };
      sources.slice(0, 10).forEach(preflight);

      const tryOne = (src: StreamSource) =>
        new Promise<boolean>((resolve) => {
          if (refuseInstantly(src)) {
            resolve(false);
            return;
          }
          const key = `nh${++seq}`;
          r.attemptKey = key;
          r.pending = resolve;
          patch({ attempt: { key, src } });
        });

      let i = 0;
      const next = async (): Promise<boolean> => {
        while (i < sources.length) {
          if (token !== r.token) return false;
          const src = sources[i++];
          sources.slice(i, i + 4).forEach(preflight);
          const pf = preflight(src);
          if (pf && (await Promise.race([pf, new Promise<null>((res) => setTimeout(() => res(null), PREFLIGHT_RACE_MS))])) === false) continue;
          if (token !== r.token) return false;
          teardown();
          r.needsHeal = false;
          patch({ playing: false }); // sparkleTile(stage) - no label
          const ok = await tryOne(src);
          if (token !== r.token) return false;
          if (ok) {
            rememberStream(src);
            noteNationLive(c.n, src as unknown as CoreSource);
            patch({ playing: true, metaSrc: src as unknown as CoreSource });
            return true;
          }
          teardown();
        }
        return false;
      };

      const retryLater = (delay: number) => {
        patch({ hidden: true });
        r.retryT = setTimeout(() => {
          if (r.alive) load(attempt + 1);
        }, delay);
      };

      if (!(await next())) {
        if (token === r.token && attempt < 3) retryLater(RETRY_MS[attempt]);
        return;
      }
      r.healT = setInterval(async () => {
        if (token !== r.token) {
          if (r.healT) clearInterval(r.healT);
          return;
        }
        if (r.healing) return;
        if (!r.needsHeal && r.attemptKey) return; // still playing
        r.healing = true;
        const ok = await next();
        r.healing = false;
        if (token !== r.token) return;
        if (!ok) {
          if (r.healT) clearInterval(r.healT);
          r.healT = null;
          retryLater(20000);
        }
      }, HEAL_MS);
    },
    // c is fixed for the life of the screen (NationScreen keys the view by ISO)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** StreamTile.onSettled for the mounted attempt. */
  const settle = useCallback(
    (key: string, ok: boolean) => {
      if (key !== r.attemptKey) return;
      const p = r.pending;
      r.pending = null;
      if (!ok) r.attemptKey = null;
      if (p) p(ok);
    },
    [r],
  );

  /** StreamTile.onNeedsHeal: a hard death after PLAYING (stage.__needsHeal). */
  const needsHeal = useCallback(
    (key: string) => {
      if (key === r.attemptKey) r.needsHeal = true;
    },
    [r],
  );

  useEffect(() => {
    r.alive = true;
    load(0);
    return () => {
      // closeOverlay(): _clgToken++, clearTimeout(_clgRetry), clearInterval(_heroHeal), teardownLiveIn
      r.alive = false;
      r.token++;
      clearTimers();
      const p = r.pending;
      r.pending = null;
      r.attemptKey = null;
      if (p) p(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, settle, needsHeal };
}
