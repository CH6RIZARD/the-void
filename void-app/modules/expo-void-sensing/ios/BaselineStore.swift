import Foundation
import CryptoKit

/// Immutable snapshot of one per-user (signal, circadian bucket) baseline.
struct Baseline {
    let count: Int
    let mean: Double
    let variance: Double
    let firstSeenMs: Int64
    let lastSeenMs: Int64

    var standardDeviation: Double { return variance > 0 ? variance.squareRoot() : 0 }
    /// Warm after 30 samples (no minimum days).
    var isWarm: Bool { return count >= BaselineStore.warmMinCount }
    /// Confidence multiplier: min(1, samples / 200).
    var confidenceFactor: Double {
        return Swift.min(1.0, Double(count) / Double(BaselineStore.fullConfidenceCount))
    }
}

/// Per-user rolling baselines: weighted Welford accumulation, 28-day exponential decay,
/// 6 x 4-hour circadian buckets. Persisted on-device only, AES-GCM encrypted with a
/// key held in the Keychain (this-device-only). Port of Android BaselineStore.kt with
/// the plan's warm-up (30 samples, no min days).
final class BaselineStore {
    static let warmMinCount = 30
    static let fullConfidenceCount = 200
    static let decayTauSeconds = 28.0 * 86_400.0
    static let bucketCount = 6
    static let persistIntervalMs: Int64 = 30_000

    private static let keyAccount = "baseline.key.v1"
    private static let fileName = "baselines.v1.bin"

    private struct Accumulator: Codable {
        var weightSum: Double = 0
        var mean: Double = 0
        var s: Double = 0
        var count: Int = 0
        var firstSeenMs: Int64? = nil
        var lastSeenMs: Int64? = nil

        mutating func decay(toMs: Int64, tau: Double) {
            guard let last = lastSeenMs else { return }
            let dt = Double(toMs - last) / 1000.0
            guard dt > 0 else { return }
            let lambda = exp(-dt / tau)
            weightSum *= lambda
            s *= lambda
        }

        mutating func add(_ x: Double, weight: Double, atMs: Int64) {
            if firstSeenMs == nil { firstSeenMs = atMs }
            let newW = weightSum + weight
            let delta = x - mean
            let newMean = mean + (weight / newW) * delta
            s += weight * delta * (x - newMean)
            mean = newMean
            weightSum = newW
            count += 1
            lastSeenMs = atMs
        }

        var variance: Double { return weightSum > 0 ? Swift.max(0, s / weightSum) : 0 }

        func snapshot() -> Baseline? {
            guard let f = firstSeenMs, let l = lastSeenMs else { return nil }
            return Baseline(count: count, mean: mean, variance: variance, firstSeenMs: f, lastSeenMs: l)
        }
    }

    private let lock = NSLock()
    private var accumulators: [String: Accumulator] = [:]
    private var dirty = false
    private var lastPersistMs: Int64 = 0

    init() {
        restore()
    }

    static func circadianBucket(atMs: Int64) -> Int {
        let date = Date(timeIntervalSince1970: Double(atMs) / 1000.0)
        let hour = Calendar.current.component(.hour, from: date)
        return Swift.min(bucketCount - 1, Swift.max(0, hour / 4))
    }

    private func key(_ signal: String, _ atMs: Int64) -> String {
        return "\(signal)#\(BaselineStore.circadianBucket(atMs: atMs))"
    }

    /// Fold one observation into its bucket.
    func update(_ signal: String, value: Double, atMs: Int64) {
        guard value.isFinite else { return }
        lock.lock()
        defer { lock.unlock() }
        let k = key(signal, atMs)
        var acc = accumulators[k] ?? Accumulator()
        acc.decay(toMs: atMs, tau: BaselineStore.decayTauSeconds)
        acc.add(value, weight: 1.0, atMs: atMs)
        accumulators[k] = acc
        dirty = true
        if atMs - lastPersistMs >= BaselineStore.persistIntervalMs {
            persistLocked(nowMs: atMs)
        }
    }

    func baseline(_ signal: String, atMs: Int64) -> Baseline? {
        lock.lock()
        defer { lock.unlock() }
        return accumulators[key(signal, atMs)]?.snapshot()
    }

    /// Per-user z-score; nil until the bucket is warm (never an absolute value).
    func z(_ signal: String, value: Double, atMs: Int64) -> Double? {
        guard value.isFinite, let b = baseline(signal, atMs: atMs), b.isWarm else { return nil }
        let sd = b.standardDeviation
        guard sd > 1e-9 else { return nil }
        return (value - b.mean) / sd
    }

    /// Update then read back: (z or nil, confidence factor of the bucket).
    func observe(_ signal: String, value: Double, atMs: Int64) -> (z: Double?, factor: Double) {
        update(signal, value: value, atMs: atMs)
        let factor = baseline(signal, atMs: atMs)?.confidenceFactor ?? 0
        return (z(signal, value: value, atMs: atMs), factor)
    }

    func flush() {
        lock.lock()
        defer { lock.unlock() }
        if dirty { persistLocked(nowMs: vsNowMs()) }
    }

    /// Erase all baselines (in memory and on disk).
    func wipe() {
        lock.lock()
        defer { lock.unlock() }
        accumulators.removeAll()
        dirty = false
        if let url = BaselineStore.fileURL() { try? FileManager.default.removeItem(at: url) }
    }

    // MARK: - Encrypted persistence

    private static func fileURL() -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let folder = dir.appendingPathComponent("VoidSensing", isDirectory: true)
        if !FileManager.default.fileExists(atPath: folder.path) {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
        }
        return folder.appendingPathComponent(fileName)
    }

    private static func symmetricKey() -> SymmetricKey? {
        if let data = VoidKeychain.read(keyAccount), data.count == 32 {
            return SymmetricKey(data: data)
        }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        guard VoidKeychain.write(data, account: keyAccount) else { return nil }
        return key
    }

    private func persistLocked(nowMs: Int64) {
        lastPersistMs = nowMs
        guard let url = BaselineStore.fileURL(), let key = BaselineStore.symmetricKey() else { return }
        do {
            let plain = try JSONEncoder().encode(accumulators)
            let sealed = try AES.GCM.seal(plain, using: key)
            guard let combined = sealed.combined else { return }
            try combined.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            dirty = false
        } catch {
            // In-memory state remains authoritative.
        }
    }

    private func restore() {
        guard let url = BaselineStore.fileURL(),
              let blob = try? Data(contentsOf: url) else { return }
        guard let keyData = VoidKeychain.read(BaselineStore.keyAccount), keyData.count == 32 else {
            // Key lost (e.g. reinstall wipe): the ciphertext is unreadable; start cold.
            try? FileManager.default.removeItem(at: url)
            return
        }
        do {
            let box = try AES.GCM.SealedBox(combined: blob)
            let plain = try AES.GCM.open(box, using: SymmetricKey(data: keyData))
            let decoded = try JSONDecoder().decode([String: Accumulator].self, from: plain)
            lock.lock()
            accumulators = decoded
            lock.unlock()
        } catch {
            // Corrupt -> start cold (z() returns nil until warm).
        }
    }
}
