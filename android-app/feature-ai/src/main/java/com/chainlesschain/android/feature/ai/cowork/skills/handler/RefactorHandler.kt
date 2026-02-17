package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Refactor handler — suggests refactoring improvements for code.
 *
 * Input keys:
 * - "code" or "input": The code to refactor
 * - "language": Programming language (optional)
 * - "goals": Refactoring goals (optional, e.g. "readability", "performance")
 */
class RefactorHandler : SkillHandler {

    override val skillName: String = "refactor"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val code = (input["code"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No code provided")

        val language = input["language"]?.toString() ?: "auto-detect"
        val goals = input["goals"]?.toString() ?: "readability, maintainability"

        val systemPrompt = """
            You are an expert software engineer specializing in refactoring.

            Refactoring goals: $goals

            Provide:
            ## Analysis
            What can be improved and why.

            ## Refactored Code
            The complete refactored version in a code block.

            ## Changes Made
            Bullet list of specific changes and their rationale.
        """.trimIndent()

        val userMessage = buildString {
            appendLine("Language: $language")
            appendLine()
            appendLine("```")
            appendLine(code)
            appendLine("```")
        }

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, userMessage, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(success = true, output = response, data = mapOf("goals" to goals))
    }
}
