package com.chainlesschain.android.pdh.llm

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.1 A3.5 — user toggle for "use Android in-APK LocalLlmServer as the
 * default backend for `cc ask`".
 *
 * Off (default): `cc ask` follows its existing fallback chain — explicit
 * --base-url > CC_HUB_OLLAMA_URL env > config.llm.baseUrl > localhost:11434.
 * On: when this app pushes the toggle to cc's persistent config via
 * `cc config set llm.preferAndroidLocal true`, `cc ask` resolves baseUrl to
 * `http://127.0.0.1:18484` (the Ollama-compat port LocalLlmServer binds).
 *
 * Why a separate store instead of writing only to cc's config file:
 *  - cc config writes go through a subprocess (slow + can fail before APK
 *    bootstrap finishes). The UI needs an instant-readable, durable mirror.
 *  - On bootstrap completion AiBackendSettingsViewModel reconciles cc config
 *    to match this store (truth source = local EncryptedSharedPreferences).
 *
 * Backed by EncryptedSharedPreferences (AES-256-GCM under AndroidKeyStore).
 * A boolean toggle is low-sensitivity, but routing all PDH-adjacent prefs
 * through encrypted storage keeps the surface uniform.
 */
@Singleton
class LlmPreferences @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (t: Throwable) {
            // EncryptedSharedPreferences can throw on keystore corruption (rare
            // but real on factory-reset / cross-device restore). Fall back to
            // plain SharedPreferences so the toggle still works; the value is
            // not high-sensitivity (boolean routing preference).
            Timber.w(t, "LlmPreferences: encrypted prefs init failed, falling back to plain")
            context.getSharedPreferences(PREFS_NAME_FALLBACK, Context.MODE_PRIVATE)
        }
    }

    private val _preferAndroidLocal: MutableStateFlow<Boolean> by lazy {
        MutableStateFlow(readPreferAndroidLocal())
    }

    /** Current value as a hot Flow. Default false. */
    val preferAndroidLocal: StateFlow<Boolean> get() = _preferAndroidLocal.asStateFlow()

    /** Snapshot read — for places that don't need a Flow. */
    fun getPreferAndroidLocal(): Boolean = _preferAndroidLocal.value

    /**
     * Persists the new value and updates the Flow. Idempotent: setting to
     * the same value is a no-op (no re-emit, no SharedPreferences write).
     */
    fun setPreferAndroidLocal(value: Boolean) {
        if (_preferAndroidLocal.value == value) return
        try {
            prefs.edit().putBoolean(KEY_PREFER_ANDROID_LOCAL, value).apply()
        } catch (t: Throwable) {
            // Write failures are non-fatal — the in-memory Flow still reflects
            // the user's choice for this session; next session falls back to
            // last successfully-persisted value.
            Timber.w(t, "LlmPreferences: write failed (non-fatal)")
        }
        _preferAndroidLocal.value = value
    }

    private fun readPreferAndroidLocal(): Boolean = try {
        prefs.getBoolean(KEY_PREFER_ANDROID_LOCAL, false)
    } catch (t: Throwable) {
        Timber.w(t, "LlmPreferences: read failed, defaulting to false")
        false
    }

    companion object {
        private const val PREFS_NAME = "pdh_llm_preferences"
        private const val PREFS_NAME_FALLBACK = "pdh_llm_preferences_plain"
        private const val KEY_PREFER_ANDROID_LOCAL = "preferAndroidLocal"
    }
}
