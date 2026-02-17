package com.chainlesschain.android.feature.ai.cowork.skills.registry

import com.chainlesschain.android.feature.ai.cowork.skills.model.Skill
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillCategory
import java.util.concurrent.ConcurrentHashMap

/**
 * Secondary indexes for O(1) lookup by category and file type.
 */
class SkillIndex {

    private val categoryIndex = ConcurrentHashMap<SkillCategory, MutableSet<String>>()
    private val fileTypeIndex = ConcurrentHashMap<String, MutableSet<String>>()
    private val tagIndex = ConcurrentHashMap<String, MutableSet<String>>()

    /**
     * Add a skill to all indexes.
     */
    fun add(skill: Skill) {
        val name = skill.name

        // Category index
        categoryIndex.getOrPut(skill.category) { mutableSetOf() }.add(name)

        // File type index
        for (ft in skill.fileTypes) {
            fileTypeIndex.getOrPut(ft.lowercase()) { mutableSetOf() }.add(name)
        }

        // Tag index
        for (tag in skill.metadata.tags) {
            tagIndex.getOrPut(tag.lowercase()) { mutableSetOf() }.add(name)
        }
    }

    /**
     * Remove a skill from all indexes.
     */
    fun remove(skillName: String) {
        categoryIndex.values.forEach { it.remove(skillName) }
        fileTypeIndex.values.forEach { it.remove(skillName) }
        tagIndex.values.forEach { it.remove(skillName) }
    }

    /**
     * Get skill names by category.
     */
    fun getByCategory(category: SkillCategory): Set<String> {
        return categoryIndex[category] ?: emptySet()
    }

    /**
     * Get skill names that support a given file type/extension.
     */
    fun getByFileType(extension: String): Set<String> {
        return fileTypeIndex[extension.lowercase()] ?: emptySet()
    }

    /**
     * Get skill names by tag.
     */
    fun getByTag(tag: String): Set<String> {
        return tagIndex[tag.lowercase()] ?: emptySet()
    }

    /**
     * Clear all indexes.
     */
    fun clear() {
        categoryIndex.clear()
        fileTypeIndex.clear()
        tagIndex.clear()
    }
}
