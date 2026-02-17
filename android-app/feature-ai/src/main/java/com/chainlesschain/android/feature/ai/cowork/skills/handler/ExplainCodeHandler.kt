package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Explain code handler — explains code in natural language.
 *
 * Input keys:
 * - "code" or "input": The code to explain
 * - "language": Programming language (optional)
 * - "level": Detail level — "brief", "normal", "detailed" (default: "normal")
 */
class ExplainCodeHandler : SkillHandler {

    override val skillName: String = "explain-code"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val code = (input["code"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No code provided")

        val language = input["language"]?.toString() ?: "auto-detect"
        val level = input["level"]?.toString() ?: "normal"

        val detailInstruction = when (level) {
            "brief" -> "Give a brief 2-3 sentence overview of what this code does."
            "detailed" -> "Provide a detailed line-by-line explanation of the code."
            else -> "Explain the code clearly, covering the main components and logic flow."
        }

        val systemPrompt = """
            You are a patient programming teacher. Explain code clearly.

            $detailInstruction

            Structure your explanation:
            ## Overview
            What the code does and why.

            ## Key Components
            Functions, variables, data structures.

            ## How It Works
            Logic flow and control structures.
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
        return SkillResult(success = true, output = response, data = mapOf("level" to level))
    }
}
