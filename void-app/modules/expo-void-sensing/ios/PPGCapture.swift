import Foundation

/// Result of a contact-PPG estimate (device-local).
struct PPGReading {
    let bpm: Double
    /// RMSSD in ms; only in calm, clean moments.
    let rmssdMs: Double?
    let snrDb: Double
    let quality: Double
    let valid: Bool
    let windowEndMs: Int64

    static func invalid(_ windowEndMs: Int64, snrDb: Double = -100) -> PPGReading {
        return PPGReading(bpm: 0, rmssdMs: nil, snrDb: snrDb, quality: 0, valid: false, windowEndMs: windowEndMs)
    }
}

/// Rear-camera fingertip (contact) PPG estimator core. Port of Android PPGCapture.kt:
/// detrend -> Butterworth-4 band-pass -> DFT peak cross-checked with a time-domain peak
/// detector -> HRV (RMSSD) only when SNR is good and the device is still.
final class PPGCapture {
    static let minBpm = 45.0
    static let maxBpm = 180.0
    static let minValidSnrDb = 0.0
    static let hrvMinSnrDb = 3.0
    static let hrvMaxMotionEnergy = 0.05

    func estimate(times: [Double], values: [Double], motionEnergy: Double?, windowEndMs: Int64) -> PPGReading {
        guard let p = DSP.estimatePulse(times: times, values: values,
                                        minBpm: PPGCapture.minBpm, maxBpm: PPGCapture.maxBpm,
                                        targetFs: 30.0) else {
            return PPGReading.invalid(windowEndMs)
        }
        let valid = p.agree && p.snrDb >= PPGCapture.minValidSnrDb
        guard valid else {
            return PPGReading(bpm: p.bpm, rmssdMs: nil, snrDb: p.snrDb, quality: p.quality,
                              valid: false, windowEndMs: windowEndMs)
        }
        let calm = (motionEnergy ?? 0) < PPGCapture.hrvMaxMotionEnergy
        let hrv = (p.snrDb >= PPGCapture.hrvMinSnrDb && calm) ? p.rmssdMs : nil
        return PPGReading(bpm: p.bpm, rmssdMs: hrv, snrDb: p.snrDb, quality: p.quality,
                          valid: true, windowEndMs: windowEndMs)
    }
}
