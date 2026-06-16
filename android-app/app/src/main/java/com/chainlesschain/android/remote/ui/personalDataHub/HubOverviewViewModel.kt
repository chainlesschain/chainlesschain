package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.OverviewReport
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ② 数据总览 — drives [LocalCcRunner.runOverview] (cc hub run-skill
 * analysis.overview) → cross-app decision snapshot for the 数据总览 tab.
 */
@HiltViewModel
class HubOverviewViewModel @Inject constructor(
    private val runner: LocalCcRunner,
) : ViewModel() {

    data class UiState(
        val loading: Boolean = false,
        val report: OverviewReport? = null,
        val errorMessage: String? = null,
    )

    private val _uiState = MutableStateFlow(UiState(loading = true))
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, errorMessage = null) }
            when (val r = runner.runOverview()) {
                is LocalCcRunner.OverviewResult.Ok ->
                    _uiState.update { it.copy(loading = false, report = r.report) }
                is LocalCcRunner.OverviewResult.Failed ->
                    _uiState.update { it.copy(loading = false, errorMessage = r.reason) }
            }
        }
    }
}
