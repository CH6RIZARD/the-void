package com.thevoid.sensing.capture

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * A single touch event carrying KINEMATICS ONLY.
 *
 * PRIVACY INVARIANT (plan T1.2): we capture typing/scroll *kinematics*, never content
 * or keys. There is deliberately no field for the character typed, the key identity,
 * the text, or any glyph. Mirrors iOS TouchCapture.swift.
 */
data class TouchEvent(
    /** Normalized screen position [0,1]. */
    val x: Double,
    val y: Double,
    val timestamp: Double,
    val phase: Phase,
) {
    enum class Phase { BEGAN, MOVED, ENDED }
}

/** Deterministic scroll/typing kinematic features over a batch of touch events. */
data class TouchFeatures(
    val totalEvents: Int,
    val tapCount: Int,
    val flingCount: Int,
    val scrollVelocityMean: Double,
    val scrollVelocityStdDev: Double,
    val maxScrollVelocity: Double,
    val directionReversalCount: Int,
    val meanInterEventMs: Double,
) {
    companion object {
        val EMPTY = TouchFeatures(0, 0, 0, 0.0, 0.0, 0.0, 0, 0.0)
    }
}

/**
 * Tier-0 touch capture. Pure, deterministic feature extraction: identical event
 * streams always produce identical `TouchFeatures` (replay-stable).
 */
class TouchCapture(
    /**
     * Vertical velocity (normalized units/second) above which a scroll gesture is
     * classified as a fling.
     */
    private val flingVelocityThreshold: Double = 2.0,
    /** Movement magnitude below which a began->ended pair counts as a tap. */
    private val tapMovementThreshold: Double = 0.02,
) {
    fun features(events: List<TouchEvent>): TouchFeatures {
        if (events.size <= 1) {
            return if (events.isEmpty()) {
                TouchFeatures.EMPTY
            } else {
                TouchFeatures(events.size, 0, 0, 0.0, 0.0, 0.0, 0, 0.0)
            }
        }

        val velocities = ArrayList<Double>()      // signed vertical velocity per moved segment
        val interEvent = ArrayList<Double>()
        var tapCount = 0
        var flingCount = 0
        var reversals = 0
        var lastSignedVelSign = 0
        var gestureStart: TouchEvent? = null
        var lastGestureMovement = 0.0

        for (i in 1 until events.size) {
            val prev = events[i - 1]
            val cur = events[i]
            val dt = cur.timestamp - prev.timestamp
            interEvent.add(dt)

            when (cur.phase) {
                TouchEvent.Phase.BEGAN -> {
                    gestureStart = cur
                    lastGestureMovement = 0.0
                }
                TouchEvent.Phase.MOVED -> {
                    if (dt > 0) {
                        val vy = (cur.y - prev.y) / dt
                        velocities.add(vy)
                        lastGestureMovement += abs(cur.y - prev.y) + abs(cur.x - prev.x)
                        val sign = if (vy > 0) 1 else if (vy < 0) -1 else 0
                        if (sign != 0) {
                            if (lastSignedVelSign != 0 && sign != lastSignedVelSign) {
                                reversals += 1
                            }
                            lastSignedVelSign = sign
                        }
                    }
                }
                TouchEvent.Phase.ENDED -> {
                    if (dt > 0) {
                        val vy = (cur.y - prev.y) / dt
                        if (abs(vy) >= flingVelocityThreshold) {
                            flingCount += 1
                        }
                    }
                    val start = gestureStart
                    if (start != null) {
                        val travel = abs(cur.x - start.x) + abs(cur.y - start.y)
                        if (travel <= tapMovementThreshold && lastGestureMovement <= tapMovementThreshold) {
                            tapCount += 1
                        }
                    }
                    gestureStart = null
                }
            }
        }

        val speeds = velocities.map { abs(it) }
        val mean = if (speeds.isEmpty()) 0.0 else speeds.sum() / speeds.size
        val variance = if (speeds.isEmpty()) {
            0.0
        } else {
            speeds.fold(0.0) { acc, v -> acc + (v - mean) * (v - mean) } / speeds.size
        }
        val maxV = speeds.maxOrNull() ?: 0.0
        val meanDtMs = if (interEvent.isEmpty()) 0.0 else (interEvent.sum() / interEvent.size) * 1000.0

        return TouchFeatures(
            totalEvents = events.size,
            tapCount = tapCount,
            flingCount = flingCount,
            scrollVelocityMean = mean,
            scrollVelocityStdDev = sqrt(variance),
            maxScrollVelocity = maxV,
            directionReversalCount = reversals,
            meanInterEventMs = meanDtMs,
        )
    }
}
