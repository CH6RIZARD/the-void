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

    /** Warm when we have enough observations spread over enough days. */
    val isWarm: Boolean
        get() = count >= BaselineStore.WARM_MIN_COUNT &&
            (lastSeenMs - firstSeenMs) >= BaselineStore.WARM_MIN_MS
}

/**
 * Per-user rolling baseline with online (weighted Welford) accumulation, 28-day
 * exponential decay, and 4-hour circadian buckets. On-device only, stored in
 * EncryptedSharedPreferences. Mirrors iOS BaselineStore.swift.
 *
 * INVARIANTS (CLAUDE.md #4, plan T1.6):
 * - `z(...)` returns null until the relevant bucket is warm (n >= 200 AND >= 3 days).
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
            persist()
        }
    }

    /** Snapshot of a bucket's baseline (null if never observed). */
    fun baseline(signal: String, atMs: Long): Baseline? {
        synchronized(lock) {
            val k = keyFor(signal, circadianBucket(atMs))
            return accumulators[k]?.snapshot()
        }
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
        } ?: return
        try {
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
    }

    companion object {
        const val WARM_MIN_COUNT = 200
        const val WARM_MIN_DAYS = 3
        const val WARM_MIN_MS = WARM_MIN_DAYS.toLong() * 86_400_000L
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
