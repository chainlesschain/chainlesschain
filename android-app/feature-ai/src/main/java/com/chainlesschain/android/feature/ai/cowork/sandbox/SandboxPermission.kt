package com.chainlesschain.android.feature.ai.cowork.sandbox

/**
 * Sandbox Permission
 *
 * Defines the permissions for file access within the sandbox.
 */
enum class SandboxPermission(
    val displayName: String,
    val level: Int
) {
    /**
     * No access
     */
    NONE("None", 0),

    /**
     * Read-only access
     */
    READ("Read", 1),

    /**
     * Write access (includes read)
     */
    WRITE("Write", 2),

    /**
     * Execute access
     */
    EXECUTE("Execute", 3),

    /**
     * Full access (read, write, execute)
     */
    FULL("Full", 4);

    /**
     * Check if this permission includes another
     */
    fun includes(other: SandboxPermission): Boolean {
        return level >= other.level
    }

    companion object {
        /**
         * Get permission from string
         */
        fun fromString(value: String): SandboxPermission {
            return entries.find { it.name.equals(value, ignoreCase = true) } ?: NONE
        }
    }
}
