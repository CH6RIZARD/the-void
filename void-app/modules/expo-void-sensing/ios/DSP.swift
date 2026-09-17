import Foundation

/// Direct-form-1 biquad section (port of Android PPGCapture.kt Biquad).
struct Biquad {
    let b0: Double
    let b1: Double
    let b2: Double
    let a1: Double
    let a2: Double

    func filter(_ input: [Double]) -> [Double] {
        var out = [Double](repeating: 0, count: input.count)
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        for i in 0..<input.count {
            let x0 = input[i]
            let y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            out[i] = y0
            x2 = x1; x1 = x0
            y2 = y1; y1 = y0
        }
        return out
    }
}

/// Result of a pulse estimate over one window (device-local only).
struct PulseEstimate {
    let bpm: Double
    let fftBpm: Double
    let peakBpm: Double?
    let snrDb: Double
    let rmssdMs: Double?
    let agree: Bool
    /// 0..1 heuristic quality from SNR and FFT/peak agreement.
    let quality: Double
}

/// Pure DSP primitives shared by contact PPG, face rPPG and BLE HRV.
enum DSP {
    /// Butterworth quality factors for a 4th-order (two-section) cascade.
    static let q4: [Double] = [0.541196100, 1.306562965]

    static func lowpass(fs: Double, fc: Double, q: Double) -> Biquad {
        let w0 = 2.0 * Double.pi * fc / fs
        let cosw = cos(w0)
        let alpha = sin(w0) / (2.0 * q)
        let a0 = 1.0 + alpha
        return Biquad(b0: ((1.0 - cosw) / 2.0) / a0,
                      b1: (1.0 - cosw) / a0,
                      b2: ((1.0 - cosw) / 2.0) / a0,
                      a1: (-2.0 * cosw) / a0,
                      a2: (1.0 - alpha) / a0)
    }

    static func highpass(fs: Double, fc: Double, q: Double) -> Biquad {
        let w0 = 2.0 * Double.pi * fc / fs
        let cosw = cos(w0)
        let alpha = sin(w0) / (2.0 * q)
        let a0 = 1.0 + alpha
        return Biquad(b0: ((1.0 + cosw) / 2.0) / a0,
                      b1: (-(1.0 + cosw)) / a0,
                      b2: ((1.0 + cosw) / 2.0) / a0,
                      a1: (-2.0 * cosw) / a0,
                      a2: (1.0 - alpha) / a0)
    }

    /// 4th-order Butterworth band-pass = HP(low) then LP(high), two sections each.
    static func bandpass4(_ x: [Double], fs: Double, lowHz: Double, highHz: Double) -> [Double] {
        var y = x
        for q in q4 { y = highpass(fs: fs, fc: lowHz, q: q).filter(y) }
        for q in q4 { y = lowpass(fs: fs, fc: highHz, q: q).filter(y) }
        return y
    }

    /// Linear-interpolation resample of an irregular series onto a uniform grid.
    static func resample(times: [Double], values: [Double], fs: Double) -> [Double] {
        let n = Swift.min(times.count, values.count)
        guard n >= 2, fs > 0 else { return [] }
        let t0 = times[0]
        let t1 = times[n - 1]
        guard t1 > t0 else { return [] }
        let count = Int(((t1 - t0) * fs).rounded(.down)) + 1
        var out = [Double](repeating: 0, count: count)
        var j = 0
        for i in 0..<count {
            let t = t0 + Double(i) / fs
            while j < n - 2 && times[j + 1] < t { j += 1 }
            let ta = times[j], tb = times[j + 1]
            let va = values[j], vb = values[j + 1]
            if tb <= ta {
                out[i] = vb
            } else {
                let u = vsClamp((t - ta) / (tb - ta), 0, 1)
                out[i] = va + (vb - va) * u
            }
        }
        return out
    }

    /// Subtract a centred moving average (removes baseline wander / exposure drift).
    static func detrend(_ x: [Double], window: Int) -> [Double] {
        let n = x.count
        guard n > 0 else { return [] }
        let half = Swift.max(1, window / 2)
        var prefix = [Double](repeating: 0, count: n + 1)
        for i in 0..<n { prefix[i + 1] = prefix[i] + x[i] }
        var out = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let lo = Swift.max(0, i - half)
            let hi = Swift.min(n, i + half + 1)
            let mean = (prefix[hi] - prefix[lo]) / Double(hi - lo)
            out[i] = x[i] - mean
        }
        return out
    }

    /// Dominant in-band frequency via a finely scanned windowed DFT.
    /// SNR (dB) = energy within ±0.1 Hz of f0 and 2·f0, over the remaining in-band energy.
    static func dominantFrequency(_ x: [Double], fs: Double, lowHz: Double, highHz: Double,
                                  stepHz: Double = 0.5 / 60.0) -> (freqHz: Double, snrDb: Double) {
        let n = x.count
        guard n > 8, fs > 0, highHz > lowHz else { return (0, -100) }
        // Hann window.
        var xw = [Double](repeating: 0, count: n)
        let denom = Double(n - 1)
        for i in 0..<n {
            xw[i] = x[i] * (0.5 - 0.5 * cos(2.0 * Double.pi * Double(i) / denom))
        }
        let upper = Swift.min(highHz * 2.0 + 0.1, fs / 2.0)
        var freqs: [Double] = []
        var powers: [Double] = []
        var f = lowHz
        while f <= upper {
            let w = 2.0 * Double.pi * f / fs
            var re = 0.0, im = 0.0
            for t in 0..<n {
                let ang = w * Double(t)
                re += xw[t] * cos(ang)
                im -= xw[t] * sin(ang)
            }
            freqs.append(f)
            powers.append(re * re + im * im)
            f += stepHz
        }
        var peakIdx = -1
        var peakPower = 0.0
        for i in 0..<freqs.count where freqs[i] <= highHz {
            if powers[i] > peakPower { peakPower = powers[i]; peakIdx = i }
        }
        guard peakIdx >= 0, peakPower > 0 else { return (0, -100) }
        let f0 = freqs[peakIdx]
        var sig = 0.0, noise = 0.0
        for i in 0..<freqs.count {
            let fi = freqs[i]
            let nearF0 = abs(fi - f0) <= 0.1
            let nearH2 = abs(fi - 2.0 * f0) <= 0.1
            if nearF0 || nearH2 {
                sig += powers[i]
            } else if fi <= highHz {
                noise += powers[i]
            }
        }
        let snr = noise > 0 ? 10.0 * log10(sig / noise) : 30.0
        return (f0, snr)
    }

    /// Local maxima with a refractory distance, sub-sample refined (parabolic).
    /// Returns fractional sample positions.
    static func detectPeaks(_ x: [Double], fs: Double, maxBpm: Double) -> [Double] {
        let n = x.count
        guard n >= 3, fs > 0 else { return [] }
        let meanSq = x.reduce(0.0) { $0 + $1 * $1 } / Double(n)
        let thr = 0.3 * meanSq.squareRoot()
        let minDist = Swift.max(1, Int((fs * 60.0 / maxBpm).rounded(.down)))
        var peaks: [(pos: Double, amp: Double, idx: Int)] = []
        for i in 1..<(n - 1) {
            guard x[i] > x[i - 1], x[i] >= x[i + 1], x[i] > thr else { continue }
            let a = x[i - 1], b = x[i], c = x[i + 1]
            let d = a - 2.0 * b + c
            let offset = abs(d) > 1e-12 ? vsClamp(0.5 * (a - c) / d, -0.5, 0.5) : 0.0
            let candidate = (pos: Double(i) + offset, amp: b, idx: i)
            if let last = peaks.last, i - last.idx < minDist {
                if b > last.amp { peaks[peaks.count - 1] = candidate }
            } else {
                peaks.append(candidate)
            }
        }
        return peaks.map { $0.pos }
    }

    static func median(_ xs: [Double]) -> Double? {
        guard !xs.isEmpty else { return nil }
        let s = xs.sorted()
        let m = s.count / 2
        return s.count % 2 == 0 ? (s[m - 1] + s[m]) / 2.0 : s[m]
    }

    /// RMSSD (ms) over artifact-filtered RR intervals: an interval is accepted when it is
    /// in the physiological range and within 25% of the median; only successive pairs
    /// of accepted intervals contribute. Needs >= 4 pairs.
    static func rmssd(_ rrMs: [Double], minRR: Double = 333, maxRR: Double = 1333) -> Double? {
        let inRange = rrMs.filter { $0 >= minRR && $0 <= maxRR }
        guard let med = median(inRange) else { return nil }
        var sumSq = 0.0
        var pairs = 0
        var prev: Double? = nil
        for rr in rrMs {
            let ok = rr >= minRR && rr <= maxRR && abs(rr - med) <= 0.25 * med
            if ok, let p = prev {
                let d = rr - p
                sumSq += d * d
                pairs += 1
            }
            prev = ok ? rr : nil
        }
        guard pairs >= 4 else { return nil }
        return (sumSq / Double(pairs)).squareRoot()
    }

    /// Full pulse pipeline over an irregularly sampled optical series.
    /// normalize -> resample -> detrend -> band-pass -> DFT peak (+SNR) -> peak detector
    /// cross-check -> RMSSD.
    static func estimatePulse(times: [Double], values: [Double],
                              minBpm: Double = 45, maxBpm: Double = 180,
                              targetFs: Double? = nil) -> PulseEstimate? {
        let n = Swift.min(times.count, values.count)
        guard n >= 16 else { return nil }
        let span = times[n - 1] - times[0]
        guard span >= 4.0 else { return nil }
        let measuredFs = Double(n - 1) / span
        let fs = targetFs ?? Swift.max(5.0, Swift.min(60.0, measuredFs.rounded()))

        // Normalize by the mean (illumination invariant).
        let mean = values.prefix(n).reduce(0, +) / Double(n)
        guard mean.isFinite, abs(mean) > 1e-9 else { return nil }
        let norm = values.prefix(n).map { $0 / mean - 1.0 }

        var x = resample(times: Array(times.prefix(n)), values: norm, fs: fs)
        guard x.count >= 16 else { return nil }
        x = detrend(x, window: Int(fs.rounded()))

        let lowHz = minBpm / 60.0
        let highHz = Swift.min(maxBpm / 60.0, 0.45 * fs)
        guard highHz > lowHz else { return nil }
        x = bandpass4(x, fs: fs, lowHz: lowHz, highHz: highHz)

        // Drop the filter's start-up transient.
        let skip = Swift.min(Int(fs.rounded()), x.count / 5)
        if skip > 0 { x.removeFirst(skip) }
        guard x.count >= 16 else { return nil }

        let (f0, snr) = dominantFrequency(x, fs: fs, lowHz: lowHz, highHz: highHz)
        guard f0 > 0 else { return nil }
        let fftBpm = f0 * 60.0

        let peaks = detectPeaks(x, fs: fs, maxBpm: maxBpm)
        var rr: [Double] = []
        if peaks.count >= 2 {
            for i in 1..<peaks.count {
                rr.append((peaks[i] - peaks[i - 1]) / fs * 1000.0)
            }
        }
        let validRR = rr.filter { $0 >= 60000.0 / maxBpm && $0 <= 60000.0 / minBpm }
        let peakBpm: Double? = median(validRR).map { 60000.0 / $0 }
        let agree = peakBpm.map { abs($0 - fftBpm) <= 8.0 } ?? false
        let rmssdMs = agree ? rmssd(rr, minRR: 60000.0 / maxBpm, maxRR: 60000.0 / minBpm) : nil

        var quality = vsClamp((snr + 5.0) / 10.0, 0, 1)
        if !agree { quality *= 0.5 }

        return PulseEstimate(bpm: fftBpm, fftBpm: fftBpm, peakBpm: peakBpm, snrDb: snr,
                             rmssdMs: rmssdMs, agree: agree, quality: quality)
    }
}
