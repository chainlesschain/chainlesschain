package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Unit test generation handler — generates unit test code.
 *
 * Input keys:
 * - "code" or "input": The code to generate tests for
 * - "language": Programming language (optional)
 * - "framework": Test framework (optional, e.g. "JUnit", "MockK", "pytest")
 */
class UnitTestHandler : SkillHandler {

    override val skillName: String = "unit-test"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val code = (input["code"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No code provided")

        val language = input["language"]?.toString() ?: "auto-detect"
        val framework = input["framework"]?.toString() ?: "auto-detect"

        val systemPrompt = """
            You are an expert at writing unit tests. Generate comprehensive tests.

            Language: $language
            Framework: $framework

            Requirements:
            - Test all public methods/functions
            - Include happy path and edge cases
            - Test error conditions
            - Use descriptive test names
            - Include setup/teardown if needed

            Output format:
            ## Test Plan
            Brief description of what will be tested.

            ## Test Code
            Complete, runnable test code in a code block.

            ## Coverage Notes
            What is covered and any limitations.
        """.trimIndent()

        val userMessage = buildString {
            appendLine("Generate unit tests for:")
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
        return SkillResult(
            success = true,
            output = response,
            data = mapOf("language" to language, "framework" to framework)
        )
    }
}
