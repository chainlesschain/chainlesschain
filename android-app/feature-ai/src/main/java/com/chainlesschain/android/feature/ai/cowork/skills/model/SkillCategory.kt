package com.chainlesschain.android.feature.ai.cowork.skills.model

/**
 * Skill category enum matching desktop Agent Skills Open Standard.
 */
enum class SkillCategory(val displayName: String) {
    CODE("Code"),
    DOCUMENTATION("Documentation"),
    ANALYSIS("Analysis"),
    TRANSLATION("Translation"),
    TESTING("Testing"),
    DEBUGGING("Debugging"),
    REFACTORING("Refactoring"),
    DEVELOPMENT("Development"),
    LEARNING("Learning"),
    DEVOPS("DevOps"),
    SECURITY("Security"),
    AUTOMATION("Automation"),
    DATA("Data"),
    KNOWLEDGE("Knowledge"),
    PRODUCTIVITY("Productivity"),
    REMOTE("Remote"),
    GENERAL("General"),
    CUSTOM("Custom");

    companion object {
        fun fromString(value: String): SkillCategory {
            return entries.find { it.name.equals(value, ignoreCase = true) }
                ?: GENERAL
        }
    }
}
