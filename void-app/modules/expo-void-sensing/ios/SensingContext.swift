import Foundation
import UIKit
import AVFoundation

/// Non-sensitive context used for baseline bucketing, gating and power policy.
/// Proximity monitoring is intentionally NOT used on iOS (it blanks the screen).
struct SensingContext {
    var hourOfDay: Int
    var headphones: Bool
    /// 0..1, or -1 when unknown (simulator / monitoring unavailable).
    var batteryLevel: Double
    var lowPowerMode: Bool
    var sessionSeconds: Double

    var isLowBattery: Bool { return batteryLevel >= 0 && batteryLevel < 0.2 }

    func toDictionary() -> [String: Any] {
        return [
            "hourOfDay": hourOfDay,
            "headphones": headphones,
            "batteryLevel": batteryLevel,
            "lowPowerMode": lowPowerMode,
            "sessionSeconds": sessionSeconds,
        ]
    }
}

/// Reads UIKit / AVAudioSession state on the main thread and caches it behind a lock
/// so any queue can read `current()`.
final class SensingContextProvider {
    private let lock = NSLock()
    private var headphones = false
    private var battery: Double = -1
    private var lowPower = false
    private let sessionStart = Date()

    private static let headphonePorts: [AVAudioSession.Port] = [
        .headphones, .bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .usbAudio,
    ]

    /// Asynchronously refresh cached values (main thread).
    func refresh() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let device = UIDevice.current
            if !device.isBatteryMonitoringEnabled {
                device.isBatteryMonitoringEnabled = true
            }
            let level = Double(device.batteryLevel)
            let lp = ProcessInfo.processInfo.isLowPowerModeEnabled
            let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
            let hp = outputs.contains { SensingContextProvider.headphonePorts.contains($0.portType) }
            self.lock.lock()
            self.battery = level
            self.lowPower = lp
            self.headphones = hp
            self.lock.unlock()
        }
    }

    func current() -> SensingContext {
        let hour = Calendar.current.component(.hour, from: Date())
        lock.lock()
        defer { lock.unlock() }
        return SensingContext(
            hourOfDay: hour,
            headphones: headphones,
            batteryLevel: battery,
            lowPowerMode: lowPower,
            sessionSeconds: Date().timeIntervalSince(sessionStart)
        )
    }
}
