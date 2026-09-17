import { requireNativeModule } from "expo";
import type { EventSubscription } from "expo-modules-core";

/** Kept for callers that imported the old SDK 51 name. */
export type Subscription = EventSubscription;
import { PermissionsAndroid, Platform } from "react-native";

type Permission = Parameters<typeof PermissionsAndroid.requestMultiple>[0][number];

/**
 * expo-void-sensing — the ONLY bridge between the native on-device sensing/affect
 * pipeline and JS. Raw physiological data (IMU, camera frames, green-channel series,
 * RR intervals) NEVER crosses this boundary. The native side emits the quantized,
 * DP-noised AffectState, plus the user-requested calm-reading result and BLE device
 * discovery/status. There is no method that returns a raw buffer.
 */

/** Quantized, personal-baseline z-scores. Mirrors schemas/affect.proto AffectState. */
export interface AffectState {
  /** int8 z-scores in [-128,127] mapping to [-4σ,+4σ] (divide by ~32 for σ). */
  valenceZ: number;
  arousalZ: number;
  attentionZ: number;
  /** 0..100 reliability (already scaled by baseline warm-up). */
  confidence: number;
  /** bitfield: 1=PPG (camera: fingertip or face rPPG) 2=FACE 4=MOTION 8=TOUCH 16=BLE strap/watch */
  sourceMask: number;
  windowEndMs: number;
  /** true in production (local DP noise applied before emit). */
  dpApplied: boolean;
  /** Impression whose lag-aligned window overlaps this estimate, when one does. */
  impressionId?: string;
}

export type SensorTier = "motion" | "touch" | "face" | "ppg" | "ble";
export const ALL_TIERS: SensorTier[] = ["motion", "touch", "face", "ppg", "ble"];

export interface ConsentState {
  /** true when any of face/ppg/ble is on, or motion AND touch are on. */
  affectConsent: boolean;
  perTier: Record<SensorTier, boolean>;
  /** true only after the user explicitly picked "Not now". */
  nonBiometricFeed: boolean;
  /** true once the user has made any choice on the consent screen. */
  hasChosen: boolean;
}

/** Fingertip calm-reading progress/result (event "onCalmReading"). */
export interface CalmReading {
  /** bpm, or null until a valid estimate exists. */
  bpm: number | null;
  /** HRV (ms, SDNN) when the reading was calm enough, else null. */
  hrv: number | null;
  /** 0..1 */
  progress: number;
  done: boolean;
  /** 0..1 signal quality */
  quality: number;
  /** present when the reading could not start or was aborted. */
  error?: string;
}

/** A BLE heart-rate device found by scanHeartRateDevices() (event "onBleDevice"). */
export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number;
}

/** BLE connection/scan status (event "onBleStatus"). */
export interface BleStatus {
  status: "scanning" | "scanDone" | "connecting" | "connected" | "disconnected" | "error";
  id: string | null;
  message: string | null;
}

/** Coarse context (never affect evidence on its own). */
export interface ContextState {
  proximityNear: boolean | null;
  lux: number | null;
  lowLight: boolean;
  headphones: boolean;
  batteryPct: number;
  charging: boolean;
  hourOfDay: number;
  sessionMs: number;
}

/** One touch sample from the WebView (x,y normalized to the viewport). */
export interface TouchSample {
  x: number;
  y: number;
  /** ms, any monotonic clock (performance.now()). */
  t: number;
  phase: "start" | "move" | "end";
  pressure?: number;
}

// The native body may be absent (web, or a build without the module). In that case
// we boot with a no-op stub so the app still reaches the UI and the bridge is testable.
const EMPTY_TIERS: Record<SensorTier, boolean> = {
  motion: false, touch: false, face: false, ppg: false, ble: false,
};
let stubConsent: ConsentState = {
  affectConsent: false,
  nonBiometricFeed: false,
  hasChosen: false,
  perTier: { ...EMPTY_TIERS },
};
const STUB_CONTEXT: ContextState = {
  proximityNear: null, lux: null, lowLight: false, headphones: false,
  batteryPct: -1, charging: false, hourOfDay: new Date().getHours(), sessionMs: 0,
};
const STUB = {
  isAvailable: () => false,
  // The stub remembers the choice for this session so the consent screen can be passed.
  requestConsent: async (tiers: SensorTier[]) => {
    const perTier = { ...EMPTY_TIERS };
    tiers.forEach((t) => { if (t in perTier) perTier[t] = true; });
    stubConsent = { affectConsent: false, nonBiometricFeed: tiers.length === 0, hasChosen: true, perTier };
    return stubConsent;
  },
  revokeConsent: async () => stubConsent,
  chooseNonBiometric: () => {
    stubConsent = { affectConsent: false, nonBiometricFeed: true, hasChosen: true, perTier: { ...EMPTY_TIERS } };
    return stubConsent;
  },
  getConsent: () => stubConsent,
  setKillSwitch: (_on: boolean) => {},
  isKillSwitchEnabled: () => true,
  start: async () => {},
  stop: async () => {},
  getAffectState: () => null,
  markImpression: (_i: string, _t: string) => {},
  recordTouch: (_s: TouchSample[]) => {},
  startCalmReading: () => false,
  stopCalmReading: () => {},
  scanHeartRateDevices: () => false,
  connectHeartRate: (_id: string) => false,
  disconnectHeartRate: () => {},
  setFeedVisible: (_v: boolean) => {},
  getContext: () => STUB_CONTEXT,
  addListener: () => {},
  removeListeners: () => {},
};

const NOOP_SUB: EventSubscription = { remove() {} };

let nativeAvailable = true;
let Native: any;
try {
  Native = requireNativeModule("ExpoVoidSensing");
} catch {
  nativeAvailable = false;
  Native = STUB;
}
// SDK 52+: a native module object IS the event emitter (addListener/removeListeners
// live on it). Wrapping it in `new EventEmitter(Native)` (the SDK 51 pattern) would
// create a detached JS emitter that never receives native events.
function addNativeListener<T>(event: string, listener: (payload: T) => void): EventSubscription {
  if (!nativeAvailable || typeof Native?.addListener !== "function") return NOOP_SUB;
  return Native.addListener(event, listener) as EventSubscription;
}

/** Call a native function if this build's native module has it (iOS may lag). */
/** Like call(), but awaits: iOS exposes some of these as AsyncFunction (Promise), Android as Function. */
async function callAsync<T>(name: keyof typeof STUB, fallback: T, ...args: any[]): Promise<T> {
  const fn = Native?.[name];
  if (typeof fn !== "function") return fallback;
  try {
    return await fn(...args);
  } catch {
    return fallback;
  }
}

function call<T>(name: keyof typeof STUB, fallback: T, ...args: any[]): T {
  const fn = Native?.[name];
  if (typeof fn !== "function") return fallback;
  try {
    return fn(...args);
  } catch {
    return fallback;
  }
}

/** True when the native module is actually linked in this build. */
export function hasNativeSensing(): boolean {
  return nativeAvailable;
}

/** True only where the native pipeline can run (has sensors + OS support). */
export function isAvailable(): boolean {
  return call("isAvailable", false);
}

function normalizeConsent(s: any): ConsentState {
  const perTier = { ...EMPTY_TIERS, ...(s?.perTier ?? {}) } as Record<SensorTier, boolean>;
  return {
    affectConsent: !!s?.affectConsent,
    nonBiometricFeed: !!s?.nonBiometricFeed,
    hasChosen: !!s?.hasChosen,
    perTier,
  };
}

// ── Android runtime permissions ────────────────────────────────────────────
// Native code only CHECKS permissions; the system prompts are shown from here.

async function requestAndroid(perms: string[]): Promise<boolean> {
  if (Platform.OS !== "android" || perms.length === 0) return true;
  try {
    const res = await PermissionsAndroid.requestMultiple(perms as Permission[]);
    return perms.every((p) => res[p as Permission] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

function bluetoothPerms(): string[] {
  // BLUETOOTH_SCAN / CONNECT are runtime permissions only on Android 12 (API 31)+.
  if (Platform.OS !== "android" || Number(Platform.Version) < 31) return [];
  return ["android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"];
}

/** Ask the OS for the permissions the given tiers need. Returns tiers that ended up usable. */
export async function ensurePermissions(tiers: SensorTier[]): Promise<SensorTier[]> {
  if (Platform.OS !== "android") return tiers; // iOS prompts natively on first use.
  const out: SensorTier[] = [];
  const needsCamera = tiers.includes("face") || tiers.includes("ppg");
  const cameraOk = needsCamera ? await requestAndroid([PermissionsAndroid.PERMISSIONS.CAMERA]) : true;
  const bleOk = tiers.includes("ble") ? await requestAndroid(bluetoothPerms()) : true;
  for (const t of tiers) {
    if ((t === "face" || t === "ppg") && !cameraOk) continue;
    if (t === "ble" && !bleOk) continue;
    out.push(t);
  }
  return out;
}

/**
 * Record consent for EXACTLY these tiers (replaces the previous set) and mark the
 * choice as made. Requests the matching OS permissions first; tiers whose permission
 * is denied are not granted. An empty list is the same as chooseNonBiometric().
 */
export async function requestConsent(tiers: SensorTier[]): Promise<ConsentState> {
  const usable = await ensurePermissions(tiers);
  return normalizeConsent(await Native.requestConsent(usable));
}

/** Revoke specific tiers (settings toggles). */
export async function revokeConsent(tiers: SensorTier[]): Promise<ConsentState> {
  const fn = Native?.revokeConsent;
  if (typeof fn !== "function") return getConsent();
  return normalizeConsent(await fn(tiers));
}

/** "Not now": no sensing, non-biometric feed, choice remembered. */
export async function chooseNonBiometric(): Promise<ConsentState> {
  return normalizeConsent(await callAsync("chooseNonBiometric", stubConsent));
}

export function getConsent(): ConsentState {
  return normalizeConsent(call("getConsent", stubConsent));
}

/** Kill switch. `false` stops all capture and emits; persisted natively. */
export function setKillSwitch(enabled: boolean): void {
  call("setKillSwitch", undefined, enabled);
}

export function isKillSwitchEnabled(): boolean {
  return call("isKillSwitchEnabled", true);
}

/** Begin capture for the consented tiers (no-op for unconsented/unavailable tiers). */
export async function start(): Promise<void> {
  return Native.start();
}

export async function stop(): Promise<void> {
  return Native.stop();
}

/**
 * Latest gated + DP-noised AffectState, or null when: no consent, kill switch off,
 * no warm baseline yet, or motion-gated.
 */
export function getAffectState(): AffectState | null {
  return call("getAffectState", null);
}

/** Associate a shown item with the impression id so native Attribution can align lag. */
export function markImpression(impressionId: string, itemId: string): void {
  call("markImpression", undefined, String(impressionId), String(itemId));
}

/** Feed a batch of touch kinematics (sent by the WebView ~1/s). Positions only; no content. */
export function recordTouch(samples: TouchSample[]): void {
  if (!Array.isArray(samples) || samples.length === 0) return;
  const clean = samples
    .filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.t))
    .slice(-300)
    .map((s) => ({
      x: Number(s.x),
      y: Number(s.y),
      t: Number(s.t),
      phase: s.phase === "start" || s.phase === "end" ? s.phase : "move",
      pressure: Number.isFinite(s.pressure as number) ? Number(s.pressure) : 0,
    }));
  if (clean.length) call("recordTouch", undefined, clean);
}

/**
 * Start the explicit 30 s fingertip calm reading (rear camera + torch). Progress and
 * the result arrive via addCalmReadingListener. Requests CAMERA first on Android.
 *
 * Result reasons when `ok` is false:
 *  - "permission": the OS camera permission was denied (no native event is sent)
 *  - "unavailable": this build has no native calm reading (no native event is sent)
 *  - "native": native refused (consent missing, kill switch, no activity) and has
 *    ALREADY sent an onCalmReading event with `done: true` and `error`.
 */
export async function startCalmReading(): Promise<{ ok: boolean; reason?: "permission" | "unavailable" | "native" }> {
  if (typeof Native?.startCalmReading !== "function" || !nativeAvailable) {
    return { ok: false, reason: "unavailable" };
  }
  const granted = await requestAndroid(Platform.OS === "android" ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []);
  if (!granted) return { ok: false, reason: "permission" };
  return (await callAsync("startCalmReading", false)) ? { ok: true } : { ok: false, reason: "native" };
}

export function stopCalmReading(): void {
  call("stopCalmReading", undefined);
}

/** Scan ~15 s for BLE heart-rate devices; results via addBleDeviceListener. */
export async function scanHeartRateDevices(): Promise<boolean> {
  if (!(await requestAndroid(bluetoothPerms()))) return false;
  return !!(await callAsync("scanHeartRateDevices", false));
}

export async function connectHeartRate(id: string): Promise<boolean> {
  if (!(await requestAndroid(bluetoothPerms()))) return false;
  return !!(await callAsync("connectHeartRate", false, String(id)));
}

export function disconnectHeartRate(): void {
  call("disconnectHeartRate", undefined);
}

/** Front-camera face sensing runs only while the feed is visible (and consented). */
export function setFeedVisible(visible: boolean): void {
  call("setFeedVisible", undefined, !!visible);
}

export function getContext(): ContextState {
  return call("getContext", STUB_CONTEXT);
}

// ── Events ─────────────────────────────────────────────────────────────────


export function addAffectListener(listener: (state: AffectState) => void): EventSubscription {
  return addNativeListener<AffectState>("onAffect", listener);
}

export function addCalmReadingListener(listener: (r: CalmReading) => void): EventSubscription {
  return addNativeListener<CalmReading>("onCalmReading", listener);
}

export function addBleDeviceListener(listener: (d: BleDevice) => void): EventSubscription {
  return addNativeListener<BleDevice>("onBleDevice", listener);
}

export function addBleStatusListener(listener: (s: BleStatus) => void): EventSubscription {
  return addNativeListener<BleStatus>("onBleStatus", listener);
}
