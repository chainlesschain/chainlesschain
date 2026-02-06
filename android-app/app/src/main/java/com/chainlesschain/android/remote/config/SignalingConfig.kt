package com.chainlesschain.android.remote.config

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SignalingConfig @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        const val DEFAULT_SIGNALING_URL = "ws://192.168.3.59:9001"
        const val PRODUCTION_SIGNALING_URL = "wss://your-signaling-server.com"

        const val CONNECT_TIMEOUT_MS = 10000L
        const val RECONNECT_DELAY_MS = 3000L
        const val MAX_RECONNECT_ATTEMPTS = 5
        const val PING_INTERVAL_SECONDS = 20L

        private const val PREFS_NAME = "signaling_prefs"
        private const val KEY_CUSTOM_URL = "custom_signaling_url"
        private const val ENV_SIGNALING_URL = "SIGNALING_SERVER_URL"
    }

    private val prefs by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getSignalingUrl(): String {
        val envValue = System.getenv(ENV_SIGNALING_URL)?.trim().orEmpty()
        if (envValue.isNotBlank()) {
            return envValue
        }

        val storedValue = prefs.getString(KEY_CUSTOM_URL, null)?.trim().orEmpty()
        if (storedValue.isNotBlank()) {
            return storedValue
        }

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
