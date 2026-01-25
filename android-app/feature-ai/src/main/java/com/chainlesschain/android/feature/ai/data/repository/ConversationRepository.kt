package com.chainlesschain.android.feature.ai.data.repository

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
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
    private val securePreferences: SecurePreferences
) {

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
     */
    fun saveApiKey(provider: LLMProvider, apiKey: String) {
        securePreferences.saveApiKeyForProvider(provider.name, apiKey)
    }

    /**
     * 获取API Key
     */
    fun getApiKey(provider: LLMProvider): String? {
        return securePreferences.getApiKeyForProvider(provider.name)
    }

    /**
     * 检查是否已保存API Key
     */
    fun hasApiKey(provider: LLMProvider): Boolean {
        return securePreferences.hasApiKeyForProvider(provider.name)
    }

    /**
     * 删除API Key
     */
    fun clearApiKey(provider: LLMProvider) {
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

/**
 * LLM适配器工厂
 */
@Singleton
class LLMAdapterFactory @Inject constructor() {

    private val adapters = mutableMapOf<String, LLMAdapter>()

    fun createAdapter(
        provider: LLMProvider,
        apiKey: String? = null
    ): LLMAdapter {
        val key = "${provider.name}_$apiKey"

        return adapters.getOrPut(key) {
            when (provider) {
                LLMProvider.OPENAI -> {
                    require(apiKey != null) { "OpenAI需要API Key" }
                    com.chainlesschain.android.feature.ai.data.llm.OpenAIAdapter(apiKey)
                }
                LLMProvider.DEEPSEEK -> {
                    require(apiKey != null) { "DeepSeek需要API Key" }
                    com.chainlesschain.android.feature.ai.data.llm.DeepSeekAdapter(apiKey)
                }
                LLMProvider.OLLAMA -> {
                    com.chainlesschain.android.feature.ai.data.llm.OllamaAdapter()
                }
                LLMProvider.CUSTOM -> {
                    require(apiKey != null) { "${provider.displayName}需要API Key" }
                    com.chainlesschain.android.feature.ai.data.llm.OpenAIAdapter(apiKey)
                }
            }
        }
    }

    fun clearCache() {
        adapters.clear()
    }
}
