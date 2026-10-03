// TAP-FOR-SOUND — one audible source in the whole app (web: _audioCell,
// toggleStreamAudio, streamSetAudio, silenceOtherMedia, releaseStreamAudio, ytShadow*).
//
// Every live stream plays muted and never stops. Tapping a playing stream turns its
// sound on; tapping another moves the sound; tapping the audible one mutes it. Any
// other audio in the app (reel with sound, audio drop, radio) calls claimAudio() and
// takes the slot, silencing the stream.
//
// YouTube: the visible tile is never commanded for sound (a command paints YouTube's
// chrome). A hidden SHADOW player of the same video carries the audio, seek-synced for
// VODs. If it is not PLAYING within 5s, the visible tile unmutes behind its veil.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { YT_SHADOW_FALLBACK_MS } from './constants';
import { PLAYER_WEBVIEW_PROPS, YT_BASE_URL, parseYtMsg, ytCmd, ytPlayerHtml } from './ytHtml';

export interface YtAudioHooks {
  /** The exact embed src the visible tile is playing. */
  embedSrc: string;
  /** web ytTileTime(): last reported time + wall-clock since. */
  time(): number;
  duration(): number;
  /** Fallback: unmute (on) / mute (off) the VISIBLE player, behind a veil. */
  setFallback(on: boolean): void;
}

/** A stream tile registers itself as the target of a tap. */
export interface AudioTarget {
  id: string;
  /** HLS / others: toggle the player's mute. */
  setMuted(muted: boolean): void;
  yt?: YtAudioHooks;
}

/** Any non-stream app audio (reels, audio posts, radio). */
export interface ExternalAudio {
  id: string;
  stop(): void;
}

interface AudioCtx {
  audibleId: string | null;
  /** Tap on a PLAYING tile. */
  toggleStream(target: AudioTarget): void;
  /** Tile unmounted / disposed / healed: drop sound if it was this one. */
  releaseStream(id?: string): void;
  /** Other app audio starts: it owns the single slot now. */
  claimAudio(owner: ExternalAudio): void;
  releaseAudio(id: string): void;
  /** Stream tiles read this to know whether they should be audible after a nudge. */
  isAudible(id: string): boolean;
  isFallback(id: string): boolean;
}

const Ctx = createContext<AudioCtx | null>(null);

interface Shadow {
  key: number;
  targetId: string;
  src: string;
  isVod: boolean;
  seekTo: number;
  playing: boolean;
  fallbackT: ReturnType<typeof setTimeout> | null;
}

export function AudioOwnerProvider({ children }: { children: React.ReactNode }) {
  const [audibleId, setAudibleId] = useState<string | null>(null);
  const current = useRef<AudioTarget | null>(null);
  const external = useRef<ExternalAudio | null>(null);
  const fallbackIds = useRef(new Set<string>());
  const [shadow, setShadow] = useState<Shadow | null>(null);
  const shadowRef = useRef<Shadow | null>(null);
  const shadowView = useRef<WebView>(null);
  const shadowSeq = useRef(0);

  const stopShadow = useCallback(() => {
    const sh = shadowRef.current;
    if (!sh) return;
    if (sh.fallbackT) clearTimeout(sh.fallbackT);
    shadowRef.current = null;
    setShadow(null);
  }, []);

  const startShadow = useCallback(
    (target: AudioTarget) => {
      stopShadow();
      const yt = target.yt!;
      let u: URL;
      try {
        u = new URL(yt.embedSrc);
      } catch {
        return;
      }
      const t = yt.time();
      const dur = yt.duration() || 0;
      const isVod = dur > 0 && t < dur - 20;
      u.searchParams.set('mute', '0');
      u.searchParams.set('autoplay', '1');
      if (isVod) u.searchParams.set('start', String(Math.max(0, Math.floor(t))));
      const sh: Shadow = { key: ++shadowSeq.current, targetId: target.id, src: u.toString(), isVod, seekTo: 0, playing: false, fallbackT: null };
      // No audio within 5s → unmuted autoplay refused in the shadow. Use the visible
      // player instead, veiled, so the user still gets sound.
      sh.fallbackT = setTimeout(() => {
        if (sh.playing || shadowRef.current !== sh || current.current?.id !== target.id) return;
        stopShadow();
        fallbackIds.current.add(target.id);
        try {
          yt.setFallback(true);
        } catch {}
      }, YT_SHADOW_FALLBACK_MS);
      shadowRef.current = sh;
      setShadow(sh);
    },
    [stopShadow],
  );

  const setAudio = useCallback(
    (target: AudioTarget, on: boolean) => {
      if (target.yt) {
        if (on) {
          startShadow(target);
          return;
        }
        if (shadowRef.current && shadowRef.current.targetId === target.id) stopShadow();
        if (fallbackIds.current.has(target.id)) {
          fallbackIds.current.delete(target.id);
          try {
            target.yt.setFallback(false);
          } catch {}
        }
        return;
      }
      try {
        target.setMuted(!on);
      } catch {}
    },
    [startShadow, stopShadow],
  );

  const toggleStream = useCallback(
    (target: AudioTarget) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const cur = current.current;
      if (cur && cur.id === target.id) {
        setAudio(cur, false);
        current.current = null;
        setAudibleId(null);
        return;
      }
      if (cur) setAudio(cur, false);
      // silenceOtherMedia(): reels / audio drops / radio stop.
      if (external.current) {
        try {
          external.current.stop();
        } catch {}
        external.current = null;
      }
      current.current = target;
      setAudibleId(target.id);
      setAudio(target, true);
    },
    [setAudio],
  );

  const releaseStream = useCallback(
    (id?: string) => {
      // The user hears sound die when its tile scrolls past; every path that can
      // do that now says so, so the next session's log names the culprit.
      try { if (audibleId && id === audibleId) console.warn('[audio] cut: releaseStream(' + audibleId + ')'); } catch {}
      const cur = current.current;
      if (!cur || (id && cur.id !== id)) {
        if (id) fallbackIds.current.delete(id);
        return;
      }
      setAudio(cur, false);
      current.current = null;
      setAudibleId(null);
    },
    [setAudio],
  );

  const claimAudio = useCallback(
    (owner: ExternalAudio) => {
      releaseStream();
      if (external.current && external.current.id !== owner.id) {
        try {
          external.current.stop();
        } catch {}
      }
      external.current = owner;
    },
    [releaseStream],
  );

  const releaseAudio = useCallback((id: string) => {
    if (external.current && external.current.id === id) external.current = null;
  }, []);

  const isAudible = useCallback((id: string) => current.current?.id === id, []);
  const isFallback = useCallback((id: string) => fallbackIds.current.has(id), []);

  useEffect(() => () => stopShadow(), [stopShadow]);

  const onShadowMessage = useCallback((e: WebViewMessageEvent) => {
    const sh = shadowRef.current;
    const m = parseYtMsg(e.nativeEvent.data);
    if (!sh || !m) return;
    const st = m.e === 'state' || m.e === 'info' ? m.s : null;
    if (st === 1 && !sh.playing) {
      sh.playing = true;
      if (sh.fallbackT) clearTimeout(sh.fallbackT);
      // Resync to the picture once audio is flowing (the shadow started ~1-2s late).
      if (sh.isVod && current.current?.yt && current.current.id === sh.targetId) {
        const t = current.current.yt.time() + 0.25;
        shadowView.current?.injectJavaScript(ytCmd('seekTo', [t, true]));
      }
    }
  }, []);

  const value = useMemo<AudioCtx>(
    () => ({ audibleId, toggleStream, releaseStream, claimAudio, releaseAudio, isAudible, isFallback }),
    [audibleId, toggleStream, releaseStream, claimAudio, releaseAudio, isAudible, isFallback],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {shadow ? (
        // web: position:fixed;left:0;bottom:0;width:320px;height:180px;opacity:0;pointer-events:none;z-index:-1
        // Kept ON screen (1% opacity) — iOS/Android may refuse to run media in a view
        // that is fully transparent or outside the window.
        <View pointerEvents="none" style={styles.shadow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <WebView
            key={shadow.key}
            ref={shadowView}
            {...PLAYER_WEBVIEW_PROPS}
            source={{ html: ytPlayerHtml(shadow.src, { shadow: true }), baseUrl: YT_BASE_URL }}
            onMessage={onShadowMessage}
            style={styles.fill}
          />
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useAudioOwner(): AudioCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAudioOwner must be used inside <AudioOwnerProvider>');
  return c;
}

/** Convenience for other surfaces (reels, audio posts, radio). */
export function useClaimAudio() {
  const { claimAudio, releaseAudio } = useAudioOwner();
  return { claimAudio, releaseAudio };
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', left: 0, bottom: 0, width: 320, height: 180, opacity: 0.01, zIndex: -1 },
  fill: { flex: 1, backgroundColor: 'transparent' },
});
