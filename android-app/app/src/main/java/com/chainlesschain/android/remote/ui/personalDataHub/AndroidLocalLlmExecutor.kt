package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.config.LLMConfiguration
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.remote.commands.PromptMessage
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Path Y 桥层 — 把桌面 PDH `retrieve-context` 拿回的 prompt messages 喂给安卓端
 * 既有的 [LLMAdapter] 直接推理。
 *
 * 设计文档：`docs/design/Personal_Data_Hub_Android_Standalone_Cc.md` §11（过渡期方案）
 * 与 `Cc_NL_Phone_App_Manager.md` §1.3。
 *
 * 责任：
 *  1. 探测用户在 LLMSettings 配过 API key 的云厂商（Doubao / DeepSeek / Claude…），
 *     按优先级返回第一个匹配的 [ConfiguredProvider]；都没配返回 null。
 *  2. 把 `List<PromptMessage>` 转成 `List<Message>` 并调 [LLMAdapter.chat]，
 *     返回模型回答的纯文本。
 *
 * **不**做：citation 解析 / 校验 / audit — 由调用方 (HubAskViewModel) 处理，
 * 让本类保持 pure side-effect-on-LLM 形态便于单测。
 */
@Singleton
class AndroidLocalLlmExecutor @Inject constructor(
    private val securePreferences: SecurePreferences,
    private val llmAdapterFactory: LLMAdapterFactory,
    private val llmConfigManager: LLMConfigManager,
) {

    /** 探测出的可用云 LLM 提供商 + 默认模型 id。 */
    data class ConfiguredProvider(
        val provider: LLMProvider,
        val model: String,
        val displayLabel: String
    )

    /**
     * 找到第一个已配 API key 的非 Ollama 提供商。
     * 优先序按"用户最可能配的 / 中文场景效果好"排：Doubao（火山引擎）→ DeepSeek → OpenAI → Claude →
     * Qwen → Moonshot → Gemini → ChatGLM → Ernie → Spark。
     * 都没配 → null（UI 显示禁用 toggle + 引导去 LLMSettings 配 key）。
     *
     * **双存储读取顺序** — 2026-05-24 修：
     *  1. 先查 [LLMConfigManager]（"LLM 设置"屏 `updateXxxConfig()` 写的主存储）
     *  2. fallback `securePreferences.hasApiKeyForProvider()`（老 `saveApiKey` 双写的兼容存储）
     *
     * 原 bug：用户在 LLM 设置里填豆包 key 只进了 `LLMConfigManager`，本类只查 SP →
     * `androidLlm` 永远 null → 首页云 chip / 4-tier selector 永远灰。修后两存储一致命中。
     */
    fun detectProvider(): ConfiguredProvider? {
        val candidates = listOf(
            LLMProvider.DOUBAO,
            LLMProvider.DEEPSEEK,
            LLMProvider.OPENAI,
            LLMProvider.CLAUDE,
            LLMProvider.QWEN,
            LLMProvider.MOONSHOT,
            LLMProvider.GEMINI,
            LLMProvider.CHATGLM,
            LLMProvider.ERNIE,
            LLMProvider.SPARK,
        )
        val config = try {
            // LLMConfigManager._config 默认空 LLMConfiguration() — 必须显式 load() 才有 disk 内容
            // (load() 是 idempotent，重复调用安全)。若用户从未开过 Project tab 等触发 load 的入口，
            // 这里是首次加载——不调直接 getConfig() 拿到的是空 config，apiKey 全 blank → 永远 null。
            llmConfigManager.load()
            llmConfigManager.getConfig()
        } catch (e: Throwable) {
            // config 未加载（首次进 app 时 lazy 还没触发）— 退化为 SP-only
            Timber.w(e, "detectProvider: llmConfigManager load/getConfig failed, falling back to SP")
            null
        }
        for (p in candidates) {
            val hasKey = (config?.let { keyForProvider(it, p) }?.isNotBlank() == true)
                || securePreferences.hasApiKeyForProvider(p.name)
            if (!hasKey) continue
            val model = LLMProvider.DEFAULT_MODELS[p]?.firstOrNull()?.id ?: continue
            return ConfiguredProvider(provider = p, model = model, displayLabel = p.displayName)
        }
        return null
    }

    /**
     * 调安卓端 LLM 适配器跑推理，返回回答文本。
     *
     * @throws IllegalStateException API key 缺失（不该到这步，应在 [detectProvider] 阶段挡掉）
     * @throws Exception adapter 抛的网络/解析错——调用方应 catch 后渲染 errorMessage
     */
    suspend fun chat(messages: List<PromptMessage>, configured: ConfiguredProvider): String {
        val apiKey = readApiKey(configured.provider)
            ?: throw IllegalStateException(
                "No API key configured for ${configured.provider.displayName}"
            )
        val adapter = llmAdapterFactory.createAdapter(configured.provider, apiKey)
        val domainMessages = messages.map { it.toDomainMessage() }
        Timber.d(
            "AndroidLocalLlmExecutor: chat() provider=%s model=%s msgs=%d",
            configured.provider.name,
            configured.model,
            domainMessages.size
        )
        return adapter.chat(domainMessages, configured.model)
    }

    /**
     * 与 [detectProvider] 同样的双存储读法。configManager 优先，SP fallback。
     * 抽 internal 函数让 [chat] 与 detectProvider 共用同一段路由不漂移。
     */
    internal fun readApiKey(provider: LLMProvider): String? {
        val fromConfig = try {
            llmConfigManager.load()  // 同 detectProvider 注释 — 确保 disk-backed config 入内存
            llmConfigManager.getConfig().let { keyForProvider(it, provider) }
        } catch (e: Throwable) {
            Timber.w(e, "readApiKey: llmConfigManager load/getConfig failed")
            null
        }
        if (!fromConfig.isNullOrBlank()) return fromConfig
        return securePreferences.getApiKeyForProvider(provider.name)
    }

    private fun keyForProvider(config: LLMConfiguration, provider: LLMProvider): String = when (provider) {
        LLMProvider.OPENAI -> config.openai.apiKey
        LLMProvider.DEEPSEEK -> config.deepseek.apiKey
        LLMProvider.CLAUDE -> config.anthropic.apiKey
        LLMProvider.DOUBAO -> config.volcengine.apiKey
        LLMProvider.QWEN -> config.qwen.apiKey
        LLMProvider.ERNIE -> config.ernie.apiKey
        LLMProvider.CHATGLM -> config.chatglm.apiKey
        LLMProvider.MOONSHOT -> config.moonshot.apiKey
        LLMProvider.SPARK -> config.spark.apiKey
        LLMProvider.GEMINI -> config.gemini.apiKey
        LLMProvider.CUSTOM -> config.custom.apiKey
        LLMProvider.OLLAMA -> "" // Ollama 不走 API key 路径
    }
}

private fun PromptMessage.toDomainMessage(): Message =
    Message(
        id = UUID.randomUUID().toString(),
        conversationId = "pdh-ask-y",
        role = roleFromString(this.role),
        content = this.content,
        createdAt = System.currentTimeMillis(),
    )

private fun roleFromString(role: String): MessageRole =
    when (role.lowercase()) {
        "system" -> MessageRole.SYSTEM
        "assistant" -> MessageRole.ASSISTANT
        "tool" -> MessageRole.TOOL
        else -> MessageRole.USER
    }
