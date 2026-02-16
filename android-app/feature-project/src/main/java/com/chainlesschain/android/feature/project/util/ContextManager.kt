package com.chainlesschain.android.feature.project.util

import timber.log.Timber
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.project.model.ProjectMessageType

/**
 * 智能上下文管理器
 *
 * 功能：
 * 1. Token 计数和管理
 * 2. 消息优先级排序
 * 3. 自动压缩历史消息
 * 4. 上下文窗口优化
 */
class ContextManager(
    private val maxContextTokens: Int = 4000,  // 默认最大上下文 token 数
    private val compressionRatio: Float = 0.5f  // 压缩比例
) {

    companion object {
        // Token 估算：中文约 2 字符/token，英文约 4 字符/token
        private const val CHARS_PER_TOKEN_CN = 2.0f
        private const val CHARS_PER_TOKEN_EN = 4.0f

        // 消息类型权重（用于优先级计算）
        private val TYPE_WEIGHTS = mapOf(
            "SYSTEM" to 10,
            "TASK_PLAN" to 9,
            "TASK_ANALYSIS" to 8,
            "CODE_BLOCK" to 7,
            "FILE_REFERENCE" to 6,
            "EXECUTION_RESULT" to 5,
            "CREATION" to 4,
            "INTENT_CONFIRM" to 3,
            "NORMAL" to 2
        )
    }

    /**
     * 估算文本的 token 数量
     */
    fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0

        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars

        val cnTokens = chineseChars / CHARS_PER_TOKEN_CN
        val enTokens = otherChars / CHARS_PER_TOKEN_EN

        return (cnTokens + enTokens).toInt()
    }

    /**
     * 计算消息列表的总 token 数
     */
    fun calculateTotalTokens(messages: List<ProjectChatMessageEntity>): Int {
        return messages.sumOf { estimateTokens(it.content) }
    }

    /**
     * 计算消息优先级
     *
     * 优先级因素：
     * 1. 消息类型权重
     * 2. 时间衰减（越新优先级越高）
     * 3. 用户消息 vs AI 消息
     */
    fun calculatePriority(
        message: ProjectChatMessageEntity,
        currentTime: Long = System.currentTimeMillis()
    ): MessagePriority {
        val typeWeight = TYPE_WEIGHTS[message.messageType] ?: 1

        // 时间衰减：24小时内的消息保持高优先级
        val ageHours = (currentTime - message.createdAt) / (1000 * 60 * 60)
        val timeWeight = when {
            ageHours < 1 -> 10
            ageHours < 6 -> 8
            ageHours < 24 -> 5
            ageHours < 72 -> 3
            else -> 1
        }

        // 用户消息权重更高
        val roleWeight = if (message.role == "user") 2 else 1

        val totalScore = typeWeight * timeWeight * roleWeight

        return when {
            totalScore >= 100 -> MessagePriority.CRITICAL
            totalScore >= 50 -> MessagePriority.HIGH
            totalScore >= 20 -> MessagePriority.MEDIUM
            totalScore >= 10 -> MessagePriority.LOW
            else -> MessagePriority.VERY_LOW
        }
    }

    /**
     * 智能选择消息用于上下文
     *
     * 策略：
     * 1. 保留所有高优先级消息
     * 2. 保留最近 N 条消息
     * 3. 压缩旧的低优先级消息
     * 4. 确保总 token 数在限制内
     */
    fun selectMessagesForContext(
        allMessages: List<ProjectChatMessageEntity>,
        systemPrompt: String = ""
    ): ContextResult {
        val currentTime = System.currentTimeMillis()
        val systemTokens = estimateTokens(systemPrompt)
        val availableTokens = maxContextTokens - systemTokens

        // 给消息打分和排序
        val scoredMessages = allMessages.map { msg ->
            ScoredMessage(
                message = msg,
                priority = calculatePriority(msg, currentTime),
                tokens = estimateTokens(msg.content)
            )
        }.sortedByDescending { it.priority.score }

        // 策略 1: 保留最近 5 条消息（无论 token 数量）
        val recentCount = 5
        val recentMessages = allMessages.takeLast(recentCount)

        // 策略 2: 从高优先级消息中选择
        val selectedMessages = mutableListOf<ProjectChatMessageEntity>()
        val compressedMessages = mutableListOf<ProjectChatMessageEntity>()
        var usedTokens = 0

        // 首先加入最近消息
        recentMessages.forEach { msg ->
            val tokens = estimateTokens(msg.content)
            if (usedTokens + tokens <= availableTokens) {
                selectedMessages.add(msg)
                usedTokens += tokens
            }
        }

        // 然后按优先级加入其他消息
        val remainingMessages = scoredMessages.filter { scored ->
            !recentMessages.any { it.id == scored.message.id }
        }

        for (scored in remainingMessages) {
            if (usedTokens + scored.tokens <= availableTokens) {
                selectedMessages.add(scored.message)
                usedTokens += scored.tokens
            } else if (scored.priority.score >= MessagePriority.MEDIUM.score) {
                // 压缩高优先级但超长的消息
                val compressed = compressMessage(scored.message)
                val compressedTokens = estimateTokens(compressed.content)

                if (usedTokens + compressedTokens <= availableTokens) {
                    compressedMessages.add(compressed)
                    usedTokens += compressedTokens
                }
            }
        }

        // 按时间排序（保持对话顺序）
        val finalMessages = (selectedMessages + compressedMessages)
            .distinctBy { it.id }
            .sortedBy { it.createdAt }

        Timber.d("Context selection: ${finalMessages.size} messages, $usedTokens tokens used, ${compressedMessages.size} compressed")

        return ContextResult(
            messages = finalMessages,
            totalTokens = usedTokens,
            compressedCount = compressedMessages.size,
            droppedCount = allMessages.size - finalMessages.size
        )
    }

    /**
     * 压缩消息内容
     *
     * 压缩策略：
     * 1. 保留消息结构和关键信息
     * 2. 移除冗余内容
     * 3. 截断过长的代码块
     */
    private fun compressMessage(message: ProjectChatMessageEntity): ProjectChatMessageEntity {
        val content = message.content
        val targetLength = (content.length * compressionRatio).toInt()

        val compressed = when (message.messageType) {
            "CODE_BLOCK" -> {
                // 保留代码块的前后部分，中间用省略号
                compressCodeBlock(content, targetLength)
            }

            "FILE_REFERENCE" -> {
                // 保留文件路径，压缩文件内容
                compressFileReference(content, targetLength)
            }

            "TASK_PLAN" -> {
                // 保留任务标题和关键步骤
                compressTaskPlan(content, targetLength)
            }

            else -> {
                // 一般消息：保留开头和结尾
                if (content.length > targetLength) {
                    val halfLength = targetLength / 2
                    "${content.take(halfLength)}\n... (已压缩) ...\n${content.takeLast(halfLength)}"
                } else {
                    content
                }
            }
        }

        return message.copy(
            content = compressed
        )
    }

    /**
     * 压缩代码块
     */
    private fun compressCodeBlock(content: String, targetLength: Int): String {
        val lines = content.lines()
        if (lines.size <= 10) return content

        val headerLines = lines.take(5)
        val footerLines = lines.takeLast(5)
        val totalLines = lines.size

        return """
            |${headerLines.joinToString("\n")}
            |
            |... (省略 ${totalLines - 10} 行代码) ...
            |
            |${footerLines.joinToString("\n")}
        """.trimMargin()
    }

    /**
     * 压缩文件引用
     */
    private fun compressFileReference(content: String, targetLength: Int): String {
        // 提取文件路径
        val pathPattern = Regex("路径[:：]\\s*(.+)")
        val path = pathPattern.find(content)?.groupValues?.get(1) ?: "unknown"

        return "引用文件: $path (内容已压缩)"
    }

    /**
     * 压缩任务计划
     */
    private fun compressTaskPlan(content: String, targetLength: Int): String {
        val lines = content.lines()
        val title = lines.firstOrNull() ?: "Task Plan"
        val steps = lines.filter { it.trim().startsWith("-") || it.trim().startsWith("*") }

        return """
            |$title
            |
            |步骤:
            |${steps.take(5).joinToString("\n")}
            |${if (steps.size > 5) "... (还有 ${steps.size - 5} 个步骤)" else ""}
        """.trimMargin()
    }

    /**
     * 转换为 LLM Message 格式
     */
    fun convertToLLMMessages(
        messages: List<ProjectChatMessageEntity>,
        conversationId: String
    ): List<Message> {
        return messages.map { msg ->
            Message(
                id = msg.id,
                conversationId = conversationId,
                role = when (msg.role) {
                    "user" -> MessageRole.USER
                    "assistant" -> MessageRole.ASSISTANT
                    "system" -> MessageRole.SYSTEM
                    else -> MessageRole.USER
                },
                content = msg.content,
                createdAt = msg.createdAt,
                tokenCount = estimateTokens(msg.content)
            )
        }
    }

    /**
     * 生成上下文摘要
     */
    fun generateContextSummary(result: ContextResult): String {
        return """
            |上下文统计:
            |- 消息数: ${result.messages.size}
            |- 总 Tokens: ${result.totalTokens}/${maxContextTokens}
            |- 压缩消息数: ${result.compressedCount}
            |- 丢弃消息数: ${result.droppedCount}
            |- Token 使用率: ${"%.1f".format(result.totalTokens.toFloat() / maxContextTokens * 100)}%
        """.trimMargin()
    }
}

/**
 * 消息优先级枚举
 */
enum class MessagePriority(val score: Int) {
    CRITICAL(100),  // 关键消息（系统消息、最新消息）
    HIGH(50),       // 高优先级（任务计划、代码块）
    MEDIUM(20),     // 中优先级（文件引用、普通对话）
    LOW(10),        // 低优先级（旧消息）
    VERY_LOW(1)     // 很低优先级（可压缩或丢弃）
}

/**
 * 带评分的消息
 */
private data class ScoredMessage(
    val message: ProjectChatMessageEntity,
    val priority: MessagePriority,
    val tokens: Int
)

/**
 * 上下文选择结果
 */
data class ContextResult(
    val messages: List<ProjectChatMessageEntity>,  // 选中的消息
    val totalTokens: Int,                          // 总 token 数
    val compressedCount: Int,                      // 压缩的消息数
    val droppedCount: Int                          // 丢弃的消息数
)
