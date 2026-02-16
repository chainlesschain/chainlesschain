package com.chainlesschain.android.feature.collaboration.data.manager

import com.chainlesschain.android.feature.collaboration.data.repository.CollaborationRepository
import com.chainlesschain.android.feature.collaboration.domain.model.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

/**
 * Manager for real-time collaboration
 */
@Singleton
class CollaborationManager @Inject constructor(
    private val repository: CollaborationRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _events = MutableSharedFlow<CollaborationEvent>(extraBufferCapacity = 100)
    val events: SharedFlow<CollaborationEvent> = _events.asSharedFlow()

    private val _currentSession = MutableStateFlow<CollaborationSession?>(null)
    val currentSession: StateFlow<CollaborationSession?> = _currentSession.asStateFlow()

    private val colors = listOf(
        "#FF5733", "#33FF57", "#3357FF", "#FF33F5",
        "#F5FF33", "#33FFF5", "#FF8C33", "#8C33FF"
    )

    // ==================== Session Management ====================

    suspend fun createSession(
        documentId: String,
        documentType: DocumentType,
        hostUserId: String,
        hostDisplayName: String
    ): CollaborationSession {
        val hostUser = ActiveUser(
            userId = hostUserId,
            displayName = hostDisplayName,
            color = colors.random()
        )

        val session = repository.createSession(
            CollaborationSession(
                id = "",
                documentId = documentId,
                documentType = documentType,
                hostUserId = hostUserId,
                activeUsers = listOf(hostUser)
            )
        )

        _currentSession.value = session
        return session
    }

    suspend fun joinSession(
        sessionId: String,
        userId: String,
        displayName: String
    ): Result<CollaborationSession> = runCatching {
        val session = repository.getSessionById(sessionId)
            ?: throw IllegalArgumentException("Session not found: $sessionId")

        if (session.status != SessionStatus.ACTIVE) {
            throw IllegalStateException("Session is not active")
        }

        val user = ActiveUser(
            userId = userId,
            displayName = displayName,
            color = colors.filterNot { c ->
                session.activeUsers.any { it.color == c }
            }.randomOrNull() ?: colors.random()
        )

        repository.addUserToSession(sessionId, user)
        _events.emit(CollaborationEvent.UserJoined(user))

        val updatedSession = repository.getSessionById(sessionId)
            ?: throw IllegalStateException("Session not found after update: $sessionId")
        _currentSession.value = updatedSession
        updatedSession
    }

    suspend fun leaveSession(sessionId: String, userId: String): Result<Unit> = runCatching {
        repository.removeUserFromSession(sessionId, userId)
        _events.emit(CollaborationEvent.UserLeft(userId))

        if (_currentSession.value?.id == sessionId) {
            _currentSession.value = null
        }
    }

    suspend fun closeSession(sessionId: String): Result<Unit> = runCatching {
        val session = repository.getSessionById(sessionId)
            ?: throw IllegalArgumentException("Session not found")

        repository.updateSession(session.copy(status = SessionStatus.CLOSED))

        if (_currentSession.value?.id == sessionId) {
            _currentSession.value = null
        }
    }

    // ==================== Cursor & Selection ====================

    suspend fun updateCursorPosition(
        sessionId: String,
        userId: String,
        position: CursorPosition
    ) {
        val session = repository.getSessionById(sessionId) ?: return
        val user = session.activeUsers.find { it.userId == userId } ?: return

        repository.updateUserInSession(
            sessionId,
            user.copy(cursorPosition = position, lastActivity = System.currentTimeMillis())
        )
        _events.emit(CollaborationEvent.CursorMoved(userId, position))
    }

    suspend fun updateSelection(
        sessionId: String,
        userId: String,
        selection: TextSelection?
    ) {
        val session = repository.getSessionById(sessionId) ?: return
        val user = session.activeUsers.find { it.userId == userId } ?: return

        repository.updateUserInSession(
            sessionId,
            user.copy(selection = selection, lastActivity = System.currentTimeMillis())
        )
        _events.emit(CollaborationEvent.SelectionChanged(userId, selection))
    }

    // ==================== CRDT Operations ====================

    suspend fun applyOperations(
        sessionId: String,
        operations: List<CRDTOperation>
    ) {
        repository.addOperations(sessionId, operations)
        repository.updateSyncStatus(sessionId, SyncStatus.SYNCING)

        // Simulate sync delay
        delay(50)

        repository.updateSyncStatus(sessionId, SyncStatus.SYNCED)
        _events.emit(CollaborationEvent.ContentChanged(operations))
    }

    suspend fun insertText(
        sessionId: String,
        userId: String,
        position: Int,
        content: String
    ): CRDTOperation {
        val operation = CRDTOperation(
            id = UUID.randomUUID().toString(),
            type = OperationType.INSERT,
            userId = userId,
            position = position,
            content = content
        )
        applyOperations(sessionId, listOf(operation))
        return operation
    }

    suspend fun deleteText(
        sessionId: String,
        userId: String,
        position: Int,
        length: Int
    ): CRDTOperation {
        val operation = CRDTOperation(
            id = UUID.randomUUID().toString(),
            type = OperationType.DELETE,
            userId = userId,
            position = position,
            length = length
        )
        applyOperations(sessionId, listOf(operation))
        return operation
    }

    // ==================== Version Control ====================

    suspend fun createVersion(
        documentId: String,
        content: String,
        authorId: String,
        authorName: String,
        message: String? = null
    ): DocumentVersion {
        val sessionId = _currentSession.value?.id
        val operations = if (sessionId != null) {
            repository.getOperationsForSession(sessionId).first()
        } else {
            emptyList()
        }

        val version = repository.createVersion(
            DocumentVersion(
                versionId = "",
                documentId = documentId,
                content = content,
                operations = operations,
                authorId = authorId,
                authorName = authorName,
                message = message
            )
        )

        // Clear operations after versioning
        sessionId?.let { repository.clearOperations(it) }

        return version
    }

    fun getVersionHistory(documentId: String): Flow<List<DocumentVersion>> {
        return repository.getVersionsForDocument(documentId)
    }

    suspend fun restoreVersion(documentId: String, versionId: String): Result<DocumentVersion> = runCatching {
        repository.getVersion(documentId, versionId)
            ?: throw IllegalArgumentException("Version not found")
    }

    // ==================== Conflict Resolution ====================

    suspend fun resolveConflict(
        conflictId: String,
        documentId: String,
        localVersion: String,
        remoteVersion: String,
        strategy: ResolutionStrategy,
        resolvedBy: String
    ): ConflictResolution {
        val resolvedContent = when (strategy) {
            ResolutionStrategy.LOCAL_WINS -> localVersion
            ResolutionStrategy.REMOTE_WINS -> remoteVersion
            ResolutionStrategy.MERGE -> mergeContent(localVersion, remoteVersion)
            ResolutionStrategy.MANUAL -> localVersion // User will edit manually
        }

        return ConflictResolution(
            conflictId = conflictId,
            documentId = documentId,
            localVersion = localVersion,
            remoteVersion = remoteVersion,
            resolvedContent = resolvedContent,
            strategy = strategy,
            resolvedBy = resolvedBy
        )
    }

    private fun mergeContent(local: String, remote: String): String {
        // Simple merge: concatenate with separator
        // Real implementation would use diff/merge algorithms
        return if (local == remote) {
            local
        } else {
            "$local\n<<<<<<< LOCAL\n$remote\n>>>>>>> REMOTE"
        }
    }

    // ==================== Lifecycle ====================

    fun shutdown() {
        scope.cancel()
    }
}
