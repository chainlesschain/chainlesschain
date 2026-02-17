package com.chainlesschain.android.feature.ai.cowork.skills.model

/**
 * Core Skill data class — Agent Skills Open Standard compatible.
 *
 * A Skill combines metadata (from YAML frontmatter), instructions (Markdown body),
 * and optional Kotlin handler class for native execution.
 */
data class Skill(
    val metadata: SkillMetadata,
    val instructions: String,                // Markdown body (prompt template)
    val examples: List<String> = emptyList(),
    val source: SkillSource,                 // BUNDLED, MANAGED, WORKSPACE
    val sourcePath: String = "",             // original file path
    val enabled: Boolean = true
) {
    /** Convenience accessor for the skill name. */
    val name: String get() = metadata.name

    /** Convenience accessor for the category. */
    val category: SkillCategory get() = metadata.category

    /** Convenience accessor for supported file types. */
    val fileTypes: List<String> get() = metadata.fileTypes

    /** Whether this skill has a Kotlin handler (vs documentation-only / LLM prompt). */
    val hasHandler: Boolean get() = !metadata.handler.isNullOrBlank()
}

/**
 * Source layer for 3-layer skill loading.
 * Higher ordinal = higher priority (overrides lower layers).
 */
enum class SkillSource {
    BUNDLED,     // shipped with APK in assets/skills/
    MANAGED,     // downloaded from marketplace to files/skills/managed/
    WORKSPACE    // user-specified directory (highest priority)
}

/**
 * Result of a skill execution.
 */
data class SkillResult(
    val success: Boolean,
    val output: String,
    val data: Map<String, Any> = emptyMap(),
    val error: String? = null,
    val tokenUsage: Int? = null
)
