// STREAM TILE — native port of attemptSource(cell, source) for ONE source.
//
// Contract (mirrors the web Promise):
//   • mounts the player for `source` muted + autoplaying under the loader
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
import { VideoView, type VideoPlayer } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { isReleasedPlayer, usePacedPlayer } from './pacedPlayer';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { AudioRing, TileLoader } from './TileChrome';
import { useAudioOwner, type AudioTarget } from './AudioOwner';
import { liveVidFor, markBadStream, type StreamSource } from './core';
import { createSignalChecker, frameVerdict, FRAME_H, FRAME_JUDGE_DELAY, FRAME_W } from '../../core';
import { sampleFrame, sampleFramePaced } from './frameSample';
import { variantCached, variantFor } from './hlsVariant';
import { CONNECT_TIMEOUT, WALL_BUFFER, YT_DEAD_CODES, YT_NUDGE_MS, YT_VEIL_MIN_MS, YT_VEIL_MS, noteDecoderFailure, youtubeEmbedSrc } from './constants';
import { PLAYER_WEBVIEW_PROPS, YT_BASE_URL, parseYtMsg, ytCmd, ytPlayerHtml } from './ytHtml';

export interface StreamTileHandle {
  /** Watchdog / resume nudge. force=true is liveNudgePlay (always), false = only when not PLAYING. */
  nudge(force?: boolean): void;
  /**
   * Stop playing, now, without going through the `parked` prop.
   *
   * The only way to pause a tile used to be a prop change, which means a React
   * commit - and when the whole wall leaves the screen that is a commit touching
   * every mounted tile at once. There was no imperative counterpart: `nudge`
   * only ever plays, so a caller reaching for "stop everything" and finding
   * nudge(false) would start the paused ones instead. This is the missing half.
   */
  stop(): void;
  /** Tap-for-sound; no-op until PLAYING. Returns true if the tap was consumed. */
  tap(): boolean;
  isPlaying(): boolean;
}

export interface StreamTileProps {
  tileId: string;
  source: StreamSource;
  /** Loader label. Empty by default: the loader moves, which is the message. */
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

// ─── HOW LONG A TILE TAKES TO SHOW A PICTURE, AND HOW OFTEN IT NEVER DOES ────
//
// The wall sits at three or four tiles of six with a picture, and until now
// nothing said why. There are no JS stalls in a fifty-second window, so it is not
// a blocked thread; a tile either takes a long time to connect or quietly gives
// up at the CONNECT_TIMEOUT below, and both look identical from outside - a
// sparkle panel.
//
// Per-tile logging would be useless here: a first fill settles a dozen tiles
// within a second or two of each other and the interesting thing is the shape of
// the set, not any one of them. So this keeps counters and prints one line per
// batch, shortly after the wall stops settling tiles. Four numbers, no
// allocation per tile, nothing retained.
let fillOk = 0;
let fillFail = 0;
const fillMs: number[] = [];
let fillFirstAt = 0;
let fillTimer: ReturnType<typeof setTimeout> | null = null;
function noteSettle(success: boolean, ms: number, kind: string): void {
  if (success) {
    fillOk++;
    fillMs.push(ms);
  } else {
    fillFail++;
  }
  if (!fillFirstAt) fillFirstAt = Date.now();
  if (fillTimer) clearTimeout(fillTimer);
  // Report once the batch has gone quiet - but no later than ten seconds after
  // its first settle. A wall that never stops settling (tiles timing out and
  // healing in a loop) is exactly the one this line exists to describe, and a
  // quiet-only timer never fired for it.
  const wait = Math.max(300, Math.min(2500, fillFirstAt + 10000 - Date.now()));
  fillTimer = setTimeout(() => {
    fillTimer = null;
    const n = fillOk + fillFail;
    if (!n) return;
    const sorted = fillMs.slice().sort((a, b) => a - b);
    const med = sorted.length ? sorted[sorted.length >> 1] : -1;
    const worst = sorted.length ? sorted[sorted.length - 1] : -1;
    try {
      console.warn(
        '[fill] ' + fillOk + '/' + n + ' tiles got a picture · median ' + med + 'ms · worst ' + worst + 'ms · ' + fillFail + ' gave up · last ' + kind,
      );
    } catch {
      /* */
    }
    fillOk = 0;
    fillFail = 0;
    fillMs.length = 0;
    fillFirstAt = 0;
  }, wait);
}

interface PlayerApi {
  finish(ok: boolean): void;
  isDone(): boolean;
  succeeded(): boolean;
  needsHeal(): void;
  register(h: { nudge(force?: boolean): void; stop(): void; isPlaying(): boolean; target: AudioTarget }): void;
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
  const { tileId, source, loaderLabel = '', parked = false, radius = 6, showLoader = true, tileWidth, surface: surfaceType = 'texture' } = props;
  const audio = useAudioOwner();
  const [playing, setPlaying] = useState(false);
  const done = useRef(false);
  const ok = useRef(false);
  const mounted = useRef(true);
  const handles = useRef<{ nudge(force?: boolean): void; stop(): void; isPlaying(): boolean; target: AudioTarget } | null>(null);
  const cb = useRef(props);
  cb.current = props;

  const finish = useCallback((success: boolean) => {
    if (done.current) return;
    done.current = true;
    // Succeeding into an unmounted tile is a failure (web: !cell.isConnected).
    if (success && !mounted.current) success = false;
    ok.current = success;
    if (success) setPlaying(true);
    noteSettle(success, Date.now() - startedAt.current, source.type);
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

  const startedAt = useRef(Date.now());
  useEffect(() => {
    mounted.current = true;
    startedAt.current = Date.now();
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
      stop: () => {
        handles.current?.stop();
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
/**
 * Drop this player's audio track while it is silent, restore it when it is not.
 *
 * expo-video exposes audioTrack as a settable, nullable property; null is no audio
 * decoder at all, where muted is a decoder producing samples nobody hears.
 * Wrapped in its own try/catch per call: a player mid-teardown, or a source with
 * no audio track to begin with, must not take the tile down with it.
 */
function detachAudio(player: VideoPlayer, silent: boolean): void {
  try {
    const p = player as unknown as { audioTrack: unknown; availableAudioTracks?: unknown[] };
    if (silent) {
      p.audioTrack = null;
      return;
    }
    if (p.audioTrack == null) {
      const first = p.availableAudioTracks?.[0];
      if (first) p.audioTrack = first;
    }
  } catch {
    /* not every source has one, and not every build of expo-video exposes it */
  }
}

function HlsPlayer({ tileId, source, parked, api, tileWidth, surface = 'texture' }: PlayerProps & { parked: boolean; tileWidth?: number; surface?: 'texture' | 'surface' }) {
  const audio = useAudioOwner();
  const raw = source.url || '';
  // Play the smallest variant that covers this tile (see hlsVariant.ts). Already
  // resolved streams start on it; the rest connect on the master playlist as before
  // and switch once it is read, which is also what a failed read leaves in place.
  // CAP THE SCALE AT 2x, NOT THE SCREEN'S FULL DENSITY.
  //
  // getPixelSizeForLayoutSize uses the real density, so on a 3x phone a 170dp
  // tile asked for ~510px and the picker handed it a 720p variant. Six of those
  // decoding at once is what costs the frame rate - the decoders are the
  // expense, and most of every frame was being thrown away scaling down into a
  // tile a sixth of its area.
  //
  // Two device pixels per layout pixel is already more than a tile this size can
  // show. On a 3x screen that asks for ~340px and gets a 480p variant instead:
  // less than half the pixels to decode per tile, per frame, with the softness
  // landing on a picture that is 170dp wide.
  const targetW = Math.round((tileWidth || 180) * Math.min(2, PixelRatio.get()));
  // ONE PLAYER PER TILE, NOT TWO.
  //
  // This started the player on the master playlist and then called setUrl once
  // the right variant was known. usePacedPlayer memoises on the source, so that
  // second url DESTROYED the running player and built another - a second or so
  // after the first had started playing. On a first fill of twelve to twenty-four
  // tiles that is twelve to twenty-four extra creates and as many paced releases,
  // which is precisely the churn pacedPlayer exists to survive rather than to be
  // handed.
  //
  // So the variant is resolved FIRST and the player is created once, on the url
  // it will keep. The tile shows its panel in the meantime, which costs nothing
  // now that a panel is a gradient rather than a black hole. A cached variant -
  // the common case after the first tile of a stream - resolves synchronously and
  // nothing waits at all.
  //
  // If the master playlist cannot be read, variantFor returns the raw url, so a
  // stream never fails to play because of this.
  const [url, setUrl] = useState<string | null>(() => variantCached(raw, targetW) || null);
  useEffect(() => {
    let alive = true;
    const cached = variantCached(raw, targetW);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    variantFor(raw, targetW).then((u) => {
      if (alive) setUrl(u || raw);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, targetW]);
  const player = usePacedPlayer(url ? ({ uri: url, contentType: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'auto' } as any) : null, (p) => {
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
    // Not built yet (paced creation) - nothing to listen to or register.
    if (!player) return;
    let judgeT: ReturnType<typeof setTimeout> | null = null;
    const resume = () => {
      if (isReleasedPlayer(player)) return;   // a released player aborts the process
      try {
        player.muted = !audio.isAudible(tileId);
        if (!player.playing) player.play();
      } catch {}
    };
    const onPlaying = (isPlaying: boolean) => {
      if (isPlaying && !api.isDone() && !judgeT) {
        // web: judge one decoded frame 700ms after `playing`. PLAYING is not proof of a
        // picture: an off-air channel serves SMPTE bars. Bars fail the attempt (and are
        // refused for the session) so the cascade moves on; unknown counts as fine.
        // THE LOADER STAYS UNTIL THERE IS A PICTURE.
        //
        // I had this settle the instant `playing` fired, to save the wait. That
        // was wrong: `playing` means the player has STARTED, not that a frame has
        // reached the screen. Settling there hid the sparkle and left a BLACK
        // SQUARE with a label on it - worse than the wait it saved, because a
        // black tile looks broken and a moving loader looks like loading.
        //
        // So the settle waits for the frame check again. That check was 700ms,
        // which was most of why tiles felt slow; it only has to be long enough
        // for a frame to exist, and it is 320ms now (FRAME_JUDGE_DELAY).
        judgeT = setTimeout(async () => {
          if (api.isDone()) return;
          let bars = false;
          // THE SAME GUARD THE MID-STREAM CHECK ALREADY HAS.
          //
          // A hundred lines below, the periodic checker says it plainly:
          // "SurfaceView hands nothing back to captureRef, so this check can only
          // ever say 'unknown' there - all cost, no verdict." That guard was added
          // there and never here, and the wall mounts every tile as a SurfaceView.
          //
          // So on EVERY wall tile this ran a captureRef on the Android main
          // thread, base64'd the result and PNG-decoded it in JS, to answer a
          // question that is structurally unanswerable - and api.finish() waited
          // behind the await. finish() is what releases the cascade LANE, and
          // there are only four. Four tiles' worth of connect capacity was being
          // spent on a measurement that always returned nothing.
          if (surface !== 'surface' && AppState.currentState === 'active') {
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
    };
    const subPlaying = player.addListener('playingChange', (e: any) => onPlaying(!!(e && (e.isPlaying ?? e))));
    const onError = (e: any) => {
      if (e && e.status === 'error') {
        // Codec failures are how this device says "no more decoders". Tell the budget
        // before healing, so the wall asks for one fewer from here on.
        try {
          const msg = String((e && (e.error?.message || e.message)) || '');
          if (/codec|decoder|MediaCodec/i.test(msg) || !msg) noteDecoderFailure();
        } catch {}
        if (!api.isDone()) api.finish(false);
        else api.needsHeal();
      }
    };
    const subStatus = player.addListener('statusChange', onError);
    // THE EVENT MAY HAVE FIRED BEFORE ANYONE WAS LISTENING.
    //
    // Player creation is paced now: the queue builds the player and setup calls
    // play() in the same tick, and this effect - which attaches the listeners -
    // only runs after React has re-rendered with the new player. A stream that
    // starts quickly fires playingChange in that gap, nobody hears it, the tile
    // never judges a frame, and at CONNECT_TIMEOUT it gives up on a picture that
    // has been playing the whole time - then heals, remounts, and does it again.
    // That churn is also why the [fill] line never went quiet long enough to
    // print. With creation in render the gap was a few microseconds and the race
    // was hidden; ReelVideo has guarded it all along ("the source may already be
    // ready before the listeners attached"). So: read the state the player is
    // already in. Both reads are cached fields, not blocking getters.
    try {
      if (player.playing) onPlaying(true);
      else if (player.status === 'error') onError({ status: 'error' });
    } catch {}
    api.register({
      nudge: () => {
        if (parkedRef.current) return;
        resume();
      },
      // What the parked branch does, without the prop change: see the effect above.
      stop: () => {
        if (isReleasedPlayer(player)) return;
        try {
          player.pause();
        } catch {}
      },
      isPlaying: () => {
        if (isReleasedPlayer(player)) return false;
        try {
          return player.playing;
        } catch {
          return false;
        }
      },
      target: {
        id: tileId,
        setMuted: (m) => {
          // The audio owner can still hold this tile's handle after it unmounts.
          if (isReleasedPlayer(player)) return;
          try {
            player.muted = m;
            // MUTED IS NOT THE SAME AS NOT DECODING.
            // A muted player still decodes its audio track: on a wall of a dozen
            // tiles that is a dozen audio decoders competing for the same hardware,
            // and every underrun posts an AudioRendererEventListener callback to the
            // main looper. Measured on device during an ANR: the main thread
            // saturated by onAudioUnderrun with 52 input events queued behind it,
            // media.swcodec at 74% because the hardware decoders were exhausted and
            // playback had fallen back to software.
            //
            // Only one tile is ever audible, so the rest need no audio track at all.
            // Dropping it frees the decoder instead of silencing it, and the track is
            // put back the moment this tile is the one being listened to.
            detachAudio(player, m);
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
  // THE CLOCK IS READ FROM AN EVENT, NOT POLLED.
  //
  // This polled player.currentTime every three seconds. That getter is one of
  // the few in expo-video that BLOCKS: VideoModule.kt wraps it in
  // runBlocking(mainQueue) - its own comment says "we shouldn't block the
  // thread" - so each read parks the JS thread until the main thread gets
  // round to answering, and the main thread is the one busy with layout,
  // surfaces and paced releases. Ten tiles is ten of those waits every three
  // seconds, on a timer, for as long as the wall is up.
  //
  // The timeUpdate event carries the same currentTime, is emitted from the
  // player's own clock at timeUpdateEventInterval, and costs the JS thread
  // nothing to receive. Same STALL_DEAD_MS rule, same verdict, no wait.
  useEffect(() => {
    if (parked || !player) return;
    let last = -1;
    let lastMovedAt = Date.now();
    try {
      if (isReleasedPlayer(player)) return;
      player.timeUpdateEventInterval = 3;
    } catch {
      return;
    }
    const sub = player.addListener('timeUpdate', (e: any) => {
      if (!api.succeeded() || AppState.currentState !== 'active') return;
      let playing = false;
      try {
        if (isReleasedPlayer(player)) return;
        playing = player.playing;
      } catch {
        return;
      }
      const t = e && typeof e.currentTime === 'number' ? e.currentTime : -1;
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
    });
    return () => {
      sub.remove();
      try {
        if (!isReleasedPlayer(player)) player.timeUpdateEventInterval = 0;
      } catch {}
    };
  }, [parked, player, api]);

  // Mid-stream (web checkTileSignal from the watchdog): only while on screen, the app is
  // in the foreground and the clip is playing. At most one capture per ~15s per tile;
  // bars = dead now, a slate must repeat 3 checks. Dead -> refuse + heal.
  useEffect(() => {
    if (parked || !player) return;
    // SurfaceView hands nothing back to captureRef, so this check can only ever say
    // "unknown" there - all cost, no verdict. The clock check above catches a dead
    // picture on any surface type, so only a TextureView still samples pixels.
    if (surface === 'surface') return;
    const check = createSignalChecker();
    let busy = false;
    let dead = false;
    const t = setInterval(async () => {
      if (busy || dead || !api.succeeded() || AppState.currentState !== 'active') return;
      try {
        if (isReleasedPlayer(player) || !player.playing) return;
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
    if (!api.succeeded() || !player) return;
    try {
      if (isReleasedPlayer(player)) return;
      if (parked) player.pause();
      else {
        const silent = !audio.isAudible(tileId);
        player.muted = silent;
        detachAudio(player, silent);
        player.play();
      }
    } catch {}
  }, [parked, player, api, audio, tileId]);

  return (
    // The capture target for sampleFrame: the video alone, never the loader or labels.
    <View ref={shotRef} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* No surface until there is a player to draw into it. The panel above
          covers the tile meanwhile, exactly as it does while the variant resolves. */}
      {player ? (
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
      ) : null}
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
  const s = useRef({ state: -1 as number, time: 0, at: 0, dur: 0, alive: false, veilT: null as any, veilDueAt: 0, nudge: null as any }).current;

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
  const veilRef = useRef<(ms?: number) => void>(() => {});
  // Shorten a veil that is still counting down to the ceiling. Only ever
  // shortens: a tile already about to be revealed is left alone, so a burst of
  // state messages cannot keep pushing the reveal away.
  const revealSoon = useCallback(() => {
    if (!s.veilT) return;
    if (s.veilDueAt && s.veilDueAt - Date.now() <= YT_VEIL_MIN_MS) return;
    veilRef.current(YT_VEIL_MIN_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const veil = useCallback(
    (ms = YT_VEIL_MS) => {
      clearTimeout(s.veilT);
      frameO.stopAnimation();
      holdO.stopAnimation();
      frameO.setValue(0);
      holdO.setValue(1);
      setHold(true);
      s.veilDueAt = Date.now() + ms;
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
      // Exactly what parking a YouTube tile does, without the prop change. The
      // bootstrap interval has to go too, or it nudges the tile straight back.
      stop: () => {
        clearInterval(s.nudge);
        post('pauseVideo');
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

  veilRef.current = veil;

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
        // Playing: stop waiting out the ceiling. Re-arm the veil for a short
        // grace instead, which is all the chrome needs to clear.
        revealSoon();
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
    api.register({ nudge: () => {}, stop: () => {}, isPlaying: () => true, target: { id: tileId, setMuted: () => {} } });
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
    api.register({ nudge: () => {}, stop: () => {}, isPlaying: () => api.succeeded(), target: { id: tileId, setMuted: () => {} } });
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
