import Foundation

/// Laplace local-DP mechanism on int8-quantized z-scores with a DAILY epsilon budget.
///
/// Sensitivity 8 int8 units (= ±0.25σ, enforced by clipping each emit's change against
/// the previous released trajectory), epsilon 1.0 per emit -> Laplace scale 8.
final class DPMechanism {
    static let sensitivity = 8.0
    static let epsilonPerEmit = 1.0
    /// Total epsilon per local day (6 h of 1 Hz emits); resets at local midnight.
    static let dailyBudget = 21_600.0

    private static let spentKey = "com.thevoid.sensing.dp.spent"
    private static let dayKey = "com.thevoid.sensing.dp.day"

    private let lock = NSLock()
    private var spent: Double
    private var day: String

    init() {
        let d = UserDefaults.standard
        spent = d.double(forKey: DPMechanism.spentKey)
        day = d.string(forKey: DPMechanism.dayKey) ?? ""
    }

    static func currentDay() -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)"
    }

    var remainingBudget: Double {
        lock.lock()
        defer { lock.unlock() }
        rollDayLocked()
        return DPMechanism.dailyBudget - spent
    }

    /// Spend one epsilon quantum; false when today's budget is exhausted.
    func trySpend() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        rollDayLocked()
        guard spent + DPMechanism.epsilonPerEmit <= DPMechanism.dailyBudget else { return false }
        spent += DPMechanism.epsilonPerEmit
        UserDefaults.standard.set(spent, forKey: DPMechanism.spentKey)
        return true
    }

    private func rollDayLocked() {
        let today = DPMechanism.currentDay()
        if today != day {
            day = today
            spent = 0
            UserDefaults.standard.set(today, forKey: DPMechanism.dayKey)
            UserDefaults.standard.set(0.0, forKey: DPMechanism.spentKey)
        }
    }

    /// Laplace(0, sensitivity / epsilon) sample via inverse CDF.
    func laplace() -> Double {
        let scale = DPMechanism.sensitivity / DPMechanism.epsilonPerEmit
        var u = Double.random(in: -0.5..<0.5)
        if abs(u) >= 0.4999999 { u = u < 0 ? -0.4999999 : 0.4999999 }
        let sign: Double = u < 0 ? -1 : 1
        return -scale * sign * log(1.0 - 2.0 * abs(u))
    }
}

/// The SINGLE exit point for affect data. Order (never reordered or bypassed):
/// consent -> kill switch -> estimate present -> daily budget -> quantize int8 ->
/// clip change to ±sensitivity -> Laplace noise -> dpApplied = true -> emit.
final class PrivacyGate {
    private let consent: ConsentManager
    private let killSwitch: KillSwitch
    private let dp: DPMechanism

    private let lock = NSLock()
    /// Previously released (pre-noise, clipped) int8 trajectory: valence, arousal, attention.
    private var trajectory: [Int]? = nil

    init(consent: ConsentManager, killSwitch: KillSwitch, dp: DPMechanism = DPMechanism()) {
        self.consent = consent
        self.killSwitch = killSwitch
        self.dp = dp
    }

    func resetTrajectory() {
        lock.lock()
        trajectory = nil
        lock.unlock()
    }

    /// Wire dictionary matching index.ts `AffectState`, or nil when any gate fails.
    func produce(_ local: AffectStateLocal, impressionId: String?) -> [String: Any]? {
        guard consent.snapshot().affectConsent else { return nil }
        guard killSwitch.isEnabled else { return nil }
        guard dp.trySpend() else { return nil }

        let q = [
            AffectStateLocal.quantizeZ(local.valenceZ),
            AffectStateLocal.quantizeZ(local.arousalZ),
            AffectStateLocal.quantizeZ(local.attentionZ),
        ]
        let s = Int(DPMechanism.sensitivity)

        lock.lock()
        let prev = trajectory ?? [0, 0, 0]
        var clipped = [0, 0, 0]
        for i in 0..<3 {
            let delta = Swift.max(-s, Swift.min(s, q[i] - prev[i]))
            clipped[i] = prev[i] + delta
        }
        trajectory = clipped
        lock.unlock()

        let noised = clipped.map { v -> Int in
            let n = (Double(v) + dp.laplace()).rounded()
            return Int(Swift.max(-128.0, Swift.min(127.0, n)))
        }

        var out: [String: Any] = [
            "valenceZ": noised[0],
            "arousalZ": noised[1],
            "attentionZ": noised[2],
            "confidence": Int((AffectStateLocal.clampedConfidence(local.confidenceUnit) * 100.0).rounded()),
            "sourceMask": local.sourceMask,
            "windowEndMs": Double(local.windowEndMs),
            "dpApplied": true,
        ]
        if let imp = impressionId { out["impressionId"] = imp }
        return out
    }
}
