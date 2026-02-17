package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Email Draft handler — drafts professional emails with customizable tone.
 *
 * Input keys:
 * - "text" or "input": Brief description of the email to draft
 * - "to": Recipient name or role (optional)
 * - "tone": Email tone — formal, casual, friendly (default: formal)
 */
class EmailDraftHandler : SkillHandler {

    override val skillName: String = "email-draft"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No email description provided")

        val recipient = input["to"]?.toString()
        val tone = input["tone"]?.toString() ?: "formal"

        val toneInstruction = when (tone) {
            "casual" -> "Write in a relaxed, conversational tone. Use contractions and friendly language."
            "friendly" -> "Write in a warm, approachable tone. Be personable but professional."
            else -> "Write in a professional, polished tone. Use proper business language."
        }

        val systemPrompt = buildString {
            appendLine("You are a professional email writer. $toneInstruction")
            appendLine()
            appendLine("Generate a complete email with:")
            appendLine("## Subject")
            appendLine("A clear, concise subject line.")
            appendLine()
            appendLine("## Email")
            appendLine("The full email body with proper greeting and sign-off.")
            if (recipient != null) {
                appendLine("Address the email to: $recipient")
            }
        }

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, text, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(
            success = true,
            output = response,
            data = mapOf("skill" to skillName, "tone" to tone)
        )
    }
}
