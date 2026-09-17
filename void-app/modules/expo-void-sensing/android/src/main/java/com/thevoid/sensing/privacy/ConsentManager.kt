package com.thevoid.sensing.privacy

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The sensor tiers the JS contract exposes (index.ts `SensorTier`). */
enum class SensorTier(val jsKey: String) {
    MOTION("motion"),
    TOUCH("touch"),
    FACE("face"),
    PPG("ppg"),
    BLE("ble");

    companion object {
        fun fromJs(key: String): SensorTier? = values().firstOrNull { it.jsKey == key }
    }
}

/** Device-local consent snapshot. Mirrors index.ts `ConsentState`. */
data class ConsentSnapshot(
    val affectConsent: Boolean,
    val perTier: Map<SensorTier, Boolean>,
    /** True only after the user explicitly picked "Not now" (non-biometric feed). */
    val nonBiometricFeed: Boolean,
    /** True once the user has made any choice on the consent screen. */
    val hasChosen: Boolean,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "affectConsent" to affectConsent,
        "perTier" to SensorTier.values().associate { it.jsKey to (perTier[it] ?: false) },
        "nonBiometricFeed" to nonBiometricFeed,
        "hasChosen" to hasChosen,
    )
}

/**
 * Explicit, unbundled, per-tier consent ledger. This is the app's OWN consent record,
 * distinct from OS runtime permissions; both must hold before a tier captures.
 *
 * Persisted in EncryptedSharedPreferences, device-local, never networked.
 */
class ConsentManager(context: Context?) {

    private val prefs: SharedPreferences? = buildPrefs(context)
    private val consented = HashSet<SensorTier>()
    private var hasChosen = false
    private var nonBiometric = false

    init {
        restore()
    }

    /**
     * Set the consented tiers to EXACTLY [tiers] (the consent screen sends the full
     * toggle state). Marks the choice as made. An empty list is equivalent to "Not now".
     */
    fun setTiers(tiers: List<SensorTier>): ConsentSnapshot = synchronized(this) {
        consented.clear()
        consented.addAll(tiers)
        hasChosen = true
        nonBiometric = tiers.isEmpty()
        persist()
        snapshotLocked()
    }

    /** Record explicit opt-in for [tiers] without revoking others. */
    fun grant(tiers: List<SensorTier>): ConsentSnapshot = synchronized(this) {
        consented.addAll(tiers)
        hasChosen = true
        if (tiers.isNotEmpty()) nonBiometric = false
        persist()
        snapshotLocked()
    }

    /** Revoke consent for [tiers] (used by an in-app toggle). */
    fun revoke(tiers: List<SensorTier>): ConsentSnapshot = synchronized(this) {
        consented.removeAll(tiers.toSet())
        persist()
        snapshotLocked()
    }

    /** The user picked "Not now": revoke everything, use the non-biometric feed. */
    fun chooseNonBiometric(): ConsentSnapshot = synchronized(this) {
        consented.clear()
        hasChosen = true
        nonBiometric = true
        persist()
        snapshotLocked()
    }

    fun snapshot(): ConsentSnapshot = synchronized(this) { snapshotLocked() }

    private fun snapshotLocked(): ConsentSnapshot {
        val perTier = SensorTier.values().associateWith { consented.contains(it) }
        // Affect is produced when any physiological tier is on, or when BOTH
        // behavioural tiers (motion + touch) are on.
        val physiological = consented.contains(SensorTier.FACE) ||
            consented.contains(SensorTier.PPG) ||
            consented.contains(SensorTier.BLE)
        val behavioural = consented.contains(SensorTier.MOTION) && consented.contains(SensorTier.TOUCH)
        return ConsentSnapshot(
            affectConsent = physiological || behavioural,
            perTier = perTier,
            nonBiometricFeed = nonBiometric,
            hasChosen = hasChosen,
        )
    }

    fun isConsented(tier: SensorTier): Boolean = synchronized(this) { consented.contains(tier) }

    private fun buildPrefs(context: Context?): SharedPreferences? {
        if (context == null) return null
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "void_consent",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            null
        }
    }

    private fun persist() {
        val p = prefs ?: return
        try {
            p.edit()
                .putStringSet(KEY, consented.map { it.jsKey }.toSet())
                .putBoolean(KEY_CHOSEN, hasChosen)
                .putBoolean(KEY_NONBIO, nonBiometric)
                .apply()
        } catch (t: Throwable) {
            // ignore
        }
    }

    private fun restore() {
        val p = prefs ?: return
        try {
            val set = p.getStringSet(KEY, emptySet()) ?: emptySet()
            for (k in set) {
                SensorTier.fromJs(k)?.let { consented.add(it) }
            }
            hasChosen = p.getBoolean(KEY_CHOSEN, false)
            nonBiometric = p.getBoolean(KEY_NONBIO, false)
        } catch (t: Throwable) {
            // ignore
        }
    }

    companion object {
        private const val KEY = "consented_tiers"
        private const val KEY_CHOSEN = "has_chosen"
        private const val KEY_NONBIO = "non_biometric_feed"
    }
}
