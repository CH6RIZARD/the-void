import Foundation

/// Produces realistic fake sensor streams so the whole subsystem can be demoed
/// and unit-tested with NO hardware and NO users.
///
/// It conforms to `SignalSource` for each channel via lightweight adapter
/// sources, but the primary use is the synchronous `generate(...)` API that
/// returns a deterministic (seeded) batch of `SignalSample`s matching the shape
/// each real source emits. Deterministic seeding keeps tests reproducible.
public final class SyntheticSignalGenerator {

    public struct Scenario {
        /// Baseline heart rate (bpm) around which HR wobbles.
        public var baseHeartRate: Double
        /// Baseline HRV SDNN (ms).
        public var baseHRV: Double
        /// Overall physical activity 0 (still) → 1 (running).
        public var activity: Double
        /// Emotional arousal 0 (calm) → 1 (excited) — drives HR/blink/tension.
        public var arousal: Double
        /// Attention 0 (distracted) → 1 (locked in) — drives gaze/dwell.
        public var attention: Double
        /// Whether a Watch is present (enables HR/HRV; else steps/energy only).
        public var watchPresent: Bool
        /// Which sources are enabled/available in this scenario.
        public var enabledSources: Set<SignalSourceID>

        public init(baseHeartRate: Double = 68,
                    baseHRV: Double = 55,
                    activity: Double = 0.1,
                    arousal: Double = 0.4,
                    attention: Double = 0.6,
                    watchPresent: Bool = true,
                    enabledSources: Set<SignalSourceID> = Set(SignalSourceID.allCases)) {
            self.baseHeartRate = baseHeartRate
            self.baseHRV = baseHRV
            self.activity = activity
            self.arousal = arousal
            self.attention = attention
            self.watchPresent = watchPresent
            self.enabledSources = enabledSources
        }

        public static let calmFocused = Scenario(baseHeartRate: 62, baseHRV: 70,
                                                  activity: 0.05, arousal: 0.25, attention: 0.85)
        public static let excitedRestless = Scenario(baseHeartRate: 92, baseHRV: 28,
                                                      activity: 0.6, arousal: 0.85, attention: 0.4)
        public static let phoneOnly = Scenario(watchPresent: false,
                                               enabledSources: [.interaction, .context, .motion])
    }

    private var rng: SplitMix64
    private let scenario: Scenario

    public init(scenario: Scenario = Scenario(), seed: UInt64 = 42) {
        self.scenario = scenario
        self.rng = SplitMix64(seed: seed)
    }

    /// Generate `count` samples per enabled source, spaced `interval` seconds
    /// apart, ending at `endTime`.
    public func generate(count: Int = 60,
                         interval: TimeInterval = 1.0,
                         endTime: Date = Date()) -> [SignalSample] {
        var out: [SignalSample] = []
        for i in 0..<count {
            let t = endTime.addingTimeInterval(-Double(count - 1 - i) * interval)
            for source in scenario.enabledSources {
                if let s = sample(for: source, at: t) { out.append(s) }
            }
        }
        return out.sorted { $0.timestamp < $1.timestamp }
    }

    private func sample(for source: SignalSourceID, at t: Date) -> SignalSample? {
        switch source {
        case .motion: return motionSample(at: t)
        case .health: return healthSample(at: t)
        case .face: return faceSample(at: t)
        case .interaction: return interactionSample(at: t)
        case .context: return contextSample(at: t)
        }
    }

    // MARK: - Per-source synthesis

    private func motionSample(at t: Date) -> SignalSample {
        let jitterBase = scenario.activity * 0.7 + scenario.arousal * 0.3
        let accelVarRaw = clamp01(jitterBase + noise(0.1)) * 2.0
        let gyroRaw = clamp01(jitterBase + noise(0.1)) * 6.0
        let cadence = scenario.activity * 3.0 + noise(0.1)
        return SignalSample(
            sourceID: .motion,
            timestamp: t,
            payload: [
                "motion.accel_variance": clamp01(accelVarRaw / 2.0),
                "motion.gyro_jitter": clamp01(gyroRaw / 6.0),
                "motion.cadence": clamp01(cadence / 3.0),
                "motion.activity_state": clamp01(scenario.activity)
            ],
            scalars: [
                "accel_variance_raw": accelVarRaw,
                "gyro_jitter_raw": gyroRaw,
                "cadence_steps_per_sec": max(0, cadence)
            ])
    }

    private func healthSample(at t: Date) -> SignalSample {
        if scenario.watchPresent {
            // Arousal + activity raise HR; arousal lowers HRV.
            let hr = scenario.baseHeartRate
                + scenario.arousal * 35
                + scenario.activity * 25
                + noise(3)
            let hrv = max(8, scenario.baseHRV - scenario.arousal * 30 + noise(4))
            let resting = scenario.baseHeartRate - 4 + noise(1)
            return SignalSample(
                sourceID: .health,
                timestamp: t,
                payload: [
                    "health.heart_rate": HealthSource.norm(hr, (40, 180)),
                    "health.hrv_sdnn": HealthSource.norm(hrv, (10, 120)),
                    "health.resting_hr": HealthSource.norm(resting, (40, 100))
                ],
                scalars: [
                    "heart_rate_bpm": hr,
                    "hrv_sdnn_ms": hrv,
                    "resting_hr_bpm": resting
                ])
        } else {
            // Degraded mode: steps + active energy only.
            let steps = scenario.activity * 160 + noise(10)
            let energy = scenario.activity * 12 + noise(1)
            return SignalSample(
                sourceID: .health,
                timestamp: t,
                payload: [
                    "health.steps": clamp01(steps / 180),
                    "health.active_energy": clamp01(energy / 15)
                ],
                scalars: ["steps": max(0, steps), "active_energy_kcal": max(0, energy)])
        }
    }

    private func faceSample(at t: Date) -> SignalSample {
        // High arousal → more blinking + tension; high attention → steady gaze.
        let blink = clamp01(0.3 + scenario.arousal * 0.5 + noise(0.05))
        let gaze = clamp01(scenario.attention + noise(0.08))
        let brow = clamp01(scenario.arousal * 0.6 + noise(0.05))
        let jaw = clamp01(scenario.arousal * 0.4 + noise(0.05))
        // Face carries NO scalars — session-scoped, never baselined/persisted.
        return SignalSample(
            sourceID: .face,
            timestamp: t,
            payload: [
                "face.blink_rate": blink,
                "face.gaze_dwell": gaze,
                "face.brow_tension": brow,
                "face.jaw_tension": jaw
            ],
            scalars: [:])
    }

    private func interactionSample(at t: Date) -> SignalSample {
        // Attention → longer dwell, slower scroll, more micro-pauses.
        // Low attention / high arousal → fast scroll + reversals.
        let dwell = clamp01(scenario.attention * 0.9 + noise(0.08))
        let scroll = clamp01((1 - scenario.attention) * 0.8 + scenario.arousal * 0.2 + noise(0.08))
        var payload: [String: Double] = [
            "interaction.dwell": dwell,
            "interaction.scroll_velocity": scroll,
            "interaction.deceleration": clamp01(scenario.attention * 0.5 + noise(0.05))
        ]
        if rng.nextUnit() < (1 - scenario.attention) * 0.4 {
            payload["interaction.reversal"] = 1.0
        }
        if rng.nextUnit() < scenario.attention * 0.3 {
            payload["interaction.micro_pause"] = 1.0
        }
        return SignalSample(sourceID: .interaction, timestamp: t, payload: payload,
                            scalars: ["dwell_ms": dwell * 15000])
    }

    private func contextSample(at t: Date) -> SignalSample {
        return SignalSample(
            sourceID: .context,
            timestamp: t,
            payload: [
                "context.time_of_day": ContextSource.timeOfDayWeight(t),
                "context.ambient_light": clamp01(0.5 + noise(0.2)),
                "context.charging": rng.nextUnit() < 0.3 ? 1.0 : 0.0,
                "context.motion_context": clamp01(scenario.activity)
            ],
            scalars: ["hour": Double(Calendar.current.component(.hour, from: t))])
    }

    // MARK: - Synthetic items

    /// A deterministic set of candidate items with embeddings, for demoing the
    /// ranker end-to-end.
    public func makeItems(count: Int = 12, embeddingDim: Int = 8) -> [Item] {
        let topics = ["sports", "news", "music", "nature", "gaming"]
        let regions = ["JP", "US", "BR", "NG", "DE"]
        let formats = Item.Format.allCases
        var items: [Item] = []
        for i in 0..<count {
            var emb = [Double]()
            for _ in 0..<embeddingDim { emb.append(rng.nextGaussian()) }
            items.append(Item(
                id: "item-\(i)",
                authorID: "author-\(i % 5)",
                region: regions[i % regions.count],
                topic: topics[i % topics.count],
                format: formats[i % formats.count],
                embedding: emb,
                createdAt: Date().addingTimeInterval(-Double(i) * 1800)))
        }
        return items
    }

    // MARK: - Noise

    private func noise(_ scale: Double) -> Double {
        rng.nextGaussian() * scale
    }

    private func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1, max(0, v))
    }
}
