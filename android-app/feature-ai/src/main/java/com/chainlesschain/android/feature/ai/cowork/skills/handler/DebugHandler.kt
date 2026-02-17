package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Debug handler — analyzes errors and suggests fixes.
 *
 * Input keys:
 * - "error" or "input": The error message or description
 * - "code": Related source code (optional)
 * - "stackTrace": Stack trace (optional)
 */
class DebugHandler : SkillHandler {

    override val skillName: String = "debug"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val error = (input["error"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No error description provided")

        val code = input["code"]?.toString()
        val stackTrace = input["stackTrace"]?.toString()

        val systemPrompt = """
            You are an expert debugger. Analyze the error and provide actionable fixes.

            Structure your response:
            ## Root Cause
            What is causing the error and why.

            ## Fix
            Step-by-step fix instructions with code examples.

            ## Prevention
            How to prevent this type of error in the future.
        """.trimIndent()

        val userMessage = buildString {
            appendLine("Error: $error")
            if (!stackTrace.isNullOrBlank()) {
                appendLine()
                appendLine("Stack trace:")
                appendLine("```")
                appendLine(stackTrace)
                appendLine("```")
            }
            if (!code.isNullOrBlank()) {
                appendLine()
                appendLine("Related code:")
                appendLine("```")
                appendLine(code)
                appendLine("```")
            }
        }

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, userMessage, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(success = true, output = response)
    }
}
