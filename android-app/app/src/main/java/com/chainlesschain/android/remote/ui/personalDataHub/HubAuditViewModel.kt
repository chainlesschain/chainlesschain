package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AuditRow
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@Immutable
data class HubAuditUiState(
    val rows: List<AuditRow> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val actionFilter: String? = null,
    val limit: Int = 50
)

@HiltViewModel
class HubAuditViewModel @Inject constructor(
    private val hub: PersonalDataHubCommands
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubAuditUiState())
    val uiState: StateFlow<HubAuditUiState> = _uiState.asStateFlow()

    init { reload() }

    fun setActionFilter(action: String?) {
        _uiState.update { it.copy(actionFilter = action) }
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val s = _uiState.value
            hub.recentAudit(action = s.actionFilter, limit = s.limit)
                .onSuccess { resp ->
                    _uiState.update { it.copy(rows = resp.rows, isLoading = false) }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAuditViewModel: recentAudit failed")
                    _uiState.update { it.copy(isLoading = false, errorMessage = err.message) }
                }
        }
    }
}
