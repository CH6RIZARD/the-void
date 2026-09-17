package com.thevoid.sensing.privacy

import com.thevoid.sensing.affect.AffectEstimating
import com.thevoid.sensing.affect.AffectStateLocal
import com.thevoid.sensing.affect.AffectWindow
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * The quantized, DP-noised affect vector — the ONLY physiological payload allowed to
 * cross the JS bridge / network boundary. Field names mirror index.ts `AffectState`.
 */
data class EmittedAffectState(
    val valenceZ: Int,      // int8 [-128,127]
    val arousalZ: Int,
    val attentionZ: Int,
    val confidence: Int,    // 0..100
    val sourceMask: Int,
    val windowEndMs: Long,
    val dpApplied: Boolean,
    /** Impression whose lag-aligned window overlaps this estimate, if any. */
    val impressionId: String? = null,
) {
    fun toMap(): Map<String, Any?> {
        val m = HashMap<String, Any?>()
        m["valenceZ"] = valenceZ
        m["arousalZ"] = arousalZ
        m["attentionZ"] = attentionZ
        m["confidence"] = confidence
        m["sourceMask"] = sourceMask
        // JS numbers are doubles; ms timestamps fit exactly.
        m["windowEndMs"] = windowEndMs.toDouble()
        m["dpApplied"] = dpApplied
        if (impressionId != null) m["impressionId"] = impressionId
        return m
    }
}

/**
 * Local differential privacy on the QUANTIZED int8 output.
 *
 * Each emit releases three int8 z-scores. To bound sensitivity, every true value is
 * first clipped to a window of ±[clipHalfWidth] units around the PREVIOUS released
 * (already-noised, hence public) value, so any two inputs differ by at most
 * `sensitivity = 2 * clipHalfWidth` (= 8 units ≈ 0.25σ). Laplace noise with scale
 * `sensitivity / perEmitEpsilon` is then added. Released values are post-processing of
 * public data plus the noised true value, so the per-emit guarantee is ε = [perEmitEpsilon]
 * per dimension-bounded release.
 *
 * The epsilon ledger resets once per local day. When the daily budget is spent, the
 * gate stops emitting (never emits un-noised data).
 */
class DPMechanism(
    private val perEmitEpsilon: Double = DEFAULT_PER_EMIT_EPSILON,
    private val dailyBudget: Double = DEFAULT_DAILY_BUDGET,
    private val sensitivity: Double = DEFAULT_SENSITIVITY,
    private val rng: Random = Random.Default,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private var spent = 0.0
    private var dayKey = -1
    private val clipHalfWidth: Int = (sensitivity / 2.0).roundToInt().coerceAtLeast(1)

    /** Last released values (public), used as the clip centre. */
    private var lastV: Int? = null
    private var lastA: Int? = null
    private var lastAtt: Int? = null

    private fun rollDay() {
        val cal = Calendar.getInstance()
        cal.timeInMillis = clock()
        val key = cal.get(Calendar.YEAR) * 1000 + cal.get(Calendar.DAY_OF_YEAR)
        if (key != dayKey) {
            dayKey = key
            spent = 0.0
        }
    }

    val remainingBudget: Double
        get() = synchronized(this) {
            rollDay()
            dailyBudget - spent
        }

    /** True while there is budget left today for at least one more emit. */
    fun hasBudget(): Boolean = synchronized(this) {
        rollDay()
        spent + perEmitEpsilon <= dailyBudget
    }

    /** Spend one epsilon quantum. Returns false when today's budget cannot cover it. */
    fun spend(): Boolean = synchronized(this) {
        rollDay()
        if (spent + perEmitEpsilon > dailyBudget) {
            false
        } else {
            spent += perEmitEpsilon
            true
        }
    }

    /** Clip → Laplace noise → clamp int8 for the three affect dimensions. */
    fun release(v: Int, a: Int, att: Int): Triple<Int, Int, Int> = synchronized(this) {
        val outV = noised(v, lastV)
        val outA = noised(a, lastA)
        val outAtt = noised(att, lastAtt)
        lastV = outV
        lastA = outA
        lastAtt = outAtt
        Triple(outV, outA, outAtt)
    }

    /** Forget the clip centre (e.g. after a long pause), so the next emit starts fresh. */
    fun resetCentre() {
        synchronized(this) {
            lastV = null
            lastA = null
            lastAtt = null
        }
    }

    private fun noised(value: Int, centre: Int?): Int {
        // With no previous release the clip centre is neutral (0), so the first emits
        // start near neutral and track the true value by at most clipHalfWidth per emit.
        val c = centre ?: 0
        val clipped = value.coerceIn(c - clipHalfWidth, c + clipHalfWidth)
        val noisy: Double = clipped.toDouble() + laplace(sensitivity / perEmitEpsilon)
        return noisy.roundToInt().coerceIn(-128, 127)
    }

    private fun laplace(scale: Double): Double {
        // u in (-0.5, 0.5); guard |u| = 0.5 which would give ln(0).
        var u = rng.nextDouble() - 0.5
        if (abs(u) >= 0.4999999) u = if (u < 0) -0.4999999 else 0.4999999
        val sign = if (u < 0) -1.0 else 1.0
        return -scale * sign * ln(1.0 - 2.0 * abs(u))
    }

    companion object {
        /** ε per emit. */
        const val DEFAULT_PER_EMIT_EPSILON = 1.0
        /** Daily ε ledger: at the 2s emit cadence this allows ~11 h of emits per day. */
        const val DEFAULT_DAILY_BUDGET = 20_000.0
        /** int8 units (8/127·4σ ≈ 0.25σ). */
        const val DEFAULT_SENSITIVITY = 8.0
    }
}

/**
 * The SINGLE emit() exit point for affect data.
 *
 * Order (must not be reordered or bypassed):
 *   consent -> kill switch -> model estimate -> quantize int8 -> daily ε budget ->
 *   clip + Laplace noise -> dp_applied = true -> emit.
 *
 * Returns null when ANY gate fails. This is the only place an [EmittedAffectState] is
 * constructed; raw sensor buffers never reach here.
 */
class PrivacyGate(
    private val consentManager: ConsentManager,
    private val killSwitch: KillSwitch,
    private val estimator: AffectEstimating,
    private val dp: DPMechanism = DPMechanism(),
) {
    /**
     * Produce the emittable, DP-noised state for a window, or null if gated.
     *
     * @param confidenceScale multiplier in [0,1] applied to the model confidence (e.g.
     *   baseline warm-up `min(1, samples/200)`).
     */
    fun produce(
        window: AffectWindow,
        confidenceScale: Double = 1.0,
        impressionId: String? = null,
    ): EmittedAffectState? {
        // 1. Consent (explicit, unbundled).
        if (!consentManager.snapshot().affectConsent) return null
        // 2. Kill switch.
        if (!killSwitch.isEnabled()) return null
        // 3. Model estimate (null until at least one baseline is warm).
        val local: AffectStateLocal = estimator.estimate(window) ?: return null
        // 4. Quantize to int8.
        val qv = AffectStateLocal.quantizeZ(local.valenceZ)
        val qa = AffectStateLocal.quantizeZ(local.arousalZ)
        val qatt = AffectStateLocal.quantizeZ(local.attentionZ)
        // 5. Daily ε budget. If we cannot spend, do not emit.
        if (!dp.spend()) return null
        // 6. Clip + Laplace noise.
        val (outV, outA, outAtt) = dp.release(qv, qa, qatt)

        val scale = if (confidenceScale.isNaN()) 0.0 else confidenceScale.coerceIn(0.0, 1.0)
        val confidence = (local.confidenceUnit * scale * 100.0).roundToInt().coerceIn(0, 100)

        return EmittedAffectState(
            valenceZ = outV,
            arousalZ = outA,
            attentionZ = outAtt,
            confidence = confidence,
            sourceMask = local.sourceMask,
            windowEndMs = local.windowEndMs,
            dpApplied = true,
            impressionId = impressionId,
        )
    }

    fun resetNoiseCentre() {
        dp.resetCentre()
    }
}
