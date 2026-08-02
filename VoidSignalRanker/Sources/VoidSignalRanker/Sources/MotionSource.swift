import Foundation
#if canImport(CoreMotion) && os(iOS)
import CoreMotion
#endif

/// Motion signal source (CoreMotion).
///
/// Emits derived features:
/// - `motion.accel_variance`   — normalized variance of device acceleration
/// - `motion.gyro_jitter`      — normalized rotational jitter
/// - `motion.cadence`          — normalized pedometer cadence (steps/sec)
/// - `motion.activity_state`   — coarse activity encoded to [0,1]
///   (stationary=0, walking≈0.4, running≈0.8, automotive≈0.6, cycling≈0.7)
///
/// Raw accelerometer/gyro frames are consumed inside a rolling buffer and never
/// leave this object; only the derived, normalized scalars are emitted.
public final class MotionSource: SignalSource {

    public let id: SignalSourceID = .motion
    public var isEnabled: Bool = false { didSet { enabledChanged(oldValue) } }

    private let signal = SignalStream()
    public var samples: AsyncStream<SignalSample> { signal.stream }

    /// Expected physical maxima used for normalization. Tunable constants — NOT
    /// per-user thresholds (per-user baselining happens in `FeatureExtractor`).
    private let accelVarianceCeiling = 2.0      // (m/s^2)^2-ish in g units
    private let gyroJitterCeiling = 6.0         // rad/s summed magnitude
    private let cadenceCeiling = 3.0            // steps/sec (sprint ~ 3)

    #if canImport(CoreMotion) && os(iOS)
    private let motionManager = CMMotionManager()
    private let pedometer = CMPedometer()
    private let activityManager = CMMotionActivityManager()
    private let queue = OperationQueue()

    // Rolling buffers of the most recent samples for variance/jitter.
    private var accelWindow: [Double] = []
    private var gyroWindow: [Double] = []
    private let windowSize = 50 // ~1s at 50Hz

    private var latestCadence: Double = 0
    private var latestActivity: Double = 0

    public var isAvailable: Bool {
        motionManager.isDeviceMotionAvailable || motionManager.isAccelerometerAvailable
    }

    public init() {
        queue.maxConcurrentOperationCount = 1
    }

    public func start() {
        guard isActive else { return }

        if motionManager.isDeviceMotionAvailable {
            motionManager.deviceMotionUpdateInterval = 1.0 / 50.0
            motionManager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
                guard let self, let motion else { return }
                let a = motion.userAcceleration
                let accelMag = sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
                let r = motion.rotationRate
                let gyroMag = sqrt(r.x * r.x + r.y * r.y + r.z * r.z)
                self.ingest(accelMag: accelMag, gyroMag: gyroMag)
            }
        }

        if CMPedometer.isCadenceAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                guard let self, let data else { return }
                if let c = data.currentCadence?.doubleValue {
                    self.latestCadence = c
                }
            }
        }

        if CMMotionActivityManager.isActivityAvailable() {
            activityManager.startActivityUpdates(to: queue) { [weak self] activity in
                guard let self, let activity else { return }
                self.latestActivity = Self.encodeActivity(activity)
            }
        }
    }

    public func stop() {
        motionManager.stopDeviceMotionUpdates()
        pedometer.stopUpdates()
        activityManager.stopActivityUpdates()
        accelWindow.removeAll(keepingCapacity: true)
        gyroWindow.removeAll(keepingCapacity: true)
    }

    private func ingest(accelMag: Double, gyroMag: Double) {
        accelWindow.append(accelMag)
        gyroWindow.append(gyroMag)
        if accelWindow.count > windowSize { accelWindow.removeFirst(accelWindow.count - windowSize) }
        if gyroWindow.count > windowSize { gyroWindow.removeFirst(gyroWindow.count - windowSize) }

        // Emit at most one derived sample per full window to keep rates sane.
        guard accelWindow.count >= windowSize else { return }

        let accelVar = Self.variance(accelWindow)
        let gyroJitter = Self.variance(gyroWindow)

        let payload: [String: Double] = [
            "motion.accel_variance": accelVar / accelVarianceCeiling,
            "motion.gyro_jitter": gyroJitter / gyroJitterCeiling,
            "motion.cadence": latestCadence / cadenceCeiling,
            "motion.activity_state": latestActivity
        ]
        let scalars: [String: Double] = [
            "accel_variance_raw": accelVar,
            "gyro_jitter_raw": gyroJitter,
            "cadence_steps_per_sec": latestCadence
        ]
        signal.emit(SignalSample(sourceID: id, payload: payload, scalars: scalars))
        // Reset accumulation so windows don't overlap indefinitely.
        accelWindow.removeFirst(windowSize / 2)
        gyroWindow.removeFirst(gyroWindow.count > windowSize / 2 ? windowSize / 2 : 0)
    }

    private static func encodeActivity(_ activity: CMMotionActivity) -> Double {
        if activity.running { return 0.8 }
        if activity.cycling { return 0.7 }
        if activity.automotive { return 0.6 }
        if activity.walking { return 0.4 }
        if activity.stationary { return 0.0 }
        return 0.2 // unknown / low confidence
    }
    #else
    // Non-iOS / no CoreMotion: source exists but is never available.
    public init() {}
    public var isAvailable: Bool { false }
    public func start() {}
    public func stop() {}
    #endif

    /// Sample variance. Shared helper kept outside the platform guard so tests
    /// (which may build without CoreMotion) can still exercise it indirectly.
    static func variance(_ xs: [Double]) -> Double {
        guard xs.count > 1 else { return 0 }
        let mean = xs.reduce(0, +) / Double(xs.count)
        let ss = xs.reduce(0) { $0 + ($1 - mean) * ($1 - mean) }
        return ss / Double(xs.count - 1)
    }
}

extension MotionSource {
    fileprivate func enabledChanged(_ oldValue: Bool) {
        guard oldValue != isEnabled else { return }
        if isEnabled { start() } else { stop() }
    }
}
