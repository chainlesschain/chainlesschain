package com.chainlesschain.android.core.common.memory

/**
 * Memory Pressure Level
 *
 * Defines the levels of memory pressure for cleanup operations.
 */
enum class MemoryPressureLevel(
    val priority: Int,
    val displayName: String
) {
    /**
     * Normal operation - no memory pressure
     */
    NORMAL(0, "Normal"),

    /**
     * Moderate pressure - consider releasing some resources
     */
    MODERATE(1, "Moderate"),

    /**
     * Warning level - release non-essential resources
     */
    WARNING(2, "Warning"),

    /**
     * Critical level - release all possible resources
     */
    CRITICAL(3, "Critical");

    companion object {
        /**
         * Get pressure level from ComponentCallbacks2 level
         */
        fun fromTrimLevel(level: Int): MemoryPressureLevel {
            return when {
                level >= android.content.ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> CRITICAL
                level >= android.content.ComponentCallbacks2.TRIM_MEMORY_MODERATE -> WARNING
                level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> MODERATE
                else -> NORMAL
            }
        }
    }
}
