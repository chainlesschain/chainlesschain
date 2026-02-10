package com.chainlesschain.android.feature.hooks.data.engine

import com.chainlesschain.android.feature.hooks.data.repository.HookRepository
import com.chainlesschain.android.feature.hooks.domain.model.*
import kotlinx.coroutines.*
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hook execution engine
 */
@Singleton
class HookExecutor @Inject constructor(
    private val repository: HookRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /**
     * Execute a single hook with context
     */
    suspend fun execute(hook: HookConfig, context: HookContext): HookResponse {
        if (!hook.isEnabled) {
            return HookResponse(
                hookId = hook.id,
                success = false,
                error = "Hook is disabled"
            )
        }

        // Check conditions
        if (!checkConditions(hook.conditions, context)) {
            return HookResponse(
                hookId = hook.id,
                success = true,
                result = "Conditions not met, skipped"
            )
        }

        val startTime = System.currentTimeMillis()
        var response: HookResponse

        try {
            response = withTimeout(hook.timeout) {
                when (hook.type) {
                    HookType.SYNC -> executeSyncHandler(hook.handler, context)
                    HookType.ASYNC -> executeAsyncHandler(hook.handler, context)
                    HookType.COMMAND -> executeCommandHandler(hook.handler as HookHandler.Command, context)
                    HookType.SCRIPT -> executeScriptHandler(hook.handler as HookHandler.Script, context)
                }
            }
        } catch (e: TimeoutCancellationException) {
            response = HookResponse(
                hookId = hook.id,
                success = false,
                error = "Hook execution timed out after ${hook.timeout}ms"
            )
        } catch (e: Exception) {
            response = HookResponse(
                hookId = hook.id,
                success = false,
                error = e.message ?: "Unknown error"
            )
        }

        val executionTime = System.currentTimeMillis() - startTime
        response = response.copy(executionTimeMs = executionTime)

        // Log and update stats
        val log = HookLog(
            id = UUID.randomUUID().toString(),
            hookId = hook.id,
            hookName = hook.name,
            event = hook.event,
            context = context,
            response = response
        )
        repository.addLog(log)
        repository.updateStats(hook.id, response)

        return response
    }

    /**
     * Execute all hooks for an event
     */
    suspend fun executeForEvent(
        event: HookEvent,
        data: Map<String, String> = emptyMap(),
        metadata: Map<String, String> = emptyMap()
    ): List<HookResponse> {
        val context = HookContext(event = event, data = data, metadata = metadata)
        val responses = mutableListOf<HookResponse>()

        repository.getHooksByEvent(event).collect { hooks ->
            for (hook in hooks) {
                val response = execute(hook, context)
                responses.add(response)

                // Check if we should continue (for blocking hooks)
                if (!response.shouldContinue) {
                    break
                }
            }
        }

        return responses
    }

    private fun checkConditions(conditions: List<HookCondition>, context: HookContext): Boolean {
        if (conditions.isEmpty()) return true

        return conditions.all { condition ->
            val value = context.data[condition.field] ?: context.metadata[condition.field] ?: ""
            evaluateCondition(condition, value)
        }
    }

    private fun evaluateCondition(condition: HookCondition, actualValue: String): Boolean {
        return when (condition.operator) {
            ConditionOperator.EQUALS -> actualValue == condition.value
            ConditionOperator.NOT_EQUALS -> actualValue != condition.value
            ConditionOperator.CONTAINS -> actualValue.contains(condition.value)
            ConditionOperator.NOT_CONTAINS -> !actualValue.contains(condition.value)
            ConditionOperator.STARTS_WITH -> actualValue.startsWith(condition.value)
            ConditionOperator.ENDS_WITH -> actualValue.endsWith(condition.value)
            ConditionOperator.MATCHES -> actualValue.matches(Regex(condition.value))
            ConditionOperator.GREATER_THAN -> {
                val actual = actualValue.toDoubleOrNull() ?: 0.0
                val expected = condition.value.toDoubleOrNull() ?: 0.0
                actual > expected
            }
            ConditionOperator.LESS_THAN -> {
                val actual = actualValue.toDoubleOrNull() ?: 0.0
                val expected = condition.value.toDoubleOrNull() ?: 0.0
                actual < expected
            }
        }
    }

    private suspend fun executeSyncHandler(handler: HookHandler, context: HookContext): HookResponse {
        // Simulate sync handler execution
        return when (handler) {
            is HookHandler.Function -> {
                // In real implementation, this would call a registered function
                HookResponse(
                    hookId = "",
                    success = true,
                    result = "Function ${handler.name} executed"
                )
            }
            is HookHandler.Webhook -> {
                // Simulate webhook call
                delay(50)
                HookResponse(
                    hookId = "",
                    success = true,
                    result = "Webhook ${handler.url} called"
                )
            }
            else -> HookResponse(hookId = "", success = false, error = "Unsupported handler type for sync execution")
        }
    }

    private suspend fun executeAsyncHandler(handler: HookHandler, context: HookContext): HookResponse {
        // Execute in background and return immediately
        scope.launch {
            executeSyncHandler(handler, context)
        }
        return HookResponse(
            hookId = "",
            success = true,
            result = "Async handler started"
        )
    }

    private suspend fun executeCommandHandler(handler: HookHandler.Command, context: HookContext): HookResponse {
        // Simulate command execution (in real implementation, would run shell command)
        delay(100)
        return HookResponse(
            hookId = "",
            success = true,
            result = "Command executed: ${handler.command}"
        )
    }

    private suspend fun executeScriptHandler(handler: HookHandler.Script, context: HookContext): HookResponse {
        // Simulate script execution
        delay(150)
        return HookResponse(
            hookId = "",
            success = true,
            result = "Script executed: ${handler.path}"
        )
    }

    fun shutdown() {
        scope.cancel()
    }
}
