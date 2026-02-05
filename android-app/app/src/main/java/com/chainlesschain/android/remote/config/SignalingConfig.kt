package com.chainlesschain.android.remote.config

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
        /**
         * 信令服务器 URL
         *
         * 优先级：
         * 1. 环境变量 SIGNALING_SERVER_URL
         * 2. BuildConfig.SIGNALING_URL（如果配置）
         * 3. 默认值（本地开发环境）
         */
        const val DEFAULT_SIGNALING_URL = "ws://10.0.2.2:9001" // Android 模拟器访问宿主机

        /**
         * 生产环境信令服务器（配合 desktop-app-vue 的信令服务器）
         *
         * 使用 Cloudflare Tunnel 或 ngrok 可以暴露本地信令服务器：
         * - Cloudflare: cloudflared tunnel --url http://localhost:9001
         * - ngrok: ngrok http 9001
         */
        const val PRODUCTION_SIGNALING_URL = "wss://your-signaling-server.com"

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
    }

    /**
     * 获取当前环境的信令服务器 URL
     */
    fun getSignalingUrl(): String {
        // TODO: 从 SharedPreferences 或配置文件读取用户自定义 URL
        return System.getenv("SIGNALING_SERVER_URL") ?: DEFAULT_SIGNALING_URL
    }

    /**
     * 判断是否使用生产环境
     */
    fun isProduction(): Boolean {
        return getSignalingUrl().startsWith("wss://")
    }
}
