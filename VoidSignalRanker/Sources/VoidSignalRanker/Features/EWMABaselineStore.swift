import Foundation

/// Per-user rolling baseline for a single scalar, maintained as an exponentially
/// weighted moving average (EWMA) of both the mean and the variance. This lets
/// the `FeatureExtractor` z-score live values against the user's own recent
/// history rather than any absolute threshold.
///
/// The half-life is expressed in days; we translate it to a per-update decay
/// using the elapsed wall-clock time between updates, so the effective window is
/// ~7 days regardless of sample rate.
public struct EWMABaseline: Codable, Equatable {

    public private(set) var mean: Double
    public private(set) var variance: Double
    public private(set) var lastUpdate: Date
    public private(set) var sampleCount: Int
    public let halfLifeDays: Double

    public init(halfLifeDays: Double = 7.0,
                mean: Double = 0,
                variance: Double = 1,
                lastUpdate: Date = .distantPast,
                sampleCount: Int = 0) {
        self.halfLifeDays = halfLifeDays
        self.mean = mean
        self.variance = variance
        self.lastUpdate = lastUpdate
        self.sampleCount = sampleCount
    }

    /// Fold a new observation into the baseline.
    public mutating func update(_ x: Double, at time: Date = Date()) {
        guard x.isFinite else { return }
        if sampleCount == 0 {
            mean = x
            variance = 0
            lastUpdate = time
            sampleCount = 1
            return
        }
        let elapsedDays = max(0, time.timeIntervalSince(lastUpdate)) / 86_400.0
        // alpha derived from half-life: weight of the *history* decays by 0.5
        // every halfLifeDays. New-sample weight = 1 - decay.
        let decay = pow(0.5, elapsedDays / halfLifeDays)
        let alpha = 1.0 - decay // weight given to the new sample
        let clampedAlpha = min(0.5, max(0.0001, alpha)) // avoid over-reacting

        let delta = x - mean
        mean += clampedAlpha * delta
        // EWMA of variance (West's / incremental form).
        variance = (1 - clampedAlpha) * (variance + clampedAlpha * delta * delta)
        lastUpdate = time
        sampleCount += 1
    }

    /// z-score of a value against this baseline. Returns 0 until the baseline has
    /// enough history to be trustworthy.
    public func zScore(_ x: Double) -> Double {
        guard sampleCount >= 2 else { return 0 }
        let sd = sqrt(max(variance, 1e-9))
        guard sd > 1e-6 else { return 0 }
        return (x - mean) / sd
    }

    /// Squash a z-score into [0,1] via a logistic, so downstream features are
    /// bounded. z=0 → 0.5, larger positive z → →1.
    public func normalizedDeviation(_ x: Double) -> Double {
        let z = zScore(x)
        return 1.0 / (1.0 + exp(-z))
    }
}

/// Collection of per-scalar baselines, keyed by scalar name (e.g.
/// `"heart_rate_bpm"`). Persistable through `EncryptedStore` — it holds ONLY
/// aggregated statistics (means/variances), never raw samples.
public final class EWMABaselineStore: Codable {

    private var baselines: [String: EWMABaseline]
    private let halfLifeDays: Double

    enum CodingKeys: String, CodingKey { case baselines, halfLifeDays }

    public init(halfLifeDays: Double = 7.0) {
        self.baselines = [:]
        self.halfLifeDays = halfLifeDays
    }

    public required init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.baselines = try c.decode([String: EWMABaseline].self, forKey: .baselines)
        self.halfLifeDays = (try? c.decode(Double.self, forKey: .halfLifeDays)) ?? 7.0
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(baselines, forKey: .baselines)
        try c.encode(halfLifeDays, forKey: .halfLifeDays)
    }

    public func update(_ key: String, value: Double, at time: Date = Date()) {
        var b = baselines[key] ?? EWMABaseline(halfLifeDays: halfLifeDays)
        b.update(value, at: time)
        baselines[key] = b
    }

    public func normalizedDeviation(_ key: String, value: Double) -> Double? {
        guard let b = baselines[key] else { return nil }
        return b.normalizedDeviation(value)
    }

    public func zScore(_ key: String, value: Double) -> Double? {
        baselines[key]?.zScore(value)
    }

    public func baseline(_ key: String) -> EWMABaseline? { baselines[key] }

    /// Whether a baseline has enough history to z-score against.
    public func isWarm(_ key: String, minSamples: Int = 8) -> Bool {
        (baselines[key]?.sampleCount ?? 0) >= minSamples
    }

    /// Persist derived statistics only. Raw sensor data never reaches here.
    public func persist(to store: EncryptedStore, key: String = "vsr.baselines") throws {
        try store.save(self, forKey: key)
    }

    public static func restore(from store: EncryptedStore, key: String = "vsr.baselines") -> EWMABaselineStore {
        (try? store.load(EWMABaselineStore.self, forKey: key)) ?? EWMABaselineStore()
    }
}
