import ExpoModulesCore
import Foundation

#if canImport(CoreMotion)
import CoreMotion
#endif
#if canImport(CoreML)
import CoreML
#endif

// See AffectMapping.swift for the VoidSensing linkage note: those sources are
// vendored into THIS pod target, so their public types are directly in scope
// (no `import VoidSensing`).

/// Drives the already-built VoidSensing pipeline and exposes ONLY its quantized,
/// DP-noised `AffectState` projection to JS. This is a thin adapter:
///
///   Capture (Motion/PPG/Face/Touch) → BaselineStore z-scoring → MotionGate
///     → AffectEstimating → [consent + kill-switch + DP gate] → wire AffectState
///
/// INVARIANT #1: raw MotionSample / PPGReading / FaceFrame / AffectWindow NEVER
/// leave this class. The only value that crosses the bridge is the `[String: Any]`
/// produced by `AffectMapping.wire(...)`.
final class VoidSensingController: @unchecked Sendable {
    static let shared = VoidSensingController()

    // MARK: State (guarded by `lock`)
    private let lock = NSLock()

    private var affectConsent = false
    private var perTier: [String: Bool] = [
        "motion": false, "touch": false, "ppg": false, "face": false, "health": false,
    ]
    /// DSA Art.38: a one-tap non-biometric feed is ALWAYS available.
    private let nonBiometricFeed = true

    /// Kill switch. `true` = sensing permitted (switch in the ON position);
    /// `false` = killed → emit returns nil and capture stops (index.ts contract).
    private var killSwitchEnabled = true

    private var running = false

    /// The precise device-local estimate. NEVER emitted as-is — only its
    /// `AffectMapping.wire(...)` projection may cross the bridge.
    private var latestLocal: AffectState?

    /// Impression spans for on-device lag-aligned Attribution (T1.7). Device-local.
    private var impressions: [(id: String, itemId: String, startMs: UInt64)] = []

    // MARK: Pipeline (immutable; each is internally thread-safe or a value type)
    private let motion = MotionCapture()
    private let ppg = PPGCapture()
    private let face = FaceCapture()
    private let touch = TouchCapture()
    private let baselines = BaselineStore()
    private let gate = MotionGate()
    private let attribution = Attribution()
    private let estimator: AffectEstimating

    /// DP budget placeholder; the real budget is owned by the PrivacyGate (T1.9).
    private let dpEpsilon = 1.0

    private let queue = DispatchQueue(label: "com.thevoid.sensing.controller")
    private var timer: DispatchSourceTimer?

    /// Set by the module; receives already-gated + DP-noised wire dictionaries.
    var onAffect: (([String: Any]) -> Void)?

    private init() {
        #if canImport(CoreML)
        // Loads the bundled quantized model if present; otherwise a nil-model
        // estimator that returns nil (no fabricated output until the model ships).
        let url = Bundle.main.url(forResource: "AffectModel", withExtension: "mlmodelc")
        self.estimator = CoreMLAffectEstimator.load(from: url)
        #else
        self.estimator = HeuristicAffectEstimator()
        #endif
    }

    // MARK: - Availability

    func isAvailable() -> Bool {
        #if canImport(CoreMotion)
        return true
        #else
        return false
        #endif
    }

    // MARK: - Consent

    /// Records per-tier consent for the requested tiers. The user-facing modal is
    /// the PrivacyGate's responsibility (T1.9 / index.ts); this adapter persists
    /// the resulting grant and returns the new state. Unknown tiers are ignored.
    func requestConsent(tiers: [String]) -> [String: Any] {
        lock.lock()
        for tier in tiers where perTier[tier] != nil {
            perTier[tier] = true
        }
        affectConsent = perTier.values.contains(true)
        let snapshot = consentSnapshotLocked()
        lock.unlock()
        return snapshot
    }

    func getConsent() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return consentSnapshotLocked()
    }

    private func consentSnapshotLocked() -> [String: Any] {
        AffectMapping.consentWire(affectConsent: affectConsent,
                                  perTier: perTier,
                                  nonBiometricFeed: nonBiometricFeed)
    }

    // MARK: - Kill switch

    func setKillSwitch(enabled: Bool) {
        lock.lock()
        killSwitchEnabled = enabled
        let mustStop = !enabled
        lock.unlock()
        if mustStop { stop() }
    }

    // MARK: - Lifecycle

    /// Begin capture for consented tiers. No-op when unconsented, killed, or
    /// already running (index.ts contract).
    func start() {
        lock.lock()
        guard affectConsent, killSwitchEnabled, !running else {
            lock.unlock()
            return
        }
        running = true
        let motionConsented = perTier["motion"] == true
        lock.unlock()

        // Tier-0 motion drives both gating and the motion baseline. Higher tiers
        // (PPG/Face) require explicit foreground UI and are started by their own
        // screens; they remain no-ops here when unconsented/unavailable.
        if motionConsented {
            motion.start()
        }
        startTimer()
    }

    func stop() {
        lock.lock()
        running = false
        latestLocal = nil
        lock.unlock()

        motion.stop()
        stopTimer()
    }

    // MARK: - Latest estimate (wire projection only)

    /// Latest gated + DP-noised wire AffectState, or nil. Nil is the EXPECTED
    /// default and covers: no consent, kill-switch off, baseline not warm,
    /// motion-gated, or no model shipped.
    func currentWire() -> [String: Any]? {
        lock.lock()
        let permitted = affectConsent && killSwitchEnabled
        let local = latestLocal
        lock.unlock()
        guard permitted, let local else { return nil }
        return AffectMapping.wire(from: local, dpEpsilon: dpEpsilon)
    }

    // MARK: - Attribution

    /// Associate a shown item with an impression id so on-device Attribution can
    /// lag-align physiological reads (T1.7). Spans stay device-local.
    func markImpression(impressionId: String, itemId: String) {
        let ms = UInt64(Date().timeIntervalSince1970 * 1000.0)
        lock.lock()
        impressions.append((id: impressionId, itemId: itemId, startMs: ms))
        if impressions.count > 256 {
            impressions.removeFirst(impressions.count - 256)
        }
        lock.unlock()
    }

    // MARK: - Timer loop

    private func startTimer() {
        queue.async { [weak self] in
            guard let self else { return }
            let t = DispatchSource.makeTimerSource(queue: self.queue)
            t.schedule(deadline: .now() + 1.0, repeating: 1.0)
            t.setEventHandler { [weak self] in self?.tick() }
            self.timer?.cancel()
            self.timer = t
            t.resume()
        }
    }

    private func stopTimer() {
        queue.async { [weak self] in
            self?.timer?.cancel()
            self?.timer = nil
        }
    }

    /// One pipeline pass: gate → baseline z-score → estimate → route via privacy gate.
    private func tick() {
        lock.lock()
        let permitted = affectConsent && killSwitchEnabled && running
        lock.unlock()
        guard permitted else {
            setLatest(nil)
            return
        }

        // Motion gate: any window with motion energy above threshold is DISCARDED,
        // never imputed (invariant #5).
        let energy = motion.motionEnergy
        let decision = gate.evaluate(motionEnergy: energy)
        guard decision.passed else {
            setLatest(nil)
            return
        }

        let now = Date()
        let nowMs = UInt64(now.timeIntervalSince1970 * 1000.0)

        // Fold motion energy into its per-user, per-circadian-bucket baseline and
        // read back the z-score. `z(...)` returns nil until the bucket is warm, so
        // `baselineWarm` is false during cold-start and the estimator returns nil.
        baselines.update(signal: "motionEnergy", value: energy, at: now)
        let motionZ = baselines.z(signal: "motionEnergy", value: energy, at: now)
        let warm = motionZ != nil

        var mask: UInt32 = 0
        if warm { mask |= AffectSource.motion }

        let window = AffectWindow(
            windowEndMs: nowMs,
            sourceMask: mask,
            baselineWarm: warm,
            hrZ: [],
            hrvZ: [],
            motionZ: motionZ.map { [$0] } ?? [],
            blendshapeValenceZ: [],
            attentionZ: [],
            trackingQualityMean: 0
        )

        // Estimator returns nil unless baselines are warm AND a model is present.
        let local = estimator.estimate(window: window)
        setLatest(local)
    }

    /// Store the device-local estimate and, when the privacy gate allows, emit its
    /// quantized + DP-noised wire projection. This is the SINGLE emission point.
    private func setLatest(_ state: AffectState?) {
        lock.lock()
        latestLocal = state
        let permitted = affectConsent && killSwitchEnabled
        lock.unlock()

        guard permitted, let state else { return }
        let wire = AffectMapping.wire(from: state, dpEpsilon: dpEpsilon)
        onAffect?(wire)
    }
}

/// The ONLY bridge between the native sensing/affect pipeline and JS.
/// Mirrors the contract in `index.ts` exactly.
public final class ExpoVoidSensingModule: Module {
    private let controller = VoidSensingController.shared

    public func definition() -> ModuleDefinition {
        Name("ExpoVoidSensing")

        Events("onAffect")

        OnCreate {
            self.controller.onAffect = { [weak self] payload in
                // `sendEvent` takes [String: Any?]; widen the concrete [String: Any].
                self?.sendEvent("onAffect", payload.mapValues { $0 as Any? })
            }
        }

        OnDestroy {
            self.controller.onAffect = nil
        }

        Function("isAvailable") { () -> Bool in
            self.controller.isAvailable()
        }

        AsyncFunction("requestConsent") { (tiers: [String]) -> [String: Any] in
            self.controller.requestConsent(tiers: tiers)
        }

        Function("getConsent") { () -> [String: Any] in
            self.controller.getConsent()
        }

        Function("setKillSwitch") { (enabled: Bool) in
            self.controller.setKillSwitch(enabled: enabled)
        }

        AsyncFunction("start") { () -> Void in
            self.controller.start()
        }

        AsyncFunction("stop") { () -> Void in
            self.controller.stop()
        }

        // Optional wire AffectState. Nil (→ JS null) is the EXPECTED default.
        Function("getAffectState") { () -> [String: Any]? in
            self.controller.currentWire()
        }

        Function("markImpression") { (impressionId: String, itemId: String) in
            self.controller.markImpression(impressionId: impressionId, itemId: itemId)
        }
    }
}
