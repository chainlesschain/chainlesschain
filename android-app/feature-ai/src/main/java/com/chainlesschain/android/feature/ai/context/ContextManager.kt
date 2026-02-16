package com.chainlesschain.android.feature.ai.context

import timber.log.Timber
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Context Manager
 *
 * Manages LLM conversation contexts with LRU caching strategy.
 * Provides efficient context storage, retrieval, and compression
 * for optimal LLM performance.
 *
 * Features:
 * - LRU cache with configurable size limits
 * - Per-conversation message limits
 * - Automatic token estimation
 * - Context compression support
 * - StateFlow-based reactive state
 *
 * Aligns with iOS implementation patterns.
 */
@Singleton
class ContextManager @Inject constructor() {

    // Configuration
    private var config = ContextConfig.DEFAULT

    // LRU Cache for contexts
    private val cache = LRUContextCache(config.maxContexts)

    // Current active context ID
    private val _currentContextId = MutableStateFlow<String?>(null)
    val currentContextId: StateFlow<String?> = _currentContextId.asStateFlow()

    // Cache statistics
    private val _stats = MutableStateFlow(cache.getStats())
    val stats: StateFlow<CacheStats> = _stats.asStateFlow()

    /**
     * Update configuration
     */
    fun updateConfig(newConfig: ContextConfig) {
        config = newConfig
        // Evict if new max is smaller
        if (cache.size > newConfig.maxContexts) {
            cache.evictTo(newConfig.maxContexts)
            updateStats()
        }
        Timber.d("Config updated: maxContexts=${newConfig.maxContexts}")
    }

    /**
     * Get or create a context for a conversation
     */
    fun getOrCreateContext(conversationId: String): ConversationContext {
        var context = cache.get(conversationId)
        if (context == null) {
            context = ConversationContext(conversationId = conversationId)
            cache.put(conversationId, context)
            Timber.d("Created new context: $conversationId")
        }
        updateStats()
        return context
    }

    /**
     * Get a context if it exists
     */
    fun getContext(conversationId: String): ConversationContext? {
        return cache.get(conversationId)
    }

    /**
     * Add a message to a conversation context
     */
    fun addMessage(conversationId: String, message: Message) {
        val context = getOrCreateContext(conversationId)

        // Check message limit
        if (context.messageCount >= config.maxMessagesPerContext) {
            // Remove oldest messages (keep system prompt if present)
            val removeCount = context.messageCount - config.maxMessagesPerContext + 1
            repeat(removeCount) {
                if (context.messages.isNotEmpty()) {
                    val firstMsg = context.messages.first()
                    if (firstMsg.role != MessageRole.SYSTEM) {
                        context.messages.removeAt(0)
                    } else if (context.messages.size > 1) {
                        context.messages.removeAt(1)
                    }
                }
            }
            Timber.d("Evicted $removeCount old messages from context: $conversationId")
        }

        context.addMessage(message)
        context.touch()

        // Check for auto-compression
        if (config.autoCompress && shouldCompress(context)) {
            Timber.d("Context $conversationId needs compression")
            // Compression would be triggered here - actual implementation depends on LLM service
        }

        updateStats()
    }

    /**
     * Set system prompt for a conversation
     */
    fun setSystemPrompt(conversationId: String, prompt: String) {
        val context = getOrCreateContext(conversationId)
        context.systemPrompt = prompt

        // Add or replace system message at the beginning
        val existingSystemIndex = context.messages.indexOfFirst { it.role == MessageRole.SYSTEM }
        val systemMessage = Message(
            id = "system-${conversationId}",
            conversationId = conversationId,
            role = MessageRole.SYSTEM,
            content = prompt,
            createdAt = System.currentTimeMillis()
        )

        if (existingSystemIndex >= 0) {
            context.messages[existingSystemIndex] = systemMessage
        } else {
            context.messages.add(0, systemMessage)
        }

        updateStats()
    }

    /**
     * Get messages for LLM context (optimized for token limits)
     */
    fun getMessagesForLLM(
        conversationId: String,
        maxTokens: Int = config.maxTokensPerContext
    ): List<Message> {
        val context = getContext(conversationId) ?: return emptyList()
        context.touch()

        // If under limit, return all messages
        if (context.estimatedTokens <= maxTokens) {
            return context.messages.toList()
        }

        // Otherwise, select messages within token budget
        val result = mutableListOf<Message>()
        var tokenBudget = maxTokens

        // Always include system message if present
        val systemMsg = context.messages.firstOrNull { it.role == MessageRole.SYSTEM }
        if (systemMsg != null) {
            result.add(systemMsg)
            tokenBudget -= estimateTokens(systemMsg.content)
        }

        // Add messages from newest to oldest (excluding system)
        val nonSystemMessages = context.messages.filter { it.role != MessageRole.SYSTEM }
        for (message in nonSystemMessages.reversed()) {
            val msgTokens = estimateTokens(message.content)
            if (tokenBudget >= msgTokens) {
                result.add(1.coerceAtMost(result.size), message) // Insert after system
                tokenBudget -= msgTokens
            } else {
                break
            }
        }

        return result.sortedBy { it.createdAt }
    }

    /**
     * Set current active context
     */
    fun setCurrentContext(conversationId: String?) {
        _currentContextId.value = conversationId
        conversationId?.let { cache.get(it)?.touch() }
    }

    /**
     * Clear a specific context
     */
    fun clearContext(conversationId: String) {
        cache.remove(conversationId)
        if (_currentContextId.value == conversationId) {
            _currentContextId.value = null
        }
        updateStats()
        Timber.d("Cleared context: $conversationId")
    }

    /**
     * Clear all contexts
     */
    fun clearAllContexts() {
        cache.clear()
        _currentContextId.value = null
        updateStats()
        Timber.d("Cleared all contexts")
    }

    /**
     * Get all context IDs
     */
    fun getAllContextIds(): List<String> = cache.getAccessOrder()

    /**
     * Check if context exists
     */
    fun hasContext(conversationId: String): Boolean = cache.contains(conversationId)

    /**
     * Mark context as compressed
     */
    fun markCompressed(conversationId: String, summary: String) {
        val context = getContext(conversationId) ?: return
        context.isCompressed = true
        context.compressionSummary = summary
        updateStats()
    }

    /**
     * Add metadata to context
     */
    fun setContextMetadata(conversationId: String, key: String, value: Any) {
        val context = getContext(conversationId) ?: return
        context.metadata[key] = value
    }

    /**
     * Get metadata from context
     */
    fun getContextMetadata(conversationId: String, key: String): Any? {
        return getContext(conversationId)?.metadata?.get(key)
    }

    // --- Private helpers ---

    private fun shouldCompress(context: ConversationContext): Boolean {
        val threshold = (config.maxTokensPerContext * config.compressionThreshold).toInt()
        return context.estimatedTokens >= threshold
    }

    private fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0
        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars
        return (chineseChars / 2.0 + otherChars / 4.0).toInt().coerceAtLeast(1)
    }

    private fun updateStats() {
        _stats.value = cache.getStats()
    }
}
