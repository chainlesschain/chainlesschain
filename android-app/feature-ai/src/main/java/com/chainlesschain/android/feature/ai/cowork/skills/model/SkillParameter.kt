package com.chainlesschain.android.feature.ai.cowork.skills.model

/**
 * Skill input/output parameter definition for Agent Skills Open Standard.
 */
data class SkillParameter(
    val name: String,
    val type: String = "string",       // "string", "number", "boolean", "array", "object"
    val description: String = "",
    val required: Boolean = false,
    val default: Any? = null,
    val enum: List<String>? = null      // allowed values
)
