package com.chainlesschain.android.feature.hooks.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.hooks.data.engine.HookRegistry
import com.chainlesschain.android.feature.hooks.data.repository.HookRepository
import com.chainlesschain.android.feature.hooks.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import androidx.compose.runtime.Immutable
import javax.inject.Inject

@HiltViewModel
class HooksViewModel @Inject constructor(
    private val repository: HookRepository,
    private val registry: HookRegistry
) : ViewModel() {

    private val _uiState = MutableStateFlow(HooksUiState())
    val uiState: StateFlow<HooksUiState> = _uiState.asStateFlow()

    private val _selectedHook = MutableStateFlow<HookConfig?>(null)
    val selectedHook: StateFlow<HookConfig?> = _selectedHook.asStateFlow()

    init {
        loadHooks()
        loadRecentLogs()
    }

    private fun loadHooks() {
        viewModelScope.launch {
            repository.getAllHooks().collect { hooks ->
                _uiState.update { it.copy(hooks = hooks, isLoading = false) }
            }
        }
    }

    private fun loadRecentLogs() {
        viewModelScope.launch {
            repository.getRecentLogs(50).collect { logs ->
                _uiState.update { it.copy(recentLogs = logs) }
            }
        }
    }

    // ==================== Hook Operations ====================

    fun selectHook(hook: HookConfig?) {
        _selectedHook.value = hook
        hook?.let { loadHookDetails(it.id) }
    }

    private fun loadHookDetails(hookId: String) {
        viewModelScope.launch {
            combine(
                repository.getLogsForHook(hookId),
                repository.getStats(hookId)
            ) { logs, stats ->
                Pair(logs, stats)
            }.collect { (logs, stats) ->
                _uiState.update {
                    it.copy(
                        hookLogs = logs,
                        hookStats = stats
                    )
                }
            }
        }
    }

    fun createHook(
        name: String,
        event: HookEvent,
        type: HookType,
        handler: HookHandler,
        priority: HookPriority = HookPriority.NORMAL,
        description: String? = null
    ) {
        viewModelScope.launch {
            try {
                registry.register(
                    name = name,
                    event = event,
                    handler = handler,
                    type = type,
                    priority = priority,
                    description = description
                )
                _uiState.update { it.copy(message = "Hook created") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun updateHook(hook: HookConfig) {
        viewModelScope.launch {
            try {
                repository.updateHook(hook)
                _uiState.update { it.copy(message = "Hook updated") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun deleteHook(hookId: String) {
        viewModelScope.launch {
            try {
                registry.unregister(hookId)
                if (_selectedHook.value?.id == hookId) {
                    _selectedHook.value = null
                }
                _uiState.update { it.copy(message = "Hook deleted") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun toggleHook(hookId: String, enabled: Boolean) {
        viewModelScope.launch {
            try {
                if (enabled) {
                    registry.enable(hookId)
                } else {
                    registry.disable(hookId)
                }
                _uiState.update { it.copy(message = if (enabled) "Hook enabled" else "Hook disabled") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Execution ====================

    fun triggerEvent(
        event: HookEvent,
        data: Map<String, String> = emptyMap()
    ) {
        viewModelScope.launch {
            try {
                val responses = registry.trigger(event, data)
                val successCount = responses.count { it.success }
                _uiState.update {
                    it.copy(message = "Triggered ${responses.size} hooks ($successCount succeeded)")
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun testHook(hookId: String) {
        viewModelScope.launch {
            try {
                val hook = repository.getHookById(hookId) ?: throw IllegalArgumentException("Hook not found")
                val context = HookContext(event = hook.event, data = mapOf("test" to "true"))
                val response = registry.executeHook(hookId, context)
                _uiState.update {
                    it.copy(message = if (response?.success == true) "Test successful" else "Test failed: ${response?.error}")
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Logs ====================

    fun clearAllLogs() {
        viewModelScope.launch {
            try {
                registry.clearLogs()
                _uiState.update { it.copy(message = "Logs cleared") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun clearHookLogs(hookId: String) {
        viewModelScope.launch {
            try {
                repository.clearLogsForHook(hookId)
                _uiState.update { it.copy(message = "Hook logs cleared") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Messages ====================

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

@Immutable
data class HooksUiState(
    val isLoading: Boolean = true,
    val hooks: List<HookConfig> = emptyList(),
    val recentLogs: List<HookLog> = emptyList(),
    val hookLogs: List<HookLog> = emptyList(),
    val hookStats: HookStats? = null,
    val message: String? = null,
    val error: String? = null
)
