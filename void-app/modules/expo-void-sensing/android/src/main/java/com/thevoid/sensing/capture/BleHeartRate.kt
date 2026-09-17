package com.thevoid.sensing.capture

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import java.util.UUID
import kotlin.math.sqrt

/** A heart-rate measurement from a BLE strap/watch. Device-local only. */
data class BleHeartReading(
    val bpm: Double,
    /** RMSSD over recent RR intervals (ms), or null when too few intervals. */
    val rmssdMs: Double?,
    val atMs: Long,
)

/**
 * Standard Bluetooth LE Heart Rate Service client (service 0x180D, measurement 0x2A37).
 * Works with Polar / Garmin / Wahoo straps and most watches in "broadcast HR" mode.
 *
 * Every call checks the runtime permissions first (Android 12+: BLUETOOTH_SCAN /
 * BLUETOOTH_CONNECT) and fails gracefully via [onStatus] instead of throwing. On
 * Android ≤ 11 BLE scanning additionally needs location, which this app does not
 * request, so scans may return nothing there.
 */
class BleHeartRate(
    private val context: Context,
    /** (id, name, rssi) for each distinct device found during a scan. */
    private val onDevice: (id: String, name: String?, rssi: Int) -> Unit,
    /** status: "scanning" | "scanDone" | "connecting" | "connected" | "disconnected" | "error". */
    private val onStatus: (status: String, id: String?, message: String?) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()

    private var scanner: BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null
    private val seen = HashSet<String>()

    private var gatt: BluetoothGatt? = null
    private var connectedId: String? = null

    private val rr = ArrayDeque<Double>()

    @Volatile
    var latest: BleHeartReading? = null
        private set

    val isConnected: Boolean get() = gatt != null && connectedId != null

    private fun adapter(): BluetoothAdapter? {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun hasScanPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= 31) granted(Manifest.permission.BLUETOOTH_SCAN) else true

    fun hasConnectPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= 31) granted(Manifest.permission.BLUETOOTH_CONNECT) else true

    /** Scan for HR-service devices for [durationMs]. Returns false when it could not start. */
    @SuppressLint("MissingPermission")
    fun scan(durationMs: Long = SCAN_MS): Boolean {
        if (!hasScanPermission()) {
            onStatus("error", null, "bluetooth scan permission not granted")
            return false
        }
        val ad = adapter()
        if (ad == null || !ad.isEnabled) {
            onStatus("error", null, "bluetooth unavailable or off")
            return false
        }
        val sc = ad.bluetoothLeScanner
        if (sc == null) {
            onStatus("error", null, "BLE scanner unavailable")
            return false
        }
        stopScan()
        synchronized(lock) { seen.clear() }
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                handleResult(result)
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                for (r in results) handleResult(r)
            }

            override fun onScanFailed(errorCode: Int) {
                onStatus("error", null, "scan failed ($errorCode)")
            }
        }
        return try {
            val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(HR_SERVICE)).build()
            val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
            sc.startScan(listOf(filter), settings, cb)
            scanner = sc
            scanCallback = cb
            onStatus("scanning", null, null)
            main.postDelayed({
                if (scanCallback === cb) {
                    stopScan()
                    onStatus("scanDone", null, null)
                }
            }, durationMs)
            true
        } catch (t: Throwable) {
            onStatus("error", null, t.message ?: "scan failed")
            false
        }
    }

    private fun handleResult(result: ScanResult) {
        val id = result.device?.address ?: return
        val isNew = synchronized(lock) { seen.add(id) }
        if (!isNew) return
        // scanRecord.deviceName needs no CONNECT permission (device.name does on 12+).
        val name = result.scanRecord?.deviceName
        onDevice(id, name, result.rssi)
    }

    @SuppressLint("MissingPermission")
    fun stopScan() {
        val sc = scanner
        val cb = scanCallback
        scanner = null
        scanCallback = null
        if (sc != null && cb != null && hasScanPermission()) {
            try {
                sc.stopScan(cb)
            } catch (t: Throwable) {
                // ignore
            }
        }
    }

    /** Connect to a device id (MAC address) from [scan]. Returns false if it cannot start. */
    @SuppressLint("MissingPermission")
    fun connect(id: String): Boolean {
        if (!hasConnectPermission()) {
            onStatus("error", id, "bluetooth connect permission not granted")
            return false
        }
        val ad = adapter()
        if (ad == null || !ad.isEnabled) {
            onStatus("error", id, "bluetooth unavailable or off")
            return false
        }
        if (!BluetoothAdapter.checkBluetoothAddress(id)) {
            onStatus("error", id, "invalid device id")
            return false
        }
        stopScan()
        disconnect()
        return try {
            val device: BluetoothDevice = ad.getRemoteDevice(id)
            onStatus("connecting", id, null)
            connectedId = id
            gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
            if (gatt == null) {
                connectedId = null
                onStatus("error", id, "connect failed")
                false
            } else {
                true
            }
        } catch (t: Throwable) {
            connectedId = null
            onStatus("error", id, t.message ?: "connect failed")
            false
        }
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        val g = gatt
        val id = connectedId
        gatt = null
        connectedId = null
        latest = null
        synchronized(lock) { rr.clear() }
        if (g != null) {
            try {
                if (hasConnectPermission()) {
                    g.disconnect()
                    g.close()
                }
            } catch (t: Throwable) {
                // ignore
            }
            onStatus("disconnected", id, null)
        }
    }

    private val callback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try {
                    if (hasConnectPermission()) gatt.discoverServices()
                } catch (t: Throwable) {
                    onStatus("error", connectedId, t.message ?: "service discovery failed")
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val id = connectedId
                if (this@BleHeartRate.gatt === gatt) {
                    this@BleHeartRate.gatt = null
                    connectedId = null
                    latest = null
                }
                try {
                    if (hasConnectPermission()) gatt.close()
                } catch (t: Throwable) {
                    // ignore
                }
                onStatus("disconnected", id, if (status != BluetoothGatt.GATT_SUCCESS) "status $status" else null)
            }
        }

        @Suppress("DEPRECATION")
        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            try {
                val ch = gatt.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)
                if (ch == null || !hasConnectPermission()) {
                    onStatus("error", connectedId, "device has no heart-rate measurement")
                    return
                }
                gatt.setCharacteristicNotification(ch, true)
                val desc = ch.getDescriptor(CCCD)
                if (desc != null) {
                    if (Build.VERSION.SDK_INT >= 33) {
                        gatt.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                        gatt.writeDescriptor(desc)
                    }
                }
                onStatus("connected", connectedId, null)
            } catch (t: Throwable) {
                onStatus("error", connectedId, t.message ?: "subscribe failed")
            }
        }

        // API 33+ delivers the value directly.
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            if (Build.VERSION.SDK_INT >= 33 && characteristic.uuid == HR_MEASUREMENT) {
                handleMeasurement(value)
            }
        }

        // API < 33 path (the framework also calls this on 33+, hence the version guard).
        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            if (Build.VERSION.SDK_INT < 33 && characteristic.uuid == HR_MEASUREMENT) {
                val v: ByteArray? = characteristic.value
                if (v != null) handleMeasurement(v)
            }
        }
    }

    private fun handleMeasurement(value: ByteArray) {
        val parsed = parseMeasurement(value) ?: return
        val now = System.currentTimeMillis()
        val hrv: Double? = synchronized(lock) {
            for (ms in parsed.second) {
                if (ms in 250.0..2000.0) {
                    rr.addLast(ms)
                    while (rr.size > RR_WINDOW) rr.removeFirst()
                }
            }
            computeRmssd(rr.toList())
        }
        latest = BleHeartReading(parsed.first, hrv, now)
    }

    companion object {
        val HR_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HR_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val SCAN_MS = 15_000L
        const val RR_WINDOW = 30

        /**
         * Parse a Heart Rate Measurement (0x2A37) payload.
         * flags bit0: bpm is uint16 (else uint8); bit3: energy expended (uint16) present;
         * bit4: RR intervals present (uint16 each, units of 1/1024 s).
         * Returns (bpm, rrIntervalsMs) or null when malformed.
         */
        fun parseMeasurement(b: ByteArray): Pair<Double, List<Double>>? {
            if (b.size < 2) return null
            val flags = b[0].toInt() and 0xFF
            var offset = 1
            val bpm: Int
            if ((flags and 0x01) != 0) {
                if (b.size < offset + 2) return null
                bpm = (b[offset].toInt() and 0xFF) or ((b[offset + 1].toInt() and 0xFF) shl 8)
                offset += 2
            } else {
                bpm = b[offset].toInt() and 0xFF
                offset += 1
            }
            if ((flags and 0x08) != 0) offset += 2
            val rrMs = ArrayList<Double>()
            if ((flags and 0x10) != 0) {
                while (offset + 1 < b.size) {
                    val raw = (b[offset].toInt() and 0xFF) or ((b[offset + 1].toInt() and 0xFF) shl 8)
                    rrMs.add(raw * 1000.0 / 1024.0)
                    offset += 2
                }
            }
            if (bpm <= 0) return null
            return Pair(bpm.toDouble(), rrMs)
        }

        /** Root mean square of successive RR differences (ms); null when < 5 intervals. */
        fun computeRmssd(rrMs: List<Double>): Double? {
            if (rrMs.size < 5) return null
            var sum = 0.0
            for (i in 1 until rrMs.size) {
                val d = rrMs[i] - rrMs[i - 1]
                sum += d * d
            }
            return sqrt(sum / (rrMs.size - 1))
        }
    }
}
