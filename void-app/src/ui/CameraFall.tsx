// PULL TO REFRESH: THE character drips out of the phone's camera with his sparkles, swelling at the cut-out like a
// drop, letting go and dropping to his spot, and stays there falling in place (the user's saved falling set from
// the Void Loading Lab). When the feed is done he is drawn back up into the camera. Pull to refresh only.
// Owner, 2026-10-20: only him and his sparkles, no blob, no band.
//
// Built on EZER's camera dove (CH6RIZARD/ezer, claude/one-dove: apps/mobile/components/CameraDove.tsx): the same
// store and wait.
//   - shows only if the refresh outlasts WAIT_MS; once out it always completes its entrance and exit;
//   - reduced motion: he fades in and out in place; backgrounded: gone at once.
// Sheets: scripts/fall (render.mjs bakes one seamless lap of each saved set, sparkles included).
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StatusBar, View, useWindowDimensions } from 'react-native';
import Animated, { makeMutable, useAnimatedStyle, useFrameCallback, useReducedMotion } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAMERA_FALLS, type CameraFallId } from './cameraFallFrames';

const WAIT_MS = 300;
const FPS = 30;
const IDS = Object.keys(CAMERA_FALLS) as CameraFallId[];
const GROW = 1.08; // owner, 2026-10-20: "make him 8 percent bigger"
const SCALE = 0.75 * GROW; // his cell is drawn at this fraction of its dp size
// Entrance (frames): he swells at the cut-out like a forming drop (FORM), lets go and drops to his spot (DROP),
// landing with a squash. Exit: drawn back up into the cut-out, stretching and shrinking (OUT).
const FORM = 10, DROP = 14, OUT_N = 12;
const IN = FORM + DROP;
const RM_FADE = 8; // reduced motion
const SPOT = 46; // dp below the camera point: his place, clear of the Dynamic Island

// ── store: one run at a time, shared with the UI thread ────────────────────
let active = false;
let foreground = AppState.currentState === 'active';
let timer: ReturnType<typeof setTimeout> | null = null;
let run: { id: CameraFallId; serial: number } | null = null;
let serial = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const want = makeMutable(false);
const phase = makeMutable(3); // 0 in, 1 loop, 2 out, 3 done
const t = makeMutable(0); // frames into the current phase
const clock = makeMutable(0); // frames since he appeared: his falling loop never restarts mid-run

function start() {
  t.value = 0;
  clock.value = 0;
  phase.value = 0;
  run = { id: IDS[0], serial: ++serial };
  emit();
}
function update() {
  const on = active && foreground;
  want.value = on;
  if (!foreground) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (run) { run = null; phase.value = 3; emit(); }
    return;
  }
  if (run) return; // the UI thread reads `want`: stays, or leaves
  if (on && !timer) timer = setTimeout(() => { timer = null; if (active && foreground && !run) start(); }, WAIT_MS);
  else if (!on && timer) { clearTimeout(timer); timer = null; }
}
function done(s: number) {
  if (!run || run.serial !== s) return;
  run = null;
  emit();
  update(); // still refreshing: out again after WAIT_MS
}
AppState.addEventListener('change', (s) => { foreground = s === 'active'; update(); });

/** True while he is out of the camera: the header word hides meanwhile (owner: just the text, or just him). */
export function useCameraFallOut(): boolean {
  return useSyncExternalStore(subscribe, () => run !== null);
}

/** Mount once over the feed (absolute, pointer-events none). `active` = the feed is refreshing. */
export function CameraFall({ active: on }: { active: boolean }) {
  useEffect(() => { active = on; update(); }, [on]);
  useEffect(() => () => { active = false; update(); }, []);
  const cur = useSyncExternalStore(subscribe, () => run);
  return cur ? <Sprite key={cur.serial} id={cur.id} serial={cur.serial} /> : null;
}

const sm = (v: number) => { 'worklet'; const x = Math.min(1, Math.max(0, v)); return x * x * (3 - 2 * x); };
const backOut = (v: number) => { 'worklet'; const x = Math.min(1, Math.max(0, v)) - 1; return 1 + x * x * (2.4 * x + 1.4); };

function Sprite({ id, serial: s }: { id: CameraFallId; serial: number }) {
  const P = CAMERA_FALLS[id];
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const [offY, setOffY] = useState(0);
  const box = React.useRef<View>(null);

  // Camera point: top-centre, half the status bar down. Cut-out bottom: Dynamic Island, notch, or punch hole.
  const bar = Platform.OS === 'android' ? StatusBar.currentHeight ?? insets.top : insets.top;
  const camX = W / 2;
  const camY = bar / 2 - offY;
  const y0 = (Platform.OS === 'ios' ? (insets.top >= 51 ? insets.top - 11 : insets.top * 0.66) : bar / 2 + 4.5) - offY;
  const C = P.cell, cols = P.cols, nl = P.nl;
  const spotY = Math.max(y0 + 4 + (C * SCALE) / 2, camY + SPOT * (W / 390)); // his place, never over the cut-out
  const NIn = reduced ? RM_FADE : IN, NOut = reduced ? RM_FADE : OUT_N;

  useFrameCallback((info) => {
    'worklet';
    if (phase.value === 3) return;
    const dt = (Math.min(info.timeSincePreviousFrame ?? 16.7, 100) * FPS) / 1000;
    let x = t.value + dt;
    clock.value += dt;
    if (phase.value === 0 && x >= NIn) { phase.value = 1; x -= NIn; }
    if (phase.value === 1 && !want.value) { phase.value = 2; x = 0; }
    if (phase.value === 2 && x >= NOut) { phase.value = 3; x = NOut - 0.001; scheduleOnRN(done, s); }
    t.value = x;
  });

  // Him (sparkles baked in): where he is, his size, his drop stretch (sy / sx) and fade.
  const winStyle = useAnimatedStyle(() => {
    const ph = phase.value, v = t.value;
    let x = camX, y = spotY, g = 1, sy = 1, a = 1;
    if (reduced) a = ph === 0 ? v / RM_FADE : ph === 2 ? 1 - v / RM_FADE : ph === 3 ? 0 : 1;
    else if (ph === 0 && v < FORM) {
      // the drop forming: hanging off the cut-out, swelling and lengthening
      const u = sm(v / FORM);
      g = 0.12 + 0.43 * u; sy = 1 + 0.3 * u; a = sm(v / 3);
      y = y0 + (C * SCALE * g * sy) * 0.32;
    } else if (ph === 0) {
      // let go: drops to his spot, stretched while moving, a squash as he lands, settles
      const w = (v - FORM) / DROP;
      const from = y0 + C * SCALE * 0.55 * 1.3 * 0.32;
      y = from + (spotY - from) * backOut(w);
      g = 0.55 + 0.45 * sm(w / 0.6);
      const land = sm((w - 0.45) / 0.2) * (1 - sm((w - 0.65) / 0.35));
      sy = 1 + 0.3 * (1 - sm(w / 0.5)) - 0.14 * land;
    } else if (ph === 2) {
      // drawn back up: accelerating, lengthening, shrinking into the cut-out
      const w = v / OUT_N, e = w * w * w;
      y = spotY + (y0 - spotY) * e;
      g = 1 - 0.88 * sm(w); sy = 1 + 0.35 * sm(w / 0.6); a = 1 - sm((w - 0.75) / 0.25);
    } else if (ph === 3) a = 0;
    return {
      opacity: a,
      transform: [{ translateX: x - C / 2 }, { translateY: y - C / 2 }, { scaleX: SCALE * g / Math.sqrt(sy) }, { scaleY: SCALE * g * sy }],
    };
  });
  const slide = useAnimatedStyle(() => {
    const c = Math.floor(clock.value) % nl;
    return { transform: [{ translateX: -(c % cols) * C }, { translateY: -Math.floor(c / cols) * C }] };
  });

  const H = Math.ceil(spotY + C);
  return (
    <View ref={box} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, zIndex: 80 }}
      onLayout={() => box.current?.measureInWindow((_x, y) => setOffY(y))}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: C, height: C, overflow: 'hidden' }, winStyle]}>
        <Animated.Image source={P.sheet} resizeMode="stretch" style={[{ width: C * cols, height: C * P.rows }, slide]} />
      </Animated.View>
    </View>
  );
}
