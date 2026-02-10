package com.chainlesschain.android.feature.enterprise.data.manager

import com.chainlesschain.android.feature.enterprise.data.engine.AuditLogger
import com.chainlesschain.android.feature.enterprise.data.engine.PermissionEngine
import com.chainlesschain.android.feature.enterprise.data.repository.RBACRepository
import com.chainlesschain.android.feature.enterprise.data.repository.TeamRepository
import com.chainlesschain.android.feature.enterprise.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manager for RBAC operations
 * Coordinates between repositories and permission engine
 */
@Singleton
class RBACManager @Inject constructor(
    private val rbacRepository: RBACRepository,
    private val teamRepository: TeamRepository,
    private val permissionEngine: PermissionEngine,
    private val auditLogger: AuditLogger
) {
    // ==================== Permission Checking ====================

    /**
     * Check if user has permission
     */
    suspend fun hasPermission(
        userId: String,
        permission: Permission,
        resourceType: String? = null,
        resourceId: String? = null
    ): Boolean {
        return permissionEngine.checkPermission(userId, permission, resourceType, resourceId).granted
    }

    /**
     * Check multiple permissions
     */
    suspend fun hasAllPermissions(
        userId: String,
        permissions: Set<Permission>,
        resourceType: String? = null,
        resourceId: String? = null
    ): Boolean {
        return permissions.all { permission ->
            hasPermission(userId, permission, resourceType, resourceId)
        }
    }

    /**
     * Check if user has any of the permissions
     */
    suspend fun hasAnyPermission(
        userId: String,
        permissions: Set<Permission>,
        resourceType: String? = null,
        resourceId: String? = null
    ): Boolean {
        return permissions.any { permission ->
            hasPermission(userId, permission, resourceType, resourceId)
        }
    }

    /**
     * Get all permissions for a user
     */
    suspend fun getUserPermissions(userId: String): Set<Permission> {
        val permissions = mutableSetOf<Permission>()

        // From roles
        val roleIds = rbacRepository.getUserRoles(userId)
        roleIds.forEach { roleId ->
            rbacRepository.getRoleById(roleId)?.permissions?.let {
                permissions.addAll(it)
            }
        }

        // From direct grants
        rbacRepository.getPermissionGrants(userId).first().forEach { grant ->
            permissions.add(grant.permission)
        }

        // From delegations
        rbacRepository.getActiveDelegations(userId).first().forEach { delegation ->
            permissions.addAll(delegation.permissions)
        }

        return permissions
    }

    // ==================== Role Management ====================

    fun getAllRoles(): Flow<List<Role>> = rbacRepository.getAllRoles()

    suspend fun createRole(
        name: String,
        description: String,
        permissions: Set<Permission>,
        creatorId: String
    ): Role {
        val role = Role(
            id = "",
            name = name,
            description = description,
            permissions = permissions,
            isSystem = false,
            level = 10, // Custom roles have lower priority
            createdBy = creatorId,
            createdAt = System.currentTimeMillis()
        )
        val created = rbacRepository.createRole(role)
        auditLogger.log(
            action = AuditAction.ROLE_CREATED,
            userId = creatorId,
            details = mapOf("roleId" to created.id, "roleName" to name)
        )
        return created
    }

    suspend fun updateRole(role: Role, updaterId: String): Boolean {
        val existingRole = rbacRepository.getRoleById(role.id) ?: return false
        if (existingRole.isSystem) return false // Cannot modify system roles

        val success = rbacRepository.updateRole(role)
        if (success) {
            auditLogger.log(
                action = AuditAction.ROLE_UPDATED,
                userId = updaterId,
                details = mapOf("roleId" to role.id, "roleName" to role.name)
            )
        }
        return success
    }

    suspend fun deleteRole(roleId: String, deleterId: String): Boolean {
        val success = rbacRepository.deleteRole(roleId)
        if (success) {
            auditLogger.log(
                action = AuditAction.ROLE_DELETED,
                userId = deleterId,
                details = mapOf("roleId" to roleId)
            )
        }
        return success
    }

    // ==================== Role Assignment ====================

    fun getUserRoles(userId: String): Flow<Set<Role>> = rbacRepository.getUserRolesFlow(userId)

    suspend fun assignRole(userId: String, roleId: String, assignerId: String): Boolean {
        val success = rbacRepository.assignRoleToUser(userId, roleId)
        if (success) {
            auditLogger.log(
                action = AuditAction.ROLE_ASSIGNED,
                userId = assignerId,
                targetUserId = userId,
                details = mapOf("roleId" to roleId)
            )
            permissionEngine.invalidateCache(userId)
        }
        return success
    }

    suspend fun removeRole(userId: String, roleId: String, removerId: String): Boolean {
        val success = rbacRepository.removeRoleFromUser(userId, roleId)
        if (success) {
            auditLogger.log(
                action = AuditAction.ROLE_REMOVED,
                userId = removerId,
                targetUserId = userId,
                details = mapOf("roleId" to roleId)
            )
            permissionEngine.invalidateCache(userId)
        }
        return success
    }

    // ==================== Direct Permission Grants ====================

    suspend fun grantPermission(
        userId: String,
        permission: Permission,
        resourceType: String,
        resourceId: String,
        granterId: String
    ): PermissionGrant {
        val grant = PermissionGrant(
            id = "",
            userId = userId,
            permission = permission,
            resourceType = resourceType,
            resourceId = resourceId,
            grantedBy = granterId,
            grantedAt = System.currentTimeMillis()
        )
        val created = rbacRepository.grantPermission(grant)
        auditLogger.log(
            action = AuditAction.PERMISSION_GRANTED,
            userId = granterId,
            targetUserId = userId,
            resourceType = resourceType,
            resourceId = resourceId,
            details = mapOf("permission" to permission.name)
        )
        permissionEngine.invalidateCache(userId)
        return created
    }

    suspend fun revokePermission(grantId: String, revokerId: String): Boolean {
        val success = rbacRepository.revokePermission(grantId)
        if (success) {
            auditLogger.log(
                action = AuditAction.PERMISSION_REVOKED,
                userId = revokerId,
                details = mapOf("grantId" to grantId)
            )
        }
        return success
    }

    // ==================== Permission Delegation ====================

    suspend fun delegatePermissions(
        delegatorId: String,
        delegateeId: String,
        permissions: Set<Permission>,
        resourceType: String? = null,
        resourceId: String? = null,
        expiresAt: Long? = null,
        reason: String? = null
    ): PermissionDelegation {
        val delegation = PermissionDelegation(
            id = "",
            delegatorId = delegatorId,
            delegateeId = delegateeId,
            permissions = permissions,
            resourceType = resourceType,
            resourceId = resourceId,
            reason = reason,
            createdAt = System.currentTimeMillis(),
            expiresAt = expiresAt
        )
        val created = rbacRepository.createDelegation(delegation)
        auditLogger.log(
            action = AuditAction.PERMISSION_DELEGATED,
            userId = delegatorId,
            targetUserId = delegateeId,
            resourceType = resourceType,
            resourceId = resourceId,
            details = mapOf(
                "permissions" to permissions.map { it.name },
                "expiresAt" to (expiresAt?.toString() ?: "never")
            )
        )
        permissionEngine.invalidateCache(delegateeId)
        return created
    }

    suspend fun revokeDelegation(delegationId: String, revokerId: String): Boolean {
        val success = rbacRepository.revokeDelegation(delegationId)
        if (success) {
            auditLogger.log(
                action = AuditAction.DELEGATION_REVOKED,
                userId = revokerId,
                details = mapOf("delegationId" to delegationId)
            )
        }
        return success
    }

    fun getActiveDelegations(userId: String): Flow<List<PermissionDelegation>> =
        rbacRepository.getActiveDelegations(userId)

    fun getDelegationsGrantedBy(userId: String): Flow<List<PermissionDelegation>> =
        rbacRepository.getDelegationsGrantedBy(userId)
}

/**
 * Audit actions for permission changes
 */
enum class AuditAction {
    PERMISSION_GRANTED,
    PERMISSION_REVOKED,
    PERMISSION_DELEGATED,
    DELEGATION_REVOKED,
    ROLE_ASSIGNED,
    ROLE_REMOVED,
    ROLE_CREATED,
    ROLE_UPDATED,
    ROLE_DELETED,
    TEAM_CREATED,
    TEAM_UPDATED,
    TEAM_DELETED,
    MEMBER_ADDED,
    MEMBER_REMOVED
}
