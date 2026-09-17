package com.thevoid.sensing.pipeline

/** Why a window was accepted or rejected. */
enum class GateDecision {
    PASS,
    REJECT_MOTION,     // motion energy above threshold
    REJECT_ARTIFACT,   // sensor artifact (NaN / saturation / dropout)
}

/**
 * Result of gating one affect window.
 *
 * INVARIANT (CLAUDE.md #5 / plan T1.5): the gate DISCARDS, it never imputes. A rejected
 * window simply does not pass downstream — there is no substitute/imputed value.
 */
data class GateResult(
    val decision: GateDecision,
    val motionEnergy: Double,
) {
    val passed: Boolean get() = decision == GateDecision.PASS
}

/** Motion gate: rejects any window whose motion energy exceeds `energyThreshold`. */
class MotionGate(
    private val energyThreshold: Double = DEFAULT_THRESHOLD,
) {
    fun evaluate(motionEnergy: Double): GateResult {
        if (motionEnergy.isNaN() || motionEnergy.isInfinite()) {
            return GateResult(GateDecision.REJECT_ARTIFACT, motionEnergy)
        }
        if (motionEnergy > energyThreshold) {
            return GateResult(GateDecision.REJECT_MOTION, motionEnergy)
        }
        return GateResult(GateDecision.PASS, motionEnergy)
    }

    companion object {
        /** Plan T1.5 default. */
        const val DEFAULT_THRESHOLD = 0.08
    }
}

/**
 * Artifact rejection over a raw signal window (before affect inference). Flags
 * NaN/inf, flat dropouts, and saturated (rail-pinned) segments.
 */
class ArtifactReject(
    private val saturationFraction: Double = 0.5,
    private val minVariance: Double = 1e-9,
) {
    /** Returns true when the window is clean (no artifact). */
    fun isClean(samples: DoubleArray): Boolean {
        if (samples.isEmpty()) return false
        if (samples.any { it.isNaN() || it.isInfinite() }) return false
        val mn = samples.minOrNull()!!
        val mx = samples.maxOrNull()!!
        if (mn == mx) return false // fully flat
        val atRail = samples.count { it == mn || it == mx }
        if (atRail.toDouble() / samples.size >= saturationFraction && (mx - mn) > 0) {
            val distinctExtremeOnly = samples.toHashSet().size <= 2
            if (distinctExtremeOnly) return false
        }
        val mean = samples.sum() / samples.size
        val variance = samples.fold(0.0) { acc, v -> acc + (v - mean) * (v - mean) } / samples.size
        if (variance < minVariance) return false
        return true
    }
}
