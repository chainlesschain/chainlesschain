package com.chainlesschain.android.feature.ai.entity

/**
 * Relation Type
 *
 * Defines the types of relationships between entities.
 * Supports 10 core relation types for knowledge graph construction.
 */
enum class RelationType(
    val displayName: String,
    val displayNameCN: String,
    val isDirectional: Boolean = true
) {
    /**
     * Entity mentions or references another entity
     */
    MENTIONS("mentions", "提及", true),

    /**
     * Entity is related to another entity
     */
    RELATED_TO("related to", "相关于", false),

    /**
     * Entity belongs to or is part of another entity
     */
    BELONGS_TO("belongs to", "属于", true),

    /**
     * Entity contains another entity
     */
    CONTAINS("contains", "包含", true),

    /**
     * Entity created another entity
     */
    CREATED_BY("created by", "创建于", true),

    /**
     * Entity uses or depends on another entity
     */
    USES("uses", "使用", true),

    /**
     * Entity is similar to another entity
     */
    SIMILAR_TO("similar to", "类似于", false),

    /**
     * Entity is opposite or contradicts another entity
     */
    OPPOSITE_TO("opposite to", "对立于", false),

    /**
     * Entity occurs at a specific time/date
     */
    OCCURS_AT("occurs at", "发生于", true),

    /**
     * Entity is located at a specific place
     */
    LOCATED_AT("located at", "位于", true);

    companion object {
        /**
         * Get relation type from string value
         */
        fun fromString(value: String): RelationType? {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true)
            }
        }

        /**
         * Get symmetric relations (non-directional)
         */
        val symmetricRelations: List<RelationType>
            get() = entries.filter { !it.isDirectional }

        /**
         * Get directional relations
         */
        val directionalRelations: List<RelationType>
            get() = entries.filter { it.isDirectional }
    }
}
