package com.chainlesschain.android.config

import android.content.Context
import android.content.SharedPreferences
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse

/**
 * AppConfigManager 单元测试
 *
 * 测试配置加载、保存、更新、重置以及 StateFlow 通知。
 * 使用 MockK 模拟 SharedPreferences，避免依赖 EncryptedSharedPreferences。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppConfigManagerTest {

    private lateinit var mockContext: Context
    private lateinit var mockPrefs: SharedPreferences
    private lateinit var mockEditor: SharedPreferences.Editor
    private lateinit var configManager: AppConfigManager

    @Before
    fun setup() {
        mockContext = mockk(relaxed = true)
        mockPrefs = mockk(relaxed = true)
        mockEditor = mockk(relaxed = true)

        every { mockPrefs.edit() } returns mockEditor
        every { mockEditor.putString(any(), any()) } returns mockEditor
        every { mockEditor.putLong(any(), any()) } returns mockEditor
        every { mockEditor.putInt(any(), any()) } returns mockEditor
        every { mockEditor.putBoolean(any(), any()) } returns mockEditor
        every { mockEditor.apply() } just Runs

        // Default return values for SharedPreferences (simulating empty prefs)
        every { mockPrefs.getString(any(), any()) } answers { secondArg() }
        every { mockPrefs.getLong(any(), any()) } answers { secondArg() }
        every { mockPrefs.getInt(any(), any()) } answers { secondArg() }
        every { mockPrefs.getBoolean(any(), any()) } answers { secondArg() }

        // Use reflection to construct and inject mocked SharedPreferences
        configManager = constructConfigManager()
    }

    @After
    fun teardown() {
        unmockkAll()
    }

    /**
     * Construct AppConfigManager with mocked dependencies using reflection
     * to bypass EncryptedSharedPreferences creation.
     */
    private fun constructConfigManager(): AppConfigManager {
        val manager = AppConfigManager(mockContext)

        // Replace the lazy sharedPreferences with our mock
        val sharedPrefsField = AppConfigManager::class.java.getDeclaredField("sharedPreferences\$delegate")
        sharedPrefsField.isAccessible = true
        sharedPrefsField.set(manager, lazy { mockPrefs })

        // Re-initialize to pick up mocked prefs
        val configField = AppConfigManager::class.java.getDeclaredField("_config")
        configField.isAccessible = true
        val flow = configField.get(manager) as kotlinx.coroutines.flow.MutableStateFlow<AppConfig>
        flow.value = invokeLoadConfig(manager)

        return manager
    }

    private fun invokeLoadConfig(manager: AppConfigManager): AppConfig {
        val method = AppConfigManager::class.java.getDeclaredMethod("loadConfig")
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        return method.invoke(manager) as AppConfig
    }

    // ===== AppConfig.default() Tests =====

    @Test
    fun `AppConfig default should have expected values`() {
        val defaults = AppConfig.default()

        assertEquals("https://api.chainlesschain.com", defaults.apiBaseUrl)
        assertEquals(30000L, defaults.requestTimeout)
        assertEquals("ollama", defaults.defaultLLMProvider)
        assertTrue(defaults.enableLLMCache)
        assertEquals(ThemeMode.SYSTEM, defaults.themeMode)
        assertEquals("zh", defaults.language)
        assertTrue(defaults.enableCrashReporting)
        assertTrue(defaults.enableAnalytics)
        assertTrue(defaults.enableP2P)
        assertEquals(100L * 1024 * 1024, defaults.imageCacheSize)
        assertEquals(2000, defaults.databaseCacheSize)
    }

    @Test
    fun `ThemeMode enum should have three values`() {
        val values = ThemeMode.entries
        assertEquals(3, values.size)
        assertTrue(values.contains(ThemeMode.LIGHT))
        assertTrue(values.contains(ThemeMode.DARK))
        assertTrue(values.contains(ThemeMode.SYSTEM))
    }

    // ===== Initialize Tests =====

    @Test
    fun `initialize should load default config when no prefs exist`() {
        configManager.initialize()
        val config = configManager.config.value

        assertEquals("https://api.chainlesschain.com", config.apiBaseUrl)
        assertEquals(30000L, config.requestTimeout)
        assertEquals("ollama", config.defaultLLMProvider)
        assertEquals(ThemeMode.SYSTEM, config.themeMode)
        assertEquals("zh", config.language)
    }

    @Test
    fun `initialize should reload config from SharedPreferences`() {
        // Simulate stored values
        every { mockPrefs.getString("api_base_url", any()) } returns "https://custom.api.com"
        every { mockPrefs.getString("language", any()) } returns "en"
        every { mockPrefs.getString("theme_mode", any()) } returns "DARK"

        configManager.initialize()
        val config = configManager.config.value

        assertEquals("https://custom.api.com", config.apiBaseUrl)
        assertEquals("en", config.language)
        assertEquals(ThemeMode.DARK, config.themeMode)
    }

    // ===== Config StateFlow Tests =====

    @Test
    fun `config StateFlow should emit initial value`() = runTest {
        val config = configManager.config.first()
        assertNotNull(config)
        assertEquals("https://api.chainlesschain.com", config.apiBaseUrl)
    }

    // ===== SaveConfig Tests =====

    @Test
    fun `saveConfig should persist all fields`() {
        val newConfig = AppConfig(
            apiBaseUrl = "https://new.api.com",
            requestTimeout = 60000L,
            defaultLLMProvider = "openai",
            enableLLMCache = false,
            themeMode = ThemeMode.DARK,
            language = "en",
            enableCrashReporting = false,
            enableAnalytics = false,
            enableP2P = false,
            imageCacheSize = 200L * 1024 * 1024,
            databaseCacheSize = 5000
        )

        configManager.saveConfig(newConfig)

        verify { mockEditor.putString("api_base_url", "https://new.api.com") }
        verify { mockEditor.putLong("request_timeout", 60000L) }
        verify { mockEditor.putString("default_llm_provider", "openai") }
        verify { mockEditor.putBoolean("enable_llm_cache", false) }
        verify { mockEditor.putString("theme_mode", "DARK") }
        verify { mockEditor.putString("language", "en") }
        verify { mockEditor.putBoolean("enable_crash_reporting", false) }
        verify { mockEditor.putBoolean("enable_analytics", false) }
        verify { mockEditor.putBoolean("enable_p2p", false) }
        verify { mockEditor.putLong("image_cache_size", 200L * 1024 * 1024) }
        verify { mockEditor.putInt("database_cache_size", 5000) }
        verify { mockEditor.apply() }
    }

    @Test
    fun `saveConfig should update StateFlow`() {
        val newConfig = AppConfig.default().copy(apiBaseUrl = "https://updated.api.com")

        configManager.saveConfig(newConfig)

        assertEquals("https://updated.api.com", configManager.config.value.apiBaseUrl)
    }

    // ===== UpdateConfig Tests =====

    @Test
    fun `updateConfig should apply transformation and save`() {
        configManager.updateConfig { copy(language = "en") }

        assertEquals("en", configManager.config.value.language)
        verify { mockEditor.putString("language", "en") }
    }

    @Test
    fun `updateConfig should emit new value through StateFlow`() = runTest {
        configManager.updateConfig { copy(themeMode = ThemeMode.LIGHT) }

        val config = configManager.config.first()
        assertEquals(ThemeMode.LIGHT, config.themeMode)
    }

    // ===== ResetToDefaults Tests =====

    @Test
    fun `resetToDefaults should restore all default values`() {
        // First change some values
        configManager.saveConfig(
            AppConfig.default().copy(
                apiBaseUrl = "https://changed.com",
                language = "en",
                themeMode = ThemeMode.DARK
            )
        )

        // Reset
        configManager.resetToDefaults()

        val config = configManager.config.value
        assertEquals("https://api.chainlesschain.com", config.apiBaseUrl)
        assertEquals("zh", config.language)
        assertEquals(ThemeMode.SYSTEM, config.themeMode)
    }

    @Test
    fun `resetToDefaults should emit defaults through StateFlow`() = runTest {
        configManager.saveConfig(AppConfig.default().copy(language = "en"))
        configManager.resetToDefaults()

        val config = configManager.config.first()
        assertEquals("zh", config.language)
        assertEquals(ThemeMode.SYSTEM, config.themeMode)
    }

    // ===== Field Persistence Tests =====

    @Test
    fun `should persist apiBaseUrl correctly`() {
        configManager.updateConfig { copy(apiBaseUrl = "https://test.api.com") }
        verify { mockEditor.putString("api_base_url", "https://test.api.com") }
    }

    @Test
    fun `should persist themeMode correctly for all enum values`() {
        ThemeMode.entries.forEach { mode ->
            configManager.updateConfig { copy(themeMode = mode) }
            verify { mockEditor.putString("theme_mode", mode.name) }
        }
    }

    @Test
    fun `should persist language correctly`() {
        configManager.updateConfig { copy(language = "en") }
        verify { mockEditor.putString("language", "en") }
        assertEquals("en", configManager.config.value.language)
    }

    @Test
    fun `should persist boolean flags correctly`() {
        configManager.updateConfig {
            copy(
                enableCrashReporting = false,
                enableAnalytics = false,
                enableP2P = false,
                enableLLMCache = false
            )
        }

        val config = configManager.config.value
        assertFalse(config.enableCrashReporting)
        assertFalse(config.enableAnalytics)
        assertFalse(config.enableP2P)
        assertFalse(config.enableLLMCache)
    }

    @Test
    fun `should persist numeric values correctly`() {
        configManager.updateConfig {
            copy(
                requestTimeout = 60000L,
                imageCacheSize = 500L * 1024 * 1024,
                databaseCacheSize = 10000
            )
        }

        val config = configManager.config.value
        assertEquals(60000L, config.requestTimeout)
        assertEquals(500L * 1024 * 1024, config.imageCacheSize)
        assertEquals(10000, config.databaseCacheSize)
    }

    // ===== Error Handling Tests =====

    @Test
    fun `loadConfig should return defaults on exception`() {
        // Simulate an exception during load
        every { mockPrefs.getString(any(), any()) } throws RuntimeException("Crypto error")

        configManager.initialize()
        val config = configManager.config.value

        // Should fall back to defaults
        assertEquals("https://api.chainlesschain.com", config.apiBaseUrl)
        assertEquals(ThemeMode.SYSTEM, config.themeMode)
    }
}
