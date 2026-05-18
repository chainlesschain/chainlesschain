package com.chainlesschain.android.feature.ai.context

import com.chainlesschain.android.feature.ai.domain.model.Message

/**
 * Conversation Context
 *
 * Represents a single conversation's context in the LRU cache.
 * Contains messages and metadata for efficient context management.
 */
data class ConversationContext(
    /**
     * Unique conversation identifier
     */
    val conversationId: String,

    /**
     * List of messages in this context
     */
    val messages: MutableList<Message> = mutableListOf(),

    /**
     * System prompt for this conversation (if any)
     */
    var systemPrompt: String? = null,

    /**
     * Estimated total token count
     */
    var estimatedTokens: Int = 0,

    /**
     * Last access timestamp for LRU ordering
     */
    var lastAccessedAt: Long = System.currentTimeMillis(),

    /**
     * Creation timestamp
     */
    val createdAt: Long = System.currentTimeMillis(),

    /**
     * Whether this context has been compressed
     */
    var isCompressed: Boolean = false,

    /**
     * Compression summary (if compressed)
     */
    var compressionSummary: String? = null,

    /**
     * Custom metadata for this context
     */
    val metadata: MutableMap<String, Any> = mutableMapOf()
) {
    /**
     * Update last accessed timestamp
     */
    fun touch() {
        lastAccessedAt = System.currentTimeMillis()
    }

    /**
     * Add a message to this context
     */
    fun addMessage(message: Message) {
        messages.add(message)
        estimatedTokens += estimateTokens(message.content)
    }

    /**
     * Get message count
     */
    val messageCount: Int
        get() = messages.size

    /**
     * Clear all messages
     */
    fun clear() {
        messages.clear()
        estimatedTokens = 0
        isCompressed = false
        compressionSummary = null
    }

    /**
     * Estimate tokens for text content
     * Uses simple heuristic: Chinese chars ~0.5 tokens, others ~0.25 tokens
     */
    private fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0
        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars
        return (chineseChars / 2.0 + otherChars / 4.0).toInt().coerceAtLeast(1)
    }
}
