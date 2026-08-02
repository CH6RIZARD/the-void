import Foundation

/// Identifies the origin of a `SignalSample`.
///
/// Sources are addressed by a stable identifier so that downstream consumers
/// (the `FeatureExtractor`, baselines, logging) can key on them without holding
/// a reference to the concrete source object.
public enum SignalSourceID: String, Sendable, CaseIterable, Codable {
    case motion
    case health
    case face
    case interaction
    case context
}

/// A single timestamped, normalized observation emitted by a `SignalSource`.
///
/// Design contract:
/// - `payload` holds values that are already normalized into `[0, 1]` wherever
///   physically meaningful (e.g. a blink-rate that has been squashed by an
///   expected max). These are the values the `FeatureExtractor` prefers.
/// - `scalars` holds raw-but-*derived* quantities (e.g. beats-per-minute,
///   steps-per-minute, lux). These are NOT raw sensor frames — a `SignalSample`
///   never carries raw accelerometer buffers, raw ARKit face geometry, or raw
///   HealthKit samples. Raw data stays inside the source and never leaves the
///   device or the process.
///
/// `SignalSample` is a value type and `Sendable` so it can cross the async
/// stream boundary safely.
public struct SignalSample: Sendable, Equatable {

    /// Which source produced this sample.
    public let sourceID: SignalSourceID

    /// When the underlying observation window closed.
    public let timestamp: Date

    /// Normalized features in `[0, 1]` (best-effort). Keys are namespaced by
    /// convention, e.g. `"motion.accel_variance"`.
    public let payload: [String: Double]

    /// Derived scalars in natural units (bpm, lux, steps/min, ...). Present so
    /// that per-user baselines can z-score against physically meaningful
    /// quantities. Still derived — never raw sensor frames.
    public let scalars: [String: Double]

    public init(
        sourceID: SignalSourceID,
        timestamp: Date = Date(),
        payload: [String: Double],
        scalars: [String: Double] = [:]
    ) {
        self.sourceID = sourceID
        self.timestamp = timestamp
        // Clamp payload to [0, 1] defensively so that a mis-behaving source can
        // never poison the feature pipeline with out-of-range values.
        self.payload = payload.mapValues { Self.clamp01($0) }
        self.scalars = scalars
    }

    @inline(__always)
    static func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1.0, max(0.0, v))
    }
}
