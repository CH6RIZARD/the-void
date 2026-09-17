package com.thevoid.sensing.pipeline

import kotlin.math.roundToLong

/**
 * The physiological signals we attribute, each with its characteristic response
 * latency relative to the stimulus (plan T1.7). Mirrors iOS Attribution.swift.
 */
enum class SignalKind(val latencySeconds: Double) {
    HEART_RATE(3.0),   // HR: 3s
    HRV(5.0),          // HRV: 5s
    PUPIL(1.0),        // pupil: 1s
    BLENDSHAPE(0.5),   // facial blendshape: 0.5s
    TOUCH(0.0);        // touch kinematics: immediate
}

/** The time span an impression was on screen. */
data class ImpressionSpan(
    val impressionId: String,
    val startMs: Long,
    val endMs: Long,
) {
    val exposureSeconds: Double
        get() = if (endMs > startMs) (endMs - startMs) / 1000.0 else 0.0
}

/**
 * One lag-aligned attribution of a signal to an impression.
 *
 * REALITY-CHECK (plan T1.7): fast scrolling yields FEW usable labels — that is correct,
 * not a bug. Samples with `confidence < 0.4` are DROPPED, never rescued.
 */
data class AttributionWindow(
    val impressionId: String,
    val signal: SignalKind,
    val signalStartMs: Long,
    val signalEndMs: Long,
    val confidence: Double,
    val dropped: Boolean,
)

/** Lag-aligned attribution of physiological responses to impressions. */
class Attribution(
    private val dropThreshold: Double = DROP_THRESHOLD,
    private val responseWindow: Double = RESPONSE_WINDOW_SECONDS,
) {
    /**
     * Confidence that the lag-aligned window captured a real response: the fraction of
     * the response window observed AFTER the signal's latency.
     */
    fun confidence(exposureSeconds: Double, signal: SignalKind): Double {
        val usable = exposureSeconds - signal.latencySeconds
        if (usable <= 0 || responseWindow <= 0) return 0.0
        return minOf(1.0, usable / responseWindow)
    }

    /** Align one signal to one impression, producing a (possibly dropped) window. */
    fun align(impression: ImpressionSpan, signal: SignalKind): AttributionWindow {
        val conf = confidence(impression.exposureSeconds, signal)
        val latencyMs = (signal.latencySeconds * 1000.0).roundToLong()
        val start = impression.startMs + latencyMs
        val end = maxOf(start, impression.endMs + latencyMs)
        return AttributionWindow(
            impressionId = impression.impressionId,
            signal = signal,
            signalStartMs = start,
            signalEndMs = end,
            confidence = conf,
            dropped = conf < dropThreshold,
        )
    }

    /** Align every signal kind to a batch of impressions. */
    fun alignAll(
        impressions: List<ImpressionSpan>,
        signals: List<SignalKind> = SignalKind.values().toList(),
    ): List<AttributionWindow> {
        val out = ArrayList<AttributionWindow>()
        for (imp in impressions) {
            for (sig in signals) {
                out.add(align(imp, sig))
            }
        }
        return out
    }

    companion object {
        /** Samples below this confidence are dropped (plan T1.7). */
        const val DROP_THRESHOLD = 0.4
        /**
         * Time (s) over which a lag-aligned response fully forms; longer exposure past
         * the signal latency -> higher attribution confidence.
         */
        const val RESPONSE_WINDOW_SECONDS = 8.0
    }
}

/**
 * Tracks impressions marked from JS (`markImpression`) and answers "which impression
 * does an affect window ending at T belong to?" using [Attribution]'s lag alignment.
 *
 * An impression is open from its mark until the next mark (the web marks the post
 * that became the primary visible one), capped at [MAX_SPAN_MS]. Device-local only.
 */
class ImpressionTracker(
    private val attribution: Attribution = Attribution(),
) {
    private data class Mark(val impressionId: String, val itemId: String, val startMs: Long)

    private val lock = Any()
    private val marks = ArrayDeque<Mark>()

    fun mark(impressionId: String, itemId: String, atMs: Long) {
        synchronized(lock) {
            marks.addLast(Mark(impressionId, itemId, atMs))
            while (marks.size > MAX_MARKS) marks.removeFirst()
        }
    }

    /**
     * The impression whose lag-aligned [signal] window contains [windowEndMs] and whose
     * attribution confidence is above the drop threshold, or null.
     */
    fun impressionFor(windowEndMs: Long, signal: SignalKind): String? {
        val snapshot: List<Mark> = synchronized(lock) { marks.toList() }
        for (i in snapshot.indices.reversed()) {
            val m = snapshot[i]
            val nextStart = if (i + 1 < snapshot.size) snapshot[i + 1].startMs else Long.MAX_VALUE
            val end = minOf(nextStart, m.startMs + MAX_SPAN_MS, windowEndMs)
            if (end <= m.startMs) continue
            val w = attribution.align(ImpressionSpan(m.impressionId, m.startMs, end), signal)
            if (!w.dropped && windowEndMs >= w.signalStartMs && windowEndMs <= w.signalEndMs + TOLERANCE_MS) {
                return m.impressionId
            }
        }
        return null
    }

    companion object {
        const val MAX_MARKS = 64
        const val MAX_SPAN_MS = 15_000L
        /** One tick of slack so a window ending right after the lagged span still counts. */
        const val TOLERANCE_MS = 1_000L
    }
}
