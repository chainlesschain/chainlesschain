package com.chainlesschain.android.feature.ai.cowork.skills

import com.chainlesschain.android.feature.ai.cowork.skills.executor.SkillExecutor
import com.chainlesschain.android.feature.ai.cowork.skills.model.Skill
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillCategory
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillResult
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Public facade for invoking skills from other features/modules.
 *
 * Provides a simplified API that can be injected into any ViewModel or
 * service that needs to execute skills programmatically (e.g. ProjectViewModel,
 * KnowledgeViewModel, etc.).
 *
 * Usage:
 * ```kotlin
 * @Inject lateinit var skillInvoker: SkillInvoker
 *
 * val result = skillInvoker.invoke("summarize", "Long text to summarize...")
 * val result = skillInvoker.invoke("code-review", mapOf("code" to code, "language" to "kotlin"))
 * ```
 */
@Singleton
class SkillInvoker @Inject constructor(
    private val executor: SkillExecutor,
    private val registry: SkillRegistry
) {
    /**
     * Execute a skill by name with a simple string input.
     */
    suspend fun invoke(skillName: String, input: String): SkillResult {
        return executor.execute(skillName, mapOf("input" to input))
    }

    /**
     * Execute a skill by name with typed key-value input.
     */
    suspend fun invoke(skillName: String, input: Map<String, Any>): SkillResult {
        return executor.execute(skillName, input)
    }

    /**
     * Get available skills for a given category.
     */
    fun getSkillsForCategory(category: SkillCategory): List<Skill> {
        return registry.findByCategory(category)
    }

    /**
     * Check if a skill is available (registered and enabled).
     */
    fun isAvailable(skillName: String): Boolean {
        val skill = registry.findByName(skillName) ?: return false
        return skill.enabled
    }

    /**
     * Get all available skill names.
     */
    fun listAvailable(): List<String> {
        return registry.listInvocable().map { it.name }
    }
}
