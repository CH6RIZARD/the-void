package com.thevoid.sensing.capture

import android.content.Context
import androidx.lifecycle.LifecycleOwner
import kotlin.math.roundToInt

/** Progress/result of a fingertip calm reading. `bpm`/`hrvMs` are null until valid. */
data class CalmProgress(
    val bpm: Double?,
    val hrvMs: Double?,
    /** 0..1 elapsed fraction of [CalmReadingSession.DURATION_MS]. */
    val progress: Double,
    val done: Boolean,
    /** 0..1 signal quality (SNR-derived). */
    val quality: Double,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "bpm" to bpm?.let { (it * 10.0).roundToInt() / 10.0 },
        "hrv" to hrvMs?.let { (it * 10.0).roundToInt() / 10.0 },
        "progress" to progress,
        "done" to done,
        "quality" to quality,
    )
}

/**
 * One explicit 30 s rear-camera + torch fingertip reading. Wires [PPGCameraSource]
 * (frames → ROI mean) into [PPGCapture] (band-pass, FFT, peak cross-check, HRV).
 * Only runs between [start] and [stop]; holds scalars only, never frames.
 */
class CalmReadingSession(
    context: Context,
    private val motionEnergy: () -> Double,
    onError: (String) -> Unit,
) {
    private val ppg = PPGCapture()
    private val lock = Any()
    private val ts = ArrayList<Long>(1024)
    private val vs = ArrayList<Double>(1024)
    private val validBpm = ArrayList<Double>()
    private val validHrv = ArrayList<Double>()

    @Volatile
    var startedMs = 0L
        private set

    private val source = PPGCameraSource(
        context,
        onGreenSample = { green, tMs ->
            synchronized(lock) {
                if (ts.isEmpty() || tMs > ts[ts.size - 1]) {
                    ts.add(tMs)
                    vs.add(green)
                }
            }
        },
        onError = onError,
    )

    fun start(owner: LifecycleOwner) {
        synchronized(lock) {
            ts.clear()
            vs.clear()
            validBpm.clear()
            validHrv.clear()
        }
        startedMs = System.currentTimeMillis()
        source.start(owner)
    }

    fun stop() {
        source.stop()
    }

    /**
     * Evaluate the trailing [WINDOW_MS] (progress updates) or, when [isFinal], the whole
     * session minus the first [SETTLE_MS] (finger settling / auto-exposure).
     */
    fun evaluate(nowMs: Long, isFinal: Boolean): CalmProgress {
        val progress = ((nowMs - startedMs).toDouble() / DURATION_MS).coerceIn(0.0, 1.0)
        val from = if (isFinal) startedMs + SETTLE_MS else nowMs - WINDOW_MS
        val snapshot: Pair<LongArray, DoubleArray> = synchronized(lock) {
            val tl = ArrayList<Long>()
            val vl = ArrayList<Double>()
            for (i in ts.indices) {
                if (ts[i] >= from) {
                    tl.add(ts[i])
                    vl.add(vs[i])
                }
            }
            Pair(tl.toLongArray(), vl.toDoubleArray())
        }
        val tArr = snapshot.first
        val vArr = snapshot.second

        var bpm: Double? = null
        var hrv: Double? = null
        var quality = 0.0
        val fsRaw = PulseDsp.sampleRate(tArr)
        if (tArr.size >= 32 && fsRaw >= 8.0) {
            val fs = fsRaw.coerceAtMost(30.0)
            val uniform = PulseDsp.resample(tArr, vArr, fs)
            val reading = ppg.estimate(uniform, fs, motionEnergy(), nowMs)
            quality = ((reading.snrDb - 1.0) / 9.0).coerceIn(0.0, 1.0)
            if (reading.isValid && reading.heartRateBpm in 40.0..200.0) {
                bpm = reading.heartRateBpm
                hrv = reading.hrvMs
                synchronized(lock) {
                    if (!isFinal) {
                        validBpm.add(reading.heartRateBpm)
                        reading.hrvMs?.let { validHrv.add(it) }
                    }
                }
            }
        }

        if (isFinal && bpm == null) {
            // Whole-session estimate failed the cross-check: fall back to the median of the
            // valid progressive windows, if there were enough of them.
            synchronized(lock) {
                if (validBpm.size >= MIN_VALID_WINDOWS) {
                    bpm = median(validBpm)
                    hrv = if (validHrv.size >= MIN_VALID_WINDOWS) median(validHrv) else null
                }
            }
        }
        return CalmProgress(bpm, hrv, progress, isFinal, quality)
    }

    private fun median(xs: List<Double>): Double {
        val s = xs.sorted()
        return s[s.size / 2]
    }

    companion object {
        const val DURATION_MS = 30_000L
        const val WINDOW_MS = 10_000L
        const val SETTLE_MS = 3_000L
        const val MIN_VALID_WINDOWS = 5
    }
}
