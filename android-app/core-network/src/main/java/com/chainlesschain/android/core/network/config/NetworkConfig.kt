package com.chainlesschain.android.core.network.config

/**
 * 网络配置接口
 *
 * 由 app 模块实现，注入到 core-network 的 NetworkModule 中，
 * 避免 core-network 直接依赖 app 模块的 AppConfigManager。
 */
interface NetworkConfig {
    /** API 基础地址 */
    val apiBaseUrl: String

    /** 请求超时时间（毫秒） */
    val requestTimeoutMs: Long
}
