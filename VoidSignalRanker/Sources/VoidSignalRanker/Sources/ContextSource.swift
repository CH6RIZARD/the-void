import Foundation
#if canImport(UIKit) && os(iOS)
import UIKit
#endif

/// Context signal source — low-rate ambient/device context. Needs no special
/// permission (battery + time are freely readable; ambient light uses the
/// screen-brightness proxy rather than the private ALS API).
///
/// Emits derived features:
/// - `context.time_of_day`   — cyclic-ish time normalized to [0,1] with a
///   "prime attention" bump midday/evening
/// - `context.ambient_light` — normalized brightness proxy
/// - `context.charging`      — 1 when charging/full, else 0
/// - `context.motion_context`— coarse motion context echo (set by app or motion)
public final class ContextSource: SignalSource {

    public let id: SignalSourceID = .context
    public var isEnabled: Bool = false { didSet { if isEnabled { start() } else { stop() } } }
    public var isAvailable: Bool { true }

    private let signal = SignalStream()
    public var samples: AsyncStream<SignalSample> { signal.stream }

    private var timer: Timer?
    private var motionContext: Double = 0.0

    public init() {}

    public func start() {
        guard isActive else { return }
        #if canImport(UIKit) && os(iOS)
        UIDevice.current.isBatteryMonitoringEnabled = true
        #endif
        emitSnapshot()
        let t = Timer(timeInterval: 15.0, repeats: true) { [weak self] _ in
            self?.emitSnapshot()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// Allows the app / MotionSource to feed a coarse motion context in.
    public func updateMotionContext(_ value: Double) {
        motionContext = clamp01(value)
    }

    private func emitSnapshot() {
        let now = Date()
        let payload: [String: Double] = [
            "context.time_of_day": Self.timeOfDayWeight(now),
            "context.ambient_light": ambientLightProxy(),
            "context.charging": chargingState(),
            "context.motion_context": motionContext
        ]
        signal.emit(SignalSample(sourceID: id, timestamp: now, payload: payload,
                                 scalars: ["hour": Double(Calendar.current.component(.hour, from: now))]))
    }

    private func ambientLightProxy() -> Double {
        #if canImport(UIKit) && os(iOS)
        return clamp01(Double(UIScreen.main.brightness))
        #else
        return 0.5
        #endif
    }

    private func chargingState() -> Double {
        #if canImport(UIKit) && os(iOS)
        switch UIDevice.current.batteryState {
        case .charging, .full: return 1.0
        default: return 0.0
        }
        #else
        return 0.0
        #endif
    }

    /// Maps clock time to an attention-availability weight. This is a static
    /// prior; per-user learning happens in the ranker/baselines, not here.
    static func timeOfDayWeight(_ date: Date) -> Double {
        let hour = Double(Calendar.current.component(.hour, from: date))
        // Bimodal bump: midday (~13) and evening (~21) higher; deep night low.
        let midday = exp(-pow(hour - 13.0, 2) / (2 * 9))
        let evening = exp(-pow(hour - 21.0, 2) / (2 * 6))
        return clamp01(0.15 + 0.85 * max(midday, evening))
    }

    private func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1, max(0, v))
    }
}
