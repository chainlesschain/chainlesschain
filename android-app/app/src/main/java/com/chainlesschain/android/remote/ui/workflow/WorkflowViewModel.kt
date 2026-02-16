package com.chainlesschain.android.remote.ui.workflow

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.RunningWorkflow
import com.chainlesschain.android.remote.commands.WorkflowCommands
import com.chainlesschain.android.remote.commands.WorkflowDefinition
import com.chainlesschain.android.remote.commands.WorkflowExecutionHistory
import com.chainlesschain.android.remote.commands.WorkflowListItem
import com.chainlesschain.android.remote.commands.WorkflowStep
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
 * 工作流管理 ViewModel
 *
 * 管理工作流的创建、执行和监控
 */
@HiltViewModel
class WorkflowViewModel @Inject constructor(
    private val workflowCommands: WorkflowCommands,
    private val eventDispatcher: RemoteEventDispatcher
) : ViewModel() {

    // UI State
    private val _uiState = MutableStateFlow(WorkflowUiState())
    val uiState: StateFlow<WorkflowUiState> = _uiState.asStateFlow()

    // Events
    private val _events = MutableSharedFlow<WorkflowEvent>()
    val events: SharedFlow<WorkflowEvent> = _events.asSharedFlow()

    // Selected workflow detail
    private val _selectedWorkflow = MutableStateFlow<WorkflowDefinition?>(null)
    val selectedWorkflow: StateFlow<WorkflowDefinition?> = _selectedWorkflow.asStateFlow()

    init {
        // Listen for workflow progress events
        viewModelScope.launch {
            eventDispatcher.workflowProgress.collect { event ->
                // Update running workflow in state
                val updatedRunning = _uiState.value.runningWorkflows.map { running ->
                    if (running.executionId == event.executionId) {
                        running.copy(
                            currentStep = event.currentStep,
                            progress = event.progress
                        )
                    } else {
                        running
                    }
                }
                _uiState.value = _uiState.value.copy(runningWorkflows = updatedRunning)

                _events.emit(WorkflowEvent.Progress(
                    executionId = event.executionId,
                    workflowName = event.workflowName,
                    progress = event.progress,
                    currentStep = event.currentStep
                ))
            }
        }

        // Listen for workflow completed events
        viewModelScope.launch {
            eventDispatcher.workflowCompleted.collect { event ->
                // Remove from running list
                val updatedRunning = _uiState.value.runningWorkflows.filterNot {
                    it.executionId == event.executionId
                }
                _uiState.value = _uiState.value.copy(runningWorkflows = updatedRunning)

                _events.emit(WorkflowEvent.Completed(
                    executionId = event.executionId,
                    workflowName = event.workflowName,
                    success = event.success,
                    error = event.error
                ))

                // Refresh history
                loadHistory()
            }
        }

        // Load initial data
        loadWorkflows()
        loadRunning()
    }

    /**
     * Load all workflows
     */
    fun loadWorkflows(limit: Int = 50, offset: Int = 0) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            workflowCommands.list(limit, offset)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        workflows = response.workflows,
                        totalCount = response.total,
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
     * Load running workflows
     */
    fun loadRunning() {
        viewModelScope.launch {
            workflowCommands.getRunning()
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        runningWorkflows = response.running
                    )
                }
        }
    }

    /**
     * Load execution history
     */
    fun loadHistory(workflowId: String? = null, limit: Int = 50, offset: Int = 0) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingHistory = true)

            workflowCommands.getHistory(workflowId, limit, offset)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(
                        executionHistory = response.executions,
                        isLoadingHistory = false
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
     * Load workflow details
     */
    fun loadWorkflow(workflowId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            workflowCommands.get(workflowId)
                .onSuccess { response ->
                    _selectedWorkflow.value = response.workflow
                    _uiState.value = _uiState.value.copy(isLoading = false)
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
     * Create a new workflow
     */
    fun createWorkflow(
        name: String,
        description: String? = null,
        steps: List<WorkflowStep>,
        variables: Map<String, Any>? = null
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isCreating = true)

            workflowCommands.create(name, steps, description, variables)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(isCreating = false)
                    _events.emit(WorkflowEvent.Created(response.workflowId ?: ""))
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isCreating = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Execute a workflow
     */
    fun executeWorkflow(
        workflowId: String,
        variables: Map<String, Any>? = null,
        async: Boolean = true
    ) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isExecuting = true)

            workflowCommands.execute(workflowId, variables, async)
                .onSuccess { response ->
                    _uiState.value = _uiState.value.copy(isExecuting = false)

                    if (async) {
                        _events.emit(WorkflowEvent.Started(response.executionId ?: ""))
                        loadRunning()
                    } else {
                        _events.emit(WorkflowEvent.Completed(
                            executionId = response.executionId ?: "",
                            workflowName = "",
                            success = response.success,
                            error = response.error
                        ))
                    }
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isExecuting = false,
                        error = e.message
                    )
                }
        }
    }

    /**
     * Cancel a running workflow
     */
    fun cancelWorkflow(executionId: String) {
        viewModelScope.launch {
            workflowCommands.cancel(executionId)
                .onSuccess {
                    val updatedRunning = _uiState.value.runningWorkflows.filterNot {
                        it.executionId == executionId
                    }
                    _uiState.value = _uiState.value.copy(runningWorkflows = updatedRunning)
                    _events.emit(WorkflowEvent.Cancelled(executionId))
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Update a workflow
     */
    fun updateWorkflow(
        workflowId: String,
        name: String? = null,
        description: String? = null,
        steps: List<WorkflowStep>? = null
    ) {
        viewModelScope.launch {
            workflowCommands.update(workflowId, name, description, steps)
                .onSuccess {
                    _events.emit(WorkflowEvent.Updated(workflowId))
                    loadWorkflows()
                    loadWorkflow(workflowId)
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Delete a workflow
     */
    fun deleteWorkflow(workflowId: String) {
        viewModelScope.launch {
            workflowCommands.delete(workflowId)
                .onSuccess {
                    val updated = _uiState.value.workflows.filterNot { it.id == workflowId }
                    _uiState.value = _uiState.value.copy(workflows = updated)
                    _events.emit(WorkflowEvent.Deleted(workflowId))
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Clone a workflow
     */
    fun cloneWorkflow(workflowId: String, newName: String) {
        viewModelScope.launch {
            workflowCommands.clone(workflowId, newName)
                .onSuccess { response ->
                    _events.emit(WorkflowEvent.Cloned(response.workflowId ?: ""))
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Export workflow as JSON
     */
    fun exportWorkflow(workflowId: String) {
        viewModelScope.launch {
            workflowCommands.export(workflowId)
                .onSuccess { response ->
                    response.definition?.let { json ->
                        _events.emit(WorkflowEvent.Exported(workflowId, json))
                    }
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Import workflow from JSON
     */
    fun importWorkflow(definition: String, name: String? = null) {
        viewModelScope.launch {
            workflowCommands.import(definition, name)
                .onSuccess { response ->
                    _events.emit(WorkflowEvent.Imported(response.workflowId ?: ""))
                    loadWorkflows()
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
        }
    }

    /**
     * Get workflow execution status
     */
    fun getExecutionStatus(executionId: String) {
        viewModelScope.launch {
            workflowCommands.getStatus(executionId)
                .onSuccess { response ->
                    _events.emit(WorkflowEvent.StatusUpdate(
                        executionId = executionId,
                        status = response.status ?: "unknown",
                        progress = response.progress,
                        currentStep = response.currentStep
                    ))
                }
        }
    }

    /**
     * Refresh all data
     */
    fun refresh() {
        loadWorkflows()
        loadRunning()
        loadHistory()
    }

    /**
     * Clear selected workflow
     */
    fun clearSelection() {
        _selectedWorkflow.value = null
    }

    /**
     * Clear error
     */
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}

/**
 * UI State
 */
@Immutable
data class WorkflowUiState(
    val workflows: List<WorkflowListItem> = emptyList(),
    val runningWorkflows: List<RunningWorkflow> = emptyList(),
    val executionHistory: List<WorkflowExecutionHistory> = emptyList(),
    val totalCount: Int = 0,
    val isLoading: Boolean = false,
    val isLoadingHistory: Boolean = false,
    val isCreating: Boolean = false,
    val isExecuting: Boolean = false,
    val error: String? = null
)

/**
 * Events
 */
sealed class WorkflowEvent {
    data class Created(val workflowId: String) : WorkflowEvent()
    data class Updated(val workflowId: String) : WorkflowEvent()
    data class Deleted(val workflowId: String) : WorkflowEvent()
    data class Cloned(val newWorkflowId: String) : WorkflowEvent()
    data class Started(val executionId: String) : WorkflowEvent()
    data class Cancelled(val executionId: String) : WorkflowEvent()
    data class Progress(
        val executionId: String,
        val workflowName: String,
        val progress: Int,
        val currentStep: String?
    ) : WorkflowEvent()
    data class Completed(
        val executionId: String,
        val workflowName: String,
        val success: Boolean,
        val error: String?
    ) : WorkflowEvent()
    data class StatusUpdate(
        val executionId: String,
        val status: String,
        val progress: Int,
        val currentStep: String?
    ) : WorkflowEvent()
    data class Exported(val workflowId: String, val json: String) : WorkflowEvent()
    data class Imported(val workflowId: String) : WorkflowEvent()
}
