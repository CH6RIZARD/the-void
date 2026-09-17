package com.thevoid.sensing.capture

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import java.util.Calendar

/** Coarse context. Used for gating/confidence only; never treated as affect evidence. */
data class ContextState(
    /** null when the device has no proximity sensor. */
    val proximityNear: Boolean?,
    /** Ambient light in lux; null when there is no light sensor. */
    val lux: Double?,
    val headphones: Boolean,
    /** 0..100, or -1 when unknown. */
    val batteryPct: Int,
    val charging: Boolean,
    val hourOfDay: Int,
    val sessionMs: Long,
) {
    val lowLight: Boolean get() = lux != null && lux < LOW_LIGHT_LUX

    fun toMap(): Map<String, Any?> = mapOf(
        "proximityNear" to proximityNear,
        "lux" to lux,
        "lowLight" to lowLight,
        "headphones" to headphones,
        "batteryPct" to batteryPct,
        "charging" to charging,
        "hourOfDay" to hourOfDay,
        "sessionMs" to sessionMs.toDouble(),
    )

    companion object {
        const val LOW_LIGHT_LUX = 10.0
    }
}

/** Proximity + ambient light (SensorManager), headphones (AudioManager), battery. */
class ContextCapture(private val context: Context?) : SensorEventListener {

    private var sensorManager: SensorManager? = null

    @Volatile
    private var near: Boolean? = null

    @Volatile
    private var lux: Double? = null

    @Volatile
    private var sessionStartMs = System.currentTimeMillis()

    fun start() {
        val ctx = context ?: return
        if (sensorManager != null) return
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
        sensorManager = sm
        sessionStartMs = System.currentTimeMillis()
        sm.getDefaultSensor(Sensor.TYPE_PROXIMITY)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        sm.getDefaultSensor(Sensor.TYPE_LIGHT)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        sensorManager = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_PROXIMITY -> {
                val v = event.values.getOrNull(0) ?: return
                near = v < event.sensor.maximumRange && v < 3f
            }
            Sensor.TYPE_LIGHT -> {
                val v = event.values.getOrNull(0) ?: return
                lux = v.toDouble()
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }

    fun snapshot(nowMs: Long = System.currentTimeMillis()): ContextState {
        val ctx = context
        var headphones = false
        var batteryPct = -1
        var charging = false
        if (ctx != null) {
            try {
                val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                val outputs = am?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
                headphones = outputs.any { isHeadphone(it.type) }
            } catch (t: Throwable) {
                // ignore
            }
            try {
                val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
                if (bm != null) {
                    batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                    charging = bm.isCharging
                }
            } catch (t: Throwable) {
                // ignore
            }
        }
        val cal = Calendar.getInstance()
        cal.timeInMillis = nowMs
        return ContextState(
            proximityNear = near,
            lux = lux,
            headphones = headphones,
            batteryPct = batteryPct,
            charging = charging,
            hourOfDay = cal.get(Calendar.HOUR_OF_DAY),
            sessionMs = nowMs - sessionStartMs,
        )
    }

    private fun isHeadphone(type: Int): Boolean {
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
        ) {
            return true
        }
        if (Build.VERSION.SDK_INT >= 26 && type == AudioDeviceInfo.TYPE_USB_HEADSET) return true
        if (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET) return true
        return false
    }
}
