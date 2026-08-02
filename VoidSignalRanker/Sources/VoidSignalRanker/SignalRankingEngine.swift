import Foundation

/// Top-level façade that wires sources → feature extractor → ranker, and exposes
/// a synchronous snapshot for the debug panel / hosting app.
///
/// It is intentionally UI-framework-free so it compiles everywhere; the SwiftUI
/// `DebugRankPanel` observes it via a thin adapter.
public final class SignalRankingEngine {

    public let extractor: FeatureExtractor
    public let graph: GraphStore
    public let ranker: FusionRanker
    private let sources: [SignalSource]

    private var streamTasks: [Task<Void, Never>] = []

    public init(sources: [SignalSource],
                extractor: FeatureExtractor,
                graph: GraphStore,
                ranker: FusionRanker) {
        self.sources = sources
        self.extractor = extractor
        self.graph = graph
        self.ranker = ranker
    }

    /// Convenience constructor building the full default stack.
    public static func makeDefault(sources: [SignalSource],
                                   userNodeID: String = "self",
                                   profile: UserProfile = UserProfile(),
                                   edges: [GraphEdge] = [],
                                   store: EncryptedStore = InMemoryEncryptedStore()) -> SignalRankingEngine {
        let baselines = EWMABaselineStore.restore(from: store)
        let extractor = FeatureExtractor(baselines: baselines)
        let graph = GraphStore(userNodeID: userNodeID, profile: profile, edges: edges)
        let physio = PhysioAffinityModel.restore(from: store)
        let ranker = FusionRanker(graph: graph, physio: physio)
        return SignalRankingEngine(sources: sources, extractor: extractor, graph: graph, ranker: ranker)
    }

    // MARK: - Lifecycle

    /// Start every active source and begin folding their samples into the
    /// extractor. Only sources that are available AND enabled emit anything, so
    /// starting with any subset (or none) is safe.
    public func start() {
        for source in sources {
            source.start()
            let stream = source.samples
            let task = Task { [weak self] in
                for await sample in stream {
                    self?.extractor.ingest(sample)
                }
            }
            streamTasks.append(task)
        }
    }

    public func stop() {
        for source in sources { source.stop() }
        for task in streamTasks { task.cancel() }
        streamTasks.removeAll()
    }

    /// Feed a pre-built batch of samples (e.g. from the synthetic generator)
    /// synchronously — useful for tests and previews without async streams.
    public func ingestSynthetic(_ samples: [SignalSample]) {
        for s in samples { extractor.ingest(s) }
    }

    // MARK: - Snapshot

    public struct Snapshot {
        public let affect: AffectiveState
        public let weights: FusionWeights
        public let ranked: [RankedItem]
        public let activeSourceIDs: [SignalSourceID]
        public let banditWarm: Bool
    }

    /// Rank the given candidates against the current affective state.
    public func snapshot(candidates: [Item]) -> Snapshot {
        let affect = extractor.currentState()
        let ranked = ranker.rank(candidates, affect: affect)
        let active = sources.filter { $0.isActive }.map { $0.id }
        return Snapshot(affect: affect,
                        weights: ranker.currentWeights(),
                        ranked: ranked,
                        activeSourceIDs: active,
                        banditWarm: ranker.isBanditWarm)
    }
}
