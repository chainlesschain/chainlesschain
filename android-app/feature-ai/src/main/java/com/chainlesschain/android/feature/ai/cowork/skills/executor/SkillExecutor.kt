package com.chainlesschain.android.feature.ai.cowork.skills.executor

import com.chainlesschain.android.feature.ai.cowork.skills.bridge.P2PSkillBridge
import com.chainlesschain.android.feature.ai.cowork.skills.gating.SkillGating
import com.chainlesschain.android.feature.ai.cowork.skills.handler.SkillHandler
import com.chainlesschain.android.feature.ai.cowork.skills.model.Skill
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillExecutionMode
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import kotlinx.coroutines.withTimeout
import timber.log.Timber

/**
 * Skill execution engine with local/remote routing.
 *
 * Execution strategy:
 * 1. Route based on executionMode: LOCAL, REMOTE, or HYBRID
 * 2. For LOCAL: handler → LLM prompt fallback
 * 3. For REMOTE: delegate to desktop via P2PSkillBridge
 * 4. For HYBRID: try local first, fallback to remote if local fails
 */
class SkillExecutor(
    private val registry: SkillRegistry,
    private val gating: SkillGating,
    private val handlers: Map<String, SkillHandler>,
    private val llmAdapter: LLMAdapter,
    private val p2pBridge: P2PSkillBridge,
    private val model: String = "qwen2:7b"
) {

    companion object {
        private const val TAG = "SkillExecutor"
        private const val DEFAULT_TIMEOUT_MS = 60_000L
    }

    /**
     * Execute a skill by name with the given input.
     *
     * @param skillName Name of the skill to execute
     * @param input     Key-value input parameters
     * @param timeoutMs Execution timeout in milliseconds
     * @return SkillResult
     */
    suspend fun execute(
        skillName: String,
        input: Map<String, Any>,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): SkillResult {
        val skill = registry.findByName(skillName)
            ?: return SkillResult(
                success = false,
                output = "",
                error = "Skill not found: $skillName"
            )

        return execute(skill, input, timeoutMs)
    }

    /**
     * Execute a skill with the given input, routing based on executionMode.
     */
    suspend fun execute(
        skill: Skill,
        input: Map<String, Any>,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): SkillResult {
        // Gate check
        val gateResult = gating.check(skill)
        if (!gateResult.passed) {
            return SkillResult(
                success = false,
                output = "",
                error = gateResult.reason
            )
        }

        return try {
            withTimeout(timeoutMs) {
                when (skill.metadata.executionMode) {
                    SkillExecutionMode.LOCAL -> {
                        Timber.d("$TAG: Routing '${skill.name}' → LOCAL")
                        executeLocal(skill, input)
                    }
                    SkillExecutionMode.REMOTE -> {
                        val targetName = skill.metadata.remoteSkillName ?: skill.name
                        Timber.d("$TAG: Routing '${skill.name}' → REMOTE (target: $targetName)")
                        p2pBridge.executeRemote(targetName, input)
                    }
                    SkillExecutionMode.HYBRID -> {
                        val targetName = skill.metadata.remoteSkillName ?: skill.name
                        Timber.d("$TAG: Routing '${skill.name}' → HYBRID (try local, fallback remote: $targetName)")
                        val localResult = try {
                            executeLocal(skill, input)
                        } catch (e: Exception) {
                            Timber.w(e, "$TAG: Local execution failed for '${skill.name}'")
                            SkillResult(success = false, output = "", error = e.message)
                        }
                        if (!localResult.success && p2pBridge.isDesktopConnected) {
                            Timber.d("$TAG: Local failed for '${skill.name}', falling back to remote: $targetName")
                            p2pBridge.executeRemote(targetName, input)
                        } else {
                            localResult
                        }
                    }
                }
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            Timber.w("$TAG: Skill '${skill.name}' timed out after ${timeoutMs}ms")
            SkillResult(
                success = false,
                output = "",
                error = "Skill execution timed out after ${timeoutMs}ms"
            )
        } catch (e: Exception) {
            Timber.e(e, "$TAG: Skill '${skill.name}' execution failed")
            SkillResult(
                success = false,
                output = "",
                error = "Execution failed: ${e.message}"
            )
        }
    }

    /**
     * Execute a skill locally (handler or LLM prompt).
     */
    private suspend fun executeLocal(skill: Skill, input: Map<String, Any>): SkillResult {
        val handler = handlers[skill.name]
        return if (handler != null) {
            Timber.d("$TAG: Executing '${skill.name}' via Kotlin handler")
            handler.execute(input, llmAdapter, model)
        } else {
            Timber.d("$TAG: Executing '${skill.name}' via LLM prompt")
            executeLLMPrompt(skill, input)
        }
    }

    /**
     * Execute a skill by constructing an LLM prompt from its instructions template.
     */
    private suspend fun executeLLMPrompt(skill: Skill, input: Map<String, Any>): SkillResult {
        // Build system prompt from skill instructions
        val systemPrompt = buildString {
            appendLine("You are executing the '${skill.metadata.displayName}' skill.")
            appendLine()
            appendLine(skill.instructions)
        }

        // Build user message from input
        val userMessage = buildString {
            for ((key, value) in input) {
                appendLine("$key: $value")
            }
        }.trim().ifBlank { "Execute this skill." }

        val messages = listOf(
            Message(
                id = "skill-system",
                conversationId = "",
                role = MessageRole.SYSTEM,
                content = systemPrompt,
                createdAt = System.currentTimeMillis()
            ),
            Message(
                id = "skill-user",
                conversationId = "",
                role = MessageRole.USER,
                content = userMessage,
                createdAt = System.currentTimeMillis()
            )
        )

        val response = llmAdapter.chat(messages, model)

        return SkillResult(
            success = true,
            output = response,
            data = mapOf("model" to model, "skill" to skill.name)
        )
    }

    /**
     * Execute a parsed /skill command.
     */
    suspend fun executeCommand(command: ParsedCommand): SkillResult {
        return execute(command.skillName, command.input)
    }

    /**
     * Update the default model used for LLM-based skill execution.
     */
    fun withModel(newModel: String): SkillExecutor {
        return SkillExecutor(registry, gating, handlers, llmAdapter, p2pBridge, newModel)
    }
}
