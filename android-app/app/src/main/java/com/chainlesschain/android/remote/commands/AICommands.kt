package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.google.gson.Gson
import kotlinx.serialization.Serializable
import timber.log.Timber
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
    private val gson = Gson()

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

        // 获取原始结果（可能是 Map 类型）
        val rawResult = client.invoke<Any>("ai.chat", params)

        return rawResult.mapCatching { result ->
            Timber.d("[AICommands] chat 原始结果类型: ${result?.javaClass?.simpleName}")
            Timber.d("[AICommands] chat 原始结果: $result")

            when (result) {
                is ChatResponse -> result
                is Map<*, *> -> {
                    // 将 Map 转换为 ChatResponse
                    val jsonStr = gson.toJson(result)
                    Timber.d("[AICommands] 转换后的 JSON: $jsonStr")
                    gson.fromJson(jsonStr, ChatResponse::class.java)
                }
                else -> {
                    val jsonStr = gson.toJson(result)
                    gson.fromJson(jsonStr, ChatResponse::class.java)
                }
            }
        }
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

    /**
     * 获取远端 Agent 列表
     */
    suspend fun listAgents(): Result<AgentsResponse> {
        return client.invoke("ai.listAgents", emptyMap())
    }

    // ==================== 流式对话 ====================

    /**
     * 开始流式对话
     *
     * @param message 用户消息
     * @param conversationId 对话 ID
     * @param model 模型
     * @param systemPrompt 系统提示
     * @param temperature 温度
     */
    suspend fun chatStream(
        message: String,
        conversationId: String? = null,
        model: String? = null,
        systemPrompt: String? = null,
        temperature: Float? = null
    ): Result<StreamStartResponse> {
        val params = mutableMapOf<String, Any>("message" to message)
        conversationId?.let { params["conversationId"] = it }
        model?.let { params["model"] = it }
        systemPrompt?.let { params["systemPrompt"] = it }
        temperature?.let { params["temperature"] = it }
        return client.invoke("ai.chatStream", params)
    }

    /**
     * 获取流式响应块
     *
     * @param streamId 流 ID
     */
    suspend fun getStreamChunk(streamId: String): Result<StreamChunkResponse> {
        return client.invoke("ai.getStreamChunk", mapOf("streamId" to streamId))
    }

    /**
     * 取消流式对话
     *
     * @param streamId 流 ID
     */
    suspend fun cancelStream(streamId: String): Result<StreamCancelResponse> {
        return client.invoke("ai.cancelStream", mapOf("streamId" to streamId))
    }

    // ==================== 对话管理 ====================

    /**
     * 获取对话详情
     *
     * @param conversationId 对话 ID
     */
    suspend fun getConversation(conversationId: String): Result<ConversationDetailResponse> {
        return client.invoke("ai.getConversation", mapOf("conversationId" to conversationId))
    }

    /**
     * 创建新对话
     *
     * @param title 标题
     * @param model 模型
     * @param systemPrompt 系统提示
     */
    suspend fun createConversation(
        title: String? = null,
        model: String? = null,
        systemPrompt: String? = null
    ): Result<CreateConversationResponse> {
        val params = mutableMapOf<String, Any>()
        title?.let { params["title"] = it }
        model?.let { params["model"] = it }
        systemPrompt?.let { params["systemPrompt"] = it }
        return client.invoke("ai.createConversation", params)
    }

    /**
     * 删除对话
     *
     * @param conversationId 对话 ID
     */
    suspend fun deleteConversation(conversationId: String): Result<DeleteConversationResponse> {
        return client.invoke("ai.deleteConversation", mapOf("conversationId" to conversationId))
    }

    /**
     * 重命名对话
     *
     * @param conversationId 对话 ID
     * @param title 新标题
     */
    suspend fun renameConversation(
        conversationId: String,
        title: String
    ): Result<RenameConversationResponse> {
        return client.invoke("ai.renameConversation", mapOf(
            "conversationId" to conversationId,
            "title" to title
        ))
    }

    /**
     * 清空对话历史
     *
     * @param conversationId 对话 ID
     */
    suspend fun clearConversation(conversationId: String): Result<ClearConversationResponse> {
        return client.invoke("ai.clearConversation", mapOf("conversationId" to conversationId))
    }

    /**
     * 归档对话
     *
     * @param conversationId 对话 ID
     */
    suspend fun archiveConversation(conversationId: String): Result<ArchiveConversationResponse> {
        return client.invoke("ai.archiveConversation", mapOf("conversationId" to conversationId))
    }

    /**
     * 导出对话
     *
     * @param conversationId 对话 ID
     * @param format 格式 (json, markdown, txt)
     */
    suspend fun exportConversation(
        conversationId: String,
        format: String = "json"
    ): Result<ExportConversationResponse> {
        return client.invoke("ai.exportConversation", mapOf(
            "conversationId" to conversationId,
            "format" to format
        ))
    }

    // ==================== 消息管理 ====================

    /**
     * 获取对话消息
     *
     * @param conversationId 对话 ID
     * @param limit 最大数量
     * @param offset 偏移量
     */
    suspend fun getMessages(
        conversationId: String,
        limit: Int = 50,
        offset: Int = 0
    ): Result<MessagesResponse> {
        return client.invoke("ai.getMessages", mapOf(
            "conversationId" to conversationId,
            "limit" to limit,
            "offset" to offset
        ))
    }

    /**
     * 删除消息
     *
     * @param conversationId 对话 ID
     * @param messageId 消息 ID
     */
    suspend fun deleteMessage(
        conversationId: String,
        messageId: String
    ): Result<DeleteMessageResponse> {
        return client.invoke("ai.deleteMessage", mapOf(
            "conversationId" to conversationId,
            "messageId" to messageId
        ))
    }

    /**
     * 重新生成回复
     *
     * @param conversationId 对话 ID
     * @param messageId 消息 ID
     */
    suspend fun regenerateResponse(
        conversationId: String,
        messageId: String
    ): Result<ChatResponse> {
        return client.invoke("ai.regenerateResponse", mapOf(
            "conversationId" to conversationId,
            "messageId" to messageId
        ))
    }

    /**
     * 编辑消息并重新生成
     *
     * @param conversationId 对话 ID
     * @param messageId 消息 ID
     * @param newContent 新内容
     */
    suspend fun editAndRegenerate(
        conversationId: String,
        messageId: String,
        newContent: String
    ): Result<ChatResponse> {
        return client.invoke("ai.editAndRegenerate", mapOf(
            "conversationId" to conversationId,
            "messageId" to messageId,
            "newContent" to newContent
        ))
    }

    // ==================== 嵌入向量 ====================

    /**
     * 生成文本嵌入
     *
     * @param text 文本
     * @param model 嵌入模型
     */
    suspend fun generateEmbedding(
        text: String,
        model: String? = null
    ): Result<EmbeddingResponse> {
        val params = mutableMapOf<String, Any>("text" to text)
        model?.let { params["model"] = it }
        return client.invoke("ai.generateEmbedding", params)
    }

    /**
     * 批量生成嵌入
     *
     * @param texts 文本列表
     * @param model 嵌入模型
     */
    suspend fun generateEmbeddings(
        texts: List<String>,
        model: String? = null
    ): Result<BatchEmbeddingResponse> {
        val params = mutableMapOf<String, Any>("texts" to texts)
        model?.let { params["model"] = it }
        return client.invoke("ai.generateEmbeddings", params)
    }

    /**
     * 计算文本相似度
     *
     * @param text1 文本1
     * @param text2 文本2
     * @param model 嵌入模型
     */
    suspend fun computeSimilarity(
        text1: String,
        text2: String,
        model: String? = null
    ): Result<SimilarityResponse> {
        val params = mutableMapOf<String, Any>(
            "text1" to text1,
            "text2" to text2
        )
        model?.let { params["model"] = it }
        return client.invoke("ai.computeSimilarity", params)
    }

    // ==================== RAG 知识库管理 ====================

    /**
     * 添加文档到知识库
     *
     * @param content 文档内容
     * @param metadata 元数据
     * @param collectionName 集合名称
     */
    suspend fun ragAddDocument(
        content: String,
        metadata: Map<String, Any>? = null,
        collectionName: String = "default"
    ): Result<RAGAddDocumentResponse> {
        val params = mutableMapOf<String, Any>(
            "content" to content,
            "collectionName" to collectionName
        )
        metadata?.let { params["metadata"] = it }
        return client.invoke("ai.ragAddDocument", params)
    }

    /**
     * 批量添加文档
     *
     * @param documents 文档列表
     * @param collectionName 集合名称
     */
    suspend fun ragAddDocuments(
        documents: List<RAGDocument>,
        collectionName: String = "default"
    ): Result<RAGAddDocumentsResponse> {
        return client.invoke("ai.ragAddDocuments", mapOf(
            "documents" to documents,
            "collectionName" to collectionName
        ))
    }

    /**
     * 删除知识库文档
     *
     * @param documentId 文档 ID
     * @param collectionName 集合名称
     */
    suspend fun ragDeleteDocument(
        documentId: String,
        collectionName: String = "default"
    ): Result<RAGDeleteResponse> {
        return client.invoke("ai.ragDeleteDocument", mapOf(
            "documentId" to documentId,
            "collectionName" to collectionName
        ))
    }

    /**
     * 列出知识库集合
     */
    suspend fun ragListCollections(): Result<RAGCollectionsResponse> {
        return client.invoke("ai.ragListCollections", emptyMap())
    }

    /**
     * 创建知识库集合
     *
     * @param name 集合名称
     * @param description 描述
     */
    suspend fun ragCreateCollection(
        name: String,
        description: String? = null
    ): Result<RAGCollectionResponse> {
        val params = mutableMapOf<String, Any>("name" to name)
        description?.let { params["description"] = it }
        return client.invoke("ai.ragCreateCollection", params)
    }

    /**
     * 删除知识库集合
     *
     * @param name 集合名称
     */
    suspend fun ragDeleteCollection(name: String): Result<RAGDeleteResponse> {
        return client.invoke("ai.ragDeleteCollection", mapOf("name" to name))
    }

    // ==================== 图像生成 ====================

    /**
     * 生成图像
     *
     * @param prompt 提示词
     * @param negativePrompt 负面提示词
     * @param width 宽度
     * @param height 高度
     * @param steps 步数
     * @param model 模型
     */
    suspend fun generateImage(
        prompt: String,
        negativePrompt: String? = null,
        width: Int = 512,
        height: Int = 512,
        steps: Int = 20,
        model: String? = null
    ): Result<ImageGenerationResponse> {
        val params = mutableMapOf<String, Any>(
            "prompt" to prompt,
            "width" to width,
            "height" to height,
            "steps" to steps
        )
        negativePrompt?.let { params["negativePrompt"] = it }
        model?.let { params["model"] = it }
        return client.invoke("ai.generateImage", params)
    }

    /**
     * 图像变体
     *
     * @param imageData Base64 图像数据
     * @param prompt 提示词
     * @param strength 变化强度 (0-1)
     */
    suspend fun imageVariation(
        imageData: String,
        prompt: String? = null,
        strength: Float = 0.7f
    ): Result<ImageGenerationResponse> {
        val params = mutableMapOf<String, Any>(
            "imageData" to imageData,
            "strength" to strength
        )
        prompt?.let { params["prompt"] = it }
        return client.invoke("ai.imageVariation", params)
    }

    /**
     * 图像编辑（修复）
     *
     * @param imageData Base64 图像数据
     * @param maskData Base64 蒙版数据
     * @param prompt 提示词
     */
    suspend fun editImage(
        imageData: String,
        maskData: String,
        prompt: String
    ): Result<ImageGenerationResponse> {
        return client.invoke("ai.editImage", mapOf(
            "imageData" to imageData,
            "maskData" to maskData,
            "prompt" to prompt
        ))
    }

    // ==================== 图像分析 ====================

    /**
     * 分析图像
     *
     * @param imageData Base64 图像数据
     * @param prompt 分析提示
     * @param model 视觉模型
     */
    suspend fun analyzeImage(
        imageData: String,
        prompt: String = "Describe this image",
        model: String? = null
    ): Result<ImageAnalysisResponse> {
        val params = mutableMapOf<String, Any>(
            "imageData" to imageData,
            "prompt" to prompt
        )
        model?.let { params["model"] = it }
        return client.invoke("ai.analyzeImage", params)
    }

    /**
     * OCR 文字识别
     *
     * @param imageData Base64 图像数据
     * @param language 语言
     */
    suspend fun ocrImage(
        imageData: String,
        language: String = "auto"
    ): Result<OCRResponse> {
        return client.invoke("ai.ocrImage", mapOf(
            "imageData" to imageData,
            "language" to language
        ))
    }

    // ==================== 音频处理 ====================

    /**
     * 语音转文字
     *
     * @param audioData Base64 音频数据
     * @param language 语言
     * @param model 模型
     */
    suspend fun transcribeAudio(
        audioData: String,
        language: String = "auto",
        model: String? = null
    ): Result<TranscriptionResponse> {
        val params = mutableMapOf<String, Any>(
            "audioData" to audioData,
            "language" to language
        )
        model?.let { params["model"] = it }
        return client.invoke("ai.transcribeAudio", params)
    }

    /**
     * 文字转语音
     *
     * @param text 文本
     * @param voice 声音
     * @param speed 速度 (0.5-2.0)
     * @param format 格式 (mp3, wav, ogg)
     */
    suspend fun textToSpeech(
        text: String,
        voice: String = "default",
        speed: Float = 1.0f,
        format: String = "mp3"
    ): Result<TTSResponse> {
        return client.invoke("ai.textToSpeech", mapOf(
            "text" to text,
            "voice" to voice,
            "speed" to speed,
            "format" to format
        ))
    }

    /**
     * 列出可用语音
     */
    suspend fun listVoices(): Result<VoicesResponse> {
        return client.invoke("ai.listVoices", emptyMap())
    }

    // ==================== 文本处理 ====================

    /**
     * 文本摘要
     *
     * @param text 文本
     * @param maxLength 最大长度
     * @param model 模型
     */
    suspend fun summarize(
        text: String,
        maxLength: Int = 200,
        model: String? = null
    ): Result<SummarizeResponse> {
        val params = mutableMapOf<String, Any>(
            "text" to text,
            "maxLength" to maxLength
        )
        model?.let { params["model"] = it }
        return client.invoke("ai.summarize", params)
    }

    /**
     * 翻译
     *
     * @param text 文本
     * @param targetLanguage 目标语言
     * @param sourceLanguage 源语言（auto 自动检测）
     */
    suspend fun translate(
        text: String,
        targetLanguage: String,
        sourceLanguage: String = "auto"
    ): Result<TranslationResponse> {
        return client.invoke("ai.translate", mapOf(
            "text" to text,
            "targetLanguage" to targetLanguage,
            "sourceLanguage" to sourceLanguage
        ))
    }

    /**
     * 情感分析
     *
     * @param text 文本
     */
    suspend fun analyzeSentiment(text: String): Result<SentimentResponse> {
        return client.invoke("ai.analyzeSentiment", mapOf("text" to text))
    }

    /**
     * 关键词提取
     *
     * @param text 文本
     * @param maxKeywords 最大关键词数
     */
    suspend fun extractKeywords(
        text: String,
        maxKeywords: Int = 10
    ): Result<KeywordsResponse> {
        return client.invoke("ai.extractKeywords", mapOf(
            "text" to text,
            "maxKeywords" to maxKeywords
        ))
    }

    /**
     * 命名实体识别
     *
     * @param text 文本
     */
    suspend fun extractEntities(text: String): Result<EntitiesResponse> {
        return client.invoke("ai.extractEntities", mapOf("text" to text))
    }

    // ==================== 代码生成 ====================

    /**
     * 生成代码
     *
     * @param prompt 提示
     * @param language 编程语言
     * @param model 模型
     */
    suspend fun generateCode(
        prompt: String,
        language: String = "python",
        model: String? = null
    ): Result<CodeGenerationResponse> {
        val params = mutableMapOf<String, Any>(
            "prompt" to prompt,
            "language" to language
        )
        model?.let { params["model"] = it }
        return client.invoke("ai.generateCode", params)
    }

    /**
     * 解释代码
     *
     * @param code 代码
     * @param language 编程语言
     */
    suspend fun explainCode(
        code: String,
        language: String? = null
    ): Result<CodeExplanationResponse> {
        val params = mutableMapOf<String, Any>("code" to code)
        language?.let { params["language"] = it }
        return client.invoke("ai.explainCode", params)
    }

    /**
     * 代码审查
     *
     * @param code 代码
     * @param language 编程语言
     */
    suspend fun reviewCode(
        code: String,
        language: String? = null
    ): Result<CodeReviewResponse> {
        val params = mutableMapOf<String, Any>("code" to code)
        language?.let { params["language"] = it }
        return client.invoke("ai.reviewCode", params)
    }

    // ==================== 工具调用 ====================

    /**
     * 带工具的对话
     *
     * @param message 消息
     * @param tools 可用工具列表
     * @param conversationId 对话 ID
     * @param model 模型
     */
    suspend fun chatWithTools(
        message: String,
        tools: List<AITool>,
        conversationId: String? = null,
        model: String? = null
    ): Result<ToolCallResponse> {
        val params = mutableMapOf<String, Any>(
            "message" to message,
            "tools" to tools
        )
        conversationId?.let { params["conversationId"] = it }
        model?.let { params["model"] = it }
        return client.invoke("ai.chatWithTools", params)
    }

    /**
     * 提交工具执行结果
     *
     * @param conversationId 对话 ID
     * @param toolCallId 工具调用 ID
     * @param result 执行结果
     */
    suspend fun submitToolResult(
        conversationId: String,
        toolCallId: String,
        result: String
    ): Result<ChatResponse> {
        return client.invoke("ai.submitToolResult", mapOf(
            "conversationId" to conversationId,
            "toolCallId" to toolCallId,
            "result" to result
        ))
    }

    // ==================== 提示词模板 ====================

    /**
     * 列出提示词模板
     */
    suspend fun listPromptTemplates(): Result<PromptTemplatesResponse> {
        return client.invoke("ai.listPromptTemplates", emptyMap())
    }

    /**
     * 获取提示词模板
     *
     * @param templateId 模板 ID
     */
    suspend fun getPromptTemplate(templateId: String): Result<PromptTemplateResponse> {
        return client.invoke("ai.getPromptTemplate", mapOf("templateId" to templateId))
    }

    /**
     * 创建提示词模板
     *
     * @param name 名称
     * @param template 模板内容
     * @param description 描述
     * @param variables 变量列表
     */
    suspend fun createPromptTemplate(
        name: String,
        template: String,
        description: String? = null,
        variables: List<String>? = null
    ): Result<PromptTemplateResponse> {
        val params = mutableMapOf<String, Any>(
            "name" to name,
            "template" to template
        )
        description?.let { params["description"] = it }
        variables?.let { params["variables"] = it }
        return client.invoke("ai.createPromptTemplate", params)
    }

    /**
     * 使用提示词模板
     *
     * @param templateId 模板 ID
     * @param variables 变量值
     */
    suspend fun usePromptTemplate(
        templateId: String,
        variables: Map<String, String>
    ): Result<PromptFromTemplateResponse> {
        return client.invoke("ai.usePromptTemplate", mapOf(
            "templateId" to templateId,
            "variables" to variables
        ))
    }

    // ==================== 使用统计 ====================

    /**
     * 获取使用统计
     *
     * @param startDate 开始日期 (YYYY-MM-DD)
     * @param endDate 结束日期 (YYYY-MM-DD)
     */
    suspend fun getUsageStats(
        startDate: String? = null,
        endDate: String? = null
    ): Result<UsageStatsResponse> {
        val params = mutableMapOf<String, Any>()
        startDate?.let { params["startDate"] = it }
        endDate?.let { params["endDate"] = it }
        return client.invoke("ai.getUsageStats", params)
    }

    /**
     * 获取模型配额
     */
    suspend fun getQuota(): Result<QuotaResponse> {
        return client.invoke("ai.getQuota", emptyMap())
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

@Serializable
data class AgentsResponse(
    val agents: List<RemoteAgentInfo>,
    val total: Int = 0
)

@Serializable
data class RemoteAgentInfo(
    val id: String,
    val name: String,
    val description: String? = null,
    val status: String? = null,
    val type: String? = null
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

// ==================== 流式对话响应 ====================

@Serializable
data class StreamStartResponse(
    val streamId: String,
    val conversationId: String,
    val model: String
)

@Serializable
data class StreamChunkResponse(
    val streamId: String,
    val content: String,
    val done: Boolean,
    val tokens: Int? = null
)

@Serializable
data class StreamCancelResponse(
    val success: Boolean,
    val streamId: String,
    val message: String? = null
)

// ==================== 对话管理响应 ====================

@Serializable
data class ConversationDetailResponse(
    val success: Boolean,
    val conversation: ConversationDetail
)

@Serializable
data class ConversationDetail(
    val id: String,
    val title: String,
    val model: String,
    val systemPrompt: String? = null,
    val messageCount: Int,
    val totalTokens: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val archived: Boolean = false,
    val metadata: Map<String, String>? = null
)

@Serializable
data class CreateConversationResponse(
    val success: Boolean,
    val conversationId: String,
    val title: String,
    val model: String
)

@Serializable
data class DeleteConversationResponse(
    val success: Boolean,
    val conversationId: String,
    val message: String? = null
)

@Serializable
data class RenameConversationResponse(
    val success: Boolean,
    val conversationId: String,
    val title: String
)

@Serializable
data class ClearConversationResponse(
    val success: Boolean,
    val conversationId: String,
    val deletedMessages: Int
)

@Serializable
data class ArchiveConversationResponse(
    val success: Boolean,
    val conversationId: String,
    val archived: Boolean
)

@Serializable
data class ExportConversationResponse(
    val success: Boolean,
    val conversationId: String,
    val format: String,
    val content: String,
    val messageCount: Int
)

// ==================== 消息管理响应 ====================

@Serializable
data class MessagesResponse(
    val success: Boolean,
    val conversationId: String,
    val messages: List<Message>,
    val total: Int
)

@Serializable
data class Message(
    val id: String,
    val role: String,  // "user", "assistant", "system"
    val content: String,
    val tokens: Int? = null,
    val createdAt: Long,
    val metadata: Map<String, String>? = null
)

@Serializable
data class DeleteMessageResponse(
    val success: Boolean,
    val conversationId: String,
    val messageId: String
)

// ==================== 嵌入向量响应 ====================

@Serializable
data class EmbeddingResponse(
    val success: Boolean,
    val embedding: List<Float>,
    val model: String,
    val dimensions: Int,
    val tokens: Int
)

@Serializable
data class BatchEmbeddingResponse(
    val success: Boolean,
    val embeddings: List<List<Float>>,
    val model: String,
    val dimensions: Int,
    val totalTokens: Int
)

@Serializable
data class SimilarityResponse(
    val success: Boolean,
    val similarity: Float,  // 0-1
    val method: String  // "cosine", "euclidean"
)

// ==================== RAG 知识库响应 ====================

@Serializable
data class RAGDocument(
    val content: String,
    val metadata: Map<String, String>? = null
)

@Serializable
data class RAGAddDocumentResponse(
    val success: Boolean,
    val documentId: String,
    val collectionName: String,
    val chunks: Int
)

@Serializable
data class RAGAddDocumentsResponse(
    val success: Boolean,
    val documentIds: List<String>,
    val collectionName: String,
    val totalChunks: Int
)

@Serializable
data class RAGDeleteResponse(
    val success: Boolean,
    val deleted: Int,
    val message: String? = null
)

@Serializable
data class RAGCollectionsResponse(
    val success: Boolean,
    val collections: List<RAGCollection>,
    val total: Int
)

@Serializable
data class RAGCollection(
    val name: String,
    val description: String? = null,
    val documentCount: Int,
    val vectorCount: Int,
    val createdAt: Long
)

@Serializable
data class RAGCollectionResponse(
    val success: Boolean,
    val collection: RAGCollection
)

// ==================== 图像生成响应 ====================

@Serializable
data class ImageGenerationResponse(
    val success: Boolean,
    val images: List<GeneratedImage>,
    val model: String,
    val prompt: String
)

@Serializable
data class GeneratedImage(
    val data: String,  // Base64
    val width: Int,
    val height: Int,
    val format: String,
    val seed: Long? = null
)

// ==================== 图像分析响应 ====================

@Serializable
data class ImageAnalysisResponse(
    val success: Boolean,
    val description: String,
    val model: String,
    val tokens: TokenUsage? = null
)

@Serializable
data class OCRResponse(
    val success: Boolean,
    val text: String,
    val blocks: List<OCRBlock>? = null,
    val language: String,
    val confidence: Float
)

@Serializable
data class OCRBlock(
    val text: String,
    val confidence: Float,
    val boundingBox: BoundingBox
)

@Serializable
data class BoundingBox(
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int
)

// ==================== 音频处理响应 ====================

@Serializable
data class TranscriptionResponse(
    val success: Boolean,
    val text: String,
    val language: String,
    val duration: Float,  // seconds
    val segments: List<TranscriptionSegment>? = null
)

@Serializable
data class TranscriptionSegment(
    val start: Float,
    val end: Float,
    val text: String,
    val confidence: Float? = null
)

@Serializable
data class TTSResponse(
    val success: Boolean,
    val audioData: String,  // Base64
    val format: String,
    val duration: Float,
    val size: Int
)

@Serializable
data class VoicesResponse(
    val success: Boolean,
    val voices: List<VoiceInfo>,
    val total: Int
)

@Serializable
data class VoiceInfo(
    val id: String,
    val name: String,
    val language: String,
    val gender: String,
    val preview: String? = null  // Preview URL
)

// ==================== 文本处理响应 ====================

@Serializable
data class SummarizeResponse(
    val success: Boolean,
    val summary: String,
    val originalLength: Int,
    val summaryLength: Int,
    val compressionRatio: Float
)

@Serializable
data class TranslationResponse(
    val success: Boolean,
    val translation: String,
    val sourceLanguage: String,
    val targetLanguage: String,
    val confidence: Float? = null
)

@Serializable
data class SentimentResponse(
    val success: Boolean,
    val sentiment: String,  // "positive", "negative", "neutral"
    val score: Float,  // -1 to 1
    val confidence: Float
)

@Serializable
data class KeywordsResponse(
    val success: Boolean,
    val keywords: List<Keyword>
)

@Serializable
data class Keyword(
    val word: String,
    val score: Float,
    val count: Int? = null
)

@Serializable
data class EntitiesResponse(
    val success: Boolean,
    val entities: List<Entity>
)

@Serializable
data class Entity(
    val text: String,
    val type: String,  // "person", "organization", "location", "date", etc.
    val start: Int,
    val end: Int,
    val confidence: Float? = null
)

// ==================== 代码生成响应 ====================

@Serializable
data class CodeGenerationResponse(
    val success: Boolean,
    val code: String,
    val language: String,
    val explanation: String? = null,
    val tokens: TokenUsage? = null
)

@Serializable
data class CodeExplanationResponse(
    val success: Boolean,
    val explanation: String,
    val language: String,
    val complexity: String? = null,
    val tokens: TokenUsage? = null
)

@Serializable
data class CodeReviewResponse(
    val success: Boolean,
    val issues: List<CodeIssue>,
    val suggestions: List<String>,
    val overallScore: Float,  // 0-10
    val language: String
)

@Serializable
data class CodeIssue(
    val type: String,  // "bug", "style", "performance", "security"
    val severity: String,  // "low", "medium", "high", "critical"
    val line: Int? = null,
    val message: String,
    val suggestion: String? = null
)

// ==================== 工具调用响应 ====================

@Serializable
data class AITool(
    val name: String,
    val description: String,
    val parameters: Map<String, ToolParameter>
)

@Serializable
data class ToolParameter(
    val type: String,
    val description: String,
    val required: Boolean = false,
    val enum: List<String>? = null
)

@Serializable
data class ToolCallResponse(
    val success: Boolean,
    val conversationId: String,
    val response: String? = null,  // If no tool call needed
    val toolCalls: List<ToolCall>? = null
)

@Serializable
data class ToolCall(
    val id: String,
    val name: String,
    val arguments: Map<String, String>
)

// ==================== 提示词模板响应 ====================

@Serializable
data class PromptTemplatesResponse(
    val success: Boolean,
    val templates: List<PromptTemplate>,
    val total: Int
)

@Serializable
data class PromptTemplate(
    val id: String,
    val name: String,
    val template: String,
    val description: String? = null,
    val variables: List<String>,
    val createdAt: Long,
    val updatedAt: Long
)

@Serializable
data class PromptTemplateResponse(
    val success: Boolean,
    val template: PromptTemplate
)

@Serializable
data class PromptFromTemplateResponse(
    val success: Boolean,
    val prompt: String,
    val templateId: String,
    val variables: Map<String, String>
)

// ==================== 使用统计响应 ====================

@Serializable
data class UsageStatsResponse(
    val success: Boolean,
    val totalTokens: Long,
    val promptTokens: Long,
    val completionTokens: Long,
    val totalRequests: Int,
    val totalCost: Float? = null,
    val byModel: Map<String, ModelUsage>,
    val byDay: List<DailyUsage>? = null
)

@Serializable
data class ModelUsage(
    val tokens: Long,
    val requests: Int,
    val cost: Float? = null
)

@Serializable
data class DailyUsage(
    val date: String,
    val tokens: Long,
    val requests: Int,
    val cost: Float? = null
)

@Serializable
data class QuotaResponse(
    val success: Boolean,
    val quotas: List<ModelQuota>
)

@Serializable
data class ModelQuota(
    val model: String,
    val limit: Long,
    val used: Long,
    val remaining: Long,
    val resetAt: Long? = null
)
