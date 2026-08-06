package com.thevoid.sensing.affect

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The device-local affect estimate (float z-scores).
 *
 * INVARIANTS:
 * - All fields are personal-baseline z-scores (CLAUDE.md #4); absolute physiological
 *   values are forbidden here.
 * - This Kotlin value is the DEVICE-LOCAL representation. Only its quantized, DP-noised
 *   projection (produced by the PrivacyGate) is allowed to cross the JS bridge /
 *   network boundary as `void.v3.AffectState`. This type carries NO raw buffers.
 * - Arousal is never a standalone reward (CLAUDE.md #3); it is auxiliary.
 */
data class AffectStateLocal(
    val valenceZ: Double,
    val arousalZ: Double,
    val attentionZ: Double,
    /** Model-reported confidence in [0,1] (heteroscedastic head). */
    val confidenceUnit: Double,
    /** Bitfield of contributing sources (see [com.thevoid.sensing.AffectSource]). */
    val sourceMask: Int,
    val windowEndMs: Long,
) {
    companion object {
        fun clampedConfidence(raw: Double): Double = min(1.0, max(0.0, raw))

        /**
         * Quantize a z-score to int8 [-128,127] mapping [-4sigma,+4sigma], matching the
         * `void.v3.AffectState` wire contract. Pure/device-local — does NOT emit
         * anything; emission is the PrivacyGate's single exit point.
         */
        fun quantizeZ(z: Double): Int {
            val clamped = min(4.0, max(-4.0, z))
            val scaled = (clamped / 4.0) * 127.0
            return scaled.roundToInt().coerceIn(-128, 127)
        }
    }
}

/**
 * The 30-second, baseline-normalized feature window fed to the affect model.
 *
 * Every series here is ALREADY per-user z-scored upstream (BaselineStore); absolute
 * units never enter the model. `baselineWarm` reflects whether the contributing
 * baselines were warm — the estimator returns null when they are not.
 */
data class AffectWindow(
    val windowEndMs: Long,
    val sourceMask: Int,
    val baselineWarm: Boolean,
    val hrZ: DoubleArray = DoubleArray(0),
    val hrvZ: DoubleArray = DoubleArray(0),
    val motionZ: DoubleArray = DoubleArray(0),
    /**
     * Blendshape-derived valence z — LOW CONFIDENCE (Barrett); weighted by
     * `trackingQualityMean` inside the estimator.
     */
    val blendshapeValenceZ: DoubleArray = DoubleArray(0),
    val attentionZ: DoubleArray = DoubleArray(0),
    val trackingQualityMean: Double = 0.0,
)

/** Anything that can turn a feature window into an affect estimate. */
interface AffectEstimating {
    /** Returns null when baselines are not warm (never a fabricated estimate). */
    fun estimate(window: AffectWindow): AffectStateLocal?
}

/**
 * A deterministic, dependency-free affect estimator used for pipeline wiring and as a
 * graceful fallback when the TFLite model is unavailable. Mirrors iOS
 * HeuristicAffectEstimator. It is NOT the production model.
 */
class HeuristicAffectEstimator : AffectEstimating {
    override fun estimate(window: AffectWindow): AffectStateLocal? {
        // Invariant: no estimate until baselines are warm.
        if (!window.baselineWarm) return null

        // Arousal: driven by HR (and inverse HRV) — auxiliary only.
        val arousal = 0.6 * mean(window.hrZ) - 0.4 * mean(window.hrvZ)

        // Valence: blendshape-derived, DOWN-WEIGHTED by tracking quality (Barrett).
        val valence = window.trackingQualityMean * mean(window.blendshapeValenceZ)

        val attention = mean(window.attentionZ)

        // Heteroscedastic confidence: more samples & better tracking -> higher; high
        // motion -> lower (noisy). Bounded to [0,1].
        val sampleSupport = min(1.0, window.hrZ.size / 30.0)
        val motionPenalty = min(1.0, abs(mean(window.motionZ)) / 2.0)
        val confidence = sampleSupport *
            (0.4 + 0.6 * window.trackingQualityMean) *
            (1.0 - 0.5 * motionPenalty)

        return AffectStateLocal(
            valenceZ = valence,
            arousalZ = arousal,
            attentionZ = attention,
            confidenceUnit = AffectStateLocal.clampedConfidence(confidence),
            sourceMask = window.sourceMask,
            windowEndMs = window.windowEndMs,
        )
    }

    private fun mean(xs: DoubleArray): Double = if (xs.isEmpty()) 0.0 else xs.sum() / xs.size
}
