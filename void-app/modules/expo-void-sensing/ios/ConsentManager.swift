import Foundation

/// Consentable sensor tiers (index.ts `SensorTier`).
enum SensorTier: String, CaseIterable {
    case motion
    case touch
    case face
    case ppg
    case ble
}

/// Device-local consent snapshot (index.ts `ConsentState`).
struct ConsentSnapshot {
    let tiers: Set<SensorTier>
    let hasChosen: Bool
    let nonBiometricFeed: Bool

    func has(_ tier: SensorTier) -> Bool { return tiers.contains(tier) }

    /// Any camera/BLE tier, or motion + touch together.
    var affectConsent: Bool {
        return has(.face) || has(.ppg) || has(.ble) || (has(.motion) && has(.touch))
    }

    func toDictionary() -> [String: Any] {
        var perTier: [String: Bool] = [:]
        for t in SensorTier.allCases { perTier[t.rawValue] = tiers.contains(t) }
        return [
            "affectConsent": affectConsent,
            "perTier": perTier,
            "nonBiometricFeed": nonBiometricFeed,
            "hasChosen": hasChosen,
        ]
    }
}

/// Explicit, unbundled, per-tier consent ledger persisted in the Keychain
/// (this-device-only). This is the app's own record, distinct from OS permissions.
final class ConsentManager {
    private struct Stored: Codable {
        var tiers: [String]
        var hasChosen: Bool
        var nonBiometricFeed: Bool
    }

    private static let account = "consent.v1"

    private let lock = NSLock()
    private var tiers: Set<SensorTier> = []
    private var hasChosen = false
    private var nonBiometricFeed = false

    init() {
        if let data = VoidKeychain.read(ConsentManager.account),
           let stored = try? JSONDecoder().decode(Stored.self, from: data) {
            tiers = Set(stored.tiers.compactMap { SensorTier(rawValue: $0) })
            hasChosen = stored.hasChosen
            nonBiometricFeed = stored.nonBiometricFeed
        }
    }

    static func parse(_ raw: [String]) -> [SensorTier] {
        return raw.compactMap { SensorTier(rawValue: $0.lowercased()) }
    }

    func snapshot() -> ConsentSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return snapshotLocked()
    }

    /// Additive grant. The user has now chosen; the feed is biometric iff any tier holds.
    func grant(_ newTiers: [SensorTier]) -> ConsentSnapshot {
        lock.lock()
        defer { lock.unlock() }
        tiers.formUnion(newTiers)
        hasChosen = true
        nonBiometricFeed = tiers.isEmpty
        persistLocked()
        return snapshotLocked()
    }

    /// "Not now": remember the choice and use the non-biometric feed.
    func declineAll() -> ConsentSnapshot {
        lock.lock()
        defer { lock.unlock() }
        hasChosen = true
        nonBiometricFeed = true
        persistLocked()
        return snapshotLocked()
    }

    func revoke(_ revoked: [SensorTier]) -> ConsentSnapshot {
        lock.lock()
        defer { lock.unlock() }
        tiers.subtract(revoked)
        if tiers.isEmpty { nonBiometricFeed = true }
        persistLocked()
        return snapshotLocked()
    }

    private func snapshotLocked() -> ConsentSnapshot {
        return ConsentSnapshot(tiers: tiers, hasChosen: hasChosen, nonBiometricFeed: nonBiometricFeed)
    }

    private func persistLocked() {
        let stored = Stored(tiers: tiers.map { $0.rawValue }.sorted(),
                            hasChosen: hasChosen,
                            nonBiometricFeed: nonBiometricFeed)
        if let data = try? JSONEncoder().encode(stored) {
            VoidKeychain.write(data, account: ConsentManager.account)
        }
    }
}
