package com.chainlesschain.android.config

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
 * 应用配置管理器
 *
 * 负责管理应用的各项配置，支持：
 * - 本地持久化配置
 * - 远程配置更新
 * - 配置优先级管理
 * - 实时配置变更通知
 */
@Singleton
class AppConfigManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val sharedPreferences: SharedPreferences by lazy {
        EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val _config = MutableStateFlow(loadConfig())
    val config: StateFlow<AppConfig> = _config.asStateFlow()

    /**
     * 初始化配置
     */
    fun initialize() {
        Timber.d("AppConfigManager initialized")
        _config.value = loadConfig()
    }

    /**
     * 从本地存储加载配置
     */
    private fun loadConfig(): AppConfig {
        return try {
            AppConfig(
                // 网络配置
                apiBaseUrl = sharedPreferences.getString(
                    KEY_API_BASE_URL,
                    DEFAULT_API_BASE_URL
                ) ?: DEFAULT_API_BASE_URL,
                requestTimeout = sharedPreferences.getLong(
                    KEY_REQUEST_TIMEOUT,
                    DEFAULT_REQUEST_TIMEOUT
                ),

                // LLM配置
                defaultLLMProvider = sharedPreferences.getString(
                    KEY_DEFAULT_LLM_PROVIDER,
                    DEFAULT_LLM_PROVIDER
                ) ?: DEFAULT_LLM_PROVIDER,
                enableLLMCache = sharedPreferences.getBoolean(
                    KEY_ENABLE_LLM_CACHE,
                    DEFAULT_ENABLE_LLM_CACHE
                ),

                // UI配置
                themeMode = try {
                    ThemeMode.valueOf(
                        sharedPreferences.getString(
                            KEY_THEME_MODE,
                            DEFAULT_THEME_MODE.name
                        ) ?: DEFAULT_THEME_MODE.name
                    )
                } catch (_: IllegalArgumentException) { DEFAULT_THEME_MODE },
                language = sharedPreferences.getString(
                    KEY_LANGUAGE,
                    DEFAULT_LANGUAGE
                ) ?: DEFAULT_LANGUAGE,

                // 功能开关
                enableCrashReporting = sharedPreferences.getBoolean(
                    KEY_ENABLE_CRASH_REPORTING,
                    DEFAULT_ENABLE_CRASH_REPORTING
                ),
                enableAnalytics = sharedPreferences.getBoolean(
                    KEY_ENABLE_ANALYTICS,
                    DEFAULT_ENABLE_ANALYTICS
                ),
                enableP2P = sharedPreferences.getBoolean(
                    KEY_ENABLE_P2P,
                    DEFAULT_ENABLE_P2P
                ),

                // P2P/信令服务器配置
                signalingServerUrl = sharedPreferences.getString(
                    KEY_SIGNALING_SERVER_URL,
                    DEFAULT_SIGNALING_SERVER_URL
                ) ?: DEFAULT_SIGNALING_SERVER_URL,

                // 性能配置
                imageCacheSize = sharedPreferences.getLong(
                    KEY_IMAGE_CACHE_SIZE,
                    DEFAULT_IMAGE_CACHE_SIZE
                ),
                databaseCacheSize = sharedPreferences.getInt(
                    KEY_DATABASE_CACHE_SIZE,
                    DEFAULT_DATABASE_CACHE_SIZE
                )
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to load config, using defaults")
            AppConfig.default()
        }
    }

    /**
     * 保存配置
     */
    fun saveConfig(config: AppConfig) {
        try {
            sharedPreferences.edit()
                .putString(KEY_API_BASE_URL, config.apiBaseUrl)
                .putLong(KEY_REQUEST_TIMEOUT, config.requestTimeout)
                .putString(KEY_DEFAULT_LLM_PROVIDER, config.defaultLLMProvider)
                .putBoolean(KEY_ENABLE_LLM_CACHE, config.enableLLMCache)
                .putString(KEY_THEME_MODE, config.themeMode.name)
                .putString(KEY_LANGUAGE, config.language)
                .putBoolean(KEY_ENABLE_CRASH_REPORTING, config.enableCrashReporting)
                .putBoolean(KEY_ENABLE_ANALYTICS, config.enableAnalytics)
                .putBoolean(KEY_ENABLE_P2P, config.enableP2P)
                .putString(KEY_SIGNALING_SERVER_URL, config.signalingServerUrl)
                .putLong(KEY_IMAGE_CACHE_SIZE, config.imageCacheSize)
                .putInt(KEY_DATABASE_CACHE_SIZE, config.databaseCacheSize)
                .apply()

            _config.value = config
            Timber.i("Config saved successfully")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save config")
        }
    }

    /**
     * 更新单个配置项
     */
    fun updateConfig(block: AppConfig.() -> AppConfig) {
        val newConfig = _config.value.block()
        saveConfig(newConfig)
    }

    /**
     * 重置为默认配置
     */
    fun resetToDefaults() {
        saveConfig(AppConfig.default())
        Timber.i("Config reset to defaults")
    }

    companion object {
        private const val PREFS_NAME = "app_config_prefs"

        // 网络配置键
        private const val KEY_API_BASE_URL = "api_base_url"
        private const val KEY_REQUEST_TIMEOUT = "request_timeout"

        // LLM配置键
        private const val KEY_DEFAULT_LLM_PROVIDER = "default_llm_provider"
        private const val KEY_ENABLE_LLM_CACHE = "enable_llm_cache"

        // UI配置键
        private const val KEY_THEME_MODE = "theme_mode"
        private const val KEY_LANGUAGE = "language"

        // 功能开关键
        private const val KEY_ENABLE_CRASH_REPORTING = "enable_crash_reporting"
        private const val KEY_ENABLE_ANALYTICS = "enable_analytics"
        private const val KEY_ENABLE_P2P = "enable_p2p"

        // P2P配置键
        private const val KEY_SIGNALING_SERVER_URL = "signaling_server_url"

        // 性能配置键
        private const val KEY_IMAGE_CACHE_SIZE = "image_cache_size"
        private const val KEY_DATABASE_CACHE_SIZE = "database_cache_size"

        // 默认值
        private const val DEFAULT_API_BASE_URL = "https://api.chainlesschain.com"
        private const val DEFAULT_REQUEST_TIMEOUT = 30000L // 30秒
        private const val DEFAULT_LLM_PROVIDER = "ollama"
        private const val DEFAULT_ENABLE_LLM_CACHE = true
        private val DEFAULT_THEME_MODE = ThemeMode.SYSTEM
        private const val DEFAULT_LANGUAGE = "zh"
        private const val DEFAULT_ENABLE_CRASH_REPORTING = true
        private const val DEFAULT_ENABLE_ANALYTICS = true
        private const val DEFAULT_ENABLE_P2P = true
        // P2P默认值 - 使用局域网广播发现或用户配置
        private const val DEFAULT_SIGNALING_SERVER_URL = "ws://192.168.1.1:9001"
        private const val DEFAULT_IMAGE_CACHE_SIZE = 100L * 1024 * 1024 // 100MB
        private const val DEFAULT_DATABASE_CACHE_SIZE = 2000 // 2000条记录
    }
}

/**
 * 应用配置数据类
 */
data class AppConfig(
    // 网络配置
    val apiBaseUrl: String,
    val requestTimeout: Long,

    // LLM配置
    val defaultLLMProvider: String,
    val enableLLMCache: Boolean,

    // UI配置
    val themeMode: ThemeMode,
    val language: String,

    // 功能开关
    val enableCrashReporting: Boolean,
    val enableAnalytics: Boolean,
    val enableP2P: Boolean,

    // P2P/信令服务器配置
    val signalingServerUrl: String,

    // 性能配置
    val imageCacheSize: Long,
    val databaseCacheSize: Int
) {
    companion object {
        fun default() = AppConfig(
            apiBaseUrl = "https://api.chainlesschain.com",
            requestTimeout = 30000L,
            defaultLLMProvider = "ollama",
            enableLLMCache = true,
            themeMode = ThemeMode.SYSTEM,
            language = "zh",
            enableCrashReporting = true,
            enableAnalytics = true,
            enableP2P = true,
            signalingServerUrl = "ws://192.168.1.1:9001",
            imageCacheSize = 100L * 1024 * 1024,
            databaseCacheSize = 2000
        )
    }
}

/**
 * 主题模式
 */
enum class ThemeMode {
    LIGHT,    // 浅色主题
    DARK,     // 深色主题
    SYSTEM    // 跟随系统
}
