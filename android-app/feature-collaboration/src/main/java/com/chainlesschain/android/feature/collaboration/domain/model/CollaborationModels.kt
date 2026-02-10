package com.chainlesschain.android.feature.collaboration.domain.model

import kotlinx.serialization.Serializable

/**
 * Collaboration session
 */
@Serializable
data class CollaborationSession(
    val id: String,
    val documentId: String,
    val documentType: DocumentType,
    val hostUserId: String,
    val activeUsers: List<ActiveUser> = emptyList(),
    val status: SessionStatus = SessionStatus.ACTIVE,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    val participantCount: Int
        get() = activeUsers.size
}

/**
 * Document types for collaboration
 */
@Serializable
enum class DocumentType {
    NOTE,
    DOCUMENT,
    WHITEBOARD,
    CODE,
    SPREADSHEET,
    PRESENTATION
}

/**
 * Session status
 */
@Serializable
enum class SessionStatus {
    ACTIVE,
    PAUSED,
    CLOSED
}

/**
 * Active user in session
 */
@Serializable
data class ActiveUser(
    val userId: String,
    val displayName: String,
    val avatarUrl: String? = null,
    val color: String, // Cursor/highlight color
    val cursorPosition: CursorPosition? = null,
    val selection: TextSelection? = null,
    val isEditing: Boolean = false,
    val lastActivity: Long = System.currentTimeMillis()
)

/**
 * Cursor position
 */
@Serializable
data class CursorPosition(
    val line: Int,
    val column: Int,
    val offset: Int? = null
)

/**
 * Text selection
 */
@Serializable
data class TextSelection(
    val start: CursorPosition,
    val end: CursorPosition
)

/**
 * Sync status
 */
@Serializable
enum class SyncStatus {
    SYNCED,
    SYNCING,
    PENDING,
    CONFLICT,
    OFFLINE
}

/**
 * CRDT operation types
 */
@Serializable
enum class OperationType {
    INSERT,
    DELETE,
    RETAIN,
    FORMAT,
    UNDO,
    REDO
}

/**
 * CRDT operation
 */
@Serializable
data class CRDTOperation(
    val id: String,
    val type: OperationType,
    val userId: String,
    val position: Int,
    val content: String? = null, // For INSERT
    val length: Int? = null, // For DELETE/RETAIN
    val attributes: Map<String, String>? = null, // For FORMAT
    val timestamp: Long = System.currentTimeMillis(),
    val vectorClock: Map<String, Int> = emptyMap()
)

/**
 * Document version
 */
@Serializable
data class DocumentVersion(
    val versionId: String,
    val documentId: String,
    val content: String,
    val operations: List<CRDTOperation>,
    val authorId: String,
    val authorName: String,
    val message: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Conflict resolution result
 */
@Serializable
data class ConflictResolution(
    val conflictId: String,
    val documentId: String,
    val localVersion: String,
    val remoteVersion: String,
    val resolvedContent: String,
    val strategy: ResolutionStrategy,
    val resolvedBy: String,
    val resolvedAt: Long = System.currentTimeMillis()
)

/**
 * Conflict resolution strategies
 */
@Serializable
enum class ResolutionStrategy {
    LOCAL_WINS,
    REMOTE_WINS,
    MERGE,
    MANUAL
}

/**
 * Collaboration event
 */
@Serializable
sealed class CollaborationEvent {
    @Serializable
    data class UserJoined(val user: ActiveUser) : CollaborationEvent()

    @Serializable
    data class UserLeft(val userId: String) : CollaborationEvent()

    @Serializable
    data class CursorMoved(val userId: String, val position: CursorPosition) : CollaborationEvent()

    @Serializable
    data class SelectionChanged(val userId: String, val selection: TextSelection?) : CollaborationEvent()

    @Serializable
    data class ContentChanged(val operations: List<CRDTOperation>) : CollaborationEvent()

    @Serializable
    data class SyncStatusChanged(val status: SyncStatus) : CollaborationEvent()

    @Serializable
    data class Conflict(val conflictId: String, val description: String) : CollaborationEvent()
}
