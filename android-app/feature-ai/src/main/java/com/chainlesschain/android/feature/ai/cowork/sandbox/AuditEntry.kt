package com.chainlesschain.android.feature.ai.cowork.sandbox

import java.util.UUID

/**
 * Audit Entry
 *
 * Records a file access operation for audit purposes.
 */
data class AuditEntry(
    /**
     * Unique entry identifier
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * Agent ID that performed the operation
     */
    val agentId: String,

    /**
     * Operation type
     */
    val operation: AuditOperation,

    /**
     * File path
     */
    val filePath: String,

    /**
     * Whether the operation was allowed
     */
    val allowed: Boolean,

    /**
     * Reason if denied
     */
    val denialReason: String? = null,

    /**
     * Timestamp of the operation
     */
    val timestamp: Long = System.currentTimeMillis(),

    /**
     * Additional metadata
     */
    val metadata: Map<String, String> = emptyMap()
)

/**
 * Types of audited operations
 */
enum class AuditOperation(val displayName: String) {
    READ("Read"),
    WRITE("Write"),
    DELETE("Delete"),
    CREATE("Create"),
    EXECUTE("Execute"),
    LIST("List"),
    MOVE("Move"),
    COPY("Copy")
}
