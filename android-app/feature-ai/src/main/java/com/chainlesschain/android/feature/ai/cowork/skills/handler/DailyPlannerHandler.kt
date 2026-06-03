package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole

/**
 * Daily Planner handler — generates a prioritized daily plan with time blocks.
 *
 * Input keys:
 * - "text" or "input": Goals, tasks, and context for the day
 */
class DailyPlannerHandler : SkillHandler {

    override val skillName: String = "daily-planner"

    override suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult {
        val text = (input["text"] ?: input["input"])?.toString()
            ?: return SkillResult(success = false, output = "", error = "No goals or tasks provided")

        val systemPrompt = """
            You are a productivity planner. Create an organized daily plan from the user's goals and tasks.

            ## Priority Tasks
            Rank tasks by importance (P1 = must-do, P2 = should-do, P3 = nice-to-do).

            ## Daily Schedule
            Suggest time blocks for each task. Use a realistic schedule (e.g., 09:00-10:30).

            ## Tips
            One or two brief productivity tips relevant to the day's tasks.

            Keep the plan practical and actionable.
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
