import ExpoModulesCore
import Foundation

/// expo-void-sensing (iOS). The ONLY bridge between the on-device sensing/affect
/// pipeline and JS. Raw sensor data never crosses it: the only affect payload is the
/// quantized, DP-noised AffectState from PrivacyGate. Calm readings expose only
/// bpm/hrv/progress (user-initiated), BLE events expose only device status.
///
/// No HealthKit, no ARKit/TrueDepth, no microphone.
public final class ExpoVoidSensingModule: Module {
    private let controller = SensingController()

    public func definition() -> ModuleDefinition {
        Name("ExpoVoidSensing")

        Events("onAffect", "onCalmReading", "onBleDevice", "onBleStatus")

        OnCreate {
            self.controller.setEmitter { [weak self] name, body in
                self?.sendEvent(name, body.mapValues { $0 as Any? })
            }
        }

        OnDestroy {
            self.controller.shutdown()
        }

        Function("hasNativeSensing") { () -> Bool in
            return true
        }

        Function("isAvailable") { () -> Bool in
            return self.controller.isAvailable()
        }

        /// tiers: subset of ["motion","touch","face","ppg","ble"]; [] = "Not now".
        AsyncFunction("requestConsent") { (tiers: [String], promise: Promise) in
            self.controller.requestConsent(tiers) { snapshot in
                promise.resolve(snapshot)
            }
        }

        AsyncFunction("revokeConsent") { (tiers: [String]) -> [String: Any] in
            return self.controller.revokeConsent(tiers)
        }

        Function("getConsent") { () -> [String: Any] in
            return self.controller.getConsent()
        }

        /// enabled == true: sensing permitted; false: killed (stops all capture, no emits).
        Function("setKillSwitch") { (enabled: Bool) -> Void in
            self.controller.setKillSwitch(enabled)
        }

        Function("getKillSwitch") { () -> Bool in
            return self.controller.isKillSwitchEnabled()
        }

        // Android-parity names used by index.ts.
        Function("isKillSwitchEnabled") { () -> Bool in
            return self.controller.isKillSwitchEnabled()
        }

        AsyncFunction("chooseNonBiometric") { (promise: Promise) in
            self.controller.requestConsent([]) { snapshot in
                promise.resolve(snapshot)
            }
        }

        AsyncFunction("start") { () -> Void in
            self.controller.start()
        }

        AsyncFunction("stop") { () -> Void in
            self.controller.stop()
        }

        Function("getAffectState") { () -> [String: Any]? in
            return self.controller.getAffectState()
        }

        Function("markImpression") { (impressionId: String, itemId: String) -> Void in
            self.controller.markImpression(impressionId: impressionId, itemId: itemId)
        }

        /// samples: [{x, y, t, pressure?, phase?}]
        Function("recordTouch") { (samples: [[String: Any]]) -> Void in
            self.controller.recordTouch(samples)
        }

        AsyncFunction("startCalmReading") { () -> Bool in
            return self.controller.startCalmReading()
        }

        Function("stopCalmReading") { () -> Void in
            self.controller.stopCalmReading()
        }

        AsyncFunction("scanHeartRateDevices") { () -> Bool in
            return self.controller.scanHeartRateDevices()
        }

        AsyncFunction("connectHeartRate") { (id: String) -> Bool in
            return self.controller.connectHeartRate(id)
        }

        Function("disconnectHeartRate") { () -> Void in
            self.controller.disconnectHeartRate()
        }

        Function("setFeedVisible") { (visible: Bool) -> Void in
            self.controller.setFeedVisible(visible)
        }

        Function("getContext") { () -> [String: Any] in
            return self.controller.getContext()
        }
    }
}
