import Foundation

/// Learns a mapping from item features → predicted affective response, i.e. the
/// expected *delta* in arousal/attention an item tends to produce for this user.
///
/// This is the `physio_affinity` term in the fusion score. It is trained online
/// from logged pairs `(item_features → measured affective response)`: after an
/// item is shown, the app logs how the user's `AffectiveState` shifted, and we
/// regress that shift on the item's coarse features (topic/region/format bucket
/// one-hots + a couple of embedding summaries).
///
/// Persistable: only regression weights (derived) are stored — never the raw
/// affective samples, which stay in memory.
public final class PhysioAffinityModel: Codable {

    /// Ridge-regularized linear weights keyed by feature bucket, predicting a
    /// signed affective delta in roughly [-1, 1].
    private var weights: [String: Double]
    private let learningRate: Double
    private let l2: Double

    enum CodingKeys: String, CodingKey { case weights, learningRate, l2 }

    public init(learningRate: Double = 0.05, l2: Double = 0.001) {
        self.weights = [:]
        self.learningRate = learningRate
        self.l2 = l2
    }

    public required init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weights = try c.decode([String: Double].self, forKey: .weights)
        learningRate = (try? c.decode(Double.self, forKey: .learningRate)) ?? 0.05
        l2 = (try? c.decode(Double.self, forKey: .l2)) ?? 0.001
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(weights, forKey: .weights)
        try c.encode(learningRate, forKey: .learningRate)
        try c.encode(l2, forKey: .l2)
    }

    /// Discrete feature buckets for an item.
    private func features(for item: Item) -> [String] {
        ["topic:\(item.topic)", "region:\(item.region)", "format:\(item.format.rawValue)"]
    }

    /// Predicted affinity in [0,1]: how well this item is expected to move the
    /// user toward a desirable affective state (positive arousal/attention).
    /// A model with no history returns the neutral 0.5.
    public func affinity(for item: Item, given state: AffectiveState) -> Double {
        let f = features(for: item)
        guard f.contains(where: { weights[$0] != nil }) else { return 0.5 }
        var raw = 0.0
        for key in f { raw += weights[key] ?? 0 }
        // Context gate: if the user is already agitated, dampen high-arousal
        // predictions so the ranker doesn't pile on. Bounded, interpretable.
        let agitationPenalty = 1.0 - 0.5 * state.agitation
        let gated = raw * agitationPenalty
        return 1.0 / (1.0 + exp(-gated)) // squash to [0,1]
    }

    /// Online update from a logged `(item → measured affective delta)` pair.
    /// `measuredDelta` is the observed change in a composite affective target
    /// (e.g. +attention, +arousal, −agitation), scaled to roughly [-1,1].
    public func train(item: Item, measuredDelta: Double) {
        let f = features(for: item)
        let predicted = f.reduce(0.0) { $0 + (weights[$1] ?? 0) }
        let error = measuredDelta - predicted
        for key in f {
            let w = weights[key] ?? 0
            weights[key] = w + learningRate * (error - l2 * w)
        }
    }

    public func persist(to store: EncryptedStore, key: String = "vsr.physio") throws {
        try store.save(self, forKey: key)
    }

    public static func restore(from store: EncryptedStore, key: String = "vsr.physio") -> PhysioAffinityModel {
        (try? store.load(PhysioAffinityModel.self, forKey: key)) ?? PhysioAffinityModel()
    }
}
