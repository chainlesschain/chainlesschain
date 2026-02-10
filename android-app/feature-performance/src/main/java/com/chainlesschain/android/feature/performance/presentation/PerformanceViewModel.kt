package com.chainlesschain.android.feature.performance.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.performance.data.cache.CacheManager
import com.chainlesschain.android.feature.performance.data.monitor.PerformanceMonitor
import com.chainlesschain.android.feature.performance.data.repository.PerformanceRepository
import com.chainlesschain.android.feature.performance.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PerformanceViewModel @Inject constructor(
    private val repository: PerformanceRepository,
    private val monitor: PerformanceMonitor,
    private val cacheManager: CacheManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(PerformanceUiState())
    val uiState: StateFlow<PerformanceUiState> = _uiState.asStateFlow()

    val isMonitoring: StateFlow<Boolean> = monitor.isMonitoring
    val currentMetrics: StateFlow<PerformanceMetrics?> = monitor.currentMetrics

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            combine(
                repository.getRecentSnapshots(20),
                repository.getAllCaches(),
                repository.getUnacknowledgedAlerts(),
                repository.getActiveTraces()
            ) { snapshots, caches, alerts, traces ->
                PerformanceData(snapshots, caches, alerts, traces)
            }.collect { data ->
                _uiState.update {
                    it.copy(
                        snapshots = data.snapshots,
                        caches = data.caches,
                        alerts = data.alerts,
                        activeTraces = data.traces,
                        isLoading = false
                    )
                }
            }
        }
    }

    // ==================== Monitoring Control ====================

    fun startMonitoring() {
        monitor.startMonitoring()
        _uiState.update { it.copy(message = "Monitoring started") }
    }

    fun stopMonitoring() {
        monitor.stopMonitoring()
        _uiState.update { it.copy(message = "Monitoring stopped") }
    }

    fun toggleMonitoring() {
        if (isMonitoring.value) {
            stopMonitoring()
        } else {
            startMonitoring()
        }
    }

    // ==================== Alerts ====================

    fun acknowledgeAlert(alertId: String) {
        viewModelScope.launch {
            repository.acknowledgeAlert(alertId)
            _uiState.update { it.copy(message = "Alert acknowledged") }
        }
    }

    fun clearAllAlerts() {
        viewModelScope.launch {
            repository.clearAlerts()
            _uiState.update { it.copy(message = "Alerts cleared") }
        }
    }

    // ==================== Caches ====================

    fun clearCache(cacheName: String) {
        cacheManager.clearCache(cacheName)
        _uiState.update { it.copy(message = "Cache cleared: $cacheName") }
    }

    fun clearAllCaches() {
        cacheManager.clearAllCaches()
        _uiState.update { it.copy(message = "All caches cleared") }
    }

    // ==================== Messages ====================

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

private data class PerformanceData(
    val snapshots: List<PerformanceSnapshot>,
    val caches: List<CacheStatistics>,
    val alerts: List<PerformanceAlert>,
    val traces: List<OperationTrace>
)

data class PerformanceUiState(
    val isLoading: Boolean = true,
    val snapshots: List<PerformanceSnapshot> = emptyList(),
    val caches: List<CacheStatistics> = emptyList(),
    val alerts: List<PerformanceAlert> = emptyList(),
    val activeTraces: List<OperationTrace> = emptyList(),
    val message: String? = null,
    val error: String? = null
)
