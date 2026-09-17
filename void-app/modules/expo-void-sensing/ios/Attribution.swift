import Foundation

/// Physiological signals and their response latency relative to a stimulus.
enum SignalKind: CaseIterable {
    case heartRate
    case hrv
    case pupil
    case blendshape
    case touch

    var latencySeconds: Double {
        switch self {
        case .heartRate: return 3.0
        case .hrv: return 5.0
        case .pupil: return 1.0
        case .blendshape: return 0.5
        case .touch: return 0.0
        }
    }
}

/// The time span an impression was on screen.
struct ImpressionSpan {
    let impressionId: String
    let startMs: Int64
    let endMs: Int64

    var exposureSeconds: Double {
        return endMs > startMs ? Double(endMs - startMs) / 1000.0 : 0
    }
}

struct AttributionWindow {
    let impressionId: String
    let signal: SignalKind
    let signalStartMs: Int64
    let signalEndMs: Int64
    let confidence: Double
    let dropped: Bool
}

/// Lag-aligned attribution of affect windows to impressions (port of Attribution.kt),
/// plus a small device-local impression tracker fed by `markImpression`.
final class Attribution {
    static let dropThreshold = 0.4
    static let responseWindowSeconds = 8.0
    /// Plan A4: overlap uses the dwell span plus a 2 s physiological lag.
    static let lagMs: Int64 = 2_000
    /// Open impressions are considered ended after this long without a successor.
    static let maxOpenMs: Int64 = 60_000

    private struct Mark {
        let impressionId: String
        let itemId: String
        let startMs: Int64
        var endMs: Int64?
    }

    private let lock = NSLock()
    private var marks: [Mark] = []

    func confidence(exposureSeconds: Double, signal: SignalKind) -> Double {
        let usable = exposureSeconds - signal.latencySeconds
        guard usable > 0, Attribution.responseWindowSeconds > 0 else { return 0 }
        return Swift.min(1.0, usable / Attribution.responseWindowSeconds)
    }

    func align(_ impression: ImpressionSpan, signal: SignalKind) -> AttributionWindow {
        let conf = confidence(exposureSeconds: impression.exposureSeconds, signal: signal)
        let latencyMs = Int64((signal.latencySeconds * 1000.0).rounded())
        let start = impression.startMs + latencyMs
        let end = Swift.max(start, impression.endMs + latencyMs)
        return AttributionWindow(impressionId: impression.impressionId, signal: signal,
                                 signalStartMs: start, signalEndMs: end,
                                 confidence: conf, dropped: conf < Attribution.dropThreshold)
    }

    /// A newly shown item ends the previous open impression.
    func markImpression(impressionId: String, itemId: String, atMs: Int64 = vsNowMs()) {
        lock.lock()
        defer { lock.unlock() }
        if let lastIdx = marks.indices.last, marks[lastIdx].endMs == nil {
            marks[lastIdx].endMs = atMs
        }
        marks.append(Mark(impressionId: impressionId, itemId: itemId, startMs: atMs, endMs: nil))
        if marks.count > 64 { marks.removeFirst(marks.count - 64) }
    }

    /// Most recent impression whose lagged span overlaps the window ending at `windowEndMs`.
    func impressionId(forWindowEndMs windowEndMs: Int64, windowMs: Int64 = 1_000) -> String? {
        let wStart = windowEndMs - windowMs
        lock.lock()
        defer { lock.unlock() }
        for m in marks.reversed() {
            let end = m.endMs ?? Swift.min(windowEndMs, m.startMs + Attribution.maxOpenMs)
            let aStart = m.startMs + Attribution.lagMs
            let aEnd = end + Attribution.lagMs
            if aStart <= windowEndMs && aEnd >= wStart { return m.impressionId }
        }
        return nil
    }

    func clear() {
        lock.lock()
        marks.removeAll()
        lock.unlock()
    }
}
