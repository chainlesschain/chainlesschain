package com.chainlesschain.android.feature.collaboration.data.repository

import com.chainlesschain.android.feature.collaboration.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for collaboration sessions and versions
 */
@Singleton
class CollaborationRepository @Inject constructor() {

    private val _sessions = MutableStateFlow<Map<String, CollaborationSession>>(emptyMap())
    private val _versions = MutableStateFlow<Map<String, List<DocumentVersion>>>(emptyMap())
    private val _operations = MutableStateFlow<Map<String, List<CRDTOperation>>>(emptyMap())

    // ==================== Sessions ====================

    fun getAllSessions(): Flow<List<CollaborationSession>> = _sessions.map {
        it.values.sortedByDescending { session -> session.updatedAt }
    }

    fun getSessionById(sessionId: String): CollaborationSession? = _sessions.value[sessionId]

    fun getSessionByIdFlow(sessionId: String): Flow<CollaborationSession?> = _sessions.map { it[sessionId] }

    fun getSessionsForDocument(documentId: String): Flow<List<CollaborationSession>> = _sessions.map { sessions ->
        sessions.values.filter { it.documentId == documentId }
    }

    fun getActiveSessions(): Flow<List<CollaborationSession>> = _sessions.map { sessions ->
        sessions.values.filter { it.status == SessionStatus.ACTIVE }
    }

    suspend fun createSession(session: CollaborationSession): CollaborationSession {
        val newSession = session.copy(
            id = if (session.id.isBlank()) UUID.randomUUID().toString() else session.id,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
        _sessions.value = _sessions.value + (newSession.id to newSession)
        return newSession
    }

    suspend fun updateSession(session: CollaborationSession): Boolean {
        if (!_sessions.value.containsKey(session.id)) return false
        val updated = session.copy(updatedAt = System.currentTimeMillis())
        _sessions.value = _sessions.value + (session.id to updated)
        return true
    }

    suspend fun deleteSession(sessionId: String): Boolean {
        if (!_sessions.value.containsKey(sessionId)) return false
        _sessions.value = _sessions.value - sessionId
        return true
    }

    suspend fun addUserToSession(sessionId: String, user: ActiveUser): Boolean {
        val session = _sessions.value[sessionId] ?: return false
        val updatedUsers = session.activeUsers.filter { it.userId != user.userId } + user
        return updateSession(session.copy(activeUsers = updatedUsers))
    }

    suspend fun removeUserFromSession(sessionId: String, userId: String): Boolean {
        val session = _sessions.value[sessionId] ?: return false
        val updatedUsers = session.activeUsers.filter { it.userId != userId }
        return updateSession(session.copy(activeUsers = updatedUsers))
    }

    suspend fun updateUserInSession(sessionId: String, user: ActiveUser): Boolean {
        val session = _sessions.value[sessionId] ?: return false
        val updatedUsers = session.activeUsers.map {
            if (it.userId == user.userId) user else it
        }
        return updateSession(session.copy(activeUsers = updatedUsers))
    }

    suspend fun updateSyncStatus(sessionId: String, status: SyncStatus): Boolean {
        val session = _sessions.value[sessionId] ?: return false
        return updateSession(session.copy(syncStatus = status))
    }

    // ==================== Versions ====================

    fun getVersionsForDocument(documentId: String): Flow<List<DocumentVersion>> = _versions.map {
        it[documentId]?.sortedByDescending { v -> v.createdAt } ?: emptyList()
    }

    suspend fun createVersion(version: DocumentVersion): DocumentVersion {
        val newVersion = version.copy(
            versionId = if (version.versionId.isBlank()) UUID.randomUUID().toString() else version.versionId,
            createdAt = System.currentTimeMillis()
        )
        val docVersions = _versions.value[version.documentId] ?: emptyList()
        _versions.value = _versions.value + (version.documentId to (docVersions + newVersion))
        return newVersion
    }

    fun getVersion(documentId: String, versionId: String): DocumentVersion? {
        return _versions.value[documentId]?.find { it.versionId == versionId }
    }

    // ==================== Operations ====================

    fun getOperationsForSession(sessionId: String): Flow<List<CRDTOperation>> = _operations.map {
        it[sessionId] ?: emptyList()
    }

    suspend fun addOperation(sessionId: String, operation: CRDTOperation) {
        val sessionOps = _operations.value[sessionId] ?: emptyList()
        _operations.value = _operations.value + (sessionId to (sessionOps + operation))
    }

    suspend fun addOperations(sessionId: String, operations: List<CRDTOperation>) {
        val sessionOps = _operations.value[sessionId] ?: emptyList()
        _operations.value = _operations.value + (sessionId to (sessionOps + operations))
    }

    suspend fun clearOperations(sessionId: String) {
        _operations.value = _operations.value - sessionId
    }
}
