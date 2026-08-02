import XCTest
@testable import VoidSignalRanker

final class FeatureNormalizationTests: XCTestCase {

    /// SignalSample must clamp its payload into [0,1] and reject NaN.
    func testPayloadClampedToUnitInterval() {
        let sample = SignalSample(
            sourceID: .motion,
            payload: ["a": 1.7, "b": -0.4, "c": Double.nan, "d": 0.3])
        XCTAssertEqual(sample.payload["a"], 1.0)
        XCTAssertEqual(sample.payload["b"], 0.0)
        XCTAssertEqual(sample.payload["c"], 0.0)
        XCTAssertEqual(sample.payload["d"], 0.3, accuracy: 1e-9)
    }

    /// HealthSource.norm maps a value into [0,1] against a range and clamps.
    func testHealthNormalization() {
        XCTAssertEqual(HealthSource.norm(40, (40, 180)), 0.0, accuracy: 1e-9)
        XCTAssertEqual(HealthSource.norm(180, (40, 180)), 1.0, accuracy: 1e-9)
        XCTAssertEqual(HealthSource.norm(110, (40, 180)), 0.5, accuracy: 0.01)
        XCTAssertEqual(HealthSource.norm(1000, (40, 180)), 1.0) // clamps high
        XCTAssertEqual(HealthSource.norm(0, (40, 180)), 0.0)    // clamps low
    }

    /// EWMA baseline: repeated identical values → zero variance → neutral (0.5)
    /// normalized deviation and zero z-score.
    func testBaselineNeutralOnConstantInput() {
        var b = EWMABaseline(halfLifeDays: 7)
        let start = Date(timeIntervalSince1970: 0)
        for i in 0..<12 {
            b.update(60, at: start.addingTimeInterval(Double(i) * 86_400))
        }
        XCTAssertEqual(b.zScore(60), 0.0, accuracy: 1e-9)
        XCTAssertEqual(b.normalizedDeviation(60), 0.5, accuracy: 1e-6)
    }

    /// EWMA baseline: after warming with varied data, values above the running
    /// mean produce positive z-scores (→ deviation > 0.5) and values below
    /// produce negative z-scores (→ deviation < 0.5).
    func testBaselineDeviationDirection() {
        var b = EWMABaseline(halfLifeDays: 7)
        let start = Date(timeIntervalSince1970: 0)
        let pattern: [Double] = [50, 60, 50, 60, 55, 65, 45, 58, 62, 48, 57, 61, 49, 59]
        for (i, v) in pattern.enumerated() {
            b.update(v, at: start.addingTimeInterval(Double(i) * 86_400))
        }
        XCTAssertGreaterThan(b.zScore(90), 0)
        XCTAssertLessThan(b.zScore(20), 0)
        let devHigh = b.normalizedDeviation(90)
        let devLow = b.normalizedDeviation(20)
        XCTAssertGreaterThan(devHigh, 0.5)
        XCTAssertLessThan(devLow, 0.5)
        for d in [devHigh, devLow] {
            XCTAssertGreaterThanOrEqual(d, 0)
            XCTAssertLessThanOrEqual(d, 1)
        }
    }

    /// The extractor's affective scalars are always within [0,1].
    func testAffectiveScalarsBounded() {
        let gen = SyntheticSignalGenerator(scenario: .excitedRestless, seed: 11)
        let extractor = FeatureExtractor()
        for s in gen.generate(count: 60) { extractor.ingest(s) }
        let state = extractor.currentState()
        for v in [state.arousal, state.attention, state.agitation, state.engagementDepth] {
            XCTAssertGreaterThanOrEqual(v, 0)
            XCTAssertLessThanOrEqual(v, 1)
        }
    }

    /// A calm/focused scenario should read as higher attention than an
    /// excited/restless one; the restless one should read as more agitated.
    func testScenarioSeparation() {
        func state(_ scenario: SyntheticSignalGenerator.Scenario) -> AffectiveState {
            let gen = SyntheticSignalGenerator(scenario: scenario, seed: 5)
            let ex = FeatureExtractor()
            for s in gen.generate(count: 60) { ex.ingest(s) }
            return ex.currentState()
        }
        let calm = state(.calmFocused)
        let restless = state(.excitedRestless)
        XCTAssertGreaterThan(calm.attention, restless.attention)
        XCTAssertGreaterThan(restless.agitation, calm.agitation)
    }
}
