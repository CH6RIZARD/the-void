import Foundation

/// Why a window was accepted or rejected.
enum GateDecision {
    case pass
    case rejectMotion
    case rejectArtifact
}

struct GateResult {
    let decision: GateDecision
    let motionEnergy: Double
    var passed: Bool { return decision == .pass }
}

/// Motion gate (port of Android MotionGate.kt). DISCARDS windows above the energy
/// threshold; never imputes a substitute value.
final class MotionGate {
    /// userAcceleration RMS (g) above which a window is rejected.
    static let defaultThreshold = 0.08
    /// Stricter stillness threshold for camera pulse (rPPG / HRV).
    static let stillThreshold = 0.035

    private let energyThreshold: Double

    init(energyThreshold: Double = MotionGate.defaultThreshold) {
        self.energyThreshold = energyThreshold
    }

    func evaluate(_ motionEnergy: Double) -> GateResult {
        guard motionEnergy.isFinite else {
            return GateResult(decision: .rejectArtifact, motionEnergy: motionEnergy)
        }
        if motionEnergy > energyThreshold {
            return GateResult(decision: .rejectMotion, motionEnergy: motionEnergy)
        }
        return GateResult(decision: .pass, motionEnergy: motionEnergy)
    }

    func isStill(_ motionEnergy: Double) -> Bool {
        return motionEnergy.isFinite && motionEnergy < MotionGate.stillThreshold
    }
}
