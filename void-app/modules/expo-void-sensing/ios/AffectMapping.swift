import Foundation

// NOTE ON LINKAGE: the VoidSensing package sources (AffectState, MotionCapture,
// BaselineStore, MotionGate, Attribution, …) are vendored INTO this same pod
// target by the podspec's `prepare_command`, so their public types are directly
// in scope here — there is intentionally NO `import VoidSensing`. If you instead
// link VoidSensing as a separate framework/pod, add `import VoidSensing` at the
// top of this file and of ExpoVoidSensingModule.swift.

/// Pure, device-local mapping from the VoidSensing `AffectState` (full-fidelity,
/// NEVER exposed) to the quantized, DP-noised wire dictionary that is the ONLY
/// shape allowed across the JS bridge (void-rank invariant #1 / schemas/affect.proto).
///
/// This helper is the single place quantization + DP happen before emission; it
/// stands in for the exit projection of the full PrivacyGate (T1.9, HUMAN GATE).
/// It emits ONLY int8 z-scores + scalars — never MotionSample / PPGReading /
/// FaceFrame / AffectWindow.
enum AffectMapping {
    /// The five consentable sensor tiers, matching `SensorTier` in index.ts.
    static let sensorTiers: [String] = ["motion", "touch", "ppg", "face", "health"]

    /// Sample Laplace(0, scale) noise via inverse-CDF, for (ε,0)-DP on a z-score.
    /// `generator` is passed inout so callers can reuse one RNG per emission.
    static func laplaceNoise(scale: Double, using generator: inout SystemRandomNumberGenerator) -> Double {
        guard scale > 0 else { return 0 }
        // u ∈ [-0.5, 0.5); clamp |u| < 0.5 so log() never hits -inf.
        let raw = Double.random(in: 0.0 ..< 1.0, using: &generator) - 0.5
        let sign = raw < 0 ? -1.0 : 1.0
        let a = Swift.min(abs(raw), 0.499_999)
        return -scale * sign * log(1.0 - 2.0 * a)
    }

    /// Project a device-local `AffectState` to the wire dictionary.
    ///
    /// - DP: Laplace noise (assumed unit sensitivity per window) is added to each
    ///   z-score BEFORE quantization; `dpApplied` is therefore always `true` on
    ///   the values that leave here. Passing `dpEpsilon <= 0` disables noise and
    ///   MUST NOT be used in production.
    /// - Quantization uses `AffectState.quantizeZ` (the wire contract's int8
    ///   [-128,127] ↔ [-4σ,+4σ] mapping) so JS receives int8-ranged integers.
    static func wire(from state: AffectState, dpEpsilon: Double) -> [String: Any] {
        var generator = SystemRandomNumberGenerator()
        let scale = dpEpsilon > 0 ? (1.0 / dpEpsilon) : 0.0

        let vz = state.valenceZ + laplaceNoise(scale: scale, using: &generator)
        let az = state.arousalZ + laplaceNoise(scale: scale, using: &generator)
        let nz = state.attentionZ + laplaceNoise(scale: scale, using: &generator)

        return [
            "valenceZ": Int(AffectState.quantizeZ(vz)),
            "arousalZ": Int(AffectState.quantizeZ(az)),
            "attentionZ": Int(AffectState.quantizeZ(nz)),
            "confidence": Int((Swift.min(1.0, Swift.max(0.0, state.confidence)) * 100.0).rounded()),
            "sourceMask": Int(state.sourceMask),
            // UInt64 ms → Double: JS `number` (index.ts `windowEndMs: number`).
            "windowEndMs": Double(state.windowEndMs),
            "dpApplied": scale > 0,
        ]
    }

    /// Build the `ConsentState` wire dictionary (matches index.ts `ConsentState`).
    static func consentWire(affectConsent: Bool,
                            perTier: [String: Bool],
                            nonBiometricFeed: Bool) -> [String: Any] {
        return [
            "affectConsent": affectConsent,
            "perTier": perTier,
            "nonBiometricFeed": nonBiometricFeed,
        ]
    }
}
