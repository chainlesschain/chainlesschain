package com.chainlesschain.android.feature.ai.data.repository

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
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

            // 更新对话的消息数量和更新时间
            conversationDao.updateConversationTimestamp(
                conversationId,
                System.currentTimeMillis()
            )

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
        val adapter = llmAdapterFactory.createAdapter(provider, apiKey)
        return adapter.streamChat(messages, model)
    }

    /**
     * 保存AI响应消息
     */
    suspend fun saveAssistantMessage(
        conversationId: String,
        content: String,
        tokenCount: Int? = null
    ): Result<Message> {
        return try {
            val entity = MessageEntity(
                id = UUID.randomUUID().toString(),
                conversationId = conversationId,
                role = MessageRole.ASSISTANT.value,
                content = content,
                createdAt = System.currentTimeMillis(),
                tokenCount = tokenCount
            )

            conversationDao.insertMessage(entity)

            // 更新对话的消息数量和更新时间
            conversationDao.updateConversationTimestamp(
                conversationId,
                System.currentTimeMillis()
            )

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
     * 现在保存到LLMConfigManager，同时保持向后兼容
     */
    fun saveApiKey(provider: LLMProvider, apiKey: String) {
        // TODO: 保存到新的配置管理器（待实现）
        // val config = configManager.getConfig()
        // val updatedConfig = when (provider) {
        //     LLMProvider.OPENAI -> config.copy(openai = config.openai.copy(apiKey = apiKey))
        //     LLMProvider.DEEPSEEK -> config.copy(deepseek = config.deepseek.copy(apiKey = apiKey))
        //     LLMProvider.CLAUDE -> config.copy(anthropic = config.anthropic.copy(apiKey = apiKey))
        //     LLMProvider.DOUBAO -> config.copy(volcengine = config.volcengine.copy(apiKey = apiKey))
        //     LLMProvider.QWEN -> config.copy(qwen = config.qwen.copy(apiKey = apiKey))
        //     LLMProvider.ERNIE -> config.copy(ernie = config.ernie.copy(apiKey = apiKey))
        //     LLMProvider.CHATGLM -> config.copy(chatglm = config.chatglm.copy(apiKey = apiKey))
        //     LLMProvider.MOONSHOT -> config.copy(moonshot = config.moonshot.copy(apiKey = apiKey))
        //     LLMProvider.SPARK -> config.copy(spark = config.spark.copy(apiKey = apiKey))
        //     LLMProvider.GEMINI -> config.copy(gemini = config.gemini.copy(apiKey = apiKey))
        //     LLMProvider.CUSTOM -> config.copy(custom = config.custom.copy(apiKey = apiKey))
        //     LLMProvider.OLLAMA -> config // Ollama不需要API Key
        // }
        // configManager.save(updatedConfig)

        // 保存到安全存储
        securePreferences.saveApiKeyForProvider(provider.name, apiKey)
    }

    /**
     * 获取API Key
     * 优先从配置管理器获取，回退到旧存储
     */
    fun getApiKey(provider: LLMProvider): String? {
        // TODO: 优先从配置管理器获取（待实现）
        // val keyFromConfig = configManager.getApiKey(provider)
        // if (keyFromConfig.isNotBlank()) {
        //     return keyFromConfig
        // }

        // 从安全存储获取
        return securePreferences.getApiKeyForProvider(provider.name)
    }

    /**
     * 检查是否已保存API Key
     */
    fun hasApiKey(provider: LLMProvider): Boolean {
        // TODO: 优先从配置管理器获取（待实现）
        // val keyFromConfig = configManager.getApiKey(provider)
        // if (keyFromConfig.isNotBlank()) {
        //     return true
        // }

        // 从安全存储检查
        return securePreferences.hasApiKeyForProvider(provider.name)
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

