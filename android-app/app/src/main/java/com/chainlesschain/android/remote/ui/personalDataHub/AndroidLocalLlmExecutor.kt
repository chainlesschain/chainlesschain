package com.chainlesschain.android.remote.ui.personalDataHub

import com.chainlesschain.android.core.security.SecurePreferences
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
    private val llmAdapterFactory: LLMAdapterFactory
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
        for (p in candidates) {
            val hasKey = securePreferences.hasApiKeyForProvider(p.name)
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
        val apiKey = securePreferences.getApiKeyForProvider(configured.provider.name)
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
