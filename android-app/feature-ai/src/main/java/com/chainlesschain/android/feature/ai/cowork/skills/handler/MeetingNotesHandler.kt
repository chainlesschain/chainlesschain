package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Meeting Notes handler — structures raw meeting notes into organized format.
 *
 * Input keys:
 * - "text" or "input": Raw meeting notes or transcript
 */
class MeetingNotesHandler : SkillHandler {

    override val skillName: String = "meeting-notes"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No meeting notes provided")

        val systemPrompt = """
            You are a meeting notes organizer. Structure the raw notes into a clear format.

            ## Attendees
            List all people mentioned.

            ## Agenda
            List the topics discussed.

            ## Key Decisions
            Bullet points of decisions made.

            ## Action Items
            - [ ] Task — Owner — Deadline (if mentioned)

            ## Next Steps
            What happens next, including follow-up meetings.
        """.trimIndent()

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
