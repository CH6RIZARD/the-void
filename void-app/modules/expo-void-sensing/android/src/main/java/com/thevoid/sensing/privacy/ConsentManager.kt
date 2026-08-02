package com.thevoid.sensing.privacy

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The sensor tiers the JS contract exposes (index.ts `SensorTier`). */
enum class SensorTier(val jsKey: String) {
    MOTION("motion"),
    TOUCH("touch"),
    PPG("ppg"),
    FACE("face"),
    HEALTH("health");

    companion object {
        fun fromJs(key: String): SensorTier? = values().firstOrNull { it.jsKey == key }
    }
}

/** Device-local consent snapshot. Mirrors index.ts `ConsentState`. */
data class ConsentSnapshot(
    val affectConsent: Boolean,
    val perTier: Map<SensorTier, Boolean>,
    /** DSA Art.38: a one-tap non-biometric feed must ALWAYS be available. */
    val nonBiometricFeed: Boolean = true,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "affectConsent" to affectConsent,
        "perTier" to SensorTier.values().associate { it.jsKey to (perTier[it] ?: false) },
        "nonBiometricFeed" to nonBiometricFeed,
    )
}

/**
 * Explicit, unbundled, per-tier consent ledger (GDPR Art.9 / EU AI Act Art.50 / BIPA /
 * CUBI / MHMDA / DSA Art.38 / Apple 5.1.3(vi)). This is the app's OWN consent record,
 * distinct from OS runtime permissions; both must hold before a tier captures.
 *
 * Persisted in EncryptedSharedPreferences, device-local, never networked.
 *
 * NOTE: consent COPY (the exact prompt wording) must not ship without legal review
 * (plan T1.9 HUMAN GATE). This class stores the RESULT of consent, not the UI.
 */
class ConsentManager(context: Context?) {

    private val prefs: SharedPreferences? = buildPrefs(context)
    private val consented = HashSet<SensorTier>()

    init {
        restore()
    }

    /** Record explicit opt-in for [tiers]. Additive: does not revoke other tiers. */
    fun grant(tiers: List<SensorTier>): ConsentSnapshot {
        synchronized(this) {
            consented.addAll(tiers)
            persist()
            return snapshot()
        }
    }

    /** Revoke consent for [tiers] (used by an in-app toggle). */
    fun revoke(tiers: List<SensorTier>): ConsentSnapshot {
        synchronized(this) {
            consented.removeAll(tiers.toSet())
            persist()
            return snapshot()
        }
    }

    fun snapshot(): ConsentSnapshot {
        synchronized(this) {
            val perTier = SensorTier.values().associateWith { consented.contains(it) }
            // affectConsent is true only when at least one biometric-bearing tier is
            // consented (motion/touch alone are non-biometric kinematics).
            val biometric = consented.any {
                it == SensorTier.PPG || it == SensorTier.FACE || it == SensorTier.HEALTH
            }
            return ConsentSnapshot(affectConsent = biometric, perTier = perTier)
        }
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
            p.edit().putStringSet(KEY, consented.map { it.jsKey }.toSet()).apply()
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
        } catch (t: Throwable) {
            // ignore
        }
    }

    companion object {
        private const val KEY = "consented_tiers"
    }
}
