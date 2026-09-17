import Foundation

/// A face-rPPG heart-rate estimate (device-local).
struct RPPGReading {
    let bpm: Double
    let quality: Double
    let snrDb: Double
    let windowEndMs: Int64
}

/// Remote PPG from the front camera: forehead/cheek green-mean ring buffer ->
/// shared DSP (band-pass + DFT + peak cross-check). Only estimated when the device
/// and head are still and a face is present with good quality.
final class RPPGCapture {
    static let windowSeconds = 12.0
    static let minSpanSeconds = 8.0
    static let minFaceQuality = 0.3

    private let lock = NSLock()
    private var times: [Double] = []
    private var values: [Double] = []

    func reset() {
        lock.lock()
        times.removeAll()
        values.removeAll()
        lock.unlock()
    }

    /// Ingest one skin sample. A missing/low-quality face or a > 0.6 s gap breaks the
    /// continuous series (never interpolated across).
    func ingest(t: Double, green: Double?, quality: Double) {
        lock.lock()
        defer { lock.unlock() }
        guard let g = green, g.isFinite, g > 1, quality >= RPPGCapture.minFaceQuality else {
            times.removeAll()
            values.removeAll()
            return
        }
        if let last = times.last, t - last > 0.6 || t <= last {
            times.removeAll()
            values.removeAll()
        }
        times.append(t)
        values.append(g)
        if let idx = times.firstIndex(where: { $0 >= t - RPPGCapture.windowSeconds }), idx > 0 {
            times.removeFirst(idx)
            values.removeFirst(idx)
        }
    }

    /// Heart-rate estimate, or nil when not still, too short, stale or low quality.
    func estimate(still: Bool) -> RPPGReading? {
        guard still else { return nil }
        lock.lock()
        let ts = times
        let vs = values
        lock.unlock()
        guard ts.count >= 40, let first = ts.first, let last = ts.last,
              last - first >= RPPGCapture.minSpanSeconds,
              vsHostTimeSeconds() - last < 1.0 else { return nil }
        let measuredFs = Double(ts.count - 1) / (last - first)
        let fs = Swift.max(5.0, Swift.min(15.0, measuredFs.rounded()))
        guard let p = DSP.estimatePulse(times: ts, values: vs, minBpm: 45, maxBpm: 180, targetFs: fs) else {
            return nil
        }
        guard p.agree, p.snrDb >= -2.0 else { return nil }
        return RPPGReading(bpm: p.bpm, quality: p.quality, snrDb: p.snrDb, windowEndMs: vsNowMs())
    }
}
