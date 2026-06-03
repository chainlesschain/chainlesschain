package com.chainlesschain.android.feature.ai.cowork.skills.model

/**
 * Execution mode for skill routing (local device vs desktop delegation).
 */
enum class SkillExecutionMode {
    LOCAL,      // Execute on Android device (default)
    REMOTE,     // Delegate to desktop PC via P2P
    HYBRID;     // Try local first, fallback to remote if local fails

    companion object {
        fun fromString(value: String): SkillExecutionMode {
            return entries.find { it.name.equals(value, ignoreCase = true) }
                ?: LOCAL
        }
    }
}

/**
 * YAML frontmatter metadata from SKILL.md files.
 * Maps to Agent Skills Open Standard fields.
 */
data class SkillMetadata(
    val name: String,
    val displayName: String = "",
    val version: String = "1.0.0",
    val description: String = "",
    val category: SkillCategory = SkillCategory.GENERAL,
    val author: String = "",
    val tags: List<String> = emptyList(),
    val fileTypes: List<String> = emptyList(),   // e.g. ["kt", "java", "py"]
    val capabilities: List<String> = emptyList(),
    val userInvocable: Boolean = true,
    val hidden: Boolean = false,

    // Agent Skills Open Standard fields
    val inputSchema: List<SkillParameter> = emptyList(),
    val outputSchema: List<SkillParameter> = emptyList(),
    val modelHints: Map<String, Any> = emptyMap(),
    val dependencies: List<String> = emptyList(),
    val cost: String? = null,
    val license: String = "",
    val homepage: String = "",
    val repository: String = "",

    // Gate conditions
    val gate: SkillGate? = null,

    // Handler reference (class name for Kotlin handlers)
    val handler: String? = null,

    // Platform support
    val os: List<String> = listOf("android", "win32", "darwin", "linux"),

    // Execution routing
    val executionMode: SkillExecutionMode = SkillExecutionMode.LOCAL,

    // Desktop skill to invoke for REMOTE execution (maps Android skill → desktop skill)
    val remoteSkillName: String? = null
)

/**
 * Gate conditions for skill availability checks.
 */
data class SkillGate(
    val platform: List<String>? = null,            // ["android", "desktop"]
    val minSdk: Int? = null,                       // minimum Android SDK version
    val requiredPermissions: List<String>? = null,  // Android permissions
    val requiredBinaries: List<String>? = null,     // binary dependencies
    val requiredEnv: List<String>? = null            // environment variables
)
