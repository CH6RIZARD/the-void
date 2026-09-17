package com.thevoid.sensing.capture

/** A face-rPPG heart-rate estimate. Device-local only. */
data class RPPGReading(
    val bpm: Double,
    /** [0,1] from in-band SNR. */
    val quality: Double,
    val atMs: Long,
)

/**
 * Remote PPG from the front camera: the per-frame forehead+cheek mean green value
 * (from [FaceCapture]) goes into a ring buffer, is resampled to a uniform grid and run
 * through the shared band-pass + DFT in [PulseDsp] (same filters as [PPGCapture]).
 *
 * A reading is produced only when the caller says the phone is still (MotionGate
 * passed) and a face is present, the window is long enough, the peak lies in
 * 45–180 bpm and the quality clears [MIN_QUALITY]. The buffer holds scalars only.
 */
class RPPGCapture {

    private val lock = Any()
    private val tMs = LongArray(CAPACITY)
    private val values = DoubleArray(CAPACITY)
    private var head = 0
    private var size = 0

    @Volatile
    var lastReading: RPPGReading? = null
        private set

    /** Add one ROI-mean green sample. */
    fun push(timestampMs: Long, green: Double) {
        if (!green.isFinite()) return
        synchronized(lock) {
            // Drop out-of-order samples and restart after a long gap.
            if (size > 0) {
                val lastT = tMs[(head - 1 + CAPACITY) % CAPACITY]
                if (timestampMs <= lastT) return
                if (timestampMs - lastT > MAX_GAP_MS) {
                    head = 0
                    size = 0
                }
            }
            tMs[head] = timestampMs
            values[head] = green
            head = (head + 1) % CAPACITY
            if (size < CAPACITY) size++
        }
    }

    fun clear() {
        synchronized(lock) {
            head = 0
            size = 0
        }
        lastReading = null
    }

    /**
     * Estimate heart rate over the trailing [WINDOW_MS]. Returns null (and keeps the
     * previous reading) when gated or when the signal is not good enough.
     */
    fun estimate(nowMs: Long, still: Boolean, facePresent: Boolean): RPPGReading? {
        if (!still || !facePresent) return null
        val snapshot: Pair<LongArray, DoubleArray> = synchronized(lock) {
            val start = (head - size + CAPACITY) % CAPACITY
            val tList = ArrayList<Long>(size)
            val vList = ArrayList<Double>(size)
            for (i in 0 until size) {
                val idx = (start + i) % CAPACITY
                if (nowMs - tMs[idx] <= WINDOW_MS) {
                    tList.add(tMs[idx])
                    vList.add(values[idx])
                }
            }
            Pair(tList.toLongArray(), vList.toDoubleArray())
        }
        val ts = snapshot.first
        val vs = snapshot.second
        if (ts.size < MIN_SAMPLES) return null
        val spanMs = ts[ts.size - 1] - ts[0]
        if (spanMs < MIN_SPAN_MS) return null
        // Stale: face lost for a while.
        if (nowMs - ts[ts.size - 1] > 2_000L) return null

        val actualFs = PulseDsp.sampleRate(ts)
        if (actualFs < 4.0) return null
        // Nyquist of the real capture rate bounds the usable band.
        val highHz = minOf(BAND_HIGH_HZ, 0.45 * actualFs)
        val uniform = PulseDsp.resample(ts, vs, RESAMPLE_HZ)
        val est = PulseDsp.estimate(uniform, RESAMPLE_HZ, BAND_LOW_HZ, highHz) ?: return null
        if (est.bpm < MIN_BPM || est.bpm > MAX_BPM || est.quality < MIN_QUALITY) return null
        val reading = RPPGReading(est.bpm, est.quality, nowMs)
        lastReading = reading
        return reading
    }

    companion object {
        const val CAPACITY = 256            // ≈25 s at 10 fps
        const val WINDOW_MS = 15_000L
        const val MIN_SPAN_MS = 8_000L
        const val MIN_SAMPLES = 40
        const val MAX_GAP_MS = 1_500L
        const val RESAMPLE_HZ = 10.0
        const val BAND_LOW_HZ = 0.75        // 45 bpm
        const val BAND_HIGH_HZ = 3.0        // 180 bpm
        const val MIN_BPM = 45.0
        const val MAX_BPM = 180.0
        const val MIN_QUALITY = 0.25
    }
}
