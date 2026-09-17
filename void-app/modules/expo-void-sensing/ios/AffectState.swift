import Foundation

// MARK: - Shared helpers (module-internal)

/// Clamp that is safe for NaN / ±inf (NaN collapses toward 0 inside the range).
@inline(__always)
func vsClamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    if v.isNaN { return Swift.min(hi, Swift.max(lo, 0.0)) }
    return Swift.min(hi, Swift.max(lo, v))
}

/// Wall-clock milliseconds since the Unix epoch.
@inline(__always)
func vsNowMs() -> Int64 {
    return Int64((Date().timeIntervalSince1970 * 1000.0).rounded())
}

/// Lenient number extraction for values arriving from the JS bridge.
func vsNumber(_ v: Any?) -> Double? {
    switch v {
    case let d as Double: return d
    case let f as Float: return Double(f)
    case let i as Int: return Double(i)
    case let i as Int64: return Double(i)
    case let n as NSNumber: return n.doubleValue
    case let s as String: return Double(s)
    default: return nil
    }
}

// MARK: - Source bitmask

/// Bit flags for `AffectState.sourceMask` (mirrors schemas/affect.proto + Android AffectSource).
enum AffectSource {
    static let ppg = 1
    static let face = 2
    static let motion = 4
    static let touch = 8
    static let watch = 16
    /// BLE heart-rate straps / watches share the WATCH bit.
    static let ble = 16
}

// MARK: - Device-local affect estimate

/// Device-local affect estimate (float personal-baseline z-scores).
/// NEVER crosses the bridge as-is: only the PrivacyGate's quantized, DP-noised
/// projection does.
struct AffectStateLocal {
    var valenceZ: Double
    var arousalZ: Double
    var attentionZ: Double
    /// Confidence in [0,1].
    var confidenceUnit: Double
    var sourceMask: Int
    var windowEndMs: Int64

    static func clampedConfidence(_ raw: Double) -> Double {
        return vsClamp(raw, 0.0, 1.0)
    }

    /// Quantize a z-score to int8 [-128,127] mapping [-4σ,+4σ] (wire contract).
    static func quantizeZ(_ z: Double) -> Int {
        guard !z.isNaN else { return 0 }
        let clamped = vsClamp(z, -4.0, 4.0)
        let scaled = (clamped / 4.0 * 127.0).rounded()
        return Int(Swift.min(127.0, Swift.max(-128.0, scaled)))
    }
}

// MARK: - Feature window

/// One tick's baseline-normalized feature window. Every `...Z` field is already a
/// per-user z-score from BaselineStore (nil = unavailable or baseline not warm).
struct AffectWindow {
    var windowEndMs: Int64
    var sourceMask: Int = 0
    /// True when at least one contributing baseline is warm.
    var baselineWarm: Bool = false
    /// Mean of `min(1, samples/200)` over the contributing baselines.
    var baselineFactor: Double = 0.0

    // Motion
    var motionZ: Double? = nil
    var tremorZ: Double? = nil

    // Touch kinematics
    var touchQuality: Double = 0.0
    var touchSpeedZ: Double? = nil
    var touchSpeedVarZ: Double? = nil
    var reversalRateZ: Double? = nil
    var tapRateZ: Double? = nil
    var pauseRatioZ: Double? = nil
    var pressureZ: Double? = nil

    // Face
    var faceQuality: Double = 0.0
    var blinkRateZ: Double? = nil
    /// Raw fraction [0,1] of recent frames looking at the screen.
    var gazeOnScreen: Double? = nil
    var gazeZ: Double? = nil
    var smileZ: Double? = nil

    // Heart
    var hrZ: Double? = nil
    var hrvZ: Double? = nil
    /// Per-source confidence of the heart-rate reading [0,1].
    var hrConfidence: Double = 0.0

    var context: SensingContext? = nil

    init(windowEndMs: Int64) {
        self.windowEndMs = windowEndMs
    }
}

// MARK: - Estimators

protocol AffectEstimating {
    /// Returns nil when no baseline is warm (never a fabricated estimate).
    func estimate(_ window: AffectWindow) -> AffectStateLocal?
}

/// Confidence-weighted mean with a shrinkage prior toward 0 (so a single weak
/// signal cannot produce a full-magnitude estimate).
struct ShrunkMean {
    private(set) var sum = 0.0
    private(set) var weight = 0.0
    let prior: Double

    init(prior: Double = 0.3) { self.prior = prior }

    mutating func add(_ v: Double?, _ w: Double) {
        guard let v = v, v.isFinite, w > 0 else { return }
        sum += vsClamp(v, -4.0, 4.0) * w
        weight += w
    }

    var value: Double { return weight > 0 ? sum / (weight + prior) : 0.0 }
}

/// Deterministic, dependency-free heuristic estimator (fallback until a trained
/// model ships). Mirrors Android HeuristicAffectEstimator in spirit, extended with
/// touch, face and multi-source heart-rate features.
final class HeuristicAffectEstimator: AffectEstimating {
    func estimate(_ w: AffectWindow) -> AffectStateLocal? {
        guard w.baselineWarm else { return nil }

        let faceQ = vsClamp(w.faceQuality, 0, 1)
        let touchQ = vsClamp(w.touchQuality, 0, 1)
        let hrC = vsClamp(w.hrConfidence, 0, 1)

        var arousal = ShrunkMean()
        var valence = ShrunkMean()
        var attention = ShrunkMean()

        // Heart (auxiliary for arousal; never a standalone reward).
        arousal.add(w.hrZ, 0.9 * hrC)
        if let hrv = w.hrvZ {
            arousal.add(-hrv, 0.5 * hrC)
            valence.add(0.5 * hrv, 0.2 * hrC)
        }

        // Motion: fidget / tremor raise arousal, lower attention.
        arousal.add(w.motionZ, 0.25)
        attention.add(w.motionZ.map { -$0 }, 0.15)
        arousal.add(w.tremorZ, 0.2)

        // Face.
        if let b = w.blinkRateZ {
            arousal.add(b, 0.3 * faceQ)
            attention.add(-b, 0.25 * faceQ)
        }
        valence.add(w.smileZ, 0.8 * faceQ)
        if let g = w.gazeOnScreen {
            let gz = w.gazeZ ?? ((g - 0.6) * 4.0)
            attention.add(gz, 0.9 * faceQ)
        }

        // Touch kinematics.
        arousal.add(w.touchSpeedZ, 0.3 * touchQ)
        if let vv = w.touchSpeedVarZ {
            attention.add(-vv, 0.35 * touchQ)
            arousal.add(0.5 * vv, 0.15 * touchQ)
        }
        if let r = w.reversalRateZ {
            attention.add(-r, 0.25 * touchQ)
            valence.add(-0.3 * r, 0.1 * touchQ)
        }
        attention.add(w.pauseRatioZ, 0.3 * touchQ)
        arousal.add(w.tapRateZ, 0.15 * touchQ)
        arousal.add(w.pressureZ, 0.1 * touchQ)

        // Context: very late night slightly lowers the attention prior.
        if let ctx = w.context, ctx.hourOfDay >= 0, ctx.hourOfDay < 5 {
            attention.add(-0.5, 0.05)
        }

        guard arousal.weight + valence.weight + attention.weight > 0 else { return nil }

        // Coverage-based confidence.
        let hasFace = w.gazeOnScreen != nil || w.smileZ != nil || w.blinkRateZ != nil
        let hasHr = w.hrZ != nil || w.hrvZ != nil
        let hasTouch = w.touchSpeedZ != nil || w.touchSpeedVarZ != nil || w.reversalRateZ != nil
            || w.tapRateZ != nil || w.pauseRatioZ != nil
        let hasMotion = w.motionZ != nil || w.tremorZ != nil
        var miss = 1.0
        if hasFace { miss *= (1.0 - 0.55 * faceQ) }
        if hasHr { miss *= (1.0 - 0.6 * hrC) }
        if hasTouch { miss *= (1.0 - 0.3 * touchQ) }
        if hasMotion { miss *= (1.0 - 0.15) }
        var confidence = 1.0 - miss

        // High motion -> noisy physiology.
        if let m = w.motionZ, m > 0 {
            confidence *= (1.0 - 0.5 * Swift.min(1.0, m / 3.0))
        }
        // Honest low confidence while baselines are young.
        confidence *= vsClamp(w.baselineFactor, 0, 1)

        return AffectStateLocal(
            valenceZ: vsClamp(valence.value, -4, 4),
            arousalZ: vsClamp(arousal.value, -4, 4),
            attentionZ: vsClamp(attention.value, -4, 4),
            confidenceUnit: AffectStateLocal.clampedConfidence(confidence),
            sourceMask: w.sourceMask,
            windowEndMs: w.windowEndMs
        )
    }
}
