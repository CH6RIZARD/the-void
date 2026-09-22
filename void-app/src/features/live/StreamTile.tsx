// STREAM TILE — native port of attemptSource(cell, source) for ONE source.
//
// Contract (mirrors the web Promise):
//   • mounts the player for `source` muted + autoplaying under the CONNECTING loader
//   • calls onSettled(true) exactly once on a REAL playing signal
//     (HLS: expo-video playing for 700ms AND the frame at 700ms is not colour bars; YouTube: playerState 1 or currentTime>0;
//      mjpeg: first frame loaded; iframe cam: load end)
//   • calls onSettled(false) exactly once on fatal error or CONNECT_TIMEOUT
//   • after success, a hard death calls onNeedsHeal() (the wall heals it)
//   • unmount = teardown (web disposeCell): player released, audio slot dropped
//
// The caller (useStreamCascade / WallTile) does the instant refusals and the
// one-stream-one-place claim before mounting this, and releases the claim on unmount.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, PixelRatio, StyleSheet, View } from 'react-native';
import { VideoView } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { usePacedPlayer } from './pacedPlayer';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { AudioRing, TileLoader } from './TileChrome';
import { useAudioOwner, type AudioTarget } from './AudioOwner';
import { liveVidFor, markBadStream, type StreamSource } from './core';
import { createSignalChecker, frameVerdict, FRAME_H, FRAME_JUDGE_DELAY, FRAME_W } from '../../core';
import { sampleFrame, sampleFramePaced } from './frameSample';
import { variantCached, variantFor } from './hlsVariant';
import { CONNECT_TIMEOUT, WALL_BUFFER, YT_DEAD_CODES, YT_NUDGE_MS, YT_VEIL_MS, youtubeEmbedSrc } from './constants';
import { PLAYER_WEBVIEW_PROPS, YT_BASE_URL, parseYtMsg, ytCmd, ytPlayerHtml } from './ytHtml';

export interface StreamTileHandle {
  /** Watchdog / resume nudge. force=true is liveNudgePlay (always), false = only when not PLAYING. */
  nudge(force?: boolean): void;
  /** Tap-for-sound; no-op until PLAYING. Returns true if the tap was consumed. */
  tap(): boolean;
  isPlaying(): boolean;
}

export interface StreamTileProps {
  tileId: string;
  source: StreamSource;
  /** Loader label while connecting ('● CONNECTING' / '● RETRYING'). */
  loaderLabel?: string;
  /** Far off-screen: pause HLS decode (native memory guard). YouTube keeps running. */
  parked?: boolean;
  /** Corner radius of the host tile, for the audio ring. */
  radius?: number;
  /** false when the host keeps its own persistent loader across attempts (the wall does). */
  showLoader?: boolean;
  /** Tile width in layout px: an HLS stream plays at the smallest size that covers it. */
  tileWidth?: number;
  /**
   * 'surface' composites the video outside the app's own GL memory (Android
   * SurfaceView). The wall uses it because 8 tiles decoding into app-side textures is
   * where its memory goes; everything else keeps the texture surface.
   */
  surface?: 'texture' | 'surface';
  onSettled(ok: boolean): void;
  onNeedsHeal?(): void;
}

interface PlayerApi {
  finish(ok: boolean): void;
  isDone(): boolean;
  succeeded(): boolean;
  needsHeal(): void;
  register(h: { nudge(force?: boolean): void; isPlaying(): boolean; target: AudioTarget }): void;
}

/**
 * Mid-stream frame check cadence per tile (was 6.1 s). Each capture costs a main-thread
 * bitmap read, and checks also share an app-wide gate (sampleFramePaced), so a dead
 * picture is still caught within ~15-30 s without stalling the UI.
 */
const SIGNAL_CHECK_MS = 15000;
/** Playing but the clock has not moved for this long: the picture is dead. */
const STALL_DEAD_MS = 15000;

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

export const StreamTile = forwardRef<StreamTileHandle, StreamTileProps>(function StreamTile(props, ref) {
  const { tileId, source, loaderLabel = '● CONNECTING', parked = false, radius = 6, showLoader = true, tileWidth, surface: surfaceType = 'texture' } = props;
  const audio = useAudioOwner();
  const [playing, setPlaying] = useState(false);
  const done = useRef(false);
  const ok = useRef(false);
  const mounted = useRef(true);
  const handles = useRef<{ nudge(force?: boolean): void; isPlaying(): boolean; target: AudioTarget } | null>(null);
  const cb = useRef(props);
  cb.current = props;

  const finish = useCallback((success: boolean) => {
    if (done.current) return;
    done.current = true;
    // Succeeding into an unmounted tile is a failure (web: !cell.isConnected).
    if (success && !mounted.current) success = false;
    ok.current = success;
    if (success) setPlaying(true);
    cb.current.onSettled(success);
  }, []);

  const api = useRef<PlayerApi>({
    finish: (s) => finish(s),
    isDone: () => done.current,
    succeeded: () => ok.current,
    needsHeal: () => cb.current.onNeedsHeal?.(),
    register: (h) => {
      handles.current = h;
    },
  }).current;

  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT[source.type] || 8000);
    return () => {
      clearTimeout(timer);
      mounted.current = false;
      audio.releaseStream(tileId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      nudge: (force) => {
        if (!ok.current) return;
        handles.current?.nudge(force);
      },
      tap: () => {
        if (!ok.current || !handles.current) return false;
        audio.toggleStream(handles.current.target);
        return true;
      },
      isPlaying: () => ok.current && !!handles.current?.isPlaying(),
    }),
    [audio],
  );

  const audible = audio.audibleId === tileId;
  let media: React.ReactNode = null;
  switch (source.type) {
    case 'hls':
      media = <HlsPlayer tileId={tileId} source={source} parked={parked} api={api} tileWidth={tileWidth} surface={surfaceType} />;
      break;
    case 'youtube':
      media = <YouTubePlayer tileId={tileId} source={source} parked={parked} api={api} />;
      break;
    case 'mjpeg':
      media = <MjpegPlayer tileId={tileId} source={source} parked={parked} api={api} />;
      break;
    case 'iframe':
      media = <IframePlayer tileId={tileId} source={source} api={api} />;
      break;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {media}
      {showLoader ? <TileLoader label={loaderLabel} visible={!playing} /> : null}
      {audible && playing ? <AudioRing radius={radius} /> : null}
    </View>
  );
});

interface PlayerProps {
  tileId: string;
  source: StreamSource;
  api: PlayerApi;
}

// ─── HLS / mp4 → expo-video ──────────────────────────────────────────────────
function HlsPlayer({ tileId, source, parked, api, tileWidth, surface = 'texture' }: PlayerProps & { parked: boolean; tileWidth?: number; surface?: 'texture' | 'surface' }) {
  const audio = useAudioOwner();
  const raw = source.url || '';
  // Play the smallest variant that covers this tile (see hlsVariant.ts). Already
  // resolved streams start on it; the rest connect on the master playlist as before
  // and switch once it is read, which is also what a failed read leaves in place.
  const targetW = PixelRatio.getPixelSizeForLayoutSize(tileWidth || 180);
  const [url, setUrl] = useState(() => variantCached(raw, targetW) || raw);
  useEffect(() => {
    let alive = true;
    variantFor(raw, targetW).then((u) => {
      if (alive && u !== url) setUrl(u);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, targetW]);
  const player = usePacedPlayer({ uri: url, contentType: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'auto' } as any, (p) => {
    p.muted = true;
    p.loop = true;
    try {
      (p as any).audioMixingMode = 'mixWithOthers';
    } catch {}
    try {
      // web hls.js maxBufferLength:8 - tighter here: a wall of tiles buffering 8s each
      // was a large share of the app's memory on the test phone.
      (p as any).bufferOptions = { ...((p as any).bufferOptions || {}), ...WALL_BUFFER };
    } catch {}
    try {
      (p as any).showNowPlayingNotification = false;
    } catch {}
    p.play();
  });
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  const shotRef = useRef<View>(null);

  useEffect(() => {
    let judgeT: ReturnType<typeof setTimeout> | null = null;
    const resume = () => {
      try {
        player.muted = !audio.isAudible(tileId);
        if (!player.playing) player.play();
      } catch {}
    };
    const subPlaying = player.addListener('playingChange', (e: any) => {
      const isPlaying = !!(e && (e.isPlaying ?? e));
      if (isPlaying && !api.isDone() && !judgeT) {
        // web: judge one decoded frame 700ms after `playing`. PLAYING is not proof of a
        // picture: an off-air channel serves SMPTE bars. Bars fail the attempt (and are
        // refused for the session) so the cascade moves on; unknown counts as fine.
        judgeT = setTimeout(async () => {
          if (api.isDone()) return;
          let bars = false;
          if (AppState.currentState === 'active') {
            const px = await sampleFrame(shotRef.current);
            bars = frameVerdict(px, FRAME_W, FRAME_H) === 'bars';
          }
          if (api.isDone()) return;
          if (bars) {
            markBadStream(source);
            api.finish(false);
            return;
          }
          api.finish(!!player.playing || player.status === 'readyToPlay');
        }, FRAME_JUDGE_DELAY);
      }
      // If the OS pauses later, nudge — never show a controls UI.
      if (!isPlaying && api.succeeded() && !parkedRef.current && AppState.currentState === 'active') resume();
    });
    const subStatus = player.addListener('statusChange', (e: any) => {
      if (e && e.status === 'error') {
        if (!api.isDone()) api.finish(false);
        else api.needsHeal();
      }
    });
    api.register({
      nudge: () => {
        if (parkedRef.current) return;
        resume();
      },
      isPlaying: () => {
        try {
          return player.playing;
        } catch {
          return false;
        }
      },
      target: {
        id: tileId,
        setMuted: (m) => {
          try {
            player.muted = m;
            if (!m) {
              player.volume = 1;
              if (!player.playing) player.play();
            }
          } catch {}
        },
      },
    });
    return () => {
      if (judgeT) clearTimeout(judgeT);
      subPlaying.remove();
      subStatus.remove();
    };
  }, [player, api, audio, tileId, source]);

  // A DEAD PICTURE WITH NO PIXELS TO READ. The colour-bar check below reads the tile's
  // own pixels, which only a TextureView can hand back; on a SurfaceView the capture
  // comes back empty and every verdict is "unknown". So a stream that stops advancing
  // while still claiming to play is caught by its clock instead: no progress for
  // STALL_DEAD_MS while unparked and playing means dead, and the wall heals it. This
  // runs whatever the surface type is - it also catches a frozen TextureView tile.
  useEffect(() => {
    if (parked) return;
    let last = -1;
    let lastMovedAt = Date.now();
    const iv = setInterval(() => {
      if (!api.succeeded() || AppState.currentState !== 'active') return;
      let t = -1;
      let playing = false;
      try {
        t = player.currentTime;
        playing = player.playing;
      } catch {
        return;
      }
      if (!playing) {
        lastMovedAt = Date.now();
        return;
      }
      if (t !== last) {
        last = t;
        lastMovedAt = Date.now();
        return;
      }
      if (Date.now() - lastMovedAt > STALL_DEAD_MS) {
        lastMovedAt = Date.now();
        api.needsHeal();
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [parked, player, api]);

  // Mid-stream (web checkTileSignal from the watchdog): only while on screen, the app is
  // in the foreground and the clip is playing. At most one capture per ~15s per tile;
  // bars = dead now, a slate must repeat 3 checks. Dead -> refuse + heal.
  useEffect(() => {
    if (parked) return;
    const check = createSignalChecker();
    let busy = false;
    let dead = false;
    const t = setInterval(async () => {
      if (busy || dead || !api.succeeded() || AppState.currentState !== 'active') return;
      try {
        if (!player.playing) return;
      } catch {
        return;
      }
      busy = true;
      try {
        const px = await sampleFramePaced(shotRef.current);
        if (px && check(px, Date.now())) {
          dead = true;
          markBadStream(source);
          api.needsHeal();
        }
      } finally {
        busy = false;
      }
    }, SIGNAL_CHECK_MS);
    return () => clearInterval(t);
  }, [parked, player, api, source]);

  useEffect(() => {
    if (!api.succeeded()) return;
    try {
      if (parked) player.pause();
      else {
        player.muted = !audio.isAudible(tileId);
        player.play();
      }
    } catch {}
  }, [parked, player, api, audio, tileId]);

  return (
    // The capture target for sampleFrame: the video alone, never the loader or labels.
    <View ref={shotRef} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
        // textureView: respects the tile's rounded clip and overlay z-order while
        // scrolling (a SurfaceView punches through labels/loader on Android), and it is
        // the only surface react-native-view-shot can read pixels from (colour-bar check).
        surfaceType={surface === 'surface' ? 'surfaceView' : 'textureView'}
        useExoShutter={false}
        pointerEvents="none"
      />
    </View>
  );
}

// ─── YouTube → isolated IFrame-API WebView, veiled ───────────────────────────
function YouTubePlayer({ tileId, source, parked, api }: PlayerProps & { parked: boolean }) {
  const audio = useAudioOwner();
  const wv = useRef<WebView>(null);
  const [src] = useState(() => youtubeEmbedSrc(source, liveVidFor(source)));
  // The veil shows the stream's thumbnail (the wall's poster) instead of a dark panel.
  const [poster] = useState(() => {
    const vid = liveVidFor(source);
    return vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null;
  });
  const [html] = useState(() => ytPlayerHtml(src));
  const frameO = useRef(new Animated.Value(0)).current; // iframe opacity:0 until revealed
  const holdO = useRef(new Animated.Value(0)).current;
  const [hold, setHold] = useState(false);
  const s = useRef({ state: -1 as number, time: 0, at: 0, dur: 0, alive: false, veilT: null as any, nudge: null as any }).current;

  const post = useCallback((f: string, a: unknown[] = []) => wv.current?.injectJavaScript(ytCmd(f, a)), []);
  // Off-screen (> PARK_SCREENS away) a YouTube tile keeps its WebView but stops its
  // decoder; scrolling it back within one screen resumes it. Tiles IN VIEW always play.
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  useEffect(() => {
    if (!s.alive) return;
    if (parked) {
      clearInterval(s.nudge);
      post('pauseVideo');
    } else {
      veil();
      post('playVideo');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parked]);

  // ytVeil(): frame to opacity 0 under the sparkle hold, fade back in after YouTube's
  // chrome has timed out (3.2s). Called on first reveal, on ANY command after that,
  // and on buffering (3) / pause (2).
  const veil = useCallback(
    (ms = YT_VEIL_MS) => {
      clearTimeout(s.veilT);
      frameO.stopAnimation();
      holdO.stopAnimation();
      frameO.setValue(0);
      holdO.setValue(1);
      setHold(true);
      s.veilT = setTimeout(() => {
        post('unloadModule', ['captions']);
        post('unloadModule', ['cc']);
        Animated.parallel([
          Animated.timing(frameO, { toValue: 1, duration: 450, easing: EASE, useNativeDriver: true }),
          Animated.timing(holdO, { toValue: 0, duration: 450, easing: EASE, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setHold(false);
        });
      }, ms);
    },
    [frameO, holdO, post, s],
  );

  const listen = useCallback(() => {
    if (parkedRef.current) return; // off-screen: never start a decoder
    if (s.alive) veil(); // after first reveal, any command must be veiled
    post('playVideo');
    // sound lives in the shadow player; the visible one only unmutes in fallback
    post(audio.isAudible(tileId) && audio.isFallback(tileId) ? 'unMute' : 'mute');
  }, [audio, post, s, tileId, veil]);
  const listenRef = useRef(listen);
  listenRef.current = listen;

  const markAlive = useCallback(() => {
    if (s.alive) return;
    clearInterval(s.nudge);
    s.alive = true;
    veil(); // first reveal happens behind the veil
    api.finish(true);
  }, [api, s, veil]);

  useEffect(() => {
    // Bootstrap nudge — cleared on first PLAYING.
    s.nudge = setInterval(() => listenRef.current(), YT_NUDGE_MS);
    api.register({
      nudge: (force) => {
        // Nudged ONLY when the last reported state is not PLAYING — every command makes
        // the player flash its chrome. force = resume-from-background (liveNudgePlay).
        if (parkedRef.current) return; // parked tiles stay paused until they come back
        if (!force && s.state === 1) return;
        veil();
        post(audio.isAudible(tileId) && audio.isFallback(tileId) ? 'unMute' : 'mute');
        post('playVideo');
      },
      isPlaying: () => s.state === 1,
      target: {
        id: tileId,
        setMuted: () => {}, // never commanded for sound — see AudioOwner shadow
        yt: {
          embedSrc: src,
          time: () => s.time + (s.at ? (Date.now() - s.at) / 1000 : 0),
          duration: () => s.dur,
          setFallback: (on) => {
            veil();
            post(on ? 'unMute' : 'mute');
            if (on) post('setVolume', [100]);
          },
        },
      },
    });
    return () => {
      clearInterval(s.nudge);
      clearTimeout(s.veilT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parseYtMsg(e.nativeEvent.data);
      if (!m) return;
      if (m.e === 'error') {
        // Removed / embed-disabled is permanent: refuse it for the session.
        if (YT_DEAD_CODES.has(Number(m.c))) markBadStream(source);
        if (!s.alive) api.finish(false);
        return;
      }
      if (m.e === 'ready') {
        listenRef.current();
        return;
      }
      if (typeof m.s === 'number') s.state = m.s;
      if (typeof m.t === 'number') {
        s.time = m.t;
        s.at = Date.now();
      }
      if (typeof m.d === 'number') s.dur = m.d;
      // Mid-watch buffering / self-pause paints YouTube's spinner or pause glyph: veil it.
      if (s.alive && (s.state === 3 || s.state === 2)) veil();
      const st = typeof m.s === 'number' ? m.s : null;
      if (st === 3) return; // buffering — hold the overlay
      if (st === 2 && s.alive) {
        listenRef.current();
        return;
      } // never leave the big YT glyph on a tile
      if ((st === 0 || st === 5) && s.alive) {
        listenRef.current();
        api.needsHeal();
        return;
      }
      if (st === 1) {
        markAlive();
        return;
      }
      if (m.e === 'info' && typeof m.t === 'number' && m.t > 0 && m.s !== 2) markAlive();
    },
    [api, markAlive, s, source, veil],
  );

  return (
    <>
      {/* No renderToHardwareTextureAndroid: the WebView is already a hardware layer, and a
          cached layer over content that changes every frame is re-rendered offscreen
          every frame. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: frameO, zIndex: 1 }]} pointerEvents="none">
        <WebView
          ref={wv}
          {...PLAYER_WEBVIEW_PROPS}
          source={{ html, baseUrl: YT_BASE_URL }}
          onMessage={onMessage}
          onLoadEnd={() => listenRef.current()} // never soft-succeed on load
          style={styles.web}
        />
      </Animated.View>
      {hold ? (
        // .yt-hold{inset:0;z-index:3;background:rgba(3,1,10,.97)} + label-less sparkle
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 3, opacity: holdO }]}>
          {poster ? <ExpoImage source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} /> : null}
          <TileLoader visible label="" animate={!parked} over={!!poster} />
        </Animated.View>
      ) : null}
    </>
  );
}

// ─── mjpeg → Image refresh ───────────────────────────────────────────────────
// RN Image cannot decode multipart MJPEG, so the camera URL is re-requested as a
// snapshot. The next frame loads invisibly and swaps in on load: no blank flashes.
const MJPEG_REFRESH_MS = 1000;
function MjpegPlayer({ tileId, source, parked, api }: PlayerProps & { parked: boolean }) {
  const url = source.url || '';
  const bust = (u: string) => u + (u.includes('?') ? '&' : '?') + '_vt=' + Date.now();
  const [next, setNext] = useState(url);
  const [shown, setShown] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Parked (off screen / wall hidden): stop refreshing. It re-downloaded and decoded a
  // full JPEG every second on every tab. The last frame stays up; it resumes on return.
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  const stalled = useRef(false);
  const schedule = useCallback(
    (ms: number) => {
      if (t.current) clearTimeout(t.current);
      if (parkedRef.current) {
        stalled.current = true;
        return;
      }
      t.current = setTimeout(() => setNext(bust(url)), ms);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url],
  );
  useEffect(() => {
    if (!parked && stalled.current) {
      stalled.current = false;
      schedule(0);
    }
  }, [parked, schedule]);
  useEffect(() => {
    api.register({ nudge: () => {}, isPlaying: () => true, target: { id: tileId, setMuted: () => {} } });
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [api, tileId]);
  return (
    <>
      {shown ? <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} /> : null}
      <Image
        key={next}
        source={{ uri: next, cache: 'reload' }}
        style={[StyleSheet.absoluteFill, { opacity: 0 }]}
        fadeDuration={0}
        onLoad={() => {
          setShown(next);
          if (!api.isDone()) api.finish(true);
          schedule(MJPEG_REFRESH_MS);
        }}
        onError={() => {
          if (!api.isDone()) api.finish(false);
          else schedule(MJPEG_REFRESH_MS * 3);
        }}
      />
    </>
  );
}

// ─── iframe cam → WebView (caller already enforced EMBEDDABLE_IFRAME && IFRAME_PLAYER_URL) ─
function IframePlayer({ tileId, source, api }: PlayerProps) {
  useEffect(() => {
    api.register({ nudge: () => {}, isPlaying: () => api.succeeded(), target: { id: tileId, setMuted: () => {} } });
  }, [api, tileId]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <WebView
        {...PLAYER_WEBVIEW_PROPS}
        source={{ uri: source.url || 'about:blank' }}
        onLoadEnd={(e) => {
          if (!e.nativeEvent.loading) api.finish(true);
        }}
        onError={() => api.finish(false)}
        onHttpError={() => api.finish(false)}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#000' },
});
