package com.chainlesschain.android.remote.config

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SignalingConfig @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        private const val TAG = "SignalingConfig"

        /**
         * 默认信令服务器 URL (仅用于开发/测试)
         *
         * ⚠️ 警告: 这是开发环境配置，不应在生产环境使用！
         *
         * 生产环境配置方法：
         * 1. 环境变量: 设置 SIGNALING_SERVER_URL=wss://your-server.com
         * 2. 运行时配置: 调用 setCustomSignalingUrl("wss://your-server.com")
         * 3. 应用设置: 在设置界面配置自定义服务器地址
         *
         * 配置优先级: 环境变量 > SharedPreferences > 默认值
         */
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
            Log.i(TAG, "Using signaling server from environment: $envValue")
            return envValue
        }

        val storedValue = prefs.getString(KEY_CUSTOM_URL, null)?.trim().orEmpty()
        if (storedValue.isNotBlank()) {
            Log.i(TAG, "Using signaling server from preferences: $storedValue")
            return storedValue
        }

        // 警告: 使用默认开发环境配置
        if (DEFAULT_SIGNALING_URL.contains("192.168") || DEFAULT_SIGNALING_URL.startsWith("ws://")) {
            Log.w(TAG, "⚠️ 使用默认开发环境信令服务器: $DEFAULT_SIGNALING_URL")
            Log.w(TAG, "⚠️ 生产环境请通过环境变量或设置界面配置 wss:// 地址")
            Log.w(TAG, "⚠️ 配置方法请参考: docs/SIGNALING_CONFIG.md")
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
