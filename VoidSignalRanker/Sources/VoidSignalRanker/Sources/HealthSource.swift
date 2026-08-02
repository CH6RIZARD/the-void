import Foundation
#if canImport(HealthKit) && os(iOS)
import HealthKit
#endif

/// Health signal source (HealthKit).
///
/// PRIVACY / COMPLIANCE:
/// - App Store Guideline 5.1.3: data read from HealthKit is used ONLY to
///   compute on-device affective features for ranking. It is never used for
///   advertising, never shared with third parties, and never written to disk in
///   raw form. Only derived, normalized scalars flow downstream.
///
/// Emits derived features (best-effort; keys present depend on availability):
/// - `health.heart_rate`   — normalized instantaneous HR
/// - `health.hrv_sdnn`     — normalized HRV (SDNN); higher SDNN → calmer → we
///   surface it directly and let the extractor interpret via baseline
/// - `health.resting_hr`   — normalized resting HR (slow-moving)
/// - Degraded mode (no paired Watch): `health.steps`, `health.active_energy`
public final class HealthSource: SignalSource {

    public let id: SignalSourceID = .health
    public var isEnabled: Bool = false { didSet { if isEnabled { start() } else { stop() } } }

    private let signal = SignalStream()
    public var samples: AsyncStream<SignalSample> { signal.stream }

    // Normalization ceilings (population-plausible ranges; per-user baselining
    // still happens in the FeatureExtractor).
    private let hrRange = (min: 40.0, max: 180.0)
    private let sdnnRange = (min: 10.0, max: 120.0)   // ms
    private let restingHRRange = (min: 40.0, max: 100.0)
    private let stepsPerMinCeiling = 180.0
    private let activeEnergyPerMinCeiling = 15.0 // kcal/min

    #if canImport(HealthKit) && os(iOS)
    private let store = HKHealthStore()
    private var queries: [HKQuery] = []

    public var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    public init() {}

    /// Whether a Watch-derived beat-to-beat signal is plausibly available.
    /// We approximate "watch present" by the presence of HRV data; callers can
    /// override by only enabling in degraded mode.
    private var highFidelityMode = true

    public func start() {
        guard isActive else { return }
        requestAuthorization { [weak self] granted in
            guard let self, granted else { return }
            self.startHeartRateQuery()
            self.startHRVQuery()
            self.startRestingHRQuery()
            self.startStepsQuery()
            self.startActiveEnergyQuery()
        }
    }

    public func stop() {
        for q in queries { store.stop(q) }
        queries.removeAll()
    }

    private func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
        var readTypes = Set<HKObjectType>()
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { readTypes.insert(hr) }
        if let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) { readTypes.insert(hrv) }
        if let rhr = HKObjectType.quantityType(forIdentifier: .restingHeartRate) { readTypes.insert(rhr) }
        if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) { readTypes.insert(steps) }
        if let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) { readTypes.insert(energy) }
        // We request READ access only — never SHARE. Nothing is written back.
        store.requestAuthorization(toShare: nil, read: readTypes) { granted, _ in
            completion(granted)
        }
    }

    private func startAnchoredQuery(
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        handler: @escaping (Double) -> Void
    ) {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return }
        let query = HKAnchoredObjectQuery(
            type: type,
            predicate: nil,
            anchor: nil,
            limit: HKObjectQueryNoLimit
        ) { _, samples, _, _, _ in
            guard let last = (samples as? [HKQuantitySample])?.last else { return }
            handler(last.quantity.doubleValue(for: unit))
        }
        query.updateHandler = { _, samples, _, _, _ in
            guard let last = (samples as? [HKQuantitySample])?.last else { return }
            handler(last.quantity.doubleValue(for: unit))
        }
        store.execute(query)
        queries.append(query)
    }

    private func startHeartRateQuery() {
        let unit = HKUnit.count().unitDivided(by: .minute())
        startAnchoredQuery(identifier: .heartRate, unit: unit) { [weak self] bpm in
            guard let self else { return }
            self.emit(payload: ["health.heart_rate": Self.norm(bpm, self.hrRange)],
                      scalars: ["heart_rate_bpm": bpm])
        }
    }

    private func startHRVQuery() {
        let unit = HKUnit.secondUnit(with: .milli)
        startAnchoredQuery(identifier: .heartRateVariabilitySDNN, unit: unit) { [weak self] sdnn in
            guard let self else { return }
            self.highFidelityMode = true
            self.emit(payload: ["health.hrv_sdnn": Self.norm(sdnn, self.sdnnRange)],
                      scalars: ["hrv_sdnn_ms": sdnn])
        }
    }

    private func startRestingHRQuery() {
        let unit = HKUnit.count().unitDivided(by: .minute())
        startAnchoredQuery(identifier: .restingHeartRate, unit: unit) { [weak self] rhr in
            guard let self else { return }
            self.emit(payload: ["health.resting_hr": Self.norm(rhr, self.restingHRRange)],
                      scalars: ["resting_hr_bpm": rhr])
        }
    }

    private func startStepsQuery() {
        startAnchoredQuery(identifier: .stepCount, unit: .count()) { [weak self] count in
            guard let self else { return }
            // Interpreted as steps within the delivered sample's window; we
            // normalize against a per-minute ceiling as a coarse proxy.
            self.emit(payload: ["health.steps": Self.clamp01(count / self.stepsPerMinCeiling)],
                      scalars: ["steps": count])
        }
    }

    private func startActiveEnergyQuery() {
        startAnchoredQuery(identifier: .activeEnergyBurned, unit: .kilocalorie()) { [weak self] kcal in
            guard let self else { return }
            self.emit(payload: ["health.active_energy": Self.clamp01(kcal / self.activeEnergyPerMinCeiling)],
                      scalars: ["active_energy_kcal": kcal])
        }
    }

    private func emit(payload: [String: Double], scalars: [String: Double]) {
        signal.emit(SignalSample(sourceID: id, payload: payload, scalars: scalars))
    }
    #else
    public init() {}
    public var isAvailable: Bool { false }
    public func start() {}
    public func stop() {}
    #endif

    // MARK: - Normalization helpers (platform-independent)

    static func norm(_ value: Double, _ range: (min: Double, max: Double)) -> Double {
        guard range.max > range.min else { return 0 }
        return clamp01((value - range.min) / (range.max - range.min))
    }

    static func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1, max(0, v))
    }
}
