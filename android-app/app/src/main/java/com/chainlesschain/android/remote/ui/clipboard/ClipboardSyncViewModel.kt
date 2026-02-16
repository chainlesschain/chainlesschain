package com.chainlesschain.android.remote.ui.clipboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.clipboard.LocalClipboardManager
import com.chainlesschain.android.remote.commands.ClipboardCommands
import com.chainlesschain.android.remote.commands.ClipboardHistoryItem
import com.chainlesschain.android.remote.events.RemoteEventDispatcher
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 剪贴板同步 ViewModel
 *
 * 管理剪贴板同步的UI状态和操作
 */
@HiltViewModel
class ClipboardSyncViewModel @Inject constructor(
    private val clipboardCommands: ClipboardCommands,
    private val localClipboardManager: LocalClipboardManager,
    private val eventDispatcher: RemoteEventDispatcher
) : ViewModel() {

    // UI State
    private val _uiState = MutableStateFlow(ClipboardSyncUiState())
    val uiState: StateFlow<ClipboardSyncUiState> = _uiState.asStateFlow()

    // Events
    private val _events = MutableSharedFlow<ClipboardSyncEvent>()
    val events: SharedFlow<ClipboardSyncEvent> = _events.asSharedFlow()

    // Expose local clipboard manager states
    val syncEnabled: StateFlow<Boolean> = localClipboardManager.syncEnabled
    val lastSyncTime: StateFlow<Long?> = localClipboardManager.lastSyncTime
    val currentContent: StateFlow<String?> = localClipboardManager.currentContent

    init {
        // Listen for clipboard changes from PC
        viewModelScope.launch {
            eventDispatcher.clipboardChanges.collect { event ->
                _uiState.value = _uiState.value.copy(
                    pcClipboard = event.content,
                    pcClipboardType = event.contentType,
                    lastUpdateTime = event.timestamp
                )
                _events.emit(ClipboardSyncEvent.ClipboardChanged(event.content, "pc"))
            }
        }

        // Sync local clipboard content
        viewModelScope.launch {
            localClipboardManager.currentContent.collect { content ->
                _uiState.value = _uiState.value.copy(localClipboard = content)
            }
        }
    }

    /**
     * Toggle clipboard sync
     */
    fun toggleSync(enabled: Boolean) {
        localClipboardManager.setSyncEnabled(enabled)
        viewModelScope.launch {
            if (enabled) {
                // Start watching PC clipboard
                clipboardCommands.watch().onSuccess {
                    _events.emit(ClipboardSyncEvent.SyncEnabled)
                }.onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            } else {
                clipboardCommands.unwatch()
                _events.emit(ClipboardSyncEvent.SyncDisabled)
            }
        }
    }

    /**
     * Push local clipboard to PC
     */
    fun pushToPC() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            localClipboardManager.pushToPC()
                .onSuccess {
                    _events.emit(ClipboardSyncEvent.PushedToPC)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = null
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Pull PC clipboard to local
     */
    fun pullFromPC() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            localClipboardManager.pullFromPC()
                .onSuccess {
                    _events.emit(ClipboardSyncEvent.PulledFromPC)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = null
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Get clipboard history
     */
    fun loadHistory(limit: Int = 50) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingHistory = true)

            clipboardCommands.getHistory(limit)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        history = response.history,
                        isLoadingHistory = false,
                        error = null
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoadingHistory = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Clear clipboard history
     */
    fun clearHistory() {
        viewModelScope.launch {
            clipboardCommands.clearHistory()
                .onSuccess {
                    _uiState.value = _uiState.value.copy(history = emptyList())
                    _events.emit(ClipboardSyncEvent.HistoryCleared)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Set content from history item
     */
    fun setFromHistory(item: ClipboardHistoryItem) {
        viewModelScope.launch {
            clipboardCommands.set(item.content)
                .onSuccess {
                    localClipboardManager.setLocalClipboard(item.content)
                    _events.emit(ClipboardSyncEvent.ContentSet(item.content))
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Manually set clipboard content
     */
    fun setContent(content: String, syncToPC: Boolean = true) {
        localClipboardManager.setLocalClipboard(content)

        if (syncToPC) {
            viewModelScope.launch {
                clipboardCommands.set(content)
                    .onSuccess {
                        _events.emit(ClipboardSyncEvent.ContentSet(content))
                    }
                    .onFailure { e ->
                        _uiState.value = _uiState.value.copy(error = e.message)
                    }
            }
        }
    }

    /**
     * Clear error
     */
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        localClipboardManager.cleanup()
    }
}

/**
 * UI State
 */
@Immutable
data class ClipboardSyncUiState(
    val localClipboard: String? = null,
    val pcClipboard: String? = null,
    val pcClipboardType: String = "text",
    val history: List<ClipboardHistoryItem> = emptyList(),
    val isLoading: Boolean = false,
    val isLoadingHistory: Boolean = false,
    val lastUpdateTime: Long? = null,
    val error: String? = null
)

/**
 * Events
 */
sealed class ClipboardSyncEvent {
    data object SyncEnabled : ClipboardSyncEvent()
    data object SyncDisabled : ClipboardSyncEvent()
    data object PushedToPC : ClipboardSyncEvent()
    data object PulledFromPC : ClipboardSyncEvent()
    data object HistoryCleared : ClipboardSyncEvent()
    data class ContentSet(val content: String) : ClipboardSyncEvent()
    data class ClipboardChanged(val content: String, val source: String) : ClipboardSyncEvent()
}
