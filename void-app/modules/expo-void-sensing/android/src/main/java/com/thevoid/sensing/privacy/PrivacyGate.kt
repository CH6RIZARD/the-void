package com.thevoid.sensing.privacy

import com.thevoid.sensing.affect.AffectEstimating
import com.thevoid.sensing.affect.AffectStateLocal
import com.thevoid.sensing.affect.AffectWindow
import kotlin.math.abs
import kotlin.math.ln
import kotlin.random.Random

/**
 * The quantized, DP-noised affect vector — the ONLY physiological payload allowed to
 * cross the JS bridge / network boundary. Field names mirror index.ts `AffectState`
 * and schemas/affect.proto exactly.
 */
data class EmittedAffectState(
    val valenceZ: Int,      // int8 [-128,127]
    val arousalZ: Int,
    val attentionZ: Int,
    val confidence: Int,    // 0..100
    val sourceMask: Int,
    val windowEndMs: Long,
    val dpApplied: Boolean,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "valenceZ" to valenceZ,
        "arousalZ" to arousalZ,
        "attentionZ" to attentionZ,
        "confidence" to confidence,
        "sourceMask" to sourceMask,
        // JS numbers are doubles; ms timestamps fit exactly.
        "windowEndMs" to windowEndMs.toDouble(),
        "dpApplied" to dpApplied,
    )
}

/**
 * Bounded-budget Laplace differential-privacy mechanism over the int8 z-score fields.
 * Sensitivity is the full int8 range (256); each emit spends [perEmitEpsilon] of the
 * total [epsilonBudget]. When the budget is exhausted, emission STOPS (returns null)
 * rather than leaking un-noised data.
 */
class DPMechanism(
    private val perEmitEpsilon: Double = DEFAULT_PER_EMIT_EPSILON,
    private val epsilonBudget: Double = DEFAULT_BUDGET,
    private val sensitivity: Double = 256.0,
    private val rng: Random = Random.Default,
) {
    private var spent = 0.0

    val remainingBudget: Double get() = synchronized(this) { epsilonBudget - spent }

    /** True while there is budget left for at least one more emit. */
    fun hasBudget(): Boolean = synchronized(this) { spent + perEmitEpsilon <= epsilonBudget }

    /** Spend one epsilon quantum. Returns false when the budget cannot cover it. */
    fun spend(): Boolean {
        synchronized(this) {
            if (spent + perEmitEpsilon > epsilonBudget) return false
            spent += perEmitEpsilon
            return true
        }
    }

    /** Add Laplace(0, sensitivity/epsilon) noise, then clamp to int8. */
    fun noiseInt8(value: Int): Int {
        val scale = sensitivity / perEmitEpsilon
        val u = rng.nextDouble() - 0.5
        val laplace = -scale * sign(u) * ln(1.0 - 2.0 * abs(u))
        return (value + laplace).toInt().coerceIn(-128, 127)
    }

    private fun sign(x: Double): Double = if (x > 0) 1.0 else if (x < 0) -1.0 else 0.0

    companion object {
        const val DEFAULT_PER_EMIT_EPSILON = 0.1
        /** Total epsilon spendable per session/window store. */
        const val DEFAULT_BUDGET = 10.0
    }
}

/**
 * The SINGLE emit() exit point for affect data (plan T1.9, HUMAN GATE).
 *
 * Order (must not be reordered or bypassed):
 *   consent -> kill switch -> model estimate -> quantize int8 -> DP noise ->
 *   epsilon budget -> dp_applied = true -> emit.
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
     * @param requireDp when true (production), an emit without applied DP is suppressed.
     */
    fun produce(window: AffectWindow, requireDp: Boolean = true): EmittedAffectState? {
        // 1. Consent (explicit, unbundled).
        if (!consentManager.snapshot().affectConsent) return null
        // 2. Kill switch.
        if (!killSwitch.isEnabled()) return null
        // 3. Model estimate (null until baselines warm AND a model ships).
        val local: AffectStateLocal = estimator.estimate(window) ?: return null
        // 4. Epsilon budget.
        if (requireDp && !dp.hasBudget()) return null

        // 5. Quantize to int8.
        val qv = AffectStateLocal.quantizeZ(local.valenceZ)
        val qa = AffectStateLocal.quantizeZ(local.arousalZ)
        val qatt = AffectStateLocal.quantizeZ(local.attentionZ)

        // 6. DP noise (+ spend budget). If we cannot spend, do not emit un-noised data.
        var dpApplied = false
        var outV = qv
        var outA = qa
        var outAtt = qatt
        if (dp.spend()) {
            outV = dp.noiseInt8(qv)
            outA = dp.noiseInt8(qa)
            outAtt = dp.noiseInt8(qatt)
            dpApplied = true
        } else if (requireDp) {
            return null
        }

        val confidence = (local.confidenceUnit * 100.0).toInt().coerceIn(0, 100)

        return EmittedAffectState(
            valenceZ = outV,
            arousalZ = outA,
            attentionZ = outAtt,
            confidence = confidence,
            sourceMask = local.sourceMask,
            windowEndMs = local.windowEndMs,
            dpApplied = dpApplied,
        )
    }
}
