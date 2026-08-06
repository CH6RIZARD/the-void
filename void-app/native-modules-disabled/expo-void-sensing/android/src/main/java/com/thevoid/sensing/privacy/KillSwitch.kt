package com.thevoid.sensing.privacy

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Remote + local kill switch. When DISABLED, the PrivacyGate emits null and all capture
 * stops (plan T1.9). Default is ENABLED (sensing permitted) — consent is still required
 * independently, so "enabled" alone never produces an emit.
 *
 * Persisted so a kill survives process restarts.
 */
class KillSwitch(context: Context?) {

    private val prefs: SharedPreferences? = buildPrefs(context)
    private val enabled = AtomicBoolean(true)

    init {
        val p = prefs
        if (p != null) {
            enabled.set(
                try {
                    p.getBoolean(KEY, true)
                } catch (t: Throwable) {
                    true
                },
            )
        }
    }

    fun isEnabled(): Boolean = enabled.get()

    fun set(value: Boolean) {
        enabled.set(value)
        val p = prefs ?: return
        try {
            p.edit().putBoolean(KEY, value).apply()
        } catch (t: Throwable) {
            // ignore
        }
    }

    private fun buildPrefs(context: Context?): SharedPreferences? {
        if (context == null) return null
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "void_killswitch",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            null
        }
    }

    companion object {
        private const val KEY = "kill_switch_enabled"
    }
}
