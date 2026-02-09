package com.chainlesschain.android.remote.config

import android.util.Log
import com.chainlesschain.android.feature.p2p.BuildConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 信令服务器配置
 *
 * 管理 WebRTC 信令服务器的连接参数
 */
@Singleton
class SignalingConfig @Inject constructor() {

    companion object {
        private const val TAG = "SignalingConfig"

        /**
         * 信令服务器 URL
         *
         * 优先级：
         * 1. 环境变量 SIGNALING_SERVER_URL
         * 2. DEBUG_SIGNALING_URL (debug builds only)
         * 3. DEFAULT_SIGNALING_URL (production)
         */
        const val DEFAULT_SIGNALING_URL = "wss://signaling.chainlesschain.com:9001"

        /** Debug-only fallback - use local network IP for real device testing */
        const val DEBUG_SIGNALING_URL = "ws://192.168.3.59:9001"

        /**
         * 连接超时（毫秒）
         */
        const val CONNECT_TIMEOUT_MS = 10000L

        /**
         * 重连延迟（毫秒）
         */
        const val RECONNECT_DELAY_MS = 3000L

        /**
         * 最大重连次数
         */
        const val MAX_RECONNECT_ATTEMPTS = 5

        /**
         * WebSocket 心跳间隔（秒）
         */
        const val PING_INTERVAL_SECONDS = 20L

        private const val ENV_SIGNALING_URL = "SIGNALING_SERVER_URL"
    }

    /**
     * 获取当前环境的信令服务器 URL
     */
    fun getSignalingUrl(): String {
        // Priority 1: Environment variable
        val envValue = System.getenv(ENV_SIGNALING_URL)
        if (!envValue.isNullOrBlank()) {
            Log.i(TAG, "Using signaling server from environment: $envValue")
            return envValue.trim()
        }

        // Priority 2: Debug builds fall back to emulator-friendly local URL
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "Debug build: using local signaling server: $DEBUG_SIGNALING_URL")
            return DEBUG_SIGNALING_URL
        }

        // Priority 3: Production default
        Log.i(TAG, "Using production signaling server: $DEFAULT_SIGNALING_URL")
        return DEFAULT_SIGNALING_URL
    }

    /**
     * 判断是否使用生产环境
     */
    fun isProduction(): Boolean {
        return getSignalingUrl().startsWith("wss://")
    }
}
