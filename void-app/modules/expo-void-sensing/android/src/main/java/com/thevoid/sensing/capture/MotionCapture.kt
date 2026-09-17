package com.thevoid.sensing.capture

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.thevoid.sensing.Vector3
import kotlin.math.sqrt

/**
 * A single IMU sample. Gravity has already been removed (`userAccel`, in g).
 *
 * REALITY-CHECK: this is raw IMU and is Tier-0 device-local ONLY. It must never be
 * serialized to the JS bridge or a network call (CLAUDE.md invariant #1). Only the
 * downstream quantized `AffectState` is allowed across the boundary.
 */
data class MotionSample(
    /** Seconds, monotonic device timebase (SensorEvent.timestamp / 1e9). */
    val timestamp: Double,
    /** User acceleration in g (gravity removed). */
    val userAccel: Vector3,
    /** Rotation rate in rad/s. */
    val rotationRate: Vector3 = Vector3.ZERO,
)

/**
 * Tier-0 motion capture: SensorManager LINEAR_ACCELERATION + GYROSCOPE @~50Hz into a
 * fixed-capacity 60s ring.
 *
 * Design notes / plan compliance (mirrors iOS MotionCapture.swift):
 * - 50 Hz updates -> capacity 3000 samples for a 60s window.
 * - `motionEnergy` = RMS of userAccel magnitude (in g) over the trailing 2s.
 * - Uses TYPE_LINEAR_ACCELERATION (gravity already removed) so a stationary device
 *   reads ~0 energy, matching the iOS `userAcceleration` semantics. Falls back to
 *   TYPE_ACCELEROMETER when linear acceleration is unavailable. Accel is divided by
 *   g (9.80665) so thresholds match the iOS units (energy in g).
 * - NO activity-recognition / step APIs (those prompt) in Tier 0.
 *
 * The ring core is pure and testable without a device. The device binding
 * (register/unregister) only runs where a SensorManager exists.
 */
class MotionCapture(private val context: Context? = null) : SensorEventListener {

    private val lock = Any()
    private val ring = ArrayList<MotionSample>(CAPACITY)
    private var writeIndex = 0

    /** Append one sample, evicting the oldest when at capacity. */
    fun ingest(sample: MotionSample) {
        synchronized(lock) {
            if (ring.size < CAPACITY) {
                ring.add(sample)
            } else {
                ring[writeIndex] = sample
            }
            writeIndex = (writeIndex + 1) % CAPACITY
        }
    }

    /** Snapshot of currently retained samples in chronological order. */
    val samples: List<MotionSample>
        get() = synchronized(lock) {
            if (ring.size < CAPACITY) {
                ArrayList(ring)
            } else {
                // Ring is full: reorder from oldest to newest.
                val out = ArrayList<MotionSample>(CAPACITY)
                out.addAll(ring.subList(writeIndex, ring.size))
                out.addAll(ring.subList(0, writeIndex))
                out
            }
        }

    val count: Int get() = synchronized(lock) { ring.size }

    /** RMS of userAccel magnitude over the trailing `ENERGY_WINDOW_SECONDS`. */
    val motionEnergy: Double
        get() = motionEnergy(samples, ENERGY_WINDOW_SECONDS)

    // MARK: - Device binding

    private var sensorManager: SensorManager? = null
    private var lastRotation: Vector3 = Vector3.ZERO

    /** Start ~50Hz sensor updates. No-op when no SensorManager / accelerometer. */
    fun start() {
        val ctx = context ?: return
        if (sensorManager != null) return // already registered
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
        sensorManager = sm
        val accel = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
            ?: sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        // 20_000 us == 50 Hz.
        accel?.let { sm.registerListener(this, it, SAMPLE_PERIOD_US) }
        gyro?.let { sm.registerListener(this, it, SAMPLE_PERIOD_US) }
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        sensorManager = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_GYROSCOPE -> {
                lastRotation = Vector3(
                    event.values[0].toDouble(),
                    event.values[1].toDouble(),
                    event.values[2].toDouble(),
                )
            }
            Sensor.TYPE_LINEAR_ACCELERATION, Sensor.TYPE_ACCELEROMETER -> {
                // Convert m/s^2 -> g so thresholds match the iOS units.
                val ua = Vector3(
                    event.values[0].toDouble() / G,
                    event.values[1].toDouble() / G,
                    event.values[2].toDouble() / G,
                )
                ingest(
                    MotionSample(
                        timestamp = event.timestamp.toDouble() / 1_000_000_000.0,
                        userAccel = ua,
                        rotationRate = lastRotation,
                    ),
                )
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }

    companion object {
        const val SAMPLE_RATE_HZ = 50.0
        const val WINDOW_SECONDS = 60.0
        const val ENERGY_WINDOW_SECONDS = 2.0
        const val CAPACITY = (SAMPLE_RATE_HZ * WINDOW_SECONDS).toInt() // 3000
        const val SAMPLE_PERIOD_US = 20_000 // 50 Hz
        const val G = 9.80665

        /**
         * Pure energy metric — RMS of userAccel magnitude over the trailing window.
         * Kept static so it can be exercised directly against fixtures.
         */
        fun motionEnergy(samples: List<MotionSample>, windowSeconds: Double): Double {
            val last = samples.lastOrNull() ?: return 0.0
            val cutoff = last.timestamp - windowSeconds
            var sumSq = 0.0
            var n = 0
            for (s in samples) {
                if (s.timestamp >= cutoff) {
                    sumSq += s.userAccel.magnitudeSquared
                    n += 1
                }
            }
            if (n == 0) return 0.0
            return sqrt(sumSq / n.toDouble())
        }
    }
}
