package com.chainlesschain.android.feature.performance.data.repository

import com.chainlesschain.android.feature.performance.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for performance data
 */
@Singleton
class PerformanceRepository @Inject constructor() {

    private val _snapshots = MutableStateFlow<List<PerformanceSnapshot>>(emptyList())
    private val _traces = MutableStateFlow<Map<String, OperationTrace>>(emptyMap())
    private val _alerts = MutableStateFlow<List<PerformanceAlert>>(emptyList())
    private val _caches = MutableStateFlow<Map<String, CacheStatistics>>(emptyMap())

    private val maxSnapshots = 100
    private val maxTraces = 1000
    private val maxAlerts = 50

    // ==================== Snapshots ====================

    fun getAllSnapshots(): Flow<List<PerformanceSnapshot>> = _snapshots.map {
        it.sortedByDescending { s -> s.timestamp }
    }

    fun getRecentSnapshots(limit: Int = 20): Flow<List<PerformanceSnapshot>> = _snapshots.map {
        it.sortedByDescending { s -> s.timestamp }.take(limit)
    }

    suspend fun addSnapshot(snapshot: PerformanceSnapshot) {
        val newSnapshot = snapshot.copy(
            id = if (snapshot.id.isBlank()) UUID.randomUUID().toString() else snapshot.id
        )
        val current = _snapshots.value.toMutableList()
        current.add(0, newSnapshot)
        if (current.size > maxSnapshots) {
            current.removeLast()
        }
        _snapshots.value = current
    }

    fun getLatestSnapshot(): PerformanceSnapshot? = _snapshots.value.firstOrNull()

    // ==================== Traces ====================

    fun getAllTraces(): Flow<List<OperationTrace>> = _traces.map {
        it.values.sortedByDescending { t -> t.startTime }
    }

    fun getActiveTraces(): Flow<List<OperationTrace>> = _traces.map { traces ->
        traces.values.filter { it.status == TraceStatus.RUNNING }
    }

    fun getTracesByCategory(category: TraceCategory): Flow<List<OperationTrace>> = _traces.map { traces ->
        traces.values.filter { it.category == category }
    }

    suspend fun startTrace(name: String, category: TraceCategory, parentId: String? = null): OperationTrace {
        val trace = OperationTrace(
            id = UUID.randomUUID().toString(),
            name = name,
            category = category,
            startTime = System.currentTimeMillis(),
            parentId = parentId,
            status = TraceStatus.RUNNING
        )
        _traces.value = _traces.value + (trace.id to trace)
        cleanupOldTraces()
        return trace
    }

    suspend fun endTrace(traceId: String, status: TraceStatus = TraceStatus.COMPLETED) {
        val trace = _traces.value[traceId] ?: return
        val endTime = System.currentTimeMillis()
        val completed = trace.copy(
            endTime = endTime,
            durationMs = endTime - trace.startTime,
            status = status
        )
        _traces.value = _traces.value + (traceId to completed)
    }

    suspend fun failTrace(traceId: String, error: String) {
        val trace = _traces.value[traceId] ?: return
        val endTime = System.currentTimeMillis()
        val failed = trace.copy(
            endTime = endTime,
            durationMs = endTime - trace.startTime,
            status = TraceStatus.FAILED,
            metadata = trace.metadata + ("error" to error)
        )
        _traces.value = _traces.value + (traceId to failed)
    }

    private fun cleanupOldTraces() {
        val traces = _traces.value.values
            .sortedByDescending { it.startTime }
            .take(maxTraces)
        _traces.value = traces.associateBy { it.id }
    }

    // ==================== Alerts ====================

    fun getAllAlerts(): Flow<List<PerformanceAlert>> = _alerts.map {
        it.sortedByDescending { a -> a.timestamp }
    }

    fun getUnacknowledgedAlerts(): Flow<List<PerformanceAlert>> = _alerts.map { alerts ->
        alerts.filter { !it.acknowledged }
    }

    suspend fun addAlert(alert: PerformanceAlert) {
        val newAlert = alert.copy(
            id = if (alert.id.isBlank()) UUID.randomUUID().toString() else alert.id
        )
        val current = _alerts.value.toMutableList()
        current.add(0, newAlert)
        if (current.size > maxAlerts) {
            current.removeLast()
        }
        _alerts.value = current
    }

    suspend fun acknowledgeAlert(alertId: String): Boolean {
        val index = _alerts.value.indexOfFirst { it.id == alertId }
        if (index == -1) return false

        val current = _alerts.value.toMutableList()
        current[index] = current[index].copy(acknowledged = true)
        _alerts.value = current
        return true
    }

    suspend fun clearAlerts() {
        _alerts.value = emptyList()
    }

    // ==================== Caches ====================

    fun getAllCaches(): Flow<List<CacheStatistics>> = _caches.map { it.values.toList() }

    suspend fun updateCache(stats: CacheStatistics) {
        _caches.value = _caches.value + (stats.name to stats)
    }

    fun getCacheStats(name: String): CacheStatistics? = _caches.value[name]
}
