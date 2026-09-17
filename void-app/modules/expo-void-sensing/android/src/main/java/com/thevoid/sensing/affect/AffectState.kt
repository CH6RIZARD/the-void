package com.thevoid.sensing.affect

import kotlin.math.abs
import kotlin.math.exp
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
    /** Model-reported confidence in [0,1]. */
    val confidenceUnit: Double,
    /** Bitfield of contributing sources (see [com.thevoid.sensing.AffectSource]). */
    val sourceMask: Int,
    val windowEndMs: Long,
) {
    companion object {
        fun clampedConfidence(raw: Double): Double =
            if (raw.isNaN()) 0.0 else min(1.0, max(0.0, raw))

        /**
         * Quantize a z-score to int8 [-128,127] mapping [-4sigma,+4sigma], matching the
         * `void.v3.AffectState` wire contract. Pure/device-local — does NOT emit
         * anything; emission is the PrivacyGate's single exit point.
         */
        fun quantizeZ(z: Double): Int {
            if (z.isNaN()) return 0
            val clamped = min(4.0, max(-4.0, z))
            val scaled = (clamped / 4.0) * 127.0
            return scaled.roundToInt().coerceIn(-128, 127)
        }
    }
}

/** Face features from the front camera (already aggregated; no frames). */
data class FaceInputs(
    /** Blink-rate z-score vs the personal baseline (null until warm). */
    val blinkRateZ: Double?,
    /** Fraction [0,1] of recent frames with the head facing the screen. */
    val gazeOnScreen: Double,
    /** Smile probability [0,1] (ML Kit classifier), smoothed. */
    val smileProb: Double,
    /** Smile z-score vs the personal baseline (null until warm). */
    val smileZ: Double?,
    /** [0,1]: fraction of recent frames with a face detected. */
    val quality: Double,
)

/** Heart rate/HRV from whichever source won the priority race. */
data class HeartInputs(
    val hrZ: Double?,
    val hrvZ: Double?,
    /** [0,1] reliability of the source (BLE strap high, face rPPG low). */
    val sourceConfidence: Double,
)

/** Touch/scroll kinematics, z-scored per user. */
data class TouchInputs(
    val speedZ: Double?,
    val jitterZ: Double?,
    val reversalZ: Double?,
    /** Events observed in the window (support). */
    val events: Int,
)

/** Context used only for gating/confidence, never as affect evidence on its own. */
data class ContextInputs(
    /** Proximity sensor reports "near" (phone in pocket / against face). */
    val proximityNear: Boolean,
    /** Ambient light too low for camera signals. */
    val lowLight: Boolean,
    val headphones: Boolean,
)

/**
 * The baseline-normalized feature window fed to the affect model.
 *
 * Every z-series is ALREADY per-user z-scored upstream (BaselineStore); absolute
 * units never enter the model. `baselineWarm` reflects whether at least one
 * contributing baseline was warm — the estimator returns null when none are.
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
    // Extended inputs (all optional).
    val face: FaceInputs? = null,
    val heart: HeartInputs? = null,
    val touch: TouchInputs? = null,
    val context: ContextInputs? = null,
)

/** Anything that can turn a feature window into an affect estimate. */
interface AffectEstimating {
    /** Returns null when baselines are not warm (never a fabricated estimate). */
    fun estimate(window: AffectWindow): AffectStateLocal?
}

/**
 * A deterministic, dependency-free affect estimator. Used until a trained model
 * ships. Mirrors iOS HeuristicAffectEstimator. It is NOT a validated model: its
 * confidence is deliberately capped so the ranker weights it modestly.
 *
 * Each dimension is a confidence-weighted mean of the evidence that is present:
 *  - arousal:   HR z (+), HRV z (−), blink-rate z (+), touch speed/jitter z (+), motion z (+)
 *  - valence:   smile (+) — face only, down-weighted by tracking quality
 *  - attention: gaze on screen (+), touch reversals z (−), blink-rate z (−), motion z (−)
 */
class HeuristicAffectEstimator : AffectEstimating {

    private class Acc {
        var sum = 0.0
        var w = 0.0
        fun add(value: Double?, weight: Double) {
            if (value == null || value.isNaN() || weight <= 0.0) return
            sum += clampZ(value) * weight
            w += weight
        }
        fun mean(): Double = if (w > 0.0) sum / w else 0.0
    }

    override fun estimate(window: AffectWindow): AffectStateLocal? {
        // Invariant: no estimate until at least one baseline is warm.
        if (!window.baselineWarm) return null

        val arousal = Acc()
        val valence = Acc()
        val attention = Acc()

        val ctx = window.context
        // Camera-derived evidence is unreliable in the dark or with the phone face-down.
        val cameraFactor = when {
            ctx == null -> 1.0
            ctx.proximityNear -> 0.0
            ctx.lowLight -> 0.4
            else -> 1.0
        }

        // Legacy array inputs (kept for compatibility with older callers).
        val legacyHr = meanOrNull(window.hrZ)
        val legacyHrv = meanOrNull(window.hrvZ)
        if (legacyHr != null) arousal.add(legacyHr, 0.6)
        if (legacyHrv != null) arousal.add(-legacyHrv, 0.4)
        meanOrNull(window.blendshapeValenceZ)?.let { valence.add(it, 0.5 * window.trackingQualityMean) }
        meanOrNull(window.attentionZ)?.let { attention.add(it, 0.5) }

        // Heart (BLE > calm reading > rPPG; confidence carried by the source).
        window.heart?.let { h ->
            val c = h.sourceConfidence.coerceIn(0.0, 1.0)
            arousal.add(h.hrZ, 1.2 * c)
            arousal.add(h.hrvZ?.let { -it }, 0.8 * c)
        }

        // Face.
        window.face?.let { f ->
            val q = f.quality.coerceIn(0.0, 1.0) * cameraFactor
            if (q > 0.0) {
                arousal.add(f.blinkRateZ, 0.3 * q)
                attention.add(f.blinkRateZ?.let { -0.5 * it }, 0.3 * q)
                // Gaze fraction -> z-like: 0.7 on screen is "typical", ±0.3 ≈ ±1.5σ.
                attention.add((f.gazeOnScreen - 0.7) * 5.0, 1.0 * q)
                val smile = f.smileZ ?: ((f.smileProb - 0.25) * 4.0)
                valence.add(smile, 0.6 * q)
            }
        }

        // Touch kinematics.
        window.touch?.let { t ->
            if (t.events >= MIN_TOUCH_EVENTS) {
                val support = min(1.0, t.events / 40.0)
                arousal.add(t.speedZ, 0.35 * support)
                arousal.add(t.jitterZ, 0.25 * support)
                attention.add(t.reversalZ?.let { -it }, 0.4 * support)
            }
        }

        // Motion (micro-tremor / fidgeting). Motion-gated upstream, so this is small.
        val motion = meanOrNull(window.motionZ)
        arousal.add(motion, 0.2)
        attention.add(motion?.let { -it }, 0.2)

        val totalW = arousal.w + valence.w + attention.w
        if (totalW <= 0.0) return null

        // Coverage-based confidence: saturates as independent evidence accumulates,
        // penalized by motion, capped (this is a heuristic, not a trained model).
        val coverage = 1.0 - exp(-totalW / 1.5)
        val motionPenalty = min(1.0, abs(motion ?: 0.0) / 2.0)
        var confidence = coverage * (1.0 - 0.5 * motionPenalty) * HEURISTIC_CONFIDENCE_CAP
        if (ctx?.proximityNear == true) confidence *= 0.5

        return AffectStateLocal(
            valenceZ = valence.mean(),
            arousalZ = arousal.mean(),
            attentionZ = attention.mean(),
            confidenceUnit = AffectStateLocal.clampedConfidence(confidence),
            sourceMask = window.sourceMask,
            windowEndMs = window.windowEndMs,
        )
    }

    private fun meanOrNull(xs: DoubleArray): Double? = if (xs.isEmpty()) null else xs.sum() / xs.size

    companion object {
        const val MIN_TOUCH_EVENTS = 6
        const val HEURISTIC_CONFIDENCE_CAP = 0.7
    }
}

private fun clampZ(z: Double): Double = min(4.0, max(-4.0, z))
