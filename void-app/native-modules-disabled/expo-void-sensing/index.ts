import { requireNativeModule, EventEmitter, type Subscription } from "expo-modules-core";

/**
 * expo-void-sensing — the ONLY bridge between the native on-device sensing/affect
 * pipeline and JS. Per void-rank invariant #1, raw physiological data (IMU, PPG
 * frames, face blendshapes) NEVER crosses this boundary. The native side emits only
 * the quantized AffectState below. There is no method that returns a raw buffer.
 */

/** Quantized, personal-baseline z-scores. Mirrors schemas/affect.proto AffectState. */
export interface AffectState {
  /** int8 z-scores in [-128,127] mapping to [-4σ,+4σ]. */
  valenceZ: number;
  arousalZ: number;
  attentionZ: number;
  /** 0..100 model-reported reliability. Expect this to be LOW/0 until a model ships. */
  confidence: number;
  /** bitfield: 1=PPG 2=FACE 4=MOTION 8=TOUCH 16=WATCH */
  sourceMask: number;
  windowEndMs: number;
  /** must be true in production (DP noise applied before emit). */
  dpApplied: boolean;
}

export type SensorTier = "motion" | "touch" | "ppg" | "face" | "health";

export interface ConsentState {
  affectConsent: boolean; // explicit, unbundled opt-in (GDPR Art.9 / BIPA)
  perTier: Record<SensorTier, boolean>;
  /** DSA Art.38: a one-tap non-biometric feed must always be available. */
  nonBiometricFeed: boolean;
}

// The native body may be absent (plain-browser/web, or a dev/EAS build before the
// iOS/Android modules are compiled in). In that case we boot with a no-op stub so
// the app still reaches the UI and the JS↔web bridge is testable on its own.
const NONBIO_CONSENT: ConsentState = {
  affectConsent: false,
  nonBiometricFeed: true,
  perTier: { motion: false, touch: false, ppg: false, face: false, health: false },
};
const STUB = {
  isAvailable: () => false,
  requestConsent: async () => NONBIO_CONSENT,
  getConsent: () => NONBIO_CONSENT,
  setKillSwitch: () => {},
  start: async () => {},
  stop: async () => {},
  getAffectState: () => null,
  markImpression: () => {},
  addListener: () => {},
  removeListeners: () => {},
} as const;

let nativeAvailable = true;
let Native: any;
try {
  Native = requireNativeModule("ExpoVoidSensing");
} catch {
  nativeAvailable = false;
  Native = STUB;
}
const emitter = nativeAvailable ? new EventEmitter(Native) : null;

/** True when the native module is actually linked in this build. */
export function hasNativeSensing(): boolean {
  return nativeAvailable;
}

/** True only where the native pipeline can run (has sensors + OS support). */
export function isAvailable(): boolean {
  return Native.isAvailable();
}

/** Explicit, per-tier consent prompt. Returns the resulting consent state. */
export async function requestConsent(tiers: SensorTier[]): Promise<ConsentState> {
  return Native.requestConsent(tiers);
}

export function getConsent(): ConsentState {
  return Native.getConsent();
}

/** Remote+local kill switch. When off, emit() returns null and capture stops. */
export function setKillSwitch(enabled: boolean): void {
  Native.setKillSwitch(enabled);
}

/** Begin capture for the consented tiers (no-op for unconsented/unavailable tiers). */
export async function start(): Promise<void> {
  return Native.start();
}

export async function stop(): Promise<void> {
  return Native.stop();
}

/**
 * Latest gated + DP-noised AffectState, or null when: no consent, kill-switch off,
 * baseline not warm (cold-start), motion-gated, or no affect model shipped yet.
 * Null is the EXPECTED result at launch — the ranker falls back to behavioral signals.
 */
export function getAffectState(): AffectState | null {
  return Native.getAffectState();
}

/** Associate a shown item with the impression id so native Attribution can align lag. */
export function markImpression(impressionId: string, itemId: string): void {
  Native.markImpression(impressionId, itemId);
}

export function addAffectListener(
  listener: (state: AffectState) => void,
): Subscription {
  if (!emitter) return { remove() {} } as Subscription;
  return emitter.addListener<AffectState>("onAffect", listener);
}
