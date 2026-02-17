package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Translate handler — translates text between languages.
 *
 * Input keys:
 * - "text" or "input": The text to translate
 * - "from": Source language (optional, auto-detect)
 * - "to": Target language (required, default: "en")
 */
class TranslateHandler : SkillHandler {

    override val skillName: String = "translate"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No text provided")

        val from = input["from"]?.toString() ?: "auto-detect"
        val to = input["to"]?.toString() ?: "en"

        val systemPrompt = """
            You are a professional translator. Translate the given text accurately.

            Source language: $from
            Target language: $to

            Rules:
            - Preserve the original meaning and tone
            - Maintain formatting (paragraphs, lists, code blocks)
            - For technical terms, provide the translation with the original in parentheses
            - Output only the translation, no explanations
        """.trimIndent()

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, text, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(
            success = true,
            output = response,
            data = mapOf("from" to from, "to" to to)
        )
    }
}
