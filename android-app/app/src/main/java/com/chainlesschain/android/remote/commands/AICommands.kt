package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AI 命令 API
 *
 * 提供类型安全的 AI 相关命令
 */
@Singleton
class AICommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * AI 对话
     */
    suspend fun chat(
        message: String,
        conversationId: String? = null,
        model: String? = null,
        systemPrompt: String? = null,
        temperature: Float? = null
    ): Result<ChatResponse> {
        val params = mutableMapOf<String, Any>(
            "message" to message
        )

        conversationId?.let { params["conversationId"] = it }
        model?.let { params["model"] = it }
        systemPrompt?.let { params["systemPrompt"] = it }
        temperature?.let { params["temperature"] = it }

        return client.invoke("ai.chat", params)
    }

    /**
     * 查询对话历史
     */
    suspend fun getConversations(
        limit: Int = 20,
        offset: Int = 0,
        keyword: String? = null
    ): Result<ConversationsResponse> {
        val params = mutableMapOf<String, Any>(
            "limit" to limit,
            "offset" to offset
        )

        keyword?.let { params["keyword"] = it }

        return client.invoke("ai.getConversations", params)
    }

    /**
     * RAG 知识库搜索
     */
    suspend fun ragSearch(
        query: String,
        topK: Int = 5,
        filters: Map<String, Any>? = null
    ): Result<RAGSearchResponse> {
        val params = mutableMapOf<String, Any>(
            "query" to query,
            "topK" to topK
        )

        filters?.let { params["filters"] = it }

        return client.invoke("ai.ragSearch", params)
    }

    /**
     * 控制 AI Agent
     */
    suspend fun controlAgent(
        action: AgentAction,
        agentId: String
    ): Result<AgentControlResponse> {
        val params = mapOf(
            "action" to action.value,
            "agentId" to agentId
        )

        return client.invoke("ai.controlAgent", params)
    }

    /**
     * 获取可用模型列表
     */
    suspend fun getModels(): Result<ModelsResponse> {
        return client.invoke("ai.getModels", emptyMap())
    }
}

/**
 * 对话响应
 */
@Serializable
data class ChatResponse(
    val conversationId: String,
    val reply: String,
    val model: String,
    val tokens: TokenUsage? = null,
    val metadata: Map<String, String>? = null
)

/**
 * Token 使用情况
 */
@Serializable
data class TokenUsage(
    val prompt: Int,
    val completion: Int,
    val total: Int
)

/**
 * 对话历史响应
 */
@Serializable
data class ConversationsResponse(
    val conversations: List<Conversation>,
    val total: Int,
    val limit: Int,
    val offset: Int
)

/**
 * 对话信息
 */
@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val model: String,
    val created_at: Long,
    val updated_at: Long,
    val metadata: Map<String, String>? = null
)

/**
 * RAG 搜索响应
 */
@Serializable
data class RAGSearchResponse(
    val query: String,
    val results: List<SearchResult>,
    val total: Int,
    val topK: Int
)

/**
 * 搜索结果
 */
@Serializable
data class SearchResult(
    val noteId: String,
    val title: String,
    val content: String,
    val score: Float,
    val metadata: Map<String, String>? = null
)

/**
 * Agent 控制响应
 */
@Serializable
data class AgentControlResponse(
    val success: Boolean,
    val agentId: String,
    val action: String,
    val status: String,
    val timestamp: Long
)

/**
 * 模型列表响应
 */
@Serializable
data class ModelsResponse(
    val models: List<AIModel>,
    val total: Int
)

/**
 * AI 模型信息
 */
@Serializable
data class AIModel(
    val id: String,
    val name: String,
    val provider: String,
    val capabilities: List<String>,
    val maxTokens: Int
)

/**
 * Agent 操作
 */
enum class AgentAction(val value: String) {
    START("start"),
    STOP("stop"),
    RESTART("restart"),
    STATUS("status")
}
