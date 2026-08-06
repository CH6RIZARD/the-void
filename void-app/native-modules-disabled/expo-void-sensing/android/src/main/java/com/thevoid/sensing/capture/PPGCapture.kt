package com.thevoid.sensing.capture

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Result of a contact-PPG estimate over one analysis window.
 *
 * REALITY-CHECK (plan T1.3): contact PPG gives ~1-2 bpm RMSE at rest, but HRV is
 * unreliable mid-scroll. Therefore `hrvMs` is populated ONLY in calm, motion-gated
 * moments (SNR >= 6 dB AND motionEnergy < 0.05); otherwise it is null. HR is reported
 * when the FFT peak and time-domain peak detector agree within 5 bpm. Mirrors iOS
 * PPGCapture.swift.
 */
data class PPGReading(
    val heartRateBpm: Double,
    val hrvMs: Double?,
    val snrDb: Double,
    val disagreementBpm: Double,
    val isValid: Boolean,
    val windowEndMs: Long,
) {
    companion object {
        fun invalid(
            windowEndMs: Long,
            snrDb: Double = 0.0,
            disagreementBpm: Double = Double.POSITIVE_INFINITY,
        ) = PPGReading(0.0, null, snrDb, disagreementBpm, false, windowEndMs)
    }
}

/**
 * Tier-4 rear-camera contact PPG.
 *
 * Pipeline (plan T1.3): green-channel ROI mean -> detrend -> Butterworth-4 bandpass
 * 0.7-4.0 Hz -> FFT peak, cross-checked against a time-domain peak detector
 * (disagreement > 5 bpm => invalid). HRV only when SNR >= 6 dB and motionEnergy < 0.05.
 *
 * The estimator core is pure and testable. The CameraX/torch capture (green ROI
 * extraction, torch on) lives in [PPGCameraSource]; the raw green-channel series it
 * produces NEVER crosses the JS bridge — only the derived reading feeds the pipeline.
 */
class PPGCapture {

    /** Estimate HR/HRV from a green-channel ROI-mean time series. */
    fun estimate(
        green: DoubleArray,
        sampleRateHz: Double,
        motionEnergy: Double,
        windowEndMs: Long = 0L,
    ): PPGReading {
        if (green.size < 16 || sampleRateHz <= 0.0) {
            return PPGReading.invalid(windowEndMs)
        }

        // 1. Detrend (remove DC / slow drift by mean subtraction).
        val mean = green.sum() / green.size
        var x = DoubleArray(green.size) { green[it] - mean }

        // 2. Butterworth-4 bandpass (HP 0.7 Hz then LP 4.0 Hz, each two biquads).
        x = Butterworth.bandpass4(x, sampleRateHz, BAND_LOW_HZ, BAND_HIGH_HZ)

        // 3. FFT (DFT) peak in band.
        val (fftFreq, snrDb) = Spectrum.dominantFrequency(x, sampleRateHz, BAND_LOW_HZ, BAND_HIGH_HZ)
        val hrFFT = fftFreq * 60.0

        // 4. Time-domain peak detector cross-check.
        val peakIdx = Spectrum.detectPeaks(x)
        if (peakIdx.size < 2 || fftFreq <= 0.0) {
            return PPGReading.invalid(windowEndMs, snrDb = snrDb)
        }
        val intervalsSamples = ArrayList<Double>(peakIdx.size - 1)
        for (i in 1 until peakIdx.size) {
            intervalsSamples.add((peakIdx[i] - peakIdx[i - 1]).toDouble())
        }
        val meanIntervalSamples = intervalsSamples.sum() / intervalsSamples.size
        val pdFreq = if (meanIntervalSamples > 0) sampleRateHz / meanIntervalSamples else 0.0
        val hrPD = pdFreq * 60.0

        val disagreement = abs(hrFFT - hrPD)

        // 5. Validity: agreement + sufficient SNR.
        val valid = disagreement <= MAX_DISAGREEMENT_BPM && snrDb >= MIN_VALID_SNR_DB
        if (!valid) {
            return PPGReading(hrFFT, null, snrDb, disagreement, false, windowEndMs)
        }

        // 6. HRV ONLY in calm, motion-gated moments.
        var hrv: Double? = null
        if (snrDb >= HRV_MIN_SNR_DB && motionEnergy < HRV_MAX_MOTION_ENERGY) {
            val intervalsMs = intervalsSamples.map { it / sampleRateHz * 1000.0 }
            val m = intervalsMs.sum() / intervalsMs.size
            val varMs = intervalsMs.fold(0.0) { acc, v -> acc + (v - m) * (v - m) } / intervalsMs.size
            hrv = sqrt(varMs) // SDNN
        }

        return PPGReading(hrFFT, hrv, snrDb, disagreement, true, windowEndMs)
    }

    companion object {
        const val BAND_LOW_HZ = 0.7
        const val BAND_HIGH_HZ = 4.0
        const val MAX_DISAGREEMENT_BPM = 5.0
        const val HRV_MIN_SNR_DB = 6.0
        const val HRV_MAX_MOTION_ENERGY = 0.05
        /** Minimum in-band SNR for the HR reading itself to be considered valid. */
        const val MIN_VALID_SNR_DB = 3.0
    }
}

// MARK: - DSP primitives (direct port of the iOS Biquad / Butterworth / Spectrum)

/** Direct-form-1 biquad section. */
internal class Biquad(
    private val b0: Double,
    private val b1: Double,
    private val b2: Double,
    private val a1: Double,
    private val a2: Double,
) {
    fun filter(input: DoubleArray): DoubleArray {
        val out = DoubleArray(input.size)
        var x1 = 0.0
        var x2 = 0.0
        var y1 = 0.0
        var y2 = 0.0
        for (i in input.indices) {
            val x0 = input[i]
            val y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            out[i] = y0
            x2 = x1; x1 = x0
            y2 = y1; y1 = y0
        }
        return out
    }
}

/** Butterworth filters built from RBJ biquad sections. */
internal object Butterworth {
    /** Butterworth quality factors for a 4th-order (two-section) cascade. */
    private val q4 = doubleArrayOf(0.541196100, 1.306562965)

    fun lowpassSection(fs: Double, fc: Double, q: Double): Biquad {
        val w0 = 2.0 * Math.PI * fc / fs
        val cosw = cos(w0)
        val alpha = sin(w0) / (2.0 * q)
        val a0 = 1.0 + alpha
        val b0 = (1.0 - cosw) / 2.0
        val b1 = 1.0 - cosw
        val b2 = (1.0 - cosw) / 2.0
        val a1 = -2.0 * cosw
        val a2 = 1.0 - alpha
        return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    fun highpassSection(fs: Double, fc: Double, q: Double): Biquad {
        val w0 = 2.0 * Math.PI * fc / fs
        val cosw = cos(w0)
        val alpha = sin(w0) / (2.0 * q)
        val a0 = 1.0 + alpha
        val b0 = (1.0 + cosw) / 2.0
        val b1 = -(1.0 + cosw)
        val b2 = (1.0 + cosw) / 2.0
        val a1 = -2.0 * cosw
        val a2 = 1.0 - alpha
        return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    /** 4th-order Butterworth bandpass = HP(lowHz) then LP(highHz), each two sections. */
    fun bandpass4(x: DoubleArray, fs: Double, lowHz: Double, highHz: Double): DoubleArray {
        var y = x
        for (q in q4) y = highpassSection(fs, lowHz, q).filter(y)
        for (q in q4) y = lowpassSection(fs, highHz, q).filter(y)
        return y
    }
}

/** Spectrum & peak utilities. */
internal object Spectrum {
    /**
     * Dominant in-band frequency via a scanned DFT. Returns (freqHz, snrDb).
     * SNR = peak power / mean of the remaining in-band power, in dB.
     */
    fun dominantFrequency(x: DoubleArray, fs: Double, bandLow: Double, bandHigh: Double): Pair<Double, Double> {
        val n = x.size
        if (n <= 1) return 0.0 to 0.0
        val df = fs / n.toDouble()
        val lowBin = maxOf(1, Math.floor(bandLow / df).toInt())
        val highBin = minOf(n / 2, Math.ceil(bandHigh / df).toInt())
        if (highBin <= lowBin) return 0.0 to 0.0

        val bins = ArrayList<Int>()
        val powers = ArrayList<Double>()
        for (k in lowBin..highBin) {
            var re = 0.0
            var im = 0.0
            val w = 2.0 * Math.PI * k / n
            for (t in 0 until n) {
                val ang = w * t
                re += x[t] * cos(ang)
                im -= x[t] * sin(ang)
            }
            bins.add(k)
            powers.add(re * re + im * im)
        }
        var peakIdx = -1
        var peakPower = 0.0
        for (i in powers.indices) {
            if (powers[i] > peakPower) {
                peakPower = powers[i]
                peakIdx = i
            }
        }
        if (peakIdx < 0 || peakPower <= 0.0) return 0.0 to 0.0
        var noiseSum = 0.0
        var noiseN = 0
        for (i in powers.indices) {
            if (i != peakIdx) {
                noiseSum += powers[i]
                noiseN += 1
            }
        }
        val noise = if (noiseN == 0) 0.0 else noiseSum / noiseN
        val snrDb = if (noise > 0) 10.0 * log10(peakPower / noise) else 60.0 // clean -> high SNR
        return (bins[peakIdx].toDouble() * df) to snrDb
    }

    /** Simple local-maxima detector above a fraction of the peak amplitude. */
    fun detectPeaks(x: DoubleArray, relThreshold: Double = 0.3): List<Int> {
        if (x.size < 3) return emptyList()
        val maxAmp = x.map { abs(it) }.maxOrNull() ?: 0.0
        if (maxAmp <= 0.0) return emptyList()
        val thr = relThreshold * maxAmp
        val peaks = ArrayList<Int>()
        for (i in 1 until x.size - 1) {
            if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] > thr) {
                peaks.add(i)
            }
        }
        return peaks
    }
}
