package com.chainlesschain.android.feature.hooks.data.engine

import com.chainlesschain.android.feature.hooks.data.repository.HookRepository
import com.chainlesschain.android.feature.hooks.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hook registry for managing hook registrations
 */
@Singleton
class HookRegistry @Inject constructor(
    private val repository: HookRepository,
    private val executor: HookExecutor
) {
    // ==================== Registration ====================

    suspend fun register(
        name: String,
        event: HookEvent,
        handler: HookHandler,
        type: HookType = HookType.SYNC,
        priority: HookPriority = HookPriority.NORMAL,
        description: String? = null,
        conditions: List<HookCondition> = emptyList(),
        timeout: Long = 30_000L
    ): HookConfig {
        val hook = HookConfig(
            id = "",
            name = name,
            description = description,
            event = event,
            type = type,
            priority = priority,
            handler = handler,
            conditions = conditions,
            timeout = timeout
        )
        return repository.createHook(hook)
    }

    suspend fun unregister(hookId: String): Boolean {
        return repository.deleteHook(hookId)
    }

    suspend fun enable(hookId: String): Boolean {
        return repository.toggleHook(hookId, true)
    }

    suspend fun disable(hookId: String): Boolean {
        return repository.toggleHook(hookId, false)
    }

    // ==================== Query ====================

    fun getAll(): Flow<List<HookConfig>> = repository.getAllHooks()

    fun getByEvent(event: HookEvent): Flow<List<HookConfig>> = repository.getHooksByEvent(event)

    fun getEnabled(): Flow<List<HookConfig>> = repository.getEnabledHooks()

    suspend fun getById(hookId: String): HookConfig? = repository.getHookById(hookId)

    // ==================== Execution ====================

    suspend fun trigger(
        event: HookEvent,
        data: Map<String, String> = emptyMap(),
        metadata: Map<String, String> = emptyMap()
    ): List<HookResponse> {
        return executor.executeForEvent(event, data, metadata)
    }

    suspend fun executeHook(hookId: String, context: HookContext): HookResponse? {
        val hook = repository.getHookById(hookId) ?: return null
        return executor.execute(hook, context)
    }

    // ==================== Built-in Hooks ====================

    suspend fun registerBuiltInHooks() {
        // Session start logging
        register(
            name = "Session Logger",
            event = HookEvent.SESSION_START,
            handler = HookHandler.Function("logSessionStart"),
            type = HookType.ASYNC,
            priority = HookPriority.MONITOR,
            description = "Logs session start events"
        )

        // File modification tracker
        register(
            name = "File Change Tracker",
            event = HookEvent.FILE_MODIFIED,
            handler = HookHandler.Function("trackFileChange"),
            type = HookType.ASYNC,
            priority = HookPriority.LOW,
            description = "Tracks file modifications"
        )

        // Error notifier
        register(
            name = "Error Notifier",
            event = HookEvent.AI_ERROR,
            handler = HookHandler.Function("notifyError"),
            type = HookType.SYNC,
            priority = HookPriority.HIGH,
            description = "Sends notifications on AI errors"
        )
    }

    // ==================== Statistics ====================

    fun getStats(hookId: String): Flow<HookStats?> = repository.getStats(hookId)

    fun getAllStats(): Flow<List<HookStats>> = repository.getAllStats()

    // ==================== Logs ====================

    fun getLogs(): Flow<List<HookLog>> = repository.getAllLogs()

    fun getLogsForHook(hookId: String): Flow<List<HookLog>> = repository.getLogsForHook(hookId)

    fun getRecentLogs(limit: Int = 50): Flow<List<HookLog>> = repository.getRecentLogs(limit)

    suspend fun clearLogs() = repository.clearLogs()
}
