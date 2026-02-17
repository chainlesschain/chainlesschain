package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Code review handler — analyzes code for quality, patterns, and bugs.
 *
 * Input keys:
 * - "code" or "input": The code to review
 * - "language": Programming language (optional, auto-detected)
 */
class CodeReviewHandler : SkillHandler {

    override val skillName: String = "code-review"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val code = (input["code"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No code provided")

        val language = input["language"]?.toString() ?: "auto-detect"

        val systemPrompt = """
            You are an expert code reviewer. Review the following code thoroughly.

            Analyze for:
            1. **Code Quality**: naming, complexity, duplication
            2. **Best Practices**: error handling, input validation, security
            3. **Style**: formatting, comments, documentation
            4. **Performance**: inefficiencies, memory, algorithm complexity

            Output format:
            ## Summary
            Brief overview of findings.

            ## Issues
            List issues with severity: 🔴 Critical | 🟡 Warning | 🔵 Info

            ## Recommendations
            Specific improvements with code examples.

            ## Score
            Overall quality score (1-10).
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
        return SkillResult(success = true, output = response, data = mapOf("language" to language))
    }
}
