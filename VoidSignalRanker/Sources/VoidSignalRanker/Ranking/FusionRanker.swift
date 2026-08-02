import Foundation

/// The five fusion weights `(w_s, w_i, w_b, w_p, w_c)`.
public struct FusionWeights: Equatable, Sendable, Codable {
    public var social: Double
    public var interest: Double
    public var behavioral: Double
    public var physio: Double
    public var controversy: Double

    public init(social: Double, interest: Double, behavioral: Double, physio: Double, controversy: Double = 0.15) {
        self.social = social
        self.interest = interest
        self.behavioral = behavioral
        self.physio = physio
        self.controversy = controversy
    }

    public var asVector: [Double] { [social, interest, behavioral, physio, controversy] }

    public init(vector v: [Double]) {
        social = v.count > 0 ? v[0] : 0
        interest = v.count > 1 ? v[1] : 0
        behavioral = v.count > 2 ? v[2] : 0
        physio = v.count > 3 ? v[3] : 0
        controversy = v.count > 4 ? v[4] : 0
    }

    /// Fixed cold-start weights: lean on interest + behavioral priors, modest
    /// social, minimal physio (which is untrained early on).
    public static let coldStart = FusionWeights(social: 0.30,
                                                interest: 0.35,
                                                behavioral: 0.25,
                                                physio: 0.10,
                                                controversy: 0.15)
}

/// The full breakdown for one ranked item — surfaced to the debug panel.
public struct RankedItem: Equatable, Sendable, Identifiable {
    public var id: String { item.id }
    public let item: Item
    public let components: GraphScores
    public let physioAffinity: Double
    public let controversy: Double
    public let weights: FusionWeights
    public let decay: Double
    public let finalScore: Double
}

/// Fuses the graph scores + physio affinity into a final ranking score:
///
///     score = w_s·social + w_i·interest + w_b·behavioral + w_p·physio_affinity
///
/// then multiplies by a recency time-decay factor.
///
/// Weights are learned per-user online via a contextual bandit (Thompson
/// sampling over a logistic model). Until the bandit is warm — or when the
/// caller requests deterministic behavior — it falls back to fixed cold-start
/// weights. The ranker produces sensible output with ANY subset of sources: the
/// affective inputs simply default to neutral and physio affinity to 0.5, so
/// missing signals degrade gracefully rather than breaking ranking.
public final class FusionRanker {

    private let graph: GraphStore
    private let physio: PhysioAffinityModel
    private let bandit: ContextualBandit
    private let now: () -> Date

    /// Half-life (seconds) of the recency decay applied to the final score.
    public var decayHalfLife: TimeInterval

    /// Number of engagement observations the bandit needs before we trust its
    /// sampled weights over the fixed cold-start weights.
    public var banditWarmupCount: Int = 20
    private var observedCount = 0

    /// When true, use posterior-mean bandit weights (no sampling) for
    /// reproducible ranking (tests / debug).
    public var deterministic: Bool = false
    private var rng = SplitMix64(seed: 0xC0FFEE)

    public init(graph: GraphStore,
                physio: PhysioAffinityModel = PhysioAffinityModel(),
                bandit: ContextualBandit? = nil,
                decayHalfLife: TimeInterval = 6 * 3600,
                now: @escaping () -> Date = { Date() }) {
        self.graph = graph
        self.physio = physio
        // Bandit context = the 4 component scores; it learns their weights.
        self.bandit = bandit ?? ContextualBandit(dimension: 5,
                                                  priorMean: FusionWeights.coldStart.asVector)
        self.decayHalfLife = decayHalfLife
        self.now = now
    }

    /// Current weights: cold-start until the bandit is warm; afterwards the
    /// bandit's sampled (or mean, if deterministic) weights, renormalized to be
    /// non-negative and sum-preserving for interpretability.
    public func currentWeights() -> FusionWeights {
        guard observedCount >= banditWarmupCount else { return .coldStart }
        let raw = deterministic ? bandit.meanWeights : bandit.sampleWeights(rng: &rng)
        return normalize(FusionWeights(vector: raw))
    }

    /// Score a single item given the current affective state.
    public func score(_ item: Item, affect: AffectiveState) -> RankedItem {
        let components = graph.scores(for: item)
        let physioAffinity = physio.affinity(for: item, given: affect)
        let controversy = item.controversy
        let weights = currentWeights()

        let linear = weights.social * components.social
            + weights.interest * components.interest
            + weights.behavioral * components.behavioral
            + weights.physio * physioAffinity
            + weights.controversy * controversy

        let decay = recencyDecay(for: item)
        let finalScore = linear * decay

        return RankedItem(item: item,
                          components: components,
                          physioAffinity: physioAffinity,
                          controversy: controversy,
                          weights: weights,
                          decay: decay,
                          finalScore: finalScore)
    }

    /// Rank a candidate set, highest score first.
    public func rank(_ items: [Item], affect: AffectiveState) -> [RankedItem] {
        items.map { score($0, affect: affect) }
             .sorted { $0.finalScore > $1.finalScore }
    }

    /// Report an engagement outcome for online learning. Updates BOTH the
    /// bandit (weight posterior) and the physio model (affective response).
    public func observe(_ ranked: RankedItem,
                        engaged: Bool,
                        measuredAffectiveDelta: Double? = nil) {
        let context = [ranked.components.social,
                       ranked.components.interest,
                       ranked.components.behavioral,
                       ranked.physioAffinity,
                       ranked.controversy]
        bandit.update(context: context, engaged: engaged)
        graph.recordEngagement(item: ranked.item, engaged: engaged)
        if let delta = measuredAffectiveDelta {
            physio.train(item: ranked.item, measuredDelta: delta)
        }
        observedCount += 1
    }

    public var isBanditWarm: Bool { observedCount >= banditWarmupCount }
    public var observationCount: Int { observedCount }

    // MARK: - Helpers

    private func recencyDecay(for item: Item) -> Double {
        let age = max(0, now().timeIntervalSince(item.createdAt))
        return pow(0.5, age / decayHalfLife)
    }

    /// Clamp negatives to 0 and renormalize so weights sum to 1 (keeps the score
    /// on a comparable scale and the panel readable). If all collapse to 0, fall
    /// back to cold-start.
    private func normalize(_ w: FusionWeights) -> FusionWeights {
        var clamped = w.asVector.map { max(0, $0) }
        // The model may personalize controversy, but never remove it.
        clamped[4] = max(0.15, clamped[4])
        let sum = clamped.reduce(0, +)
        guard sum > 1e-9 else { return .coldStart }
        return FusionWeights(vector: clamped.map { $0 / sum })
    }
}
