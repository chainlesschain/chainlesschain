package com.chainlesschain.android.feature.ai.data.repository

import timber.log.Timber
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.llm.ChatWithToolsResponse
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.*
import com.chainlesschain.android.feature.ai.domain.usage.UsageTracker
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 对话仓库
 *
 * 管理AI对话会话和消息
 */
@Singleton
class ConversationRepository @Inject constructor(
    private val conversationDao: ConversationDao,
    private val llmAdapterFactory: LLMAdapterFactory,
    private val securePreferences: SecurePreferences,
    private val configManager: LLMConfigManager,
    private val usageTracker: UsageTracker
) {

    // 用于追踪当前对话的token使用量
    private var currentInputTokens = 0
    private var currentOutputTokens = 0

    /**
     * 获取所有对话会话
     */
    fun getAllConversations(): Flow<List<Conversation>> {
        return conversationDao.getAllConversations().map { entities ->
            entities.map { it.toDomainModel() }
        }
    }

    /**
     * 根据ID获取对话
     */
    fun getConversationById(id: String): Flow<Conversation?> {
        return conversationDao.getConversationById(id).map { entity ->
            entity?.toDomainModel()
        }
    }

    /**
     * 获取对话的所有消息
     */
    fun getMessages(conversationId: String): Flow<List<Message>> {
        return conversationDao.getMessagesByConversation(conversationId).map { entities ->
            entities.map { it.toDomainModel() }
        }
    }

    /**
     * 创建新对话
     */
    suspend fun createConversation(
        title: String,
        model: String
    ): Result<Conversation> {
        return try {
            val entity = ConversationEntity(
                id = UUID.randomUUID().toString(),
                title = title,
                model = model,
                createdAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis()
            )

            conversationDao.insertConversation(entity)
            Result.success(entity.toDomainModel())
        } catch (e: Exception) {
            Result.error(e, "创建对话失败")
        }
    }

    /**
     * 删除对话
     */
    suspend fun deleteConversation(id: String): Result<Unit> {
        return try {
            conversationDao.deleteConversationWithMessages(id)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "删除对话失败")
        }
    }

    /**
     * 添加用户消息
     */
    suspend fun addUserMessage(
        conversationId: String,
        content: String
    ): Result<Message> {
        return try {
            val entity = MessageEntity(
                id = UUID.randomUUID().toString(),
                conversationId = conversationId,
                role = MessageRole.USER.value,
                content = content,
                createdAt = System.currentTimeMillis()
            )

            conversationDao.insertMessage(entity)

            // 更新对话的消息数量和更新时间（强制同步）
            syncConversationStats(conversationId)

            Result.success(entity.toDomainModel())
        } catch (e: Exception) {
            Result.error(e, "添加消息失败")
        }
    }

    /**
     * 流式发送消息并获取AI响应
     */
    fun sendMessageStream(
        conversationId: String,
        messages: List<Message>,
        model: String,
        provider: LLMProvider,
        apiKey: String? = null
    ): Flow<StreamChunk> {
        // 重置token计数
        currentInputTokens = 0
        currentOutputTokens = 0

        // 估算输入token（区分中英文字符）
        val inputText = messages.joinToString(" ") { it.content }
        currentInputTokens = estimateTokenCount(inputText)

        val adapter = llmAdapterFactory.createAdapter(provider, apiKey)
        return adapter.streamChat(messages, model).onEach { chunk ->
            // 估算输出token
            if (chunk.content.isNotEmpty() && !chunk.isDone) {
                currentOutputTokens += estimateTokenCount(chunk.content)
            }
        }
    }

    /**
     * Non-streaming chat with tools support (for function calling loop).
     * Creates an adapter and calls chatWithTools.
     */
    suspend fun chatWithTools(
        messages: List<Message>,
        model: String,
        tools: List<Map<String, Any>>,
        provider: LLMProvider,
        apiKey: String? = null
    ): ChatWithToolsResponse {
        val adapter = llmAdapterFactory.createAdapter(provider, apiKey)
        return adapter.chatWithTools(messages, model, tools)
    }

    /**
     * 保存AI响应消息并记录使用统计
     */
    suspend fun saveAssistantMessage(
        conversationId: String,
        content: String,
        tokenCount: Int? = null,
        provider: LLMProvider? = null
    ): Result<Message> {
        return try {
            // 如果没有提供tokenCount，使用估算值
            val finalTokenCount = tokenCount ?: currentOutputTokens

            val entity = MessageEntity(
                id = UUID.randomUUID().toString(),
                conversationId = conversationId,
                role = MessageRole.ASSISTANT.value,
                content = content,
                createdAt = System.currentTimeMillis(),
                tokenCount = finalTokenCount
            )

            conversationDao.insertMessage(entity)

            // 更新对话的消息数量和更新时间（强制同步）
            syncConversationStats(conversationId)

            // 记录token使用统计
            if (provider != null) {
                try {
                    usageTracker.recordUsage(
                        provider = provider,
                        inputTokens = currentInputTokens,
                        outputTokens = currentOutputTokens
                    )
                } catch (e: Exception) {
                    // 使用统计记录失败不影响主流程
                    Timber.tag("ConversationRepository").e(e, "Failed to record usage")
                }
            }

            Result.success(entity.toDomainModel())
        } catch (e: Exception) {
            Result.error(e, "保存响应失败")
        }
    }

    /**
     * 检查LLM API可用性
     */
    suspend fun checkLLMAvailability(
        provider: LLMProvider,
        apiKey: String? = null
    ): Boolean {
        return try {
            val adapter = llmAdapterFactory.createAdapter(provider, apiKey)
            adapter.checkAvailability()
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 切换对话置顶状态
     */
    suspend fun togglePinned(id: String): Result<Unit> {
        return try {
            val conversation = conversationDao.getConversationByIdSync(id)
                ?: return Result.error(IllegalArgumentException(), "对话不存在")

            conversationDao.updateConversation(
                conversation.copy(isPinned = !conversation.isPinned)
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "更新失败")
        }
    }

    // ==================== API Key管理 ====================

    /**
     * 保存API Key（加密存储）
     * 保存到LLMConfigManager，同时保持向后兼容
     */
    fun saveApiKey(provider: LLMProvider, apiKey: String) {
        // 保存到新的配置管理器
        val config = configManager.getConfig()
        val updatedConfig = when (provider) {
            LLMProvider.OPENAI -> config.copy(openai = config.openai.copy(apiKey = apiKey))
            LLMProvider.DEEPSEEK -> config.copy(deepseek = config.deepseek.copy(apiKey = apiKey))
            LLMProvider.CLAUDE -> config.copy(anthropic = config.anthropic.copy(apiKey = apiKey))
            LLMProvider.DOUBAO -> config.copy(volcengine = config.volcengine.copy(apiKey = apiKey))
            LLMProvider.QWEN -> config.copy(qwen = config.qwen.copy(apiKey = apiKey))
            LLMProvider.ERNIE -> config.copy(ernie = config.ernie.copy(apiKey = apiKey))
            LLMProvider.CHATGLM -> config.copy(chatglm = config.chatglm.copy(apiKey = apiKey))
            LLMProvider.MOONSHOT -> config.copy(moonshot = config.moonshot.copy(apiKey = apiKey))
            LLMProvider.SPARK -> config.copy(spark = config.spark.copy(apiKey = apiKey))
            LLMProvider.GEMINI -> config.copy(gemini = config.gemini.copy(apiKey = apiKey))
            LLMProvider.CUSTOM -> config.copy(custom = config.custom.copy(apiKey = apiKey))
            LLMProvider.OLLAMA -> config // Ollama不需要API Key
        }
        configManager.save(updatedConfig)

        // 同时保存到旧存储（向后兼容）
        securePreferences.saveApiKeyForProvider(provider.name, apiKey)
    }

    /**
     * 获取API Key
     * 优先从配置管理器获取，回退到旧存储
     */
    fun getApiKey(provider: LLMProvider): String? {
        // 优先从配置管理器获取
        val config = configManager.getConfig()
        val keyFromConfig = when (provider) {
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
            LLMProvider.OLLAMA -> "" // Ollama不需要API Key
        }

        if (keyFromConfig.isNotBlank()) {
            return keyFromConfig
        }

        // 回退到旧存储（向后兼容）
        return securePreferences.getApiKeyForProvider(provider.name)
    }

    /**
     * 检查是否已保存API Key
     */
    fun hasApiKey(provider: LLMProvider): Boolean {
        val apiKey = getApiKey(provider)
        return !apiKey.isNullOrBlank()
    }

    /**
     * 删除API Key
     */
    fun clearApiKey(provider: LLMProvider) {
        // 从配置管理器清除
        saveApiKey(provider, "")

        // 也从旧存储清除（向后兼容）
        securePreferences.saveApiKeyForProvider(provider.name, "")
    }

    /**
     * 删除所有API Keys
     */
    fun clearAllApiKeys() {
        securePreferences.clearAllApiKeys()
    }

    /**
     * 更准确地估算Token数量
     * 中文字符约2个字符/token，英文约4个字符/token
     */
    /**
     * 估算文本的 Token 数量
     *
     * 采用更精确的中英文混合估算策略：
     * - 中文字符（CJK统一汉字）: ~2个字符 = 1 token
     * - 英文及其他字符: ~4个字符 = 1 token
     *
     * 这种方法比简单的字节数/4更准确，特别是对中英文混合文本。
     *
     * @param text 待估算的文本
     * @return 估算的 token 数量
     */
    private fun estimateTokenCount(text: String): Int {
        if (text.isEmpty()) return 0

        // 统计中文字符数（CJK统一汉字范围：U+4E00 到 U+9FFF）
        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }

        // 其他字符数（英文、标点、空格等）
        val otherChars = text.length - chineseChars

        // 中文约0.5 token/字符，英文约0.25 token/字符
        val estimatedTokens = (chineseChars / 2.0 + otherChars / 4.0).toInt()

        return estimatedTokens.coerceAtLeast(1)
    }

    /**
     * 同步会话统计信息（消息数量 + 更新时间）
     */
    private suspend fun syncConversationStats(conversationId: String) {
        val messageCount = conversationDao.getMessageCount(conversationId)
        conversationDao.updateConversationStats(
            conversationId = conversationId,
            messageCount = messageCount,
            timestamp = System.currentTimeMillis()
        )
    }

    // 实体转领域模型
    private fun ConversationEntity.toDomainModel() = Conversation(
        id = id,
        title = title,
        model = model,
        createdAt = createdAt,
        updatedAt = updatedAt,
        messageCount = messageCount,
        isPinned = isPinned
    )

    private fun MessageEntity.toDomainModel() = Message(
        id = id,
        conversationId = conversationId,
        role = MessageRole.fromValue(role),
        content = content,
        createdAt = createdAt,
        tokenCount = tokenCount
    )
}
