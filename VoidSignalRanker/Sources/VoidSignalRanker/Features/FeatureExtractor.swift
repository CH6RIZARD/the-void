import Foundation

/// The four normalized affective scalars, each in `[0, 1]`.
///
/// - `arousal`: overall physiological activation (HR up, HRV down, high motion).
/// - `attention`: focused engagement (steady gaze dwell, low scroll velocity,
///   micro-pauses, long dwell).
/// - `agitation`: restlessness / stress (gyro jitter, brow+jaw tension, scroll
///   reversals, elevated resting-relative HR without matching motion).
/// - `engagement_depth`: sustained, deep engagement (long dwell + steady gaze +
///   low reversal over the session window).
public struct AffectiveState: Sendable, Equatable, Codable {
    public var arousal: Double
    public var attention: Double
    public var agitation: Double
    public var engagementDepth: Double

    public init(arousal: Double = 0.5,
                attention: Double = 0.5,
                agitation: Double = 0.5,
                engagementDepth: Double = 0.5) {
        self.arousal = Self.c(arousal)
        self.attention = Self.c(attention)
        self.agitation = Self.c(agitation)
        self.engagementDepth = Self.c(engagementDepth)
    }

    /// A neutral state, used as the cold-start / no-signal default.
    public static let neutral = AffectiveState()

    static func c(_ v: Double) -> Double { v.isNaN ? 0.5 : min(1, max(0, v)) }
}

/// Rolling window horizons the extractor maintains simultaneously.
public enum FeatureWindow: CaseIterable, Sendable {
    case short   // ~5s   — reactive
    case medium  // ~60s  — trend
    case session // whole session — deep engagement

    var seconds: TimeInterval {
        switch self {
        case .short: return 5
        case .medium: return 60
        case .session: return .greatestFiniteMagnitude
        }
    }
}

/// Consumes `SignalSample`s from any subset of sources and produces the four
/// normalized affective scalars using sliding windows + per-user rolling
/// baselines (z-score against a 7-day EWMA). Never uses absolute thresholds for
/// the physiological interpretation — only the EWMA deviations.
///
/// Thread-safety: all mutation is funnelled through `ingest`; callers should
/// drive it from a single actor/queue or wrap it. Kept as a plain class so it is
/// easy to unit-test synchronously.
public final class FeatureExtractor {

    private struct TimedSample { let sample: SignalSample }

    private var buffer: [TimedSample] = []
    private let baselines: EWMABaselineStore
    private let now: () -> Date

    /// Which payload keys feed which affective dimension, and with what sign.
    /// Positive weight → raises the dimension; negative → lowers it.
    /// These are *feature-construction* weights, not the ranker's fusion weights.
    private let arousalMap: [String: Double] = [
        "health.heart_rate": 1.0,
        "health.hrv_sdnn": -0.8,          // higher HRV → calmer → lower arousal
        "motion.accel_variance": 0.6,
        "motion.cadence": 0.5,
        "face.blink_rate": 0.3
    ]
    private let attentionMap: [String: Double] = [
        "face.gaze_dwell": 1.0,
        "interaction.dwell": 0.8,
        "interaction.micro_pause": 0.5,
        "interaction.scroll_velocity": -0.7,
        "context.time_of_day": 0.2
    ]
    private let agitationMap: [String: Double] = [
        "motion.gyro_jitter": 0.8,
        "face.brow_tension": 0.7,
        "face.jaw_tension": 0.7,
        "interaction.reversal": 0.6,
        "health.heart_rate": 0.4,
        "interaction.scroll_velocity": 0.4
    ]
    private let engagementMap: [String: Double] = [
        "interaction.dwell": 1.0,
        "face.gaze_dwell": 0.7,
        "interaction.micro_pause": 0.4,
        "interaction.reversal": -0.5,
        "interaction.scroll_velocity": -0.6
    ]

    /// Scalar keys that should feed the per-user baseline (derived scalars only).
    /// Face is deliberately excluded — face-derived data is session-scoped and
    /// never contributes to a persisted baseline.
    private let baselinedScalarKeys: Set<String> = [
        "heart_rate_bpm", "hrv_sdnn_ms", "resting_hr_bpm",
        "accel_variance_raw", "gyro_jitter_raw", "cadence_steps_per_sec"
    ]

    public init(baselines: EWMABaselineStore = EWMABaselineStore(),
                now: @escaping () -> Date = { Date() }) {
        self.baselines = baselines
        self.now = now
    }

    public var baselineStore: EWMABaselineStore { baselines }

    /// Ingest a sample: update baselines from its derived scalars and buffer it
    /// for windowed feature computation.
    public func ingest(_ sample: SignalSample) {
        let t = sample.timestamp
        for (key, value) in sample.scalars where baselinedScalarKeys.contains(key) {
            baselines.update(key, value: value, at: t)
        }
        buffer.append(TimedSample(sample: sample))
        pruneSessionBuffer()
    }

    /// Compute the current affective state. If no samples are present, returns
    /// `.neutral` — the ranker then relies on cold-start fixed weights.
    public func currentState() -> AffectiveState {
        guard !buffer.isEmpty else { return .neutral }

        // Blend the short + medium + session windows. Short window dominates the
        // reactive dimensions (arousal/agitation); session dominates engagement.
        let shortAgg = aggregate(window: .short)
        let mediumAgg = aggregate(window: .medium)
        let sessionAgg = aggregate(window: .session)

        let arousal = mix(shortAgg[.arousal], mediumAgg[.arousal], sessionAgg[.arousal],
                          weights: (0.6, 0.3, 0.1))
        let attention = mix(shortAgg[.attention], mediumAgg[.attention], sessionAgg[.attention],
                            weights: (0.5, 0.35, 0.15))
        let agitation = mix(shortAgg[.agitation], mediumAgg[.agitation], sessionAgg[.agitation],
                            weights: (0.6, 0.3, 0.1))
        let engagement = mix(shortAgg[.engagement], mediumAgg[.engagement], sessionAgg[.engagement],
                             weights: (0.2, 0.3, 0.5))

        return AffectiveState(arousal: arousal,
                              attention: attention,
                              agitation: agitation,
                              engagementDepth: engagement)
    }

    // MARK: - Windowed aggregation

    private enum Dim: CaseIterable { case arousal, attention, agitation, engagement }

    /// For a window, accumulate a weighted, baseline-adjusted value per dimension.
    private func aggregate(window: FeatureWindow) -> [Dim: Double?] {
        let cutoff = now().addingTimeInterval(-window.seconds)
        let inWindow = buffer.filter { $0.sample.timestamp >= cutoff }
        guard !inWindow.isEmpty else { return [:] }

        var sums: [Dim: Double] = [:]
        var weights: [Dim: Double] = [:]

        for ts in inWindow {
            let sample = ts.sample
            accumulate(sample: sample, into: &sums, weights: &weights, dim: .arousal, map: arousalMap)
            accumulate(sample: sample, into: &sums, weights: &weights, dim: .attention, map: attentionMap)
            accumulate(sample: sample, into: &sums, weights: &weights, dim: .agitation, map: agitationMap)
            accumulate(sample: sample, into: &sums, weights: &weights, dim: .engagement, map: engagementMap)
        }

        var out: [Dim: Double?] = [:]
        for dim in Dim.allCases {
            if let w = weights[dim], w > 0 {
                // Center the weighted average around 0.5 baseline.
                out[dim] = clamp01(0.5 + (sums[dim] ?? 0) / w)
            } else {
                out[dim] = nil
            }
        }
        return out
    }

    /// For each payload key that maps into this dimension, contribute a
    /// baseline-adjusted, signed deviation from 0.5.
    private func accumulate(sample: SignalSample,
                            into sums: inout [Dim: Double],
                            weights: inout [Dim: Double],
                            dim: Dim,
                            map: [String: Double]) {
        for (key, weight) in map {
            guard let raw = sample.payload[key] else { continue }
            // Prefer a baseline-adjusted value when the corresponding derived
            // scalar has a warm baseline; otherwise fall back to the normalized
            // payload directly. This is what makes interpretation per-user and
            // threshold-free where we have history.
            let adjusted = baselineAdjusted(payloadKey: key, sample: sample) ?? raw
            let signed = weight * (adjusted - 0.5)
            sums[dim, default: 0] += signed
            weights[dim, default: 0] += abs(weight)
        }
    }

    /// Maps a payload key to its backing derived scalar and returns the EWMA
    /// normalized deviation if the baseline is warm.
    private func baselineAdjusted(payloadKey: String, sample: SignalSample) -> Double? {
        let scalarKey: String?
        switch payloadKey {
        case "health.heart_rate": scalarKey = "heart_rate_bpm"
        case "health.hrv_sdnn": scalarKey = "hrv_sdnn_ms"
        case "health.resting_hr": scalarKey = "resting_hr_bpm"
        case "motion.accel_variance": scalarKey = "accel_variance_raw"
        case "motion.gyro_jitter": scalarKey = "gyro_jitter_raw"
        case "motion.cadence": scalarKey = "cadence_steps_per_sec"
        default: scalarKey = nil
        }
        guard let scalarKey,
              let value = sample.scalars[scalarKey],
              baselines.isWarm(scalarKey) else { return nil }
        return baselines.normalizedDeviation(scalarKey, value: value)
    }

    // MARK: - Helpers

    private func mix(_ a: Double??, _ b: Double??, _ c: Double??,
                     weights: (Double, Double, Double)) -> Double {
        var acc = 0.0, wsum = 0.0
        if let v = a ?? nil { acc += weights.0 * v; wsum += weights.0 }
        if let v = b ?? nil { acc += weights.1 * v; wsum += weights.1 }
        if let v = c ?? nil { acc += weights.2 * v; wsum += weights.2 }
        guard wsum > 0 else { return 0.5 } // no signal for this dimension → neutral
        return clamp01(acc / wsum)
    }

    private func pruneSessionBuffer() {
        // Cap memory: keep at most the last N samples; the session window is
        // logically unbounded but we bound storage.
        let maxSamples = 5000
        if buffer.count > maxSamples {
            buffer.removeFirst(buffer.count - maxSamples)
        }
    }

    private func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0.5 }
        return min(1, max(0, v))
    }
}
