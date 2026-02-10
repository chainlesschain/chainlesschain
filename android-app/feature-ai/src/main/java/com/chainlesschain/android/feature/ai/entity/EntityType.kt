package com.chainlesschain.android.feature.ai.entity

/**
 * Entity Type
 *
 * Defines the types of entities that can be extracted from text.
 * Supports 11 core entity types aligned with iOS implementation.
 */
enum class EntityType(
    val displayName: String,
    val displayNameCN: String,
    val color: Long // ARGB color for UI display
) {
    /**
     * Person name
     */
    PERSON("Person", "人物", 0xFF4CAF50),

    /**
     * Organization name
     */
    ORGANIZATION("Organization", "组织", 0xFF2196F3),

    /**
     * Location/Place
     */
    LOCATION("Location", "地点", 0xFFFF9800),

    /**
     * Date or time expression
     */
    DATE("Date", "日期", 0xFF9C27B0),

    /**
     * URL or web address
     */
    URL("URL", "链接", 0xFF00BCD4),

    /**
     * Email address
     */
    EMAIL("Email", "邮箱", 0xFF795548),

    /**
     * Phone number
     */
    PHONE("Phone", "电话", 0xFFE91E63),

    /**
     * Hashtag or tag
     */
    TAG("Tag", "标签", 0xFFFFEB3B),

    /**
     * Technical term (programming language, framework, tool)
     */
    TECH_TERM("Tech Term", "技术术语", 0xFF607D8B),

    /**
     * Code snippet or identifier
     */
    CODE("Code", "代码", 0xFF3F51B5),

    /**
     * Numeric value or measurement
     */
    NUMBER("Number", "数值", 0xFF8BC34A);

    companion object {
        /**
         * Get entity type from string value
         */
        fun fromString(value: String): EntityType? {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true)
            }
        }

        /**
         * Get entity types for technical content
         */
        val technicalTypes: List<EntityType>
            get() = listOf(TECH_TERM, CODE, URL, TAG)

        /**
         * Get entity types for contact information
         */
        val contactTypes: List<EntityType>
            get() = listOf(PERSON, EMAIL, PHONE, ORGANIZATION)

        /**
         * Get entity types for temporal information
         */
        val temporalTypes: List<EntityType>
            get() = listOf(DATE, NUMBER)
    }
}
