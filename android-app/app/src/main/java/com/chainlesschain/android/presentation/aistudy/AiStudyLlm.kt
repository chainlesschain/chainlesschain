package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AI 陪学 用的精简 LLM 出口。
 *
 * 复用 app 既有 LLM 配置 (设置 → AI 配置) 选定的 provider + model，
 * 不另起模型选择 UI。接口化以便 AiStudyViewModel 单测注入 fake。
 *
 * 不带 RAG / tool-use / skills (那些在 ConversationViewModel)；陪学 MVP
 * 只要纯对话 + 角色 prompt。
 */
interface AiStudyLlm {
    fun stream(messages: List<Message>): Flow<StreamChunk>
}

@Singleton
class DefaultAiStudyLlm @Inject constructor(
    private val adapterFactory: LLMAdapterFactory,
    private val configManager: LLMConfigManager,
) : AiStudyLlm {

    override fun stream(messages: List<Message>): Flow<StreamChunk> = flow {
        val provider = configManager.getProvider()
        val model = modelFor(provider)
        val adapter = try {
            adapterFactory.createAdapter(provider, configManager.getApiKey(provider))
        } catch (e: Exception) {
            emit(
                StreamChunk(
                    content = "",
                    isDone = true,
                    error = "请先在「设置 → AI 配置」选择模型或填写 API Key（${e.message ?: "未配置"}）",
                ),
            )
            return@flow
        }
        emitAll(adapter.streamChat(messages = messages, model = model))
    }

    private fun modelFor(provider: LLMProvider): String {
        val cfg = configManager.getConfig()
        return when (provider) {
            LLMProvider.OLLAMA -> cfg.ollama.model
            LLMProvider.OPENAI -> cfg.openai.model
            LLMProvider.DEEPSEEK -> cfg.deepseek.model
            LLMProvider.CLAUDE -> cfg.anthropic.model
            LLMProvider.GEMINI -> cfg.gemini.model
            LLMProvider.QWEN -> cfg.qwen.model
            LLMProvider.DOUBAO -> cfg.volcengine.model
            LLMProvider.ERNIE -> cfg.ernie.model
            LLMProvider.CHATGLM -> cfg.chatglm.model
            LLMProvider.MOONSHOT -> cfg.moonshot.model
            LLMProvider.SPARK -> cfg.spark.model
            LLMProvider.CUSTOM -> cfg.custom.model.ifBlank { cfg.ollama.model }
            else -> cfg.ollama.model
        }
    }
}
