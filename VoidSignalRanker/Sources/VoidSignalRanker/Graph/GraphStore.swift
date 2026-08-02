import Foundation

/// The three candidate-item scores the graph layer can retrieve.
public struct GraphScores: Equatable, Sendable {
    public var social: Double       // [0,1]
    public var interest: Double      // [0,1]
    public var behavioral: Double    // [0,1]

    public init(social: Double, interest: Double, behavioral: Double) {
        self.social = social
        self.interest = interest
        self.behavioral = behavioral
    }

    public static let zero = GraphScores(social: 0, interest: 0, behavioral: 0)
}

/// Directed social edges between nodes (users, authors, regions). Edge weight in
/// [0,1] captures affinity/strength.
public struct GraphEdge: Codable, Equatable, Sendable {
    public let from: String
    public let to: String
    public let weight: Double
    public init(from: String, to: String, weight: Double) {
        self.from = from
        self.to = to
        self.weight = weight
    }
}

/// On-device social/interest/behavioral scorer.
///
/// - `social`: propagates edge weight from the user through followed nodes to
///   the item's author/region, up to 2 hops. Direct follow = strongest; a
///   followed-node's edge to the author = discounted second hop.
/// - `interest`: cosine similarity between the item embedding and the user's
///   interest vector.
/// - `behavioral`: blended historical engagement across the item's topic /
///   region / format buckets.
///
/// Holds only derived aggregates + a follow graph — all safe to persist through
/// an `EncryptedStore`.
public final class GraphStore {

    private var profile: UserProfile
    private let userNodeID: String

    /// Adjacency: node → its outgoing edges. Used for the 2-hop walk.
    private var adjacency: [String: [GraphEdge]] = [:]

    private let secondHopDiscount: Double

    public init(userNodeID: String = "self",
                profile: UserProfile = UserProfile(),
                edges: [GraphEdge] = [],
                secondHopDiscount: Double = 0.5) {
        self.userNodeID = userNodeID
        self.profile = profile
        self.secondHopDiscount = secondHopDiscount
        for e in edges { adjacency[e.from, default: []].append(e) }
    }

    // MARK: - Mutation

    public func updateProfile(_ profile: UserProfile) { self.profile = profile }
    public func currentProfile() -> UserProfile { profile }

    public func addEdge(_ edge: GraphEdge) {
        adjacency[edge.from, default: []].append(edge)
    }

    /// Fold an observed engagement outcome into behavioral affinity (online).
    public func recordEngagement(item: Item, engaged: Bool, learningRate: Double = 0.1) {
        for bucket in buckets(for: item) {
            let prior = profile.behavioralAffinity[bucket] ?? 0.5
            let target = engaged ? 1.0 : 0.0
            profile.behavioralAffinity[bucket] = prior + learningRate * (target - prior)
        }
    }

    // MARK: - Scoring

    public func scores(for item: Item) -> GraphScores {
        GraphScores(social: socialScore(for: item),
                    interest: interestScore(for: item),
                    behavioral: behavioralScore(for: item))
    }

    /// 2-hop social propagation from the user to the item's author/region.
    func socialScore(for item: Item) -> Double {
        let targets = [item.authorID, item.region]
        var best = 0.0

        for target in targets {
            // Hop 0: user directly follows the target.
            if let direct = edgeWeight(from: userNodeID, to: target) {
                best = max(best, direct)
                continue
            }
            // Hop 1→2: user → followed node → target.
            for edge in adjacency[userNodeID] ?? [] {
                // edge.to is a followed node; does it connect to the target?
                if let second = edgeWeight(from: edge.to, to: target) {
                    let propagated = edge.weight * second * secondHopDiscount
                    best = max(best, propagated)
                }
            }
            // Fallback: membership in followedNodes without explicit edges.
            if profile.followedNodes.contains(target) {
                best = max(best, 0.7)
            }
        }
        return clamp01(best)
    }

    private func edgeWeight(from: String, to: String) -> Double? {
        adjacency[from]?.first(where: { $0.to == to })?.weight
    }

    /// Cosine similarity mapped from [-1,1] to [0,1].
    func interestScore(for item: Item) -> Double {
        let sim = Self.cosine(profile.interestVector, item.embedding)
        return clamp01((sim + 1.0) / 2.0)
    }

    /// Average of the item's bucket affinities (topic/region/format).
    func behavioralScore(for item: Item) -> Double {
        let bs = buckets(for: item)
        let vals = bs.compactMap { profile.behavioralAffinity[$0] }
        guard !vals.isEmpty else { return 0.5 } // no history → neutral prior
        return clamp01(vals.reduce(0, +) / Double(vals.count))
    }

    private func buckets(for item: Item) -> [String] {
        ["topic:\(item.topic)", "region:\(item.region)", "format:\(item.format.rawValue)"]
    }

    // MARK: - Math

    static func cosine(_ a: [Double], _ b: [Double]) -> Double {
        guard !a.isEmpty, a.count == b.count else { return 0 }
        var dot = 0.0, na = 0.0, nb = 0.0
        for i in 0..<a.count {
            dot += a[i] * b[i]
            na += a[i] * a[i]
            nb += b[i] * b[i]
        }
        guard na > 0, nb > 0 else { return 0 }
        return dot / (sqrt(na) * sqrt(nb))
    }

    private func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1, max(0, v))
    }

    // MARK: - Persistence (derived aggregates only)

    public func persist(to store: EncryptedStore, key: String = "vsr.profile") throws {
        try store.save(profile, forKey: key)
    }

    public func restoreProfile(from store: EncryptedStore, key: String = "vsr.profile") {
        if let restored = try? store.load(UserProfile.self, forKey: key) {
            profile = restored
        }
    }
}
