package com.thevoid.sensing

import kotlin.math.sqrt

/**
 * A minimal 3-component vector used by the sensing layer.
 *
 * Mirrors the iOS `Vector3` (see void-rank ios/.../Support/Geometry.swift). Pure
 * value type; never serialized across the JS bridge or the network.
 */
data class Vector3(
    val x: Double = 0.0,
    val y: Double = 0.0,
    val z: Double = 0.0,
) {
    /** Euclidean magnitude. */
    val magnitude: Double get() = sqrt(x * x + y * y + z * z)

    /** Squared magnitude (cheaper; used inside RMS accumulation). */
    val magnitudeSquared: Double get() = x * x + y * y + z * z

    companion object {
        val ZERO = Vector3(0.0, 0.0, 0.0)
    }
}

/**
 * Source bit-flags for `AffectState.sourceMask`.
 * Mirrors `schemas/affect.proto` `source_mask` bitfield exactly.
 */
object AffectSource {
    const val PPG: Int = 1
    const val FACE: Int = 2
    const val MOTION: Int = 4
    const val TOUCH: Int = 8
    const val WATCH: Int = 16
}
