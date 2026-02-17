package com.chainlesschain.android.feature.ai.cowork.skills.handler

import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter

/**
 * Interface for Kotlin-native skill handlers.
 *
 * Handlers construct specialized prompts and call the LLM adapter.
 * They can also perform pre/post-processing logic that pure SKILL.md
 * prompt templates cannot.
 */
interface SkillHandler {
    /** The skill name this handler is registered for. */
    val skillName: String

    /**
     * Execute the skill with the given input.
     *
     * @param input      Key-value input parameters
     * @param llmAdapter LLM adapter for AI calls
     * @param model      Model identifier to use
     * @return SkillResult
     */
    suspend fun execute(
        input: Map<String, Any>,
        llmAdapter: LLMAdapter,
        model: String
    ): SkillResult
}
