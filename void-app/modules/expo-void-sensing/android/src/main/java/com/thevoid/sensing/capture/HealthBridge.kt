package com.thevoid.sensing.capture

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant

/** A device-local Health Connect reading (e.g. from a paired Galaxy Watch). */
data class WatchReading(
    val heartRateBpm: Double?,
    val hrvMs: Double?,
    val windowEndMs: Long,
)

/**
 * Tier-1 Health Connect bridge. Reads HR / HRV that a paired wearable (Galaxy Watch,
 * Wear OS) has written to Health Connect. Degrades gracefully to null everywhere when
 * Health Connect is not installed, not permissioned, or has no data.
 *
 * INVARIANT #1: only the derived, baseline-normalized AffectState leaves the device.
 * These absolute HR/HRV values stay on-device and feed BaselineStore z-scoring only.
 */
class HealthBridge(private val context: Context) {

    private val client: HealthConnectClient? by lazy {
        try {
            if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
                HealthConnectClient.getOrCreate(context)
            } else {
                null
            }
        } catch (t: Throwable) {
            null
        }
    }

    /** True when Health Connect is installed and available on this device. */
    fun isAvailable(): Boolean = client != null

    /**
     * Read the most recent HR / HRV over the trailing [lookbackSeconds]. Suspends;
     * returns null on any failure (missing permission, no data, unavailable SDK).
     */
    suspend fun readLatest(lookbackSeconds: Long = 60L): WatchReading? {
        val c = client ?: return null
        val end = Instant.now()
        val start = end.minusSeconds(lookbackSeconds)
        val range = TimeRangeFilter.between(start, end)
        return try {
            val hr = readLatestHeartRate(c, range)
            val hrv = readLatestHrv(c, range)
            if (hr == null && hrv == null) {
                null
            } else {
                WatchReading(hr, hrv, end.toEpochMilli())
            }
        } catch (t: Throwable) {
            null
        }
    }

    private suspend fun readLatestHeartRate(
        c: HealthConnectClient,
        range: TimeRangeFilter,
    ): Double? {
        return try {
            val response = c.readRecords(
                ReadRecordsRequest(HeartRateRecord::class, timeRangeFilter = range),
            )
            val samples = response.records.flatMap { it.samples }
            samples.maxByOrNull { it.time }?.beatsPerMinute?.toDouble()
        } catch (t: Throwable) {
            null
        }
    }

    private suspend fun readLatestHrv(
        c: HealthConnectClient,
        range: TimeRangeFilter,
    ): Double? {
        return try {
            val response = c.readRecords(
                ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, timeRangeFilter = range),
            )
            response.records.maxByOrNull { it.time }?.heartRateVariabilityMillis
        } catch (t: Throwable) {
            null
        }
    }
}
