package com.chainlesschain.android.feature.enterprise.data.manager

import com.chainlesschain.android.feature.enterprise.data.engine.AuditAction
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
 */
@Singleton
class RBACManager @Inject constructor(
    private val rbacRepository: RBACRepository,
    private val teamRepository: TeamRepository,
    private val permissionEngine: PermissionEngine,
    private val auditLogger: AuditLogger
) {
    // ==================== Permission Checking ====================

    suspend fun hasPermission(
        userId: String,
        permission: Permission,
        resourceType: String? = null,
        resourceId: String? = null
    ): Boolean {
        return permissionEngine.checkPermission(userId, permission, resourceType, resourceId).hasPermission
    }

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
            permissions.add(delegation.permission)
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
            isBuiltIn = false,
            priority = 10,
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
        if (existingRole.isBuiltIn) return false

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
        granteeId: String,
        granteeType: GranteeType,
        permission: Permission,
        resourceType: String?,
        resourceId: String?,
        granterId: String
    ): PermissionGrant {
        val grant = PermissionGrant(
            id = "",
            permission = permission,
            granteeType = granteeType,
            granteeId = granteeId,
            resourceType = resourceType,
            resourceId = resourceId,
            grantedBy = granterId,
            grantedAt = System.currentTimeMillis()
        )
        val created = rbacRepository.grantPermission(grant)
        auditLogger.log(
            action = AuditAction.PERMISSION_GRANTED,
            userId = granterId,
            targetUserId = granteeId,
            resourceType = resourceType,
            resourceId = resourceId,
            details = mapOf("permission" to permission.name)
        )
        permissionEngine.invalidateCache(granteeId)
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

    suspend fun delegatePermission(
        delegatorId: String,
        delegateeId: String,
        permission: Permission,
        resourceType: String? = null,
        resourceId: String? = null,
        expiresAt: Long,
        reason: String? = null
    ): PermissionDelegation {
        val delegation = PermissionDelegation(
            id = "",
            permission = permission,
            delegatorId = delegatorId,
            delegateeId = delegateeId,
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
            details = mapOf("permission" to permission.name, "expiresAt" to expiresAt.toString())
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
