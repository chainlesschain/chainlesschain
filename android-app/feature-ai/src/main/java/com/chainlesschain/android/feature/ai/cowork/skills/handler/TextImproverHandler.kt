package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Text Improver handler — polishes text for grammar, clarity, and tone.
 *
 * Input keys:
 * - "text" or "input": The text to improve
 * - "style": Target style — formal, casual, concise, academic (default: formal)
 */
class TextImproverHandler : SkillHandler {

    override val skillName: String = "text-improver"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No text provided")

        val style = input["style"]?.toString() ?: "formal"

        val styleInstruction = when (style) {
            "casual" -> "Make it conversational and relaxed, using everyday language."
            "concise" -> "Make it as brief and direct as possible. Remove all unnecessary words."
            "academic" -> "Use academic language with precise terminology and structured arguments."
            else -> "Make it professional and polished with clear, formal language."
        }

        val systemPrompt = """
            You are an expert editor. Improve the given text. $styleInstruction

            ## Improved Text
            The polished version of the text.

            ## Changes Made
            Brief bullet points explaining what was changed and why.
        """.trimIndent()

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, text, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(
            success = true,
            output = response,
            data = mapOf("skill" to skillName, "style" to style)
        )
    }
}
