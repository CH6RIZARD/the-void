import XCTest
@testable import VoidSignalRanker

final class SourceDegradationTests: XCTestCase {

    /// A disabled source is not active even when available; an enabled but
    /// unavailable source is also not active.
    func testActiveRequiresAvailableAndEnabled() {
        let interaction = InteractionSource() // always available
        XCTAssertTrue(interaction.isAvailable)
        XCTAssertFalse(interaction.isActive) // disabled by default
        interaction.isEnabled = true
        XCTAssertTrue(interaction.isActive)

        // A disabled interaction source records nothing.
        let disabled = InteractionSource()
        disabled.recordDwell(itemID: "x", dwellMs: 5000)
        // No crash / no emission path taken — nothing to assert beyond safety.
    }

    /// Phone-only scenario (no paired Watch): HealthSource degrades to steps +
    /// active energy, and the extractor still produces a valid state.
    func testWatchAbsentDegradesToStepsAndEnergy() {
        let gen = SyntheticSignalGenerator(scenario: .phoneOnly, seed: 4)
        let samples = gen.generate(count: 40)
        let healthSamples = samples.filter { $0.sourceID == .health }
        // phoneOnly scenario doesn't enable health at all, so verify explicitly
        // with a watch-absent-but-health-enabled scenario:
        var scenario = SyntheticSignalGenerator.Scenario(watchPresent: false)
        scenario.enabledSources = [.health]
        let gen2 = SyntheticSignalGenerator(scenario: scenario, seed: 4)
        let hs = gen2.generate(count: 10)
        XCTAssertFalse(hs.isEmpty)
        for s in hs {
            XCTAssertNil(s.payload["health.heart_rate"], "no HR without a watch")
            XCTAssertNotNil(s.payload["health.steps"])
            XCTAssertNotNil(s.payload["health.active_energy"])
        }
        XCTAssertTrue(healthSamples.isEmpty) // phoneOnly excludes health
    }

    /// The ranker degrades gracefully across ANY subset of sources: for each
    /// subset the produced state and scores stay bounded and finite.
    func testAnySubsetOfSourcesProducesBoundedOutput() {
        let allSources = Array(SignalSourceID.allCases)
        // Exhaustively test all 2^5 subsets.
        for mask in 0..<(1 << allSources.count) {
            var subset = Set<SignalSourceID>()
            for (i, id) in allSources.enumerated() where (mask & (1 << i)) != 0 {
                subset.insert(id)
            }
            let scenario = SyntheticSignalGenerator.Scenario(enabledSources: subset)
            let gen = SyntheticSignalGenerator(scenario: scenario, seed: 2)
            let extractor = FeatureExtractor()
            for s in gen.generate(count: 20) { extractor.ingest(s) }
            let state = extractor.currentState()
            for v in [state.arousal, state.attention, state.agitation, state.engagementDepth] {
                XCTAssertTrue(v.isFinite)
                XCTAssertGreaterThanOrEqual(v, 0)
                XCTAssertLessThanOrEqual(v, 1)
            }
            // Rank still works.
            let ranker = FusionRanker(graph: GraphStore())
            ranker.deterministic = true
            let ranked = ranker.rank(gen.makeItems(count: 5), affect: state)
            XCTAssertEqual(ranked.count, 5)
            for r in ranked { XCTAssertTrue(r.finalScore.isFinite) }
        }
    }

    /// Empty source set yields the neutral state (cold start).
    func testEmptySourceSetYieldsNeutralState() {
        let extractor = FeatureExtractor()
        XCTAssertEqual(extractor.currentState(), .neutral)
    }

    /// Face data never contributes derived scalars to the baseline store
    /// (session-scoped privacy guarantee).
    func testFaceDataNotBaselined() {
        let gen = SyntheticSignalGenerator(
            scenario: .init(enabledSources: [.face]), seed: 6)
        let extractor = FeatureExtractor()
        for s in gen.generate(count: 30) {
            XCTAssertTrue(s.scalars.isEmpty, "face samples must carry no scalars")
            extractor.ingest(s)
        }
        // No face-derived baseline keys should exist.
        XCTAssertNil(extractor.baselineStore.baseline("blink_rate"))
        XCTAssertNil(extractor.baselineStore.baseline("face.blink_rate"))
    }

    /// Encrypted store round-trips DERIVED aggregates only.
    func testEncryptedStoreRoundTripDerivedOnly() throws {
        let store = InMemoryEncryptedStore()
        let baselines = EWMABaselineStore()
        baselines.update("heart_rate_bpm", value: 72)
        try baselines.persist(to: store)
        let restored = EWMABaselineStore.restore(from: store)
        XCTAssertNotNil(restored.baseline("heart_rate_bpm"))
    }
}
