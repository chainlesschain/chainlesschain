package com.chainlesschain.android.feature.ai.session

import timber.log.Timber
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectMessageType
import com.chainlesschain.android.core.database.entity.SessionStats
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Session Compressor
 *
 * Provides intelligent compression of conversation context:
 * - Priority-based message retention
 * - Automatic summarization of old messages
 * - Code block truncation
 * - File reference compression
 * - Achieves 30-40% token savings while preserving context quality
 */
@Singleton
class SessionCompressor @Inject constructor() {

    companion object {
        // Compression thresholds
        private const val MIN_MESSAGES_TO_KEEP = 5
        private const val IMPORTANT_MESSAGE_THRESHOLD = 60
        private const val CODE_BLOCK_MAX_LINES = 20
        private const val FILE_REFERENCE_MAX_CHARS = 200
    }

    /**
     * Compress session messages
     *
     * @param messages All session messages
     * @param targetTokens Target token count after compression
     * @param compressionLevel 0=light, 1=medium, 2=aggressive, 3=maximum
     */
    fun compressSession(
        messages: List<ProjectChatMessageEntity>,
        targetTokens: Int = SessionStats.TARGET_COMPRESSED_TOKENS,
        compressionLevel: Int = 1
    ): CompressionResult {
        if (messages.isEmpty()) {
            return CompressionResult(
                success = true,
                originalTokens = 0,
                compressedTokens = 0,
                savingsPercent = 0f,
                compressionLevel = compressionLevel,
                summary = null,
                retainedMessageCount = 0
            )
        }

        val originalTokens = messages.sumOf { estimateTokens(it.content) }

        // If already under target, minimal compression
        if (originalTokens <= targetTokens) {
            return CompressionResult(
                success = true,
                originalTokens = originalTokens,
                compressedTokens = originalTokens,
                savingsPercent = 0f,
                compressionLevel = 0,
                summary = generateSummary(messages),
                retainedMessageCount = messages.size
            )
        }

        Timber.d("Compressing ${messages.size} messages, $originalTokens tokens -> target $targetTokens")

        // Score and sort messages by importance
        val scoredMessages = messages.mapIndexed { index, msg ->
            ScoredMessage(
                message = msg,
                index = index,
                score = calculateImportanceScore(msg, index, messages.size)
            )
        }

        // Apply compression based on level
        val compressedMessages = when (compressionLevel) {
            0 -> lightCompression(scoredMessages, targetTokens)
            1 -> mediumCompression(scoredMessages, targetTokens)
            2 -> aggressiveCompression(scoredMessages, targetTokens)
            else -> maximumCompression(scoredMessages, targetTokens)
        }

        val compressedTokens = compressedMessages.sumOf { estimateTokens(it.content) }
        val savingsPercent = if (originalTokens > 0) {
            ((originalTokens - compressedTokens).toFloat() / originalTokens) * 100
        } else 0f

        Timber.d("Compression complete: $originalTokens -> $compressedTokens tokens (${savingsPercent.toInt()}% savings)")

        return CompressionResult(
            success = true,
            originalTokens = originalTokens,
            compressedTokens = compressedTokens,
            savingsPercent = savingsPercent,
            compressionLevel = compressionLevel,
            summary = generateSummary(messages),
            retainedMessageCount = compressedMessages.size
        )
    }

    /**
     * Compress context for LLM call
     */
    fun compressContext(
        messages: List<ProjectChatMessageEntity>,
        maxTokens: Int,
        compressionLevel: Int = 1
    ): OptimizedContextResult {
        if (messages.isEmpty()) {
            return OptimizedContextResult(
                messages = emptyList(),
                totalTokens = 0,
                isCompressed = false,
                savingsPercent = 0f
            )
        }

        val originalTokens = messages.sumOf { estimateTokens(it.content) }

        if (originalTokens <= maxTokens) {
            return OptimizedContextResult(
                messages = messages,
                totalTokens = originalTokens,
                isCompressed = false,
                savingsPercent = 0f
            )
        }

        // Select most important messages within token limit
        val scoredMessages = messages.mapIndexed { index, msg ->
            ScoredMessage(
                message = msg,
                index = index,
                score = calculateImportanceScore(msg, index, messages.size)
            )
        }

        val selected = selectMessagesWithinLimit(scoredMessages, maxTokens, compressionLevel)
        val selectedTokens = selected.sumOf { estimateTokens(it.content) }

        val savingsPercent = if (originalTokens > 0) {
            ((originalTokens - selectedTokens).toFloat() / originalTokens) * 100
        } else 0f

        return OptimizedContextResult(
            messages = selected,
            totalTokens = selectedTokens,
            isCompressed = true,
            savingsPercent = savingsPercent
        )
    }

    /**
     * Generate summary of conversation
     */
    fun generateSummary(messages: List<ProjectChatMessageEntity>): String {
        if (messages.isEmpty()) return "Empty conversation"

        val userMessages = messages.filter { it.role == "user" }
        val topics = mutableSetOf<String>()

        // Extract key topics from user messages
        userMessages.forEach { msg ->
            // Simple topic extraction based on keywords
            val content = msg.content.lowercase()

            if (content.contains("代码") || content.contains("code")) topics.add("代码讨论")
            if (content.contains("bug") || content.contains("错误") || content.contains("问题")) topics.add("问题解决")
            if (content.contains("解释") || content.contains("explain")) topics.add("概念解释")
            if (content.contains("优化") || content.contains("improve")) topics.add("代码优化")
            if (content.contains("测试") || content.contains("test")) topics.add("测试相关")
            if (content.contains("文档") || content.contains("document")) topics.add("文档编写")
            if (content.contains("重构") || content.contains("refactor")) topics.add("代码重构")
        }

        val topicSummary = if (topics.isNotEmpty()) {
            "主题: ${topics.take(3).joinToString(", ")}"
        } else {
            "一般对话"
        }

        return buildString {
            appendLine("会话摘要")
            appendLine("- 消息数: ${messages.size}")
            appendLine("- 用户消息: ${userMessages.size}")
            appendLine("- $topicSummary")
        }
    }

    // --- Compression strategies ---

    /**
     * Light compression: Keep all recent + important messages
     */
    private fun lightCompression(
        scoredMessages: List<ScoredMessage>,
        targetTokens: Int
    ): List<ProjectChatMessageEntity> {
        // Keep last N messages unconditionally
        val recentCount = minOf(10, scoredMessages.size)
        val recentMessages = scoredMessages.takeLast(recentCount)

        // Keep high-priority older messages
        val olderImportant = scoredMessages.dropLast(recentCount)
            .filter { it.score >= IMPORTANT_MESSAGE_THRESHOLD }

        val selected = (olderImportant + recentMessages)
            .distinctBy { it.message.id }
            .sortedBy { it.index }
            .map { compressMessageContent(it.message, CompressionMode.LIGHT) }

        return trimToTokenLimit(selected, targetTokens)
    }

    /**
     * Medium compression: Summarize old messages, keep recent
     */
    private fun mediumCompression(
        scoredMessages: List<ScoredMessage>,
        targetTokens: Int
    ): List<ProjectChatMessageEntity> {
        val recentCount = minOf(7, scoredMessages.size)
        val recentMessages = scoredMessages.takeLast(recentCount)

        // Compress older messages more aggressively
        val olderMessages = scoredMessages.dropLast(recentCount)
            .filter { it.score >= 40 }
            .map { compressMessageContent(it.message, CompressionMode.MEDIUM) }

        val recentCompressed = recentMessages.map {
            compressMessageContent(it.message, CompressionMode.LIGHT)
        }

        val selected = (olderMessages + recentCompressed)
            .distinctBy { it.id }
            .sortedBy { scoredMessages.find { s -> s.message.id == it.id }?.index ?: 0 }

        return trimToTokenLimit(selected, targetTokens)
    }

    /**
     * Aggressive compression: Only critical + very recent
     */
    private fun aggressiveCompression(
        scoredMessages: List<ScoredMessage>,
        targetTokens: Int
    ): List<ProjectChatMessageEntity> {
        val recentCount = minOf(5, scoredMessages.size)
        val recentMessages = scoredMessages.takeLast(recentCount)

        // Only keep critical older messages
        val criticalOlder = scoredMessages.dropLast(recentCount)
            .filter { it.score >= 80 }
            .map { compressMessageContent(it.message, CompressionMode.AGGRESSIVE) }

        val recentCompressed = recentMessages.map {
            compressMessageContent(it.message, CompressionMode.MEDIUM)
        }

        val selected = (criticalOlder + recentCompressed)
            .distinctBy { it.id }

        return trimToTokenLimit(selected, targetTokens)
    }

    /**
     * Maximum compression: Absolute minimum context
     */
    private fun maximumCompression(
        scoredMessages: List<ScoredMessage>,
        targetTokens: Int
    ): List<ProjectChatMessageEntity> {
        // Keep only last few messages + system messages
        val systemMessages = scoredMessages.filter {
            it.message.messageType == ProjectMessageType.SYSTEM
        }

        val recent = scoredMessages.takeLast(MIN_MESSAGES_TO_KEEP)

        val selected = (systemMessages + recent)
            .distinctBy { it.message.id }
            .sortedBy { it.index }
            .map { compressMessageContent(it.message, CompressionMode.AGGRESSIVE) }

        return trimToTokenLimit(selected, targetTokens)
    }

    /**
     * Select messages within token limit
     */
    private fun selectMessagesWithinLimit(
        scoredMessages: List<ScoredMessage>,
        maxTokens: Int,
        compressionLevel: Int
    ): List<ProjectChatMessageEntity> {
        val mode = when (compressionLevel) {
            0 -> CompressionMode.LIGHT
            1 -> CompressionMode.MEDIUM
            else -> CompressionMode.AGGRESSIVE
        }

        // Always keep most recent messages
        val mustKeep = scoredMessages.takeLast(MIN_MESSAGES_TO_KEEP)
            .map { compressMessageContent(it.message, mode) }

        var usedTokens = mustKeep.sumOf { estimateTokens(it.content) }

        // Add older messages by priority until limit
        val additional = mutableListOf<ProjectChatMessageEntity>()
        val remaining = scoredMessages.dropLast(MIN_MESSAGES_TO_KEEP)
            .sortedByDescending { it.score }

        for (scored in remaining) {
            val compressed = compressMessageContent(scored.message, mode)
            val tokens = estimateTokens(compressed.content)

            if (usedTokens + tokens <= maxTokens) {
                additional.add(compressed)
                usedTokens += tokens
            }
        }

        // Sort by original order
        val allSelected = (additional + mustKeep).distinctBy { it.id }
        return allSelected.sortedBy { msg ->
            scoredMessages.find { it.message.id == msg.id }?.index ?: 0
        }
    }

    /**
     * Compress individual message content
     */
    private fun compressMessageContent(
        message: ProjectChatMessageEntity,
        mode: CompressionMode
    ): ProjectChatMessageEntity {
        val content = message.content

        val compressed = when (message.messageType) {
            ProjectMessageType.CODE_BLOCK -> compressCodeBlock(content, mode)
            ProjectMessageType.FILE_REFERENCE -> compressFileReference(content, mode)
            ProjectMessageType.TASK_PLAN -> compressTaskPlan(content, mode)
            ProjectMessageType.EXECUTION_RESULT -> compressExecutionResult(content, mode)
            else -> compressGenericMessage(content, mode)
        }

        return message.copy(content = compressed)
    }

    private fun compressCodeBlock(content: String, mode: CompressionMode): String {
        val lines = content.lines()
        val maxLines = when (mode) {
            CompressionMode.LIGHT -> 30
            CompressionMode.MEDIUM -> CODE_BLOCK_MAX_LINES
            CompressionMode.AGGRESSIVE -> 10
        }

        if (lines.size <= maxLines) return content

        val halfLines = maxLines / 2
        val header = lines.take(halfLines)
        val footer = lines.takeLast(halfLines)

        return buildString {
            appendLine(header.joinToString("\n"))
            appendLine("... (${lines.size - maxLines} lines omitted) ...")
            append(footer.joinToString("\n"))
        }
    }

    private fun compressFileReference(content: String, mode: CompressionMode): String {
        val maxChars = when (mode) {
            CompressionMode.LIGHT -> 500
            CompressionMode.MEDIUM -> FILE_REFERENCE_MAX_CHARS
            CompressionMode.AGGRESSIVE -> 100
        }

        if (content.length <= maxChars) return content

        // Extract file path
        val pathMatch = Regex("(?:路径|Path)[:：]\\s*(.+)").find(content)
        val path = pathMatch?.groupValues?.get(1) ?: ""

        return "文件引用: $path (内容已压缩)"
    }

    private fun compressTaskPlan(content: String, mode: CompressionMode): String {
        val lines = content.lines()
        val maxSteps = when (mode) {
            CompressionMode.LIGHT -> 10
            CompressionMode.MEDIUM -> 5
            CompressionMode.AGGRESSIVE -> 3
        }

        val title = lines.firstOrNull() ?: "Task Plan"
        val steps = lines.filter { it.trim().startsWith("-") || it.trim().matches(Regex("^\\d+\\..*")) }

        return buildString {
            appendLine(title)
            steps.take(maxSteps).forEach { appendLine(it) }
            if (steps.size > maxSteps) {
                appendLine("... (${steps.size - maxSteps} more steps)")
            }
        }
    }

    private fun compressExecutionResult(content: String, mode: CompressionMode): String {
        val maxChars = when (mode) {
            CompressionMode.LIGHT -> 500
            CompressionMode.MEDIUM -> 200
            CompressionMode.AGGRESSIVE -> 100
        }

        if (content.length <= maxChars) return content

        val halfChars = maxChars / 2
        return "${content.take(halfChars)}...(truncated)...${content.takeLast(halfChars)}"
    }

    private fun compressGenericMessage(content: String, mode: CompressionMode): String {
        val maxChars = when (mode) {
            CompressionMode.LIGHT -> 1000
            CompressionMode.MEDIUM -> 500
            CompressionMode.AGGRESSIVE -> 200
        }

        if (content.length <= maxChars) return content

        return content.take(maxChars) + "..."
    }

    private fun trimToTokenLimit(
        messages: List<ProjectChatMessageEntity>,
        maxTokens: Int
    ): List<ProjectChatMessageEntity> {
        var totalTokens = messages.sumOf { estimateTokens(it.content) }

        if (totalTokens <= maxTokens) return messages

        val result = messages.toMutableList()

        // Remove from the beginning (oldest) until under limit
        while (totalTokens > maxTokens && result.size > MIN_MESSAGES_TO_KEEP) {
            val removed = result.removeAt(0)
            totalTokens -= estimateTokens(removed.content)
        }

        return result
    }

    /**
     * Calculate importance score for a message
     */
    private fun calculateImportanceScore(
        message: ProjectChatMessageEntity,
        index: Int,
        totalMessages: Int
    ): Int {
        var score = 0

        // Message type weight
        score += when (message.messageType) {
            ProjectMessageType.SYSTEM -> 100
            ProjectMessageType.TASK_PLAN -> 90
            ProjectMessageType.TASK_ANALYSIS -> 85
            ProjectMessageType.CODE_BLOCK -> 70
            ProjectMessageType.FILE_REFERENCE -> 60
            ProjectMessageType.EXECUTION_RESULT -> 50
            ProjectMessageType.INTENT_CONFIRM -> 40
            else -> 30
        }

        // Role weight (user messages slightly more important)
        score += if (message.role == "user") 10 else 5

        // Recency weight (newer = more important)
        val recencyFactor = index.toFloat() / totalMessages
        score += (recencyFactor * 30).toInt()

        // Content length consideration (very short might be less important)
        val contentLength = message.content.length
        score += when {
            contentLength < 20 -> -10
            contentLength > 500 -> 5
            else -> 0
        }

        // Quick action results are important
        if (message.isQuickAction) score += 15

        return score.coerceIn(0, 100)
    }

    private fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0
        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars
        return (chineseChars / 2.0f + otherChars / 4.0f).toInt()
    }
}

// --- Supporting types ---

private data class ScoredMessage(
    val message: ProjectChatMessageEntity,
    val index: Int,
    val score: Int
)

private enum class CompressionMode {
    LIGHT,
    MEDIUM,
    AGGRESSIVE
}

data class CompressionResult(
    val success: Boolean,
    val originalTokens: Int,
    val compressedTokens: Int,
    val savingsPercent: Float,
    val compressionLevel: Int,
    val summary: String?,
    val retainedMessageCount: Int,
    val error: String? = null
)
