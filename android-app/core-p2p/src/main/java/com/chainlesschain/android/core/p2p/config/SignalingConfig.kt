package com.chainlesschain.android.core.p2p.config

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Signaling server configuration.
 *
 * Priority: SharedPreferences > Environment variable > DEBUG_SIGNALING_URL (debug) > DEFAULT_SIGNALING_URL
 */
@Singleton
class SignalingConfig @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "SignalingConfig"

        const val DEFAULT_SIGNALING_URL = "wss://signaling.chainlesschain.com:9001"

        /** Debug-only fallback - use local network IP for real device testing */
        const val DEBUG_SIGNALING_URL = "ws://192.168.1.1:9001"

        const val CONNECT_TIMEOUT_MS = 10000L
        const val RECONNECT_DELAY_MS = 3000L
        const val MAX_RECONNECT_ATTEMPTS = 5
        const val PING_INTERVAL_SECONDS = 20L

        private const val PREFS_NAME = "signaling_prefs"
        private const val KEY_CUSTOM_URL = "custom_signaling_url"
        private const val ENV_SIGNALING_URL = "SIGNALING_SERVER_URL"
    }

    private val isDebug: Boolean
        get() = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getSignalingUrl(): String {
        // Priority 1: User-configured URL (SharedPreferences / settings UI)
        val storedValue = prefs.getString(KEY_CUSTOM_URL, null)?.trim().orEmpty()
        if (storedValue.isNotBlank()) {
            Log.i(TAG, "Using signaling server from preferences: $storedValue")
            return storedValue
        }

        // Priority 2: Environment variable
        val envValue = System.getenv(ENV_SIGNALING_URL)?.trim().orEmpty()
        if (envValue.isNotBlank()) {
            Log.i(TAG, "Using signaling server from environment: $envValue")
            return envValue
        }

        // Priority 3: Debug builds fall back to emulator-friendly local URL
        if (isDebug) {
            Log.d(TAG, "Debug build: using local signaling server: $DEBUG_SIGNALING_URL")
            return DEBUG_SIGNALING_URL
        }

        // Priority 4: Production default
        Log.i(TAG, "Using production signaling server: $DEFAULT_SIGNALING_URL")
        return DEFAULT_SIGNALING_URL
    }

    fun setCustomSignalingUrl(url: String?) {
        val value = url?.trim().orEmpty()
        if (value.isBlank()) {
            prefs.edit().remove(KEY_CUSTOM_URL).apply()
        } else {
            prefs.edit().putString(KEY_CUSTOM_URL, value).apply()
        }
    }

    fun clearCustomSignalingUrl() {
        prefs.edit().remove(KEY_CUSTOM_URL).apply()
    }

    fun isProduction(): Boolean {
        return getSignalingUrl().startsWith("wss://")
    }
}
