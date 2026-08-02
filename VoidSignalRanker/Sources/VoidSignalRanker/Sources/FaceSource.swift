import Foundation
#if canImport(ARKit) && os(iOS)
import ARKit
#endif

/// Face signal source (ARKit `ARFaceTrackingConfiguration`).
///
/// STRICT PRIVACY POSTURE:
/// - OPT-IN only. `isEnabled` must be explicitly set by the user after an
///   in-context explanation.
/// - SESSION-SCOPED. Nothing derived from the face is ever persisted — not raw
///   geometry, not blendshapes, not even the aggregated scalars. This source
///   emits only into the in-memory stream; the `FeatureExtractor` may use the
///   values live, but they must never reach an `EncryptedStore`.
/// - Raw ARKit face geometry / blendshape frames are consumed inside the
///   delegate and immediately reduced to a handful of normalized scalars.
///
/// Emits derived features:
/// - `face.blink_rate`   — normalized blinks/min
/// - `face.gaze_dwell`   — normalized stability of the gaze direction (1 = very
///   steady dwell, 0 = darting)
/// - `face.brow_tension` — normalized brow blendshape activation
/// - `face.jaw_tension`  — normalized jaw clench blendshape activation
public final class FaceSource: NSObject, SignalSource {

    public let id: SignalSourceID = .face
    public var isEnabled: Bool = false { didSet { if isEnabled { start() } else { stop() } } }

    private let signal = SignalStream()
    public var samples: AsyncStream<SignalSample> { signal.stream }

    private let blinkRateCeiling = 40.0 // blinks/min considered "high"

    #if canImport(ARKit) && os(iOS)
    private let session = ARSession()

    // Session-scoped, in-memory only. Cleared on stop().
    private var blinkTimestamps: [Date] = []
    private var lastLeftBlinkClosed = false
    private var lastRightBlinkClosed = false
    private var gazeHistory: [SIMD3<Float>] = []
    private let gazeWindow = 30

    public var isAvailable: Bool { ARFaceTrackingConfiguration.isSupported }

    public override init() {
        super.init()
        session.delegate = self
    }

    public func start() {
        guard isActive else { return }
        let config = ARFaceTrackingConfiguration()
        config.isLightEstimationEnabled = false
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    public func stop() {
        session.pause()
        // Session-scoped wipe: no face-derived data survives a stop.
        blinkTimestamps.removeAll()
        gazeHistory.removeAll()
    }

    private func process(_ face: ARFaceAnchor) {
        let now = Date()
        let blend = face.blendShapes

        // Blink detection via rising edge of eye-blink blendshapes.
        let leftClosed = (blend[.eyeBlinkLeft]?.doubleValue ?? 0) > 0.6
        let rightClosed = (blend[.eyeBlinkRight]?.doubleValue ?? 0) > 0.6
        if (leftClosed && !lastLeftBlinkClosed) || (rightClosed && !lastRightBlinkClosed) {
            blinkTimestamps.append(now)
        }
        lastLeftBlinkClosed = leftClosed
        lastRightBlinkClosed = rightClosed
        // Keep only the last 60s of blinks.
        blinkTimestamps.removeAll { now.timeIntervalSince($0) > 60 }
        let blinksPerMin = Double(blinkTimestamps.count)

        // Gaze dwell: variance of the look-at direction over the recent window.
        let look = face.lookAtPoint
        gazeHistory.append(look)
        if gazeHistory.count > gazeWindow { gazeHistory.removeFirst(gazeHistory.count - gazeWindow) }
        let gazeDwell = Self.gazeStability(gazeHistory)

        let brow = max(blend[.browDownLeft]?.doubleValue ?? 0,
                       blend[.browDownRight]?.doubleValue ?? 0)
        let jaw = max(blend[.jawForward]?.doubleValue ?? 0,
                      blend[.mouthPressLeft]?.doubleValue ?? 0,
                      blend[.mouthPressRight]?.doubleValue ?? 0)

        let payload: [String: Double] = [
            "face.blink_rate": FaceSource.clamp01(blinksPerMin / blinkRateCeiling),
            "face.gaze_dwell": gazeDwell,
            "face.brow_tension": FaceSource.clamp01(brow),
            "face.jaw_tension": FaceSource.clamp01(jaw)
        ]
        // NOTE: deliberately NO scalars persisted for face — even derived scalars
        // are session-only here, so we keep them out of the `scalars` bag that
        // baselines might otherwise want to store.
        signal.emit(SignalSample(sourceID: id, payload: payload, scalars: [:]))
    }

    static func gazeStability(_ history: [SIMD3<Float>]) -> Double {
        guard history.count > 2 else { return 1.0 }
        let n = Float(history.count)
        var mean = SIMD3<Float>(repeating: 0)
        for v in history { mean += v }
        mean /= n
        var varSum: Float = 0
        for v in history {
            let d = v - mean
            varSum += simd_dot(d, d)
        }
        let variance = Double(varSum / n)
        // Map variance → stability in [0,1]; small variance → near 1.
        return clamp01(1.0 / (1.0 + variance * 50.0))
    }
    #else
    public override init() { super.init() }
    public var isAvailable: Bool { false }
    public func start() {}
    public func stop() {}
    #endif

    static func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1, max(0, v))
    }
}

#if canImport(ARKit) && os(iOS)
extension FaceSource: ARSessionDelegate {
    public func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        for anchor in anchors {
            if let face = anchor as? ARFaceAnchor {
                process(face)
            }
        }
    }
}
#endif
