package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Quick Note handler — captures ideas with AI auto-categorization and tagging.
 *
 * Input keys:
 * - "text" or "input": The note content
 * - "category": Optional category hint (idea, task, reminder, reference)
 */
class QuickNoteHandler : SkillHandler {

    override val skillName: String = "quick-note"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No note content provided")

        val categoryHint = input["category"]?.toString()

        val systemPrompt = buildString {
            appendLine("You are a smart note-taking assistant. Your job is to organize and enhance quick notes.")
            appendLine()
            appendLine("For each note, provide:")
            appendLine("## Category")
            appendLine("Assign one category: idea, task, reminder, reference, or meeting.")
            if (categoryHint != null) {
                appendLine("The user suggests category: $categoryHint — use it if it fits.")
            }
            appendLine()
            appendLine("## Tags")
            appendLine("Generate 2-5 relevant tags as a comma-separated list.")
            appendLine()
            appendLine("## Summary")
            appendLine("A one-line summary of the note.")
            appendLine()
            appendLine("## Note")
            appendLine("The cleaned-up, well-formatted note content.")
        }

        val messages = listOf(
            Message("sys", "", MessageRole.SYSTEM, systemPrompt, System.currentTimeMillis()),
            Message("usr", "", MessageRole.USER, text, System.currentTimeMillis())
        )

        val response = llmAdapter.chat(messages, model)
        return SkillResult(
            success = true,
            output = response,
            data = mapOf("skill" to skillName)
        )
    }
}
