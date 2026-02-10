package com.chainlesschain.android.feature.ai.cowork.team

/**
 * Team Status
 *
 * Represents the current state of a Cowork team.
 */
enum class TeamStatus(
    val displayName: String
) {
    /**
     * Team is being formed/configured
     */
    FORMING("Forming"),

    /**
     * Team is ready to work
     */
    READY("Ready"),

    /**
     * Team is actively working on a goal
     */
    ACTIVE("Active"),

    /**
     * Team is paused
     */
    PAUSED("Paused"),

    /**
     * Team has completed its goal
     */
    COMPLETED("Completed"),

    /**
     * Team has been disbanded
     */
    DISBANDED("Disbanded");

    companion object {
        /**
         * Get status from string
         */
        fun fromString(value: String): TeamStatus? {
            return entries.find { it.name.equals(value, ignoreCase = true) }
        }
    }
}
