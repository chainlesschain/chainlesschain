package com.chainlesschain.android.feature.ai.session

import timber.log.Timber
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.SessionEntity
import com.chainlesschain.android.core.database.entity.SessionFilter
import com.chainlesschain.android.core.database.entity.SessionSortBy
import com.chainlesschain.android.core.database.entity.SessionStats
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Session Manager
 *
 * Manages AI conversation sessions with:
 * - Session creation, storage, and retrieval
 * - Automatic session compression (30-40% token savings)
 * - Session search and filtering
 * - Tag-based organization
 * - Export/import functionality
 * - Session analytics and insights
 */
@Singleton
class SessionManager @Inject constructor(
    private val sessionCompressor: SessionCompressor
) {

    companion object;

    private val gson = Gson()

    // In-memory session cache (thread-safe for concurrent coroutine access)
    private val sessionCache = java.util.concurrent.ConcurrentHashMap<String, SessionEntity>()
    private val messageCache = java.util.concurrent.ConcurrentHashMap<String, List<ProjectChatMessageEntity>>()

    // Current active session
    private val _currentSession = MutableStateFlow<SessionEntity?>(null)
    val currentSession: StateFlow<SessionEntity?> = _currentSession.asStateFlow()

    // Session list state
    private val _sessions = MutableStateFlow<List<SessionEntity>>(emptyList())
    val sessions: StateFlow<List<SessionEntity>> = _sessions.asStateFlow()

    /**
     * Create a new session
     */
    fun createSession(
        projectId: String?,
        title: String = "New Session",
        contextMode: String = "PROJECT",
        tags: List<String>? = null
    ): SessionEntity {
        val session = SessionEntity(
            id = UUID.randomUUID().toString(),
            projectId = projectId,
            title = title,
            contextMode = contextMode,
            tags = tags?.let { gson.toJson(it) }
        )

        sessionCache[session.id] = session
        messageCache[session.id] = emptyList()

        updateSessionList()
        Timber.d("Created new session: ${session.id}")

        return session
    }

    /**
     * Get or create session for a project
     */
    fun getOrCreateSession(
        projectId: String?,
        title: String = "Project Session"
    ): SessionEntity {
        // Find existing active session for project
        val existingSession = sessionCache.values.find {
            it.projectId == projectId && !it.isArchived
        }

        return existingSession ?: createSession(projectId, title)
    }

    /**
     * Set current active session
     */
    fun setCurrentSession(sessionId: String) {
        val session = sessionCache[sessionId]
        if (session != null) {
            val updatedSession = session.copy(
                lastAccessedAt = System.currentTimeMillis()
            )
            sessionCache[sessionId] = updatedSession
            _currentSession.value = updatedSession
            Timber.d("Set current session: $sessionId")
        }
    }

    /**
     * Add message to session
     */
    fun addMessage(
        sessionId: String,
        message: ProjectChatMessageEntity
    ): SessionUpdateResult {
        val session = sessionCache[sessionId] ?: return SessionUpdateResult(
            success = false,
            error = "Session not found"
        )

        val messages = messageCache[sessionId]?.toMutableList() ?: mutableListOf()
        messages.add(message)
        messageCache[sessionId] = messages

        // Estimate tokens
        val newTokens = estimateTokens(message.content)
        val totalTokens = session.totalTokens + newTokens

        // Check if compression is needed
        val needsCompression = messages.size >= SessionStats.DEFAULT_COMPRESSION_THRESHOLD ||
            totalTokens >= SessionStats.MAX_CONTEXT_TOKENS

        val updatedSession = session.copy(
            messageCount = messages.size,
            totalTokens = totalTokens,
            updatedAt = System.currentTimeMillis()
        )
        sessionCache[sessionId] = updatedSession

        // Trigger auto-compression if needed
        val compressionResult = if (needsCompression && !session.isCompressed) {
            autoCompressSession(sessionId)
        } else null

        updateSessionList()

        return SessionUpdateResult(
            success = true,
            session = updatedSession,
            compressionResult = compressionResult
        )
    }

    /**
     * Get messages for session
     */
    fun getSessionMessages(sessionId: String): List<ProjectChatMessageEntity> {
        return messageCache[sessionId] ?: emptyList()
    }

    /**
     * Get optimized context for LLM
     * Returns compressed/prioritized messages within token limit
     */
    fun getOptimizedContext(
        sessionId: String,
        maxTokens: Int = SessionStats.MAX_CONTEXT_TOKENS
    ): OptimizedContextResult {
        val messages = messageCache[sessionId] ?: return OptimizedContextResult(
            messages = emptyList(),
            totalTokens = 0,
            isCompressed = false,
            savingsPercent = 0f
        )

        val session = sessionCache[sessionId]
        val compressionLevel = session?.compressionLevel ?: 0

        return sessionCompressor.compressContext(
            messages = messages,
            maxTokens = maxTokens,
            compressionLevel = compressionLevel
        )
    }

    /**
     * Auto-compress session when threshold is reached
     */
    private fun autoCompressSession(sessionId: String): CompressionResult? {
        val session = sessionCache[sessionId] ?: return null
        val messages = messageCache[sessionId] ?: return null

        Timber.d("Auto-compressing session: $sessionId (${messages.size} messages)")

        val result = sessionCompressor.compressSession(
            messages = messages,
            targetTokens = SessionStats.TARGET_COMPRESSED_TOKENS
        )

        if (result.success) {
            // Update session with compression stats
            val updatedSession = session.copy(
                isCompressed = true,
                compressionLevel = result.compressionLevel,
                compressedTokens = result.compressedTokens,
                tokenSavingsPercent = result.savingsPercent,
                summary = result.summary,
                updatedAt = System.currentTimeMillis()
            )
            sessionCache[sessionId] = updatedSession
            updateSessionList()

            Timber.d("Session compressed: ${result.savingsPercent}%% savings")
        }

        return result
    }

    /**
     * Manually compress session
     */
    fun compressSession(
        sessionId: String,
        compressionLevel: Int = 1
    ): CompressionResult? {
        val session = sessionCache[sessionId] ?: return null
        val messages = messageCache[sessionId] ?: return null

        val result = sessionCompressor.compressSession(
            messages = messages,
            targetTokens = SessionStats.TARGET_COMPRESSED_TOKENS,
            compressionLevel = compressionLevel
        )

        if (result.success) {
            val updatedSession = session.copy(
                isCompressed = true,
                compressionLevel = compressionLevel,
                compressedTokens = result.compressedTokens,
                tokenSavingsPercent = result.savingsPercent,
                summary = result.summary,
                updatedAt = System.currentTimeMillis()
            )
            sessionCache[sessionId] = updatedSession
            updateSessionList()
        }

        return result
    }

    /**
     * Generate session summary
     */
    fun generateSummary(sessionId: String): String? {
        val messages = messageCache[sessionId] ?: return null
        return sessionCompressor.generateSummary(messages)
    }

    // --- Session Organization ---

    /**
     * Update session title
     */
    fun updateSessionTitle(sessionId: String, title: String) {
        val session = sessionCache[sessionId] ?: return
        val updated = session.copy(title = title, updatedAt = System.currentTimeMillis())
        sessionCache[sessionId] = updated
        updateSessionList()
    }

    /**
     * Add tag to session
     */
    fun addTag(sessionId: String, tag: String) {
        val session = sessionCache[sessionId] ?: return
        val currentTags = parseTags(session.tags).toMutableList()
        if (tag !in currentTags) {
            currentTags.add(tag)
            val updated = session.copy(
                tags = gson.toJson(currentTags),
                updatedAt = System.currentTimeMillis()
            )
            sessionCache[sessionId] = updated
            updateSessionList()
        }
    }

    /**
     * Remove tag from session
     */
    fun removeTag(sessionId: String, tag: String) {
        val session = sessionCache[sessionId] ?: return
        val currentTags = parseTags(session.tags).toMutableList()
        if (currentTags.remove(tag)) {
            val updated = session.copy(
                tags = if (currentTags.isEmpty()) null else gson.toJson(currentTags),
                updatedAt = System.currentTimeMillis()
            )
            sessionCache[sessionId] = updated
            updateSessionList()
        }
    }

    /**
     * Toggle pin status
     */
    fun togglePin(sessionId: String) {
        val session = sessionCache[sessionId] ?: return
        val updated = session.copy(
            isPinned = !session.isPinned,
            updatedAt = System.currentTimeMillis()
        )
        sessionCache[sessionId] = updated
        updateSessionList()
    }

    /**
     * Toggle star status
     */
    fun toggleStar(sessionId: String) {
        val session = sessionCache[sessionId] ?: return
        val updated = session.copy(
            isStarred = !session.isStarred,
            updatedAt = System.currentTimeMillis()
        )
        sessionCache[sessionId] = updated
        updateSessionList()
    }

    /**
     * Archive session
     */
    fun archiveSession(sessionId: String) {
        val session = sessionCache[sessionId] ?: return
        val updated = session.copy(
            isArchived = true,
            updatedAt = System.currentTimeMillis()
        )
        sessionCache[sessionId] = updated
        updateSessionList()
    }

    /**
     * Unarchive session
     */
    fun unarchiveSession(sessionId: String) {
        val session = sessionCache[sessionId] ?: return
        val updated = session.copy(
            isArchived = false,
            updatedAt = System.currentTimeMillis()
        )
        sessionCache[sessionId] = updated
        updateSessionList()
    }

    /**
     * Delete session
     */
    fun deleteSession(sessionId: String) {
        sessionCache.remove(sessionId)
        messageCache.remove(sessionId)

        if (_currentSession.value?.id == sessionId) {
            _currentSession.value = null
        }

        updateSessionList()
        Timber.d("Deleted session: $sessionId")
    }

    // --- Search & Filter ---

    /**
     * Search sessions
     */
    fun searchSessions(query: String): List<SessionEntity> {
        if (query.isBlank()) return _sessions.value

        val lowerQuery = query.lowercase()
        return sessionCache.values.filter { session ->
            session.title.lowercase().contains(lowerQuery) ||
                session.summary?.lowercase()?.contains(lowerQuery) == true ||
                parseTags(session.tags).any { it.lowercase().contains(lowerQuery) }
        }.sortedByDescending { it.updatedAt }
    }

    /**
     * Filter sessions
     */
    fun filterSessions(filter: SessionFilter): List<SessionEntity> {
        // Extract filter values to local variables for smart casting
        val filterTags = filter.tags
        val filterSearchQuery = filter.searchQuery
        val filterDateRange = filter.dateRange

        return sessionCache.values.filter { session ->
            (filter.projectId == null || session.projectId == filter.projectId) &&
                (filter.isArchived == null || session.isArchived == filter.isArchived) &&
                (filter.isPinned == null || session.isPinned == filter.isPinned) &&
                (filter.isStarred == null || session.isStarred == filter.isStarred) &&
                (filterTags == null || parseTags(session.tags).any { it in filterTags }) &&
                (filterSearchQuery == null || session.title.contains(filterSearchQuery, ignoreCase = true)) &&
                (filterDateRange == null || session.createdAt in filterDateRange.first..filterDateRange.second)
        }.sortedByDescending { it.updatedAt }
    }

    /**
     * Sort sessions
     */
    fun sortSessions(
        sessions: List<SessionEntity>,
        sortBy: SessionSortBy,
        ascending: Boolean = false
    ): List<SessionEntity> {
        val comparator: Comparator<SessionEntity> = when (sortBy) {
            SessionSortBy.CREATED_AT -> compareBy { it.createdAt }
            SessionSortBy.UPDATED_AT -> compareBy { it.updatedAt }
            SessionSortBy.LAST_ACCESSED_AT -> compareBy { it.lastAccessedAt }
            SessionSortBy.MESSAGE_COUNT -> compareBy { it.messageCount }
            SessionSortBy.TITLE -> compareBy { it.title.lowercase() }
        }

        return if (ascending) {
            sessions.sortedWith(comparator)
        } else {
            sessions.sortedWith(comparator.reversed())
        }
    }

    // --- Export/Import ---

    /**
     * Export session to JSON
     */
    fun exportSession(sessionId: String): String? {
        val session = sessionCache[sessionId] ?: return null
        val messages = messageCache[sessionId] ?: emptyList()

        val exportData = SessionExportData(
            session = session,
            messages = messages.map { MessageExportData.fromEntity(it) }
        )

        return gson.toJson(exportData)
    }

    /**
     * Import session from JSON
     */
    fun importSession(json: String): Result<SessionEntity> {
        return try {
            val exportData: SessionExportData = gson.fromJson(json, SessionExportData::class.java)

            // Generate new IDs to avoid conflicts
            val newSessionId = UUID.randomUUID().toString()
            val importedSession = exportData.session.copy(
                id = newSessionId,
                createdAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis()
            )

            val importedMessages = exportData.messages.mapIndexed { index, data ->
                data.toEntity(newSessionId, UUID.randomUUID().toString())
            }

            sessionCache[newSessionId] = importedSession
            messageCache[newSessionId] = importedMessages
            updateSessionList()

            Result.success(importedSession)
        } catch (e: Exception) {
            Timber.e(e, "Failed to import session")
            Result.failure(e)
        }
    }

    // --- Analytics ---

    /**
     * Get session statistics
     */
    fun getSessionStats(sessionId: String): SessionAnalytics? {
        val session = sessionCache[sessionId] ?: return null
        val messages = messageCache[sessionId] ?: return null

        val userMessages = messages.count { it.role == "user" }
        val assistantMessages = messages.count { it.role == "assistant" }
        val avgMessageLength = if (messages.isNotEmpty()) {
            messages.map { it.content.length }.average().toInt()
        } else 0

        return SessionAnalytics(
            sessionId = sessionId,
            totalMessages = messages.size,
            userMessages = userMessages,
            assistantMessages = assistantMessages,
            totalTokens = session.totalTokens,
            compressedTokens = session.compressedTokens,
            tokenSavings = session.tokenSavingsPercent,
            averageMessageLength = avgMessageLength,
            sessionDuration = session.updatedAt - session.createdAt,
            tags = parseTags(session.tags)
        )
    }

    /**
     * Get overall analytics
     */
    fun getOverallAnalytics(): OverallAnalytics {
        val allSessions = sessionCache.values.toList()
        val totalMessages = allSessions.sumOf { it.messageCount }
        val totalTokens = allSessions.sumOf { it.totalTokens }
        val totalCompressed = allSessions.sumOf { it.compressedTokens }
        val avgSavings = if (allSessions.isNotEmpty()) {
            allSessions.map { it.tokenSavingsPercent }.average().toFloat()
        } else 0f

        return OverallAnalytics(
            totalSessions = allSessions.size,
            activeSessions = allSessions.count { !it.isArchived },
            totalMessages = totalMessages,
            totalTokens = totalTokens,
            totalCompressedTokens = totalCompressed,
            averageTokenSavings = avgSavings,
            topTags = getTopTags(5)
        )
    }

    // --- Private helpers ---

    private fun updateSessionList() {
        _sessions.value = sessionCache.values
            .sortedByDescending { it.updatedAt }
            .toList()
    }

    private fun parseTags(tagsJson: String?): List<String> {
        if (tagsJson.isNullOrBlank()) return emptyList()
        return try {
            val type = object : TypeToken<List<String>>() {}.type
            gson.fromJson(tagsJson, type)
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun getTopTags(limit: Int): List<Pair<String, Int>> {
        val tagCounts = mutableMapOf<String, Int>()

        sessionCache.values.forEach { session ->
            parseTags(session.tags).forEach { tag ->
                tagCounts[tag] = (tagCounts[tag] ?: 0) + 1
            }
        }

        return tagCounts.entries
            .sortedByDescending { it.value }
            .take(limit)
            .map { it.key to it.value }
    }

    private fun estimateTokens(text: String): Int {
        if (text.isEmpty()) return 0
        val chineseChars = text.count { it.code in 0x4E00..0x9FFF }
        val otherChars = text.length - chineseChars
        return (chineseChars / 2.0f + otherChars / 4.0f).toInt()
    }
}

// --- Data classes ---

data class SessionUpdateResult(
    val success: Boolean,
    val session: SessionEntity? = null,
    val compressionResult: CompressionResult? = null,
    val error: String? = null
)

data class OptimizedContextResult(
    val messages: List<ProjectChatMessageEntity>,
    val totalTokens: Int,
    val isCompressed: Boolean,
    val savingsPercent: Float
)

data class SessionAnalytics(
    val sessionId: String,
    val totalMessages: Int,
    val userMessages: Int,
    val assistantMessages: Int,
    val totalTokens: Int,
    val compressedTokens: Int,
    val tokenSavings: Float,
    val averageMessageLength: Int,
    val sessionDuration: Long,
    val tags: List<String>
)

data class OverallAnalytics(
    val totalSessions: Int,
    val activeSessions: Int,
    val totalMessages: Int,
    val totalTokens: Int,
    val totalCompressedTokens: Int,
    val averageTokenSavings: Float,
    val topTags: List<Pair<String, Int>>
)

data class SessionExportData(
    val session: SessionEntity,
    val messages: List<MessageExportData>
)

data class MessageExportData(
    val role: String,
    val content: String,
    val messageType: String,
    val contextMode: String,
    val createdAt: Long
) {
    fun toEntity(sessionId: String, messageId: String): ProjectChatMessageEntity {
        return ProjectChatMessageEntity(
            id = messageId,
            projectId = sessionId,  // Reuse for linking
            role = role,
            content = content,
            messageType = messageType,
            contextMode = contextMode,
            createdAt = createdAt
        )
    }

    companion object {
        fun fromEntity(entity: ProjectChatMessageEntity): MessageExportData {
            return MessageExportData(
                role = entity.role,
                content = entity.content,
                messageType = entity.messageType,
                contextMode = entity.contextMode,
                createdAt = entity.createdAt
            )
        }
    }
}
