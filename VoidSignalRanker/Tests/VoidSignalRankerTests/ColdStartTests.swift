import XCTest
@testable import VoidSignalRanker

final class ColdStartTests: XCTestCase {

    private func makeRanker() -> FusionRanker {
        let graph = GraphStore(profile: UserProfile())
        let ranker = FusionRanker(graph: graph)
        ranker.deterministic = true
        return ranker
    }

    /// With no observations, the ranker must use the fixed cold-start weights.
    func testColdStartUsesFixedWeights() {
        let ranker = makeRanker()
        XCTAssertFalse(ranker.isBanditWarm)
        XCTAssertEqual(ranker.currentWeights(), .coldStart)
    }

    /// Cold-start weights are a valid convex combination (sum to 1).
    func testColdStartWeightsSumToOne() {
        let w = FusionWeights.coldStart
        let sum = w.social + w.interest + w.behavioral + w.physio
        XCTAssertEqual(sum, 1.0, accuracy: 1e-9)
    }

    /// The ranker produces bounded, sensible scores with NO sources (neutral
    /// affect) and an empty profile.
    func testRankingWithNoSignalsIsSensible() {
        let ranker = makeRanker()
        let gen = SyntheticSignalGenerator(seed: 3)
        let items = gen.makeItems(count: 8)
        let ranked = ranker.rank(items, affect: .neutral)

        XCTAssertEqual(ranked.count, items.count)
        // Sorted descending by final score.
        for i in 1..<ranked.count {
            XCTAssertGreaterThanOrEqual(ranked[i - 1].finalScore, ranked[i].finalScore)
        }
        // Every score in [0,1] (weights sum to 1, components + physio in [0,1],
        // decay in (0,1]).
        for r in ranked {
            XCTAssertGreaterThanOrEqual(r.finalScore, 0)
            XCTAssertLessThanOrEqual(r.finalScore, 1)
            XCTAssertEqual(r.physioAffinity, 0.5, accuracy: 1e-9) // untrained → neutral
        }
    }

    /// After enough engagement observations, the bandit becomes warm and its
    /// learned weights are used (still a valid normalized vector).
    func testBanditWarmsUpAndProducesValidWeights() {
        let ranker = makeRanker()
        ranker.banditWarmupCount = 10
        let gen = SyntheticSignalGenerator(seed: 9)
        let items = gen.makeItems(count: 10)

        for (i, item) in items.enumerated() {
            let ranked = ranker.score(item, affect: .neutral)
            // Pretend the user engages with interest-heavy items.
            ranker.observe(ranked, engaged: i % 2 == 0, measuredAffectiveDelta: 0.3)
        }
        // 10 observations meets warmup.
        XCTAssertTrue(ranker.isBanditWarm)
        let w = ranker.currentWeights()
        let sum = w.social + w.interest + w.behavioral + w.physio
        XCTAssertEqual(sum, 1.0, accuracy: 1e-6)
        for c in [w.social, w.interest, w.behavioral, w.physio] {
            XCTAssertGreaterThanOrEqual(c, 0)
        }
    }

    /// Engine end-to-end with zero sources: neutral affect, cold-start weights,
    /// still ranks candidates.
    func testEngineColdStartEndToEnd() {
        let engine = SignalRankingEngine.makeDefault(sources: [])
        engine.ranker.deterministic = true
        let gen = SyntheticSignalGenerator(seed: 1)
        let snap = engine.snapshot(candidates: gen.makeItems(count: 6))
        XCTAssertEqual(snap.affect, .neutral)
        XCTAssertEqual(snap.weights, .coldStart)
        XCTAssertEqual(snap.ranked.count, 6)
        XCTAssertTrue(snap.activeSourceIDs.isEmpty)
        XCTAssertFalse(snap.banditWarm)
    }
}
