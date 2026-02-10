package com.chainlesschain.android.feature.hooks.data.repository

import com.chainlesschain.android.feature.hooks.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for hook configurations and logs
 */
@Singleton
class HookRepository @Inject constructor() {

    private val _hooks = MutableStateFlow<Map<String, HookConfig>>(emptyMap())
    private val _logs = MutableStateFlow<List<HookLog>>(emptyList())
    private val _stats = MutableStateFlow<Map<String, HookStats>>(emptyMap())

    // ==================== Hook Config ====================

    fun getAllHooks(): Flow<List<HookConfig>> = _hooks.map {
        it.values.sortedBy { hook -> hook.priority.value }
    }

    fun getHookById(hookId: String): HookConfig? = _hooks.value[hookId]

    fun getHooksByEvent(event: HookEvent): Flow<List<HookConfig>> = _hooks.map { hooks ->
        hooks.values
            .filter { it.event == event && it.isEnabled }
            .sortedBy { it.priority.value }
    }

    fun getEnabledHooks(): Flow<List<HookConfig>> = _hooks.map { hooks ->
        hooks.values.filter { it.isEnabled }
    }

    suspend fun createHook(hook: HookConfig): HookConfig {
        val newHook = hook.copy(
            id = if (hook.id.isBlank()) UUID.randomUUID().toString() else hook.id,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
        _hooks.value = _hooks.value + (newHook.id to newHook)
        initStats(newHook.id)
        return newHook
    }

    suspend fun updateHook(hook: HookConfig): Boolean {
        if (!_hooks.value.containsKey(hook.id)) return false
        val updated = hook.copy(updatedAt = System.currentTimeMillis())
        _hooks.value = _hooks.value + (hook.id to updated)
        return true
    }

    suspend fun deleteHook(hookId: String): Boolean {
        if (!_hooks.value.containsKey(hookId)) return false
        _hooks.value = _hooks.value - hookId
        _stats.value = _stats.value - hookId
        return true
    }

    suspend fun toggleHook(hookId: String, enabled: Boolean): Boolean {
        val hook = _hooks.value[hookId] ?: return false
        return updateHook(hook.copy(isEnabled = enabled))
    }

    // ==================== Hook Logs ====================

    fun getAllLogs(): Flow<List<HookLog>> = _logs.map {
        it.sortedByDescending { log -> log.timestamp }
    }

    fun getLogsForHook(hookId: String): Flow<List<HookLog>> = _logs.map { logs ->
        logs.filter { it.hookId == hookId }.sortedByDescending { it.timestamp }
    }

    fun getRecentLogs(limit: Int = 50): Flow<List<HookLog>> = _logs.map { logs ->
        logs.sortedByDescending { it.timestamp }.take(limit)
    }

    suspend fun addLog(log: HookLog) {
        val newLog = log.copy(id = if (log.id.isBlank()) UUID.randomUUID().toString() else log.id)
        _logs.value = listOf(newLog) + _logs.value.take(999) // Keep last 1000 logs
    }

    suspend fun clearLogs() {
        _logs.value = emptyList()
    }

    suspend fun clearLogsForHook(hookId: String) {
        _logs.value = _logs.value.filter { it.hookId != hookId }
    }

    // ==================== Statistics ====================

    fun getStats(hookId: String): Flow<HookStats?> = _stats.map { it[hookId] }

    fun getAllStats(): Flow<List<HookStats>> = _stats.map { it.values.toList() }

    private fun initStats(hookId: String) {
        if (!_stats.value.containsKey(hookId)) {
            _stats.value = _stats.value + (hookId to HookStats(hookId))
        }
    }

    suspend fun updateStats(hookId: String, response: HookResponse) {
        val current = _stats.value[hookId] ?: HookStats(hookId)
        val newTotal = current.totalExecutions + 1
        val newSuccess = if (response.success) current.successCount + 1 else current.successCount
        val newFailure = if (!response.success) current.failureCount + 1 else current.failureCount
        val newAvg = ((current.avgExecutionTimeMs * current.totalExecutions) + response.executionTimeMs) / newTotal

        val updated = current.copy(
            totalExecutions = newTotal,
            successCount = newSuccess,
            failureCount = newFailure,
            avgExecutionTimeMs = newAvg,
            lastExecuted = System.currentTimeMillis()
        )
        _stats.value = _stats.value + (hookId to updated)
    }

    // ==================== Bulk Operations ====================

    suspend fun importHooks(hooks: List<HookConfig>) {
        hooks.forEach { hook ->
            _hooks.value = _hooks.value + (hook.id to hook)
            initStats(hook.id)
        }
    }

    fun exportHooks(): List<HookConfig> = _hooks.value.values.toList()
}
