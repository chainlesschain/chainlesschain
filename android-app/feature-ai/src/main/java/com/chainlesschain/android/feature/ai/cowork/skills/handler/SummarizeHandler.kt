package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Summarize handler — summarizes text or documents.
 *
 * Input keys:
 * - "text" or "input": The text to summarize
 * - "maxLength": Maximum summary length (optional, default: "medium")
 */
class SummarizeHandler : SkillHandler {

    override val skillName: String = "summarize"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No text provided")

        val maxLength = input["maxLength"]?.toString() ?: "medium"

        val lengthInstruction = when (maxLength) {
            "short" -> "Summarize in 1-2 sentences."
            "long" -> "Provide a comprehensive summary with key details."
            else -> "Provide a concise summary covering the main points in 3-5 sentences."
        }

        val systemPrompt = """
            You are a skilled summarizer. $lengthInstruction

            Structure:
            ## Summary
            The main summary.

            ## Key Points
            - Bullet points of important details.
        """.trimIndent()

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, text, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(success = true, output = response)
    }
}
