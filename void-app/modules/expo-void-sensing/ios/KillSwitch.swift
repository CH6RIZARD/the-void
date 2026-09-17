import Foundation

/// Local kill switch. `enabled == true` means sensing is PERMITTED (switch ON);
/// `false` means killed: no emits and all capture stops. Default enabled (consent is
/// still required independently). Persisted so a kill survives restarts.
final class KillSwitch {
    private static let account = "killswitch.v1"

    private let lock = NSLock()
    private var enabled: Bool

    init() {
        if let data = VoidKeychain.read(KillSwitch.account), let b = data.first {
            enabled = b != 0
        } else {
            enabled = true
        }
    }

    var isEnabled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return enabled
    }

    func set(_ value: Bool) {
        lock.lock()
        enabled = value
        lock.unlock()
        VoidKeychain.write(Data([UInt8(value ? 1 : 0)]), account: KillSwitch.account)
    }
}
