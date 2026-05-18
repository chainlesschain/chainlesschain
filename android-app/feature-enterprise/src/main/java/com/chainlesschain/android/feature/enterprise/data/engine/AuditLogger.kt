package com.chainlesschain.android.feature.enterprise.data.engine

import com.chainlesschain.android.feature.enterprise.presentation.AuditLog
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Audit logger for permission and security events
 */
@Singleton
class AuditLogger @Inject constructor() {

    // In-memory storage (will be replaced with Room DAO)
    private val auditLogs = MutableStateFlow<List<AuditEvent>>(emptyList())

    /**
     * Log an audit event
     */
    suspend fun log(event: AuditEvent) {
        auditLogs.value = listOf(event) + auditLogs.value.take(9999) // Keep last 10000 events

        Timber.d("Audit: ${event.action} by ${event.actorId} on ${event.targetType}/${event.targetId}")
    }

    /**
     * Log an audit event with individual parameters
     */
    fun log(
        action: AuditAction,
        userId: String,
        targetUserId: String? = null,
        resourceType: String? = null,
        resourceId: String? = null,
        details: Map<String, Any> = emptyMap()
    ) {
        val event = AuditEvent(
            action = action,
            actorId = userId,
            targetType = resourceType ?: targetUserId?.let { "user" },
            targetId = resourceId ?: targetUserId,
            details = details.mapValues { it.value.toString() }
        )
        auditLogs.value = listOf(event) + auditLogs.value.take(9999)
        Timber.d("Audit: ${event.action} by ${event.actorId} on ${event.targetType}/${event.targetId}")
    }

    /**
     * Get all audit logs (alias for getAllLogs)
     */
    fun getLogs(): Flow<List<AuditLog>> = auditLogs.map { events ->
        events.map { event ->
            AuditLog(
                id = event.id,
                action = event.action.name,
                userId = event.actorId,
                targetUserId = if (event.targetType == "user") event.targetId else null,
                resourceType = event.targetType,
                resourceId = event.targetId,
                details = event.details,
                timestamp = event.timestamp
            )
        }
    }

    /**
     * Get all audit logs
     */
    fun getAllLogs(): Flow<List<AuditEvent>> = auditLogs

    /**
     * Get logs by actor
     */
    fun getLogsByActor(actorId: String): Flow<List<AuditEvent>> {
        return auditLogs.map { logs ->
            logs.filter { it.actorId == actorId }
        }
    }

    /**
     * Get logs by action
     */
    fun getLogsByAction(action: AuditAction): Flow<List<AuditEvent>> {
        return auditLogs.map { logs ->
            logs.filter { it.action == action }
        }
    }

    /**
     * Get logs by target
     */
    fun getLogsByTarget(targetType: String, targetId: String? = null): Flow<List<AuditEvent>> {
        return auditLogs.map { logs ->
            logs.filter { event ->
                event.targetType == targetType &&
                        (targetId == null || event.targetId == targetId)
            }
        }
    }

    /**
     * Get logs in time range
     */
    fun getLogsInRange(startTime: Long, endTime: Long): Flow<List<AuditEvent>> {
        return auditLogs.map { logs ->
            logs.filter { it.timestamp in startTime..endTime }
        }
    }

    /**
     * Search logs by details
     */
    fun searchLogs(query: String): Flow<List<AuditEvent>> {
        val lowerQuery = query.lowercase()
        return auditLogs.map { logs ->
            logs.filter { event ->
                event.action.name.lowercase().contains(lowerQuery) ||
                        event.actorId.lowercase().contains(lowerQuery) ||
                        event.targetType?.lowercase()?.contains(lowerQuery) == true ||
                        event.targetId?.lowercase()?.contains(lowerQuery) == true ||
                        event.details.any { (k, v) ->
                            k.lowercase().contains(lowerQuery) ||
                                    v.lowercase().contains(lowerQuery)
                        }
            }
        }
    }

    /**
     * Get security-related logs
     */
    fun getSecurityLogs(): Flow<List<AuditEvent>> {
        val securityActions = setOf(
            AuditAction.PERMISSION_GRANTED,
            AuditAction.PERMISSION_REVOKED,
            AuditAction.PERMISSION_DELEGATED,
            AuditAction.DELEGATION_REVOKED,
            AuditAction.ROLE_ASSIGNED,
            AuditAction.ROLE_REMOVED,
            AuditAction.LOGIN_SUCCESS,
            AuditAction.LOGIN_FAILED,
            AuditAction.LOGOUT,
            AuditAction.PASSWORD_CHANGED,
            AuditAction.MFA_ENABLED,
            AuditAction.MFA_DISABLED,
            AuditAction.API_KEY_CREATED,
            AuditAction.API_KEY_REVOKED
        )

        return auditLogs.map { logs ->
            logs.filter { it.action in securityActions }
        }
    }

    /**
     * Clear old logs
     */
    suspend fun clearOldLogs(olderThanMs: Long) {
        val cutoff = System.currentTimeMillis() - olderThanMs
        auditLogs.value = auditLogs.value.filter { it.timestamp >= cutoff }
    }

    /**
     * Get log count
     */
    fun getLogCount(): Int = auditLogs.value.size

    /**
     * Export logs to JSON
     */
    suspend fun exportLogs(
        startTime: Long? = null,
        endTime: Long? = null,
        actions: Set<AuditAction>? = null
    ): String {
        val filtered = auditLogs.value.filter { event ->
            (startTime == null || event.timestamp >= startTime) &&
                    (endTime == null || event.timestamp <= endTime) &&
                    (actions == null || event.action in actions)
        }

        return kotlinx.serialization.json.Json.encodeToString(
            kotlinx.serialization.builtins.ListSerializer(AuditEvent.serializer()),
            filtered
        )
    }
}

/**
 * Audit event
 */
@Serializable
data class AuditEvent(
    val id: String = java.util.UUID.randomUUID().toString(),
    val action: AuditAction,
    val actorId: String,
    val actorIp: String? = null,
    val actorUserAgent: String? = null,
    val targetType: String? = null,
    val targetId: String? = null,
    val details: Map<String, String> = emptyMap(),
    val success: Boolean = true,
    val errorMessage: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Audit action types
 */
@Serializable
enum class AuditAction {
    // Permission actions
    PERMISSION_GRANTED,
    PERMISSION_REVOKED,
    PERMISSION_DELEGATED,
    DELEGATION_REVOKED,
    PERMISSION_CHECK,
    PERMISSION_DENIED,

    // Role actions
    ROLE_CREATED,
    ROLE_UPDATED,
    ROLE_DELETED,
    ROLE_ASSIGNED,
    ROLE_REMOVED,

    // Team actions
    TEAM_CREATED,
    TEAM_UPDATED,
    TEAM_DELETED,
    TEAM_MEMBER_ADDED,
    TEAM_MEMBER_REMOVED,
    TEAM_LEAD_CHANGED,

    // User actions
    USER_CREATED,
    USER_UPDATED,
    USER_DELETED,
    USER_INVITED,
    USER_ACTIVATED,
    USER_DEACTIVATED,

    // Authentication
    LOGIN_SUCCESS,
    LOGIN_FAILED,
    LOGOUT,
    PASSWORD_CHANGED,
    PASSWORD_RESET_REQUESTED,
    MFA_ENABLED,
    MFA_DISABLED,

    // API & Integration
    API_KEY_CREATED,
    API_KEY_REVOKED,
    WEBHOOK_CREATED,
    WEBHOOK_DELETED,

    // Data access
    DATA_EXPORTED,
    DATA_IMPORTED,
    REPORT_GENERATED,
    SENSITIVE_DATA_ACCESSED,

    // Settings
    SETTINGS_CHANGED,
    BILLING_UPDATED,

    // Other
    CUSTOM
}
