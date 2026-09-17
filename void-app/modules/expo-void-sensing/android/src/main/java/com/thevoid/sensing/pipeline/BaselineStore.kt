package com.thevoid.sensing.pipeline

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sqrt

/** An immutable snapshot of a per-user, per-(signal, circadian-bucket) baseline. */
data class Baseline(
    val count: Int,
    val mean: Double,
    val variance: Double,
    val firstSeenMs: Long,
    val lastSeenMs: Long,
) {
    val standardDeviation: Double get() = if (variance > 0) sqrt(variance) else 0.0

    /** Warm once enough observations exist (no minimum span of days any more). */
    val isWarm: Boolean
        get() = count >= BaselineStore.WARM_MIN_COUNT &&
            (lastSeenMs - firstSeenMs) >= BaselineStore.WARM_MIN_MS
}

/** Result of the most recent completed fingertip calm reading. */
data class Calibration(val bpm: Double, val hrvMs: Double?, val atMs: Long)

/**
 * Per-user rolling baseline with online (weighted Welford) accumulation, 28-day
 * exponential decay, and 4-hour circadian buckets. On-device only, stored in
 * EncryptedSharedPreferences. Mirrors iOS BaselineStore.swift.
 *
 * INVARIANTS (CLAUDE.md #4, plan T1.6):
 * - `z(...)` returns null until the relevant bucket is warm (n >= 30). Callers scale
 *   confidence by [warmupFactor] = min(1, n/200) so early estimates are honestly weak.
 *   Absolute physiological values must NEVER reach the model — only z-scores.
 * - Baselines are per circadian bucket (6 x 4-hour buckets/day).
 * - HR is confound-regressed against motion energy before baselining.
 * - State never leaves the device (no network path).
 */
class BaselineStore(
    context: Context? = null,
    private val userID: String = "local",
    private val tau: Double = DECAY_TAU_SECONDS,
) {
    /** Weighted-Welford accumulator (West's incremental algorithm). */
    private class Accumulator {
        var weightSum = 0.0
        var mean = 0.0
        var s = 0.0            // weighted sum of squared deviations
        var count = 0
        var firstSeenMs: Long? = null
        var lastSeenMs: Long? = null

        fun decay(toMs: Long, tau: Double) {
            val last = lastSeenMs ?: return
            val dt = (toMs - last) / 1000.0
            if (dt <= 0) return
            val lambda = exp(-dt / tau)
            weightSum *= lambda
            s *= lambda
        }

        fun add(x: Double, weight: Double, atMs: Long) {
            if (firstSeenMs == null) firstSeenMs = atMs
            val newW = weightSum + weight
            val delta = x - mean
            val newMean = mean + (weight / newW) * delta
            s += weight * delta * (x - newMean)
            mean = newMean
            weightSum = newW
            count += 1
            lastSeenMs = atMs
        }

        val variance: Double get() = if (weightSum > 0) s / weightSum else 0.0

        fun snapshot(): Baseline? {
            val f = firstSeenMs ?: return null
            val l = lastSeenMs ?: return null
            return Baseline(count, mean, variance, f, l)
        }
    }

    private val lock = Any()
    private val accumulators = HashMap<String, Accumulator>()
    private val prefs: SharedPreferences? = buildPrefs(context)
    private var lastPersistMs = 0L
    private var calibration: Calibration? = null
    private var rppgOffset = 0.0

    init {
        restore()
    }

    private fun keyFor(signal: String, bucket: Int): String = "$signal#$bucket"

    /** Fold one observation into the appropriate bucket. */
    fun update(signal: String, value: Double, atMs: Long) {
        if (!value.isFinite()) return
        synchronized(lock) {
            val k = keyFor(signal, circadianBucket(atMs))
            val acc = accumulators.getOrPut(k) { Accumulator() }
            acc.decay(atMs, tau)
            acc.add(value, 1.0, atMs)
            if (atMs - lastPersistMs >= PERSIST_INTERVAL_MS) {
                lastPersistMs = atMs
                persist()
            }
        }
    }

    /** Observation count of the bucket for [signal] at [atMs] (0 if never observed). */
    fun sampleCount(signal: String, atMs: Long): Int = baseline(signal, atMs)?.count ?: 0

    /** Confidence multiplier during warm-up: min(1, samples / CONFIDENCE_FULL_COUNT). */
    fun warmupFactor(signal: String, atMs: Long): Double =
        minOf(1.0, sampleCount(signal, atMs).toDouble() / CONFIDENCE_FULL_COUNT)

    /** Force-write the in-memory state (e.g. on stop). */
    fun flush() {
        synchronized(lock) { persist() }
    }

    // MARK: - Calm-reading calibration (fingertip PPG baseline)

    /** Store the result of a completed fingertip calm reading. */
    fun setCalibration(bpm: Double, hrvMs: Double?, atMs: Long) {
        if (!bpm.isFinite()) return
        synchronized(lock) {
            calibration = Calibration(bpm, hrvMs, atMs)
            val p = prefs ?: return
            try {
                val o = JSONObject()
                o.put("bpm", bpm)
                o.put("hrvMs", hrvMs ?: JSONObject.NULL)
                o.put("atMs", atMs)
                o.put("rppgOffset", rppgOffset)
                p.edit().putString(CALIBRATION_KEY, o.toString()).apply()
            } catch (t: Throwable) {
                // ignore
            }
        }
    }

    fun calibration(): Calibration? = synchronized(lock) { calibration }

    /** bpm offset added to face-rPPG estimates, learned against a calm reading. */
    fun rppgOffset(): Double = synchronized(lock) { rppgOffset }

    /**
     * Learn the rPPG offset from a face-rPPG estimate taken shortly after a calm reading
     * (EMA, clamped to ±15 bpm).
     */
    fun learnRppgOffset(rppgBpm: Double, atMs: Long) {
        synchronized(lock) {
            val cal = calibration ?: return
            if (atMs - cal.atMs > OFFSET_LEARN_WINDOW_MS || atMs < cal.atMs) return
            val target = (cal.bpm - rppgBpm).coerceIn(-15.0, 15.0)
            rppgOffset = (0.8 * rppgOffset + 0.2 * target).coerceIn(-15.0, 15.0)
            val p = prefs ?: return
            try {
                val raw = p.getString(CALIBRATION_KEY, null) ?: return
                val o = JSONObject(raw)
                o.put("rppgOffset", rppgOffset)
                p.edit().putString(CALIBRATION_KEY, o.toString()).apply()
            } catch (t: Throwable) {
                // ignore
            }
        }
    }

    /** Snapshot of a bucket's baseline (null if never observed). */
    fun baseline(signal: String, atMs: Long): Baseline? = synchronized(lock) {
        val k = keyFor(signal, circadianBucket(atMs))
        accumulators[k]?.snapshot()
    }

    /**
     * Per-user z-score. Returns null until the bucket is warm — NEVER an absolute
     * value, NEVER an imputed 0.
     */
    fun z(signal: String, value: Double, atMs: Long): Double? {
        val b = baseline(signal, atMs) ?: return null
        if (!b.isWarm) return null
        val sd = b.standardDeviation
        if (sd <= 0) return null
        return (value - b.mean) / sd
    }

    // MARK: - Confound regression (HR vs motion energy)

    /** Remove the motion confound from HR, returning motion-adjusted HR. */
    fun confoundAdjustedHR(hr: DoubleArray, motionEnergy: DoubleArray): DoubleArray {
        val (slope, intercept) = regress(hr, motionEnergy)
        val grandMean = if (hr.isEmpty()) 0.0 else hr.sum() / hr.size
        val n = minOf(hr.size, motionEnergy.size)
        return DoubleArray(n) { i ->
            val predicted = slope * motionEnergy[i] + intercept
            (hr[i] - predicted) + grandMean
        }
    }

    // MARK: - EncryptedSharedPreferences persistence (device-local only)

    private fun buildPrefs(context: Context?): SharedPreferences? {
        if (context == null) return null
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "void_baseline_$userID",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            null
        }
    }

    private fun persist() {
        val p = prefs ?: return
        val root = JSONObject()
        for ((k, a) in accumulators) {
            val o = JSONObject()
            o.put("weightSum", a.weightSum)
            o.put("mean", a.mean)
            o.put("s", a.s)
            o.put("count", a.count)
            o.put("firstSeenMs", a.firstSeenMs ?: JSONObject.NULL)
            o.put("lastSeenMs", a.lastSeenMs ?: JSONObject.NULL)
            root.put(k, o)
        }
        try {
            p.edit().putString(STATE_KEY, root.toString()).apply()
        } catch (t: Throwable) {
            // ignore persistence failure; in-memory state remains authoritative.
        }
    }

    private fun restore() {
        val p = prefs ?: return
        val raw = try {
            p.getString(STATE_KEY, null)
        } catch (t: Throwable) {
            null
        }
        if (raw != null) try {
            val root = JSONObject(raw)
            val it = root.keys()
            while (it.hasNext()) {
                val k = it.next()
                val o = root.getJSONObject(k)
                val acc = Accumulator()
                acc.weightSum = o.optDouble("weightSum", 0.0)
                acc.mean = o.optDouble("mean", 0.0)
                acc.s = o.optDouble("s", 0.0)
                acc.count = o.optInt("count", 0)
                acc.firstSeenMs = if (o.isNull("firstSeenMs")) null else o.optLong("firstSeenMs")
                acc.lastSeenMs = if (o.isNull("lastSeenMs")) null else o.optLong("lastSeenMs")
                accumulators[k] = acc
            }
        } catch (t: Throwable) {
            // Corrupt state -> start cold (safe: z() just returns null until warm).
        }
        try {
            val calRaw = p.getString(CALIBRATION_KEY, null)
            if (calRaw != null) {
                val o = JSONObject(calRaw)
                val hrv = if (o.isNull("hrvMs")) null else o.optDouble("hrvMs")
                calibration = Calibration(o.optDouble("bpm", 0.0), hrv, o.optLong("atMs", 0L))
                rppgOffset = o.optDouble("rppgOffset", 0.0)
            }
        } catch (t: Throwable) {
            // ignore
        }
    }

    companion object {
        const val WARM_MIN_COUNT = 30
        const val WARM_MIN_MS = 0L
        /** Sample count at which warm-up no longer scales confidence down. */
        const val CONFIDENCE_FULL_COUNT = 200.0
        private const val PERSIST_INTERVAL_MS = 30_000L
        private const val CALIBRATION_KEY = "calibration"
        private const val OFFSET_LEARN_WINDOW_MS = 10L * 60_000L
        /** Exponential decay time-constant: 28 days (in seconds). */
        const val DECAY_TAU_SECONDS = 28.0 * 86_400.0
        const val BUCKET_COUNT = 6 // 24h / 4h
        private const val STATE_KEY = "accumulators"

        /** Circadian bucket for a timestamp: 0..5 (each covers 4 hours of local time). */
        fun circadianBucket(atMs: Long): Int {
            val cal = Calendar.getInstance()
            cal.timeInMillis = atMs
            val hour = cal.get(Calendar.HOUR_OF_DAY)
            return minOf(BUCKET_COUNT - 1, hour / 4)
        }

        /** Ordinary least squares fit of `y = slope*x + intercept`. */
        fun regress(y: DoubleArray, x: DoubleArray): Pair<Double, Double> {
            val n = minOf(x.size, y.size)
            if (n <= 1) return 0.0 to (y.firstOrNull() ?: 0.0)
            var sx = 0.0
            var sy = 0.0
            var sxx = 0.0
            var sxy = 0.0
            for (i in 0 until n) {
                sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]
            }
            val denom = n * sxx - sx * sx
            if (abs(denom) <= 1e-12) return 0.0 to (sy / n)
            val slope = (n * sxy - sx * sy) / denom
            val intercept = (sy - slope * sx) / n
            return slope to intercept
        }
    }
}
