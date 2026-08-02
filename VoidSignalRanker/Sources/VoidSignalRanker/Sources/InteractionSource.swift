import Foundation

/// Interaction signal source — pure app-driven telemetry. Requires NO OS
/// permission because it observes only the user's interactions with our own UI.
///
/// The app feeds events in via the public `record*` methods (e.g. from a
/// SwiftUI `ScrollView` observer or gesture recognizers). The source derives:
/// - `interaction.dwell`          — normalized per-item dwell time
/// - `interaction.scroll_velocity`— normalized scroll speed
/// - `interaction.deceleration`   — normalized scroll deceleration magnitude
/// - `interaction.reversal`       — 1 on a scroll-direction reversal event
/// - `interaction.tap_latency`    — normalized latency from item appearance→tap
/// - `interaction.micro_pause`    — 1 when a session micro-pause is detected
public final class InteractionSource: SignalSource {

    public let id: SignalSourceID = .interaction
    public var isEnabled: Bool = false
    // Always "available": it is app-driven, needs no hardware or permission.
    public var isAvailable: Bool { true }

    private let signal = SignalStream()
    public var samples: AsyncStream<SignalSample> { signal.stream }

    // Normalization ceilings.
    private let dwellCeilingMs = 15_000.0     // 15s dwell = very engaged
    private let scrollVelocityCeiling = 4000.0 // pts/sec
    private let decelCeiling = 8000.0          // pts/sec^2
    private let tapLatencyCeilingMs = 3000.0
    private let microPauseThresholdMs = 800.0

    private var lastScrollVelocity: Double = 0
    private var lastScrollSign: Int = 0
    private var lastInteractionTime: Date = Date()

    public init() {}

    public func start() { lastInteractionTime = Date() }
    public func stop() {}

    // MARK: - App-driven event intake

    /// Call when an item leaves the viewport (or on periodic sampling) with the
    /// accumulated on-screen dwell time in milliseconds.
    public func recordDwell(itemID: String, dwellMs: Double) {
        guard isActive else { return }
        emit(["interaction.dwell": clamp01(dwellMs / dwellCeilingMs)],
             scalars: ["dwell_ms": dwellMs],
             itemID: itemID)
    }

    /// Call from a scroll observer with instantaneous velocity (pts/sec).
    public func recordScroll(velocity: Double) {
        guard isActive else { return }
        let sign = velocity > 0 ? 1 : (velocity < 0 ? -1 : 0)
        let decel = max(0, abs(lastScrollVelocity) - abs(velocity)) // magnitude drop
        var payload: [String: Double] = [
            "interaction.scroll_velocity": clamp01(abs(velocity) / scrollVelocityCeiling),
            "interaction.deceleration": clamp01(decel / decelCeiling)
        ]
        if sign != 0, lastScrollSign != 0, sign != lastScrollSign {
            payload["interaction.reversal"] = 1.0 // scroll-reversal event
        }
        lastScrollVelocity = velocity
        if sign != 0 { lastScrollSign = sign }
        emit(payload, scalars: ["scroll_velocity_pts_s": velocity])
        detectMicroPause()
    }

    /// Call when the user taps an item, providing time since the item appeared.
    public func recordTap(itemID: String, latencyMs: Double) {
        guard isActive else { return }
        emit(["interaction.tap_latency": clamp01(latencyMs / tapLatencyCeilingMs)],
             scalars: ["tap_latency_ms": latencyMs],
             itemID: itemID)
    }

    /// Detects a micro-pause: a gap since the last interaction exceeding a
    /// threshold, which often marks a moment of held attention.
    private func detectMicroPause() {
        let now = Date()
        let gapMs = now.timeIntervalSince(lastInteractionTime) * 1000.0
        lastInteractionTime = now
        if gapMs > microPauseThresholdMs {
            emit(["interaction.micro_pause": 1.0],
                 scalars: ["micro_pause_ms": gapMs])
        }
    }

    private func emit(_ payload: [String: Double], scalars: [String: Double], itemID: String? = nil) {
        var scalars = scalars
        // itemID is carried as a hash-free tag; interaction items are our own
        // content IDs (not sensitive), so this is safe to include.
        if let itemID { scalars["item_tag"] = Double(abs(itemID.hashValue % 1_000_000)) }
        signal.emit(SignalSample(sourceID: id, payload: payload, scalars: scalars))
    }

    private func clamp01(_ v: Double) -> Double {
        if v.isNaN { return 0 }
        return min(1, max(0, v))
    }
}
