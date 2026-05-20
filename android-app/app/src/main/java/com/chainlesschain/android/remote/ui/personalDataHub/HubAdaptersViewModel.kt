package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AdapterMeta
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.remote.commands.SyncReport
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@Immutable
data class HubAdaptersUiState(
    val adapters: List<AdapterMeta> = emptyList(),
    val isLoading: Boolean = false,
    val syncingAdapter: String? = null,
    val errorMessage: String? = null,
    val lastReport: SyncReport? = null
)

sealed class HubAdaptersEvent {
    data class ShowToast(val message: String) : HubAdaptersEvent()
}

@HiltViewModel
class HubAdaptersViewModel @Inject constructor(
    private val hub: PersonalDataHubCommands
) : ViewModel() {

    private val _uiState = MutableStateFlow(HubAdaptersUiState())
    val uiState: StateFlow<HubAdaptersUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<HubAdaptersEvent>()
    val events: SharedFlow<HubAdaptersEvent> = _events.asSharedFlow()

    init { reload() }

    fun reload() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            hub.listAdapters()
                .onSuccess { resp ->
                    _uiState.update { it.copy(adapters = resp.adapters, isLoading = false) }
                }
                .onFailure { err ->
                    Timber.w(err, "HubAdaptersViewModel: listAdapters failed")
                    _uiState.update { it.copy(isLoading = false, errorMessage = err.message) }
                }
        }
    }

    fun sync(name: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(syncingAdapter = name, errorMessage = null) }
            hub.syncAdapter(name = name)
                .onSuccess { report ->
                    _uiState.update {
                        it.copy(syncingAdapter = null, lastReport = report)
                    }
                    _events.emit(HubAdaptersEvent.ShowToast("$name 同步完成 (+${report.ingested} 事件)"))
                }
                .onFailure { err ->
                    Timber.w(err, "HubAdaptersViewModel: syncAdapter($name) failed")
                    _uiState.update { it.copy(syncingAdapter = null, errorMessage = err.message) }
                    _events.emit(HubAdaptersEvent.ShowToast("同步失败: ${err.message ?: "?"}"))
                }
        }
    }
}
