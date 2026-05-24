package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.config.AnthropicConfig
import com.chainlesschain.android.feature.ai.data.config.DeepSeekConfig
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.config.LLMConfiguration
import com.chainlesschain.android.feature.ai.data.config.OpenAIConfig
import com.chainlesschain.android.feature.ai.data.config.VolcengineConfig
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import io.mockk.every
import io.mockk.mockk
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * 2026-05-24 — AndroidLocalLlmExecutor.detectProvider 双存储读取测试。
 *
 * 用户报：在 LLM 设置里填了豆包 key，首页 4 路 chip 的「云」仍灰。根因 —
 * LLMSettingsViewModel.updateXxxConfig 只写 LLMConfigManager (主存储)，但
 * detectProvider 此前只查 SecurePreferences (legacy 兼容存储) → 永远 null。
 *
 * 这套测试钉死「configManager 优先 / SP fallback / 都没→null / 优先序」四个分支，
 * 避免回归。
 */
class AndroidLocalLlmExecutorTest {

    private lateinit var sp: SecurePreferences
    private lateinit var configManager: LLMConfigManager
    private lateinit var adapterFactory: LLMAdapterFactory
    private lateinit var executor: AndroidLocalLlmExecutor

    @Before
    fun setUp() {
        sp = mockk(relaxed = false)
        configManager = mockk(relaxed = false)
        adapterFactory = mockk(relaxed = true)
        executor = AndroidLocalLlmExecutor(sp, adapterFactory, configManager)

        // 默认：SP 全没 key（让 configManager 路径主导测试断言）
        every { sp.hasApiKeyForProvider(any()) } returns false
        every { sp.getApiKeyForProvider(any()) } returns null
        // detectProvider 进 try 前会调 load() 确保 disk 内容已读 — 默认 no-op 返默认空 config
        every { configManager.load() } returns LLMConfiguration()
    }

    @Test
    fun detectProvider_returns_null_when_both_stores_empty() {
        every { configManager.getConfig() } returns LLMConfiguration()
        assertNull(executor.detectProvider())
    }

    @Test
    fun detectProvider_picks_up_key_from_configManager_only() {
        // 用户从 LLM 设置填豆包 — 只写进 configManager，没写 SP
        every { configManager.getConfig() } returns LLMConfiguration(
            volcengine = VolcengineConfig(apiKey = "doubao-sk-test"),
        )
        val provider = executor.detectProvider()
        assertNotNull(provider)
        assertEquals(LLMProvider.DOUBAO, provider.provider)
    }

    @Test
    fun detectProvider_picks_up_key_from_securePreferences_only() {
        // 老用户：key 只在 SP（早期 ConversationRepository.saveApiKey 双写遗留）
        every { configManager.getConfig() } returns LLMConfiguration()
        every { sp.hasApiKeyForProvider("DOUBAO") } returns true
        val provider = executor.detectProvider()
        assertNotNull(provider)
        assertEquals(LLMProvider.DOUBAO, provider.provider)
    }

    @Test
    fun detectProvider_priority_order_DOUBAO_over_OPENAI() {
        // 同时配豆包和 OpenAI — 按优先序应选豆包
        every { configManager.getConfig() } returns LLMConfiguration(
            volcengine = VolcengineConfig(apiKey = "doubao-key"),
            openai = OpenAIConfig(apiKey = "openai-key"),
        )
        val provider = executor.detectProvider()
        assertEquals(LLMProvider.DOUBAO, provider?.provider)
    }

    @Test
    fun detectProvider_priority_order_DEEPSEEK_over_CLAUDE() {
        // 没豆包，DeepSeek 优于 Claude
        every { configManager.getConfig() } returns LLMConfiguration(
            deepseek = DeepSeekConfig(apiKey = "ds-key"),
            anthropic = AnthropicConfig(apiKey = "claude-key"),
        )
        val provider = executor.detectProvider()
        assertEquals(LLMProvider.DEEPSEEK, provider?.provider)
    }

    @Test
    fun detectProvider_blank_apiKey_in_config_falls_back_to_SP() {
        // configManager 写过但 apiKey 留空（用户清掉了）— 应 fallback SP
        every { configManager.getConfig() } returns LLMConfiguration(
            volcengine = VolcengineConfig(apiKey = ""),
        )
        every { sp.hasApiKeyForProvider("DEEPSEEK") } returns true
        val provider = executor.detectProvider()
        assertEquals(LLMProvider.DEEPSEEK, provider?.provider)
    }

    @Test
    fun detectProvider_swallows_configManager_throw_and_uses_SP() {
        // 极端：configManager.load() 抛（disk 损坏等）— 不应 NPE，应继续 SP-only 路径
        every { configManager.load() } throws IllegalStateException("disk corrupt")
        every { sp.hasApiKeyForProvider("OPENAI") } returns true
        val provider = executor.detectProvider()
        assertEquals(LLMProvider.OPENAI, provider?.provider)
    }

    @Test
    fun readApiKey_prefers_config_over_SP() {
        every { configManager.getConfig() } returns LLMConfiguration(
            volcengine = VolcengineConfig(apiKey = "config-key"),
        )
        every { sp.getApiKeyForProvider("DOUBAO") } returns "sp-key"
        assertEquals("config-key", executor.readApiKey(LLMProvider.DOUBAO))
    }

    @Test
    fun readApiKey_falls_back_to_SP_when_config_blank() {
        every { configManager.getConfig() } returns LLMConfiguration(
            volcengine = VolcengineConfig(apiKey = ""),
        )
        every { sp.getApiKeyForProvider("DOUBAO") } returns "sp-key"
        assertEquals("sp-key", executor.readApiKey(LLMProvider.DOUBAO))
    }

    @Test
    fun readApiKey_returns_null_when_both_empty() {
        every { configManager.getConfig() } returns LLMConfiguration()
        every { sp.getApiKeyForProvider("DOUBAO") } returns null
        assertNull(executor.readApiKey(LLMProvider.DOUBAO))
    }

    @Test
    fun readApiKey_handles_OLLAMA_without_key() {
        // OLLAMA 在 keyForProvider 里返回 "" — readApiKey 应 fallback SP，SP 也空 → null
        every { configManager.getConfig() } returns LLMConfiguration()
        every { sp.getApiKeyForProvider("OLLAMA") } returns null
        assertNull(executor.readApiKey(LLMProvider.OLLAMA))
    }
}
