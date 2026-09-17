import Foundation

/// One touch sample: KINEMATICS ONLY (no content, no key identity, no target).
struct TouchSample {
    enum Phase: Int {
        case unknown = 0
        case began = 1
        case moved = 2
        case ended = 3
    }

    var x: Double
    var y: Double
    /// Native wall-clock ms (JS timestamps are re-based on ingest).
    var tMs: Double
    var pressure: Double?
    var phase: Phase
}

/// Deterministic kinematic features over a trailing window.
struct TouchFeatures {
    let eventCount: Int
    let gestureCount: Int
    /// Mean |velocity| in screen-scale units / s.
    let speedMean: Double
    let speedStd: Double
    /// Vertical direction reversals per second.
    let reversalRate: Double
    /// Taps per second.
    let tapRate: Double
    /// Fraction of the window spent in gaps > 500 ms between events (hesitation / reading).
    let pauseRatio: Double
    let pressureMean: Double?
}

/// Tier-0 touch capture fed from JS (`recordTouch(samples)`), batched ~1 s.
final class TouchCapture {
    static let retentionMs = 15_000.0
    static let maxSamples = 3000

    private let lock = NSLock()
    private var samples: [TouchSample] = []

    func clear() {
        lock.lock()
        samples.removeAll()
        lock.unlock()
    }

    /// Ingest raw dictionaries `{x, y, t, pressure?, phase?}` from the bridge.
    func ingest(_ raw: [[String: Any]]) {
        guard !raw.isEmpty else { return }
        let nowMs = Double(vsNowMs())
        var parsed: [TouchSample] = []
        parsed.reserveCapacity(raw.count)
        var maxT = -Double.infinity
        for d in raw {
            guard let x = vsNumber(d["x"]), let y = vsNumber(d["y"]), x.isFinite, y.isFinite else { continue }
            var t = nowMs
            if let tv = vsNumber(d["t"]), tv.isFinite { t = tv }
            maxT = Swift.max(maxT, t)
            parsed.append(TouchSample(
                x: x,
                y: y,
                tMs: t,
                pressure: vsNumber(d["pressure"]).flatMap { $0.isFinite && $0 > 0 ? $0 : nil },
                phase: TouchCapture.parsePhase(d["phase"])
            ))
        }
        guard !parsed.isEmpty else { return }
        // Re-base JS clocks (performance.now() or skewed Date.now()) onto native ms.
        let offset = abs(nowMs - maxT) > 5000 ? (nowMs - maxT) : 0.0
        if offset != 0 {
            for i in parsed.indices { parsed[i].tMs += offset }
        }
        lock.lock()
        samples.append(contentsOf: parsed)
        samples.sort { $0.tMs < $1.tMs }
        let cutoff = nowMs - TouchCapture.retentionMs
        if let firstKeep = samples.firstIndex(where: { $0.tMs >= cutoff }) {
            if firstKeep > 0 { samples.removeFirst(firstKeep) }
        } else {
            samples.removeAll()
        }
        if samples.count > TouchCapture.maxSamples {
            samples.removeFirst(samples.count - TouchCapture.maxSamples)
        }
        lock.unlock()
    }

    private static func parsePhase(_ v: Any?) -> TouchSample.Phase {
        if let s = v as? String {
            switch s.lowercased() {
            case "began", "begin", "start", "down", "touchstart", "pointerdown": return .began
            case "moved", "move", "touchmove", "pointermove", "scroll": return .moved
            case "ended", "end", "up", "cancel", "cancelled", "touchend", "pointerup": return .ended
            default: return .unknown
            }
        }
        if let n = vsNumber(v), n.isFinite, abs(n) < 16, let p = TouchSample.Phase(rawValue: Int(n)) { return p }
        return .unknown
    }

    /// Features over the trailing `windowMs`, or nil when fewer than 3 events.
    func features(nowMs: Double, windowMs: Double = 5000) -> TouchFeatures? {
        lock.lock()
        let cutoff = nowMs - windowMs
        let window = samples.filter { $0.tMs >= cutoff && $0.tMs <= nowMs + 1000 }
        lock.unlock()
        guard window.count >= 3 else { return nil }

        // Coordinate scale: normalized [0,1] vs CSS/points.
        var maxAbs = 0.0
        for s in window { maxAbs = Swift.max(maxAbs, Swift.max(abs(s.x), abs(s.y))) }
        let scale = maxAbs <= 1.5 ? 1.0 : 400.0
        let tapTravel = 0.03 * scale
        let minDy = 0.004 * scale

        var speeds: [Double] = []
        var reversals = 0
        var taps = 0
        var gestures = 0
        var pauseMs = 0.0
        var pressureSum = 0.0
        var pressureN = 0

        var gStart: TouchSample? = nil
        var gTravel = 0.0
        var lastSign = 0
        var prev: TouchSample? = nil

        func closeGesture(_ end: TouchSample) {
            if let s = gStart {
                gestures += 1
                let disp = abs(end.x - s.x) + abs(end.y - s.y)
                if end.tMs - s.tMs <= 350 && disp <= tapTravel && gTravel <= tapTravel * 2 {
                    taps += 1
                }
            }
            gStart = nil
            gTravel = 0
            lastSign = 0
        }

        for cur in window {
            if let p = cur.pressure { pressureSum += p; pressureN += 1 }
            let dt = prev.map { cur.tMs - $0.tMs } ?? 0
            if dt > 500 { pauseMs += dt }

            let startsNew = cur.phase == .began || (cur.phase == .unknown && (prev == nil || dt > 250))
            if startsNew {
                if gStart != nil, let p = prev { closeGesture(p) }
                gStart = cur
                gTravel = 0
                lastSign = 0
            } else if let p = prev, gStart != nil, dt > 0 {
                let dx = cur.x - p.x
                let dy = cur.y - p.y
                let dist = (dx * dx + dy * dy).squareRoot()
                gTravel += dist
                speeds.append((dist / scale) / (dt / 1000.0))
                if abs(dy) >= minDy {
                    let sign = dy > 0 ? 1 : -1
                    if lastSign != 0 && sign != lastSign { reversals += 1 }
                    lastSign = sign
                }
            } else if gStart == nil {
                gStart = cur
            }
            if cur.phase == .ended { closeGesture(cur) }
            prev = cur
        }
        if gStart != nil, let p = prev { closeGesture(p) }

        let seconds = windowMs / 1000.0
        let mean = speeds.isEmpty ? 0.0 : speeds.reduce(0, +) / Double(speeds.count)
        let variance = speeds.isEmpty ? 0.0
            : speeds.reduce(0.0) { $0 + ($1 - mean) * ($1 - mean) } / Double(speeds.count)

        return TouchFeatures(
            eventCount: window.count,
            gestureCount: gestures,
            speedMean: mean,
            speedStd: variance.squareRoot(),
            reversalRate: Double(reversals) / seconds,
            tapRate: Double(taps) / seconds,
            pauseRatio: vsClamp(pauseMs / windowMs, 0, 1),
            pressureMean: pressureN > 0 ? pressureSum / Double(pressureN) : nil
        )
    }
}
