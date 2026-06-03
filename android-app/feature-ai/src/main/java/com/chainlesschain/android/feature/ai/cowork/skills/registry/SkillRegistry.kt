package com.chainlesschain.android.feature.ai.cowork.skills.registry

import com.chainlesschain.android.feature.ai.cowork.skills.model.Skill
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillCategory
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap

/**
 * Central thread-safe registry for all loaded skills.
 *
 * Provides O(1) lookup by name and indexed queries by category/fileType/tag.
 * Also generates OpenAI function-calling definitions for LLM integration.
 */
class SkillRegistry {

    private val skills = ConcurrentHashMap<String, Skill>()
    private val index = SkillIndex()

    /**
     * Register a skill. Replaces any existing skill with the same name
     * (3-layer override: BUNDLED < MANAGED < WORKSPACE).
     */
    fun register(skill: Skill) {
        val existing = skills[skill.name]
        if (existing != null && existing.source.ordinal > skill.source.ordinal) {
            // Don't override a higher-priority source with a lower one
            Timber.d("SkillRegistry: Skipping ${skill.name} (${skill.source}) — already loaded from ${existing.source}")
            return
        }

        if (existing != null) {
            index.remove(existing.name)
        }
        skills[skill.name] = skill
        index.add(skill)
        Timber.d("SkillRegistry: Registered '${skill.name}' from ${skill.source}")
    }

    /**
     * Unregister a skill by name.
     */
    fun unregister(name: String) {
        skills.remove(name)?.let { index.remove(it.name) }
    }

    /**
     * Find a skill by exact name.
     */
    fun findByName(name: String): Skill? = skills[name]

    /**
     * Find all skills in a category.
     */
    fun findByCategory(category: SkillCategory): List<Skill> {
        return index.getByCategory(category).mapNotNull { skills[it] }
    }

    /**
     * Find skills that support a given file extension.
     */
    fun findByFileType(extension: String): List<Skill> {
        return index.getByFileType(extension).mapNotNull { skills[it] }
    }

    /**
     * Find skills by tag.
     */
    fun findByTag(tag: String): List<Skill> {
        return index.getByTag(tag).mapNotNull { skills[it] }
    }

    /**
     * List all registered skills.
     */
    fun listAll(): List<Skill> = skills.values.toList()

    /**
     * List all user-invocable skills (for /skill command suggestions).
     */
    fun listInvocable(): List<Skill> {
        return skills.values.filter { it.metadata.userInvocable && it.enabled && !it.metadata.hidden }
    }

    /**
     * Search skills by query string (matches name, description, tags).
     */
    fun search(query: String): List<Skill> {
        val q = query.lowercase()
        return skills.values.filter { skill ->
            skill.name.lowercase().contains(q) ||
                    skill.metadata.description.lowercase().contains(q) ||
                    skill.metadata.displayName.lowercase().contains(q) ||
                    skill.metadata.tags.any { it.lowercase().contains(q) }
        }
    }

    /**
     * Total number of registered skills.
     */
    val size: Int get() = skills.size

    /**
     * Convert all registered skills to OpenAI function calling format.
     * Used by the LLM to know which skills it can invoke.
     */
    fun toFunctionDefinitions(): List<Map<String, Any>> {
        return listInvocable().map { skill ->
            val properties = mutableMapOf<String, Any>()
            val required = mutableListOf<String>()

            for (param in skill.metadata.inputSchema) {
                val propDef = mutableMapOf<String, Any>(
                    "type" to param.type,
                    "description" to param.description
                )
                if (param.enum != null) {
                    propDef["enum"] = param.enum
                }
                if (param.default != null) {
                    propDef["default"] = param.default
                }
                properties[param.name] = propDef
                if (param.required) {
                    required.add(param.name)
                }
            }

            // If no inputSchema defined, add a generic "input" parameter
            if (properties.isEmpty()) {
                properties["input"] = mapOf(
                    "type" to "string",
                    "description" to "The input text or code to process"
                )
            }

            mapOf(
                "type" to "function",
                "function" to mapOf(
                    "name" to skill.name,
                    "description" to skill.metadata.description,
                    "parameters" to mapOf(
                        "type" to "object",
                        "properties" to properties,
                        "required" to required
                    )
                )
            )
        }
    }

    /**
     * Clear all skills and indexes.
     */
    fun clear() {
        skills.clear()
        index.clear()
    }
}
