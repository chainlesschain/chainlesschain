package com.chainlesschain.android.feature.ai.context

/**
 * Context Manager Configuration
 *
 * Configures the behavior of the LRU context cache system.
 */
data class ContextConfig(
    /**
     * Maximum number of conversation contexts to keep in cache
     */
    val maxContexts: Int = DEFAULT_MAX_CONTEXTS,

    /**
     * Maximum number of messages per conversation context
     */
    val maxMessagesPerContext: Int = DEFAULT_MAX_MESSAGES_PER_CONTEXT,

    /**
     * Maximum token limit per context (for LLM optimization)
     */
    val maxTokensPerContext: Int = DEFAULT_MAX_TOKENS_PER_CONTEXT,

    /**
     * Enable automatic context compression when limit is reached
     */
    val autoCompress: Boolean = true,

    /**
     * Compression threshold (percentage of max before triggering compression)
     */
    val compressionThreshold: Float = 0.8f,

    /**
     * Enable context persistence to disk
     */
    val persistToDisk: Boolean = false
) {
    companion object {
        const val DEFAULT_MAX_CONTEXTS = 50
        const val DEFAULT_MAX_MESSAGES_PER_CONTEXT = 100
        const val DEFAULT_MAX_TOKENS_PER_CONTEXT = 128000

        /**
         * Default configuration suitable for most use cases
         */
        val DEFAULT = ContextConfig()

        /**
         * Memory-optimized configuration for low-memory devices
         */
        val LOW_MEMORY = ContextConfig(
            maxContexts = 20,
            maxMessagesPerContext = 50,
            maxTokensPerContext = 32000,
            autoCompress = true,
            compressionThreshold = 0.6f
        )

        /**
         * High-performance configuration for powerful devices
         */
        val HIGH_PERFORMANCE = ContextConfig(
            maxContexts = 100,
            maxMessagesPerContext = 200,
            maxTokensPerContext = 256000,
            autoCompress = true,
            compressionThreshold = 0.9f
        )
    }
}
