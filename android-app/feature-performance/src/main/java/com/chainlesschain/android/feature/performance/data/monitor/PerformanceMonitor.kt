package com.chainlesschain.android.feature.performance.data.monitor

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import com.chainlesschain.android.feature.performance.data.repository.PerformanceRepository
import com.chainlesschain.android.feature.performance.domain.model.*
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Performance monitoring engine
 */
@Singleton
class PerformanceMonitor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: PerformanceRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var monitoringJob: Job? = null

    private val _isMonitoring = MutableStateFlow(false)
    val isMonitoring: StateFlow<Boolean> = _isMonitoring.asStateFlow()

    private val _currentMetrics = MutableStateFlow<PerformanceMetrics?>(null)
    val currentMetrics: StateFlow<PerformanceMetrics?> = _currentMetrics.asStateFlow()

    // Thresholds for alerts
    private val memoryThreshold = 80f // percent
    private val cpuThreshold = 80f // percent

    // Counters for metrics
    private var networkRequestCount = 0
    private var networkBytesSent = 0L
    private var networkBytesReceived = 0L
    private var networkErrors = 0
    private var networkTotalLatency = 0L

    private var aiRequestCount = 0
    private var aiInputTokens = 0L
    private var aiOutputTokens = 0L
    private var aiTotalLatency = 0L

    private var dbQueryCount = 0
    private var dbTotalQueryTime = 0L
    private var dbSlowQueryCount = 0

    // ==================== Monitoring Control ====================

    fun startMonitoring(intervalMs: Long = 5000L) {
        if (_isMonitoring.value) return

        _isMonitoring.value = true
        monitoringJob = scope.launch {
            while (isActive) {
                collectMetrics()
                delay(intervalMs)
            }
        }
    }

    fun stopMonitoring() {
        monitoringJob?.cancel()
        monitoringJob = null
        _isMonitoring.value = false
    }

    private suspend fun collectMetrics() {
        val metrics = PerformanceMetrics(
            cpu = collectCpuMetrics(),
            memory = collectMemoryMetrics(),
            network = collectNetworkMetrics(),
            database = collectDatabaseMetrics(),
            ai = collectAIMetrics()
        )

        _currentMetrics.value = metrics
        checkThresholds(metrics)

        // Create snapshot
        val caches = repository.getAllCaches().first()
        val alerts = repository.getUnacknowledgedAlerts().first()
        val activeTraces = repository.getActiveTraces().first().size

        val snapshot = PerformanceSnapshot(
            id = UUID.randomUUID().toString(),
            metrics = metrics,
            caches = caches,
            activeTraces = activeTraces,
            alerts = alerts.take(5)
        )
        repository.addSnapshot(snapshot)
    }

    private fun collectCpuMetrics(): CpuMetrics {
        return CpuMetrics(
            usagePercent = (30 + Math.random() * 20).toFloat(), // Simulated
            coreCount = Runtime.getRuntime().availableProcessors()
        )
    }

    private fun collectMemoryMetrics(): MemoryMetrics {
        val runtime = Runtime.getRuntime()
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return MemoryMetrics(0, 0, 0, 0, 0L)
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)

        return MemoryMetrics(
            usedBytes = memInfo.totalMem - memInfo.availMem,
            totalBytes = memInfo.totalMem,
            availableBytes = memInfo.availMem,
            heapUsedBytes = runtime.totalMemory() - runtime.freeMemory(),
            heapMaxBytes = runtime.maxMemory()
        )
    }

    private fun collectNetworkMetrics(): NetworkMetrics {
        val avgLatency = if (networkRequestCount > 0) {
            networkTotalLatency / networkRequestCount
        } else 0L

        return NetworkMetrics(
            bytesSent = networkBytesSent,
            bytesReceived = networkBytesReceived,
            requestCount = networkRequestCount,
            averageLatencyMs = avgLatency,
            errorCount = networkErrors
        )
    }

    private fun collectDatabaseMetrics(): DatabaseMetrics {
        val avgQueryTime = if (dbQueryCount > 0) {
            dbTotalQueryTime / dbQueryCount
        } else 0L

        return DatabaseMetrics(
            sizeBytes = 0L, // Would need database file access
            queryCount = dbQueryCount,
            averageQueryTimeMs = avgQueryTime,
            slowQueryCount = dbSlowQueryCount,
            cacheHitRate = 0.85f // Simulated
        )
    }

    private fun collectAIMetrics(): AIMetrics {
        val avgLatency = if (aiRequestCount > 0) {
            aiTotalLatency / aiRequestCount
        } else 0L

        return AIMetrics(
            requestCount = aiRequestCount,
            totalTokensUsed = aiInputTokens + aiOutputTokens,
            inputTokens = aiInputTokens,
            outputTokens = aiOutputTokens,
            averageLatencyMs = avgLatency
        )
    }

    private suspend fun checkThresholds(metrics: PerformanceMetrics) {
        metrics.memory?.let { memory ->
            if (memory.usagePercent > memoryThreshold) {
                repository.addAlert(
                    PerformanceAlert(
                        id = "",
                        type = AlertType.HIGH_MEMORY,
                        severity = if (memory.usagePercent > 90) AlertSeverity.CRITICAL else AlertSeverity.WARNING,
                        message = "Memory usage is high: ${String.format("%.1f", memory.usagePercent)}%",
                        metric = "memory.usagePercent",
                        currentValue = memory.usagePercent.toDouble(),
                        threshold = memoryThreshold.toDouble()
                    )
                )
            }
        }

        metrics.cpu?.let { cpu ->
            if (cpu.usagePercent > cpuThreshold) {
                repository.addAlert(
                    PerformanceAlert(
                        id = "",
                        type = AlertType.HIGH_CPU,
                        severity = if (cpu.usagePercent > 90) AlertSeverity.CRITICAL else AlertSeverity.WARNING,
                        message = "CPU usage is high: ${String.format("%.1f", cpu.usagePercent)}%",
                        metric = "cpu.usagePercent",
                        currentValue = cpu.usagePercent.toDouble(),
                        threshold = cpuThreshold.toDouble()
                    )
                )
            }
        }
    }

    // ==================== Tracing ====================

    suspend fun <T> trace(
        name: String,
        category: TraceCategory,
        block: suspend () -> T
    ): T {
        val trace = repository.startTrace(name, category)
        return try {
            val result = block()
            repository.endTrace(trace.id, TraceStatus.COMPLETED)
            result
        } catch (e: Exception) {
            repository.failTrace(trace.id, e.message ?: "Unknown error")
            throw e
        }
    }

    suspend fun startTrace(name: String, category: TraceCategory): String {
        return repository.startTrace(name, category).id
    }

    suspend fun endTrace(traceId: String) {
        repository.endTrace(traceId)
    }

    // ==================== Recording ====================

    fun recordNetworkRequest(bytesSent: Long, bytesReceived: Long, latencyMs: Long, success: Boolean) {
        networkRequestCount++
        networkBytesSent += bytesSent
        networkBytesReceived += bytesReceived
        networkTotalLatency += latencyMs
        if (!success) networkErrors++
    }

    fun recordAIRequest(inputTokens: Long, outputTokens: Long, latencyMs: Long) {
        aiRequestCount++
        aiInputTokens += inputTokens
        aiOutputTokens += outputTokens
        aiTotalLatency += latencyMs
    }

    fun recordDatabaseQuery(queryTimeMs: Long, isSlowQuery: Boolean = false) {
        dbQueryCount++
        dbTotalQueryTime += queryTimeMs
        if (isSlowQuery) dbSlowQueryCount++
    }

    // ==================== Lifecycle ====================

    fun shutdown() {
        stopMonitoring()
        scope.cancel()
    }
}
