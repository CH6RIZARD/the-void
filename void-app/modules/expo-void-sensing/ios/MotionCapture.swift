import Foundation
import CoreMotion

/// Tier-0 motion capture: raw CMMotionManager deviceMotion at 50 Hz into a 60 s ring.
/// Raw deviceMotion needs no NSMotionUsageDescription (no CMMotionActivity used).
/// Samples are device-local and never cross the bridge.
final class MotionCapture {
    static let sampleRateHz = 50.0
    static let capacity = 3000 // 60 s @ 50 Hz
    static let energyWindowSeconds = 2.0

    struct Energy {
        /// RMS of userAcceleration magnitude (g) over the trailing window.
        let accelRMS: Double
        /// RMS of rotationRate magnitude (rad/s) over the trailing window.
        let rotationRMS: Double
        let samples: Int
    }

    private struct Sample {
        var t: Double
        var accelSq: Double
        var rotSq: Double
    }

    private let manager = CMMotionManager()
    private let queue: OperationQueue
    private let lock = NSLock()
    private var ring: [Sample]
    private var writeIndex = 0
    private var count = 0
    private var running = false

    init() {
        let q = OperationQueue()
        q.name = "com.thevoid.sensing.motion"
        q.maxConcurrentOperationCount = 1
        q.qualityOfService = .utility
        queue = q
        ring = Array(repeating: Sample(t: 0, accelSq: 0, rotSq: 0), count: MotionCapture.capacity)
    }

    var isAvailable: Bool { return manager.isDeviceMotionAvailable }

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    func start() {
        lock.lock()
        let already = running
        if !already { running = true }
        lock.unlock()
        guard !already else { return }
        guard manager.isDeviceMotionAvailable else {
            lock.lock(); running = false; lock.unlock()
            return
        }
        manager.deviceMotionUpdateInterval = 1.0 / MotionCapture.sampleRateHz
        manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
            guard let self = self, let m = motion else { return }
            let a = m.userAcceleration
            let r = m.rotationRate
            self.ingest(Sample(
                t: m.timestamp,
                accelSq: a.x * a.x + a.y * a.y + a.z * a.z,
                rotSq: r.x * r.x + r.y * r.y + r.z * r.z
            ))
        }
    }

    func stop() {
        lock.lock()
        let wasRunning = running
        running = false
        count = 0
        writeIndex = 0
        lock.unlock()
        if wasRunning { manager.stopDeviceMotionUpdates() }
    }

    private func ingest(_ s: Sample) {
        lock.lock()
        ring[writeIndex] = s
        writeIndex = (writeIndex + 1) % MotionCapture.capacity
        if count < MotionCapture.capacity { count += 1 }
        lock.unlock()
    }

    /// Energy over the trailing 2 s, or nil when there are no fresh samples.
    func energy(windowSeconds: Double = MotionCapture.energyWindowSeconds) -> Energy? {
        lock.lock()
        defer { lock.unlock() }
        guard count > 0 else { return nil }
        let cap = MotionCapture.capacity
        let newestIdx = (writeIndex - 1 + cap) % cap
        let newest = ring[newestIdx].t
        // deviceMotion timestamps share the systemUptime time base.
        if ProcessInfo.processInfo.systemUptime - newest > 1.5 { return nil }
        let cutoff = newest - windowSeconds
        var sumA = 0.0
        var sumR = 0.0
        var n = 0
        var i = 0
        while i < count {
            let s = ring[(newestIdx - i + cap) % cap]
            if s.t < cutoff { break }
            sumA += s.accelSq
            sumR += s.rotSq
            n += 1
            i += 1
        }
        guard n > 0 else { return nil }
        return Energy(accelRMS: (sumA / Double(n)).squareRoot(),
                      rotationRMS: (sumR / Double(n)).squareRoot(),
                      samples: n)
    }
}
