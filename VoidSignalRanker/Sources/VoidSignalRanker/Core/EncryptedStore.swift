import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Persistence seam for the *only* data allowed to leave memory: DERIVED scalars
/// and learned model weights (baselines, bandit posterior, interest vectors).
///
/// PRIVACY CONTRACT (enforced by construction — see also the README):
/// - Raw sensor data (accelerometer/gyro buffers, raw HealthKit samples, ARKit
///   face geometry / blendshape frames) MUST NEVER be passed to an
///   `EncryptedStore`. Only aggregated, derived scalars and model parameters are
///   `Codable` here by design.
/// - Everything persisted through this seam is encrypted at rest.
/// - App Store Guideline 5.1.3: HealthKit-derived data is never used for
///   advertising or third-party targeting, and is never exported off-device.
public protocol EncryptedStore: AnyObject {
    func save<T: Encodable>(_ value: T, forKey key: String) throws
    func load<T: Decodable>(_ type: T.Type, forKey key: String) throws -> T?
    func remove(forKey key: String)
}

public enum EncryptedStoreError: Error {
    case cryptoUnavailable
    case encodingFailed(Error)
    case decodingFailed(Error)
}

/// Volatile store — keeps everything in memory only. Useful for tests, previews,
/// and the synthetic generator, and as the safe default when no keychain-backed
/// key is available. Nothing touches disk.
public final class InMemoryEncryptedStore: EncryptedStore {
    private var storage: [String: Data] = [:]
    private let lock = NSLock()

    public init() {}

    public func save<T: Encodable>(_ value: T, forKey key: String) throws {
        let data: Data
        do { data = try JSONEncoder().encode(value) }
        catch { throw EncryptedStoreError.encodingFailed(error) }
        lock.lock(); defer { lock.unlock() }
        storage[key] = data
    }

    public func load<T: Decodable>(_ type: T.Type, forKey key: String) throws -> T? {
        lock.lock()
        let data = storage[key]
        lock.unlock()
        guard let data else { return nil }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw EncryptedStoreError.decodingFailed(error) }
    }

    public func remove(forKey key: String) {
        lock.lock(); defer { lock.unlock() }
        storage[key] = nil
    }
}

#if canImport(CryptoKit)
/// Disk-backed store that AES-GCM encrypts every value before it is written.
///
/// The symmetric key should be provisioned from the Keychain (an app would fetch
/// a `SymmetricKey` protected by the Secure Enclave / device passcode). We accept
/// it via init to keep this type free of Keychain plumbing and easy to test.
///
/// Reminder: only derived scalars + model weights are ever handed to this type.
public final class CryptoKitEncryptedStore: EncryptedStore {

    private let key: SymmetricKey
    private let directory: URL
    private let fileManager = FileManager.default
    private let lock = NSLock()

    public init(key: SymmetricKey, directory: URL) throws {
        self.key = key
        self.directory = directory
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func url(for key: String) -> URL {
        // Namespaced, filesystem-safe file name.
        let safe = key.replacingOccurrences(of: "/", with: "_")
        return directory.appendingPathComponent("\(safe).vsr")
    }

    public func save<T: Encodable>(_ value: T, forKey storeKey: String) throws {
        let plaintext: Data
        do { plaintext = try JSONEncoder().encode(value) }
        catch { throw EncryptedStoreError.encodingFailed(error) }
        let sealed = try AES.GCM.seal(plaintext, using: key)
        guard let combined = sealed.combined else { throw EncryptedStoreError.cryptoUnavailable }
        lock.lock(); defer { lock.unlock() }
        try combined.write(to: url(for: storeKey), options: [.atomic, .completeFileProtection])
    }

    public func load<T: Decodable>(_ type: T.Type, forKey storeKey: String) throws -> T? {
        lock.lock()
        let fileURL = url(for: storeKey)
        let exists = fileManager.fileExists(atPath: fileURL.path)
        lock.unlock()
        guard exists else { return nil }
        let combined = try Data(contentsOf: fileURL)
        let box = try AES.GCM.SealedBox(combined: combined)
        let plaintext = try AES.GCM.open(box, using: key)
        do { return try JSONDecoder().decode(T.self, from: plaintext) }
        catch { throw EncryptedStoreError.decodingFailed(error) }
    }

    public func remove(forKey storeKey: String) {
        lock.lock(); defer { lock.unlock() }
        try? fileManager.removeItem(at: url(for: storeKey))
    }
}
#endif
