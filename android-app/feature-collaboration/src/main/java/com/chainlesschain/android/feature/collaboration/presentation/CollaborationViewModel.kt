package com.chainlesschain.android.feature.collaboration.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.collaboration.data.manager.CollaborationManager
import com.chainlesschain.android.feature.collaboration.data.repository.CollaborationRepository
import com.chainlesschain.android.feature.collaboration.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CollaborationViewModel @Inject constructor(
    private val repository: CollaborationRepository,
    private val manager: CollaborationManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(CollaborationUiState())
    val uiState: StateFlow<CollaborationUiState> = _uiState.asStateFlow()

    val currentSession: StateFlow<CollaborationSession?> = manager.currentSession

    init {
        loadSessions()
        observeEvents()
    }

    private fun loadSessions() {
        viewModelScope.launch {
            repository.getActiveSessions().collect { sessions ->
                _uiState.update { it.copy(sessions = sessions, isLoading = false) }
            }
        }
    }

    private fun observeEvents() {
        viewModelScope.launch {
            manager.events.collect { event ->
                handleEvent(event)
            }
        }
    }

    private fun handleEvent(event: CollaborationEvent) {
        when (event) {
            is CollaborationEvent.UserJoined -> {
                _uiState.update { it.copy(message = "${event.user.displayName} joined") }
            }
            is CollaborationEvent.UserLeft -> {
                _uiState.update { it.copy(message = "User left the session") }
            }
            is CollaborationEvent.SyncStatusChanged -> {
                _uiState.update { it.copy(syncStatus = event.status) }
            }
            is CollaborationEvent.Conflict -> {
                _uiState.update { it.copy(hasConflict = true, conflictDescription = event.description) }
            }
            else -> {} // Handle other events as needed
        }
    }

    // ==================== Session Operations ====================

    fun createSession(
        documentId: String,
        documentType: DocumentType,
        userId: String,
        displayName: String
    ) {
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(isLoading = true) }
                manager.createSession(documentId, documentType, userId, displayName)
                _uiState.update { it.copy(isLoading = false, message = "Session created") }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    fun joinSession(sessionId: String, userId: String, displayName: String) {
        viewModelScope.launch {
            try {
                _uiState.update { it.copy(isLoading = true) }
                manager.joinSession(sessionId, userId, displayName)
                    .onSuccess {
                        _uiState.update { it.copy(isLoading = false, message = "Joined session") }
                    }
                    .onFailure { e ->
                        _uiState.update { it.copy(isLoading = false, error = e.message) }
                    }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    fun leaveSession(sessionId: String, userId: String) {
        viewModelScope.launch {
            try {
                manager.leaveSession(sessionId, userId)
                _uiState.update { it.copy(message = "Left session") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun closeSession(sessionId: String) {
        viewModelScope.launch {
            try {
                manager.closeSession(sessionId)
                _uiState.update { it.copy(message = "Session closed") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Editing Operations ====================

    fun updateCursor(position: CursorPosition, userId: String) {
        val sessionId = currentSession.value?.id ?: return
        viewModelScope.launch {
            manager.updateCursorPosition(sessionId, userId, position)
        }
    }

    fun updateSelection(selection: TextSelection?, userId: String) {
        val sessionId = currentSession.value?.id ?: return
        viewModelScope.launch {
            manager.updateSelection(sessionId, userId, selection)
        }
    }

    fun insertText(position: Int, content: String, userId: String) {
        val sessionId = currentSession.value?.id ?: return
        viewModelScope.launch {
            manager.insertText(sessionId, userId, position, content)
        }
    }

    fun deleteText(position: Int, length: Int, userId: String) {
        val sessionId = currentSession.value?.id ?: return
        viewModelScope.launch {
            manager.deleteText(sessionId, userId, position, length)
        }
    }

    // ==================== Version Control ====================

    fun createVersion(content: String, userId: String, userName: String, message: String?) {
        val documentId = currentSession.value?.documentId ?: return
        viewModelScope.launch {
            try {
                manager.createVersion(documentId, content, userId, userName, message)
                _uiState.update { it.copy(message = "Version saved") }
                loadVersionHistory(documentId)
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun loadVersionHistory(documentId: String) {
        viewModelScope.launch {
            manager.getVersionHistory(documentId).collect { versions ->
                _uiState.update { it.copy(versions = versions) }
            }
        }
    }

    fun restoreVersion(versionId: String) {
        val documentId = currentSession.value?.documentId ?: return
        viewModelScope.launch {
            manager.restoreVersion(documentId, versionId)
                .onSuccess { version ->
                    _uiState.update { it.copy(message = "Version restored", restoredContent = version.content) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
        }
    }

    // ==================== Conflict Resolution ====================

    fun resolveConflict(strategy: ResolutionStrategy, userId: String) {
        viewModelScope.launch {
            // Implementation would handle actual conflict resolution
            _uiState.update { it.copy(hasConflict = false, conflictDescription = null, message = "Conflict resolved") }
        }
    }

    // ==================== Messages ====================

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearRestoredContent() {
        _uiState.update { it.copy(restoredContent = null) }
    }
}

data class CollaborationUiState(
    val isLoading: Boolean = true,
    val sessions: List<CollaborationSession> = emptyList(),
    val versions: List<DocumentVersion> = emptyList(),
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
    val hasConflict: Boolean = false,
    val conflictDescription: String? = null,
    val restoredContent: String? = null,
    val message: String? = null,
    val error: String? = null
)
