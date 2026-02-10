package com.chainlesschain.android.feature.enterprise.data.engine

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.enterprise.domain.model.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Enterprise Permission Engine
 * 4-layer permission checking with caching
 * Based on iOS PermissionEngine implementation
 */
@Singleton
class PermissionEngine @Inject constructor(
    private val permissionCache: PermissionCache,
    private val auditLogger: AuditLogger
) {
    private val mutex = Mutex()

    // In-memory stores (will be replaced with Room DAOs)
    private val userRoles = MutableStateFlow<Map<String, List<Role>>>(emptyMap())
    private val permissionGrants = MutableStateFlow<List<PermissionGrant>>(emptyList())
    private val permissionDelegations = MutableStateFlow<List<PermissionDelegation>>(emptyList())
    private val teamMemberships = MutableStateFlow<Map<String, List<TeamMembership>>>(emptyMap())
    private val resourceInheritance = MutableStateFlow<Map<String, String>>(emptyMap()) // childId -> parentId

    /**
     * Check if user has permission
     * Follows 5-layer checking: Direct -> Role -> Team -> Inheritance -> Delegation
     */
    suspend fun checkPermission(
        userId: String,
        permission: Permission,
        resourceType: String? = null,
        resourceId: String? = null
    ): PermissionCheckResult {
        // Check cache first
        val cacheKey = permissionCache.generateKey(userId, permission, resourceType, resourceId)
        permissionCache.get(cacheKey)?.let { return it }

        Timber.d("Checking permission: $permission for user $userId")

        // Layer 1: Direct permission check
        checkDirectPermission(userId, permission, resourceType, resourceId)?.let { result ->
            permissionCache.put(cacheKey, result)
            return result
        }

        // Layer 2: Role permission check
        checkRolePermission(userId, permission)?.let { result ->
            permissionCache.put(cacheKey, result)
            return result
        }

        // Layer 3: Team permission check
        checkTeamPermission(userId, permission, resourceType, resourceId)?.let { result ->
            permissionCache.put(cacheKey, result)
            return result
        }

        // Layer 4: Inheritance permission check
        if (resourceType != null && resourceId != null) {
            checkInheritedPermission(userId, permission, resourceType, resourceId)?.let { result ->
                permissionCache.put(cacheKey, result)
                return result
            }
        }

        // Layer 5: Delegation permission check
        checkDelegatedPermission(userId, permission, resourceType, resourceId)?.let { result ->
            permissionCache.put(cacheKey, result)
            return result
        }

        // No permission found
        val result = PermissionCheckResult(hasPermission = false)
        permissionCache.put(cacheKey, result)
        return result
    }

    /**
     * Check multiple permissions (returns true if user has ANY of them)
     */
    suspend fun checkAnyPermission(
        userId: String,
        permissions: Set<Permission>,
        resourceType: String? = null,
        resourceId: String? = null
    ): Boolean {
        return permissions.any { permission ->
            checkPermission(userId, permission, resourceType, resourceId).hasPermission
        }
    }

    /**
     * Check multiple permissions (returns true if user has ALL of them)
     */
    suspend fun checkAllPermissions(
        userId: String,
        permissions: Set<Permission>,
        resourceType: String? = null,
        resourceId: String? = null
    ): Boolean {
        return permissions.all { permission ->
            checkPermission(userId, permission, resourceType, resourceId).hasPermission
        }
    }

    /**
     * Grant permission to user
     */
    suspend fun grantPermission(
        granteeId: String,
        granteeType: GranteeType,
        permission: Permission,
        resourceType: String? = null,
        resourceId: String? = null,
        grantedBy: String,
        expiresAt: Long? = null
    ): Result<PermissionGrant> = mutex.withLock {
        val grant = PermissionGrant(
            id = java.util.UUID.randomUUID().toString(),
            permission = permission,
            granteeType = granteeType,
            granteeId = granteeId,
            resourceType = resourceType,
            resourceId = resourceId,
            grantedBy = grantedBy,
            expiresAt = expiresAt
        )

        permissionGrants.value = permissionGrants.value + grant

        // Invalidate cache for this user
        if (granteeType == GranteeType.USER) {
            permissionCache.invalidateUser(granteeId)
        }

        // Log audit
        auditLogger.log(
            AuditEvent(
                action = AuditAction.PERMISSION_GRANTED,
                actorId = grantedBy,
                targetType = "permission",
                targetId = grant.id,
                details = mapOf(
                    "grantee" to granteeId,
                    "granteeType" to granteeType.name,
                    "permission" to permission.name,
                    "resourceType" to (resourceType ?: ""),
                    "resourceId" to (resourceId ?: "")
                )
            )
        )

        Timber.d("Permission granted: $permission to $granteeId")
        Result.success(grant)
    }

    /**
     * Revoke permission
     */
    suspend fun revokePermission(
        grantId: String,
        revokedBy: String
    ): Result<Unit> = mutex.withLock {
        val grant = permissionGrants.value.find { it.id == grantId }
            ?: return Result.error(
                IllegalArgumentException("Grant not found"),
                "Permission grant not found"
            )

        permissionGrants.value = permissionGrants.value.map {
            if (it.id == grantId) it.copy(isActive = false) else it
        }

        // Invalidate cache
        if (grant.granteeType == GranteeType.USER) {
            permissionCache.invalidateUser(grant.granteeId)
        }

        // Log audit
        auditLogger.log(
            AuditEvent(
                action = AuditAction.PERMISSION_REVOKED,
                actorId = revokedBy,
                targetType = "permission",
                targetId = grantId,
                details = mapOf(
                    "grantee" to grant.granteeId,
                    "permission" to grant.permission.name
                )
            )
        )

        Result.success(Unit)
    }

    /**
     * Delegate permission temporarily
     */
    suspend fun delegatePermission(
        delegatorId: String,
        delegateeId: String,
        permission: Permission,
        resourceType: String? = null,
        resourceId: String? = null,
        reason: String? = null,
        durationMs: Long
    ): Result<PermissionDelegation> = mutex.withLock {
        // Check if delegator has the permission
        val delegatorHasPermission = checkPermission(
            delegatorId, permission, resourceType, resourceId
        ).hasPermission

        if (!delegatorHasPermission) {
            return Result.error(
                SecurityException("Cannot delegate permission you don't have"),
                "You don't have this permission to delegate"
            )
        }

        val delegation = PermissionDelegation(
            id = java.util.UUID.randomUUID().toString(),
            permission = permission,
            delegatorId = delegatorId,
            delegateeId = delegateeId,
            resourceType = resourceType,
            resourceId = resourceId,
            reason = reason,
            expiresAt = System.currentTimeMillis() + durationMs
        )

        permissionDelegations.value = permissionDelegations.value + delegation

        // Invalidate cache
        permissionCache.invalidateUser(delegateeId)

        // Log audit
        auditLogger.log(
            AuditEvent(
                action = AuditAction.PERMISSION_DELEGATED,
                actorId = delegatorId,
                targetType = "delegation",
                targetId = delegation.id,
                details = mapOf(
                    "delegatee" to delegateeId,
                    "permission" to permission.name,
                    "expiresAt" to delegation.expiresAt.toString()
                )
            )
        )

        Result.success(delegation)
    }

    /**
     * Assign role to user
     */
    suspend fun assignRole(
        userId: String,
        role: Role,
        assignedBy: String
    ): Result<Unit> = mutex.withLock {
        val currentRoles = userRoles.value[userId] ?: emptyList()

        if (currentRoles.any { it.id == role.id }) {
            return Result.error(
                IllegalStateException("User already has this role"),
                "Role already assigned"
            )
        }

        userRoles.value = userRoles.value + (userId to (currentRoles + role))

        // Invalidate cache
        permissionCache.invalidateUser(userId)

        // Log audit
        auditLogger.log(
            AuditEvent(
                action = AuditAction.ROLE_ASSIGNED,
                actorId = assignedBy,
                targetType = "user",
                targetId = userId,
                details = mapOf("role" to role.name)
            )
        )

        Result.success(Unit)
    }

    /**
     * Remove role from user
     */
    suspend fun removeRole(
        userId: String,
        roleId: String,
        removedBy: String
    ): Result<Unit> = mutex.withLock {
        val currentRoles = userRoles.value[userId] ?: emptyList()
        val role = currentRoles.find { it.id == roleId }
            ?: return Result.error(
                IllegalArgumentException("Role not found"),
                "User doesn't have this role"
            )

        userRoles.value = userRoles.value + (userId to currentRoles.filter { it.id != roleId })

        // Invalidate cache
        permissionCache.invalidateUser(userId)

        // Log audit
        auditLogger.log(
            AuditEvent(
                action = AuditAction.ROLE_REMOVED,
                actorId = removedBy,
                targetType = "user",
                targetId = userId,
                details = mapOf("role" to role.name)
            )
        )

        Result.success(Unit)
    }

    /**
     * Invalidate permission cache for a user
     */
    fun invalidateCache(userId: String) {
        permissionCache.invalidateUser(userId)
    }

    /**
     * Get user's effective permissions
     */
    suspend fun getEffectivePermissions(userId: String): Set<Permission> {
        val permissions = mutableSetOf<Permission>()

        // From roles
        userRoles.value[userId]?.forEach { role ->
            permissions.addAll(role.permissions)
        }

        // From direct grants
        permissionGrants.value
            .filter { it.granteeType == GranteeType.USER && it.granteeId == userId && it.isValid }
            .forEach { permissions.add(it.permission) }

        // From team memberships
        teamMemberships.value[userId]?.forEach { membership ->
            permissionGrants.value
                .filter { it.granteeType == GranteeType.TEAM && it.granteeId == membership.teamId && it.isValid }
                .forEach { permissions.add(it.permission) }
        }

        // From delegations
        permissionDelegations.value
            .filter { it.delegateeId == userId && it.isActive }
            .forEach { permissions.add(it.permission) }

        return permissions
    }

    // ==================== Private Check Methods ====================

    private suspend fun checkDirectPermission(
        userId: String,
        permission: Permission,
        resourceType: String?,
        resourceId: String?
    ): PermissionCheckResult? {
        val grant = permissionGrants.value.find { grant ->
            grant.granteeType == GranteeType.USER &&
                    grant.granteeId == userId &&
                    grant.permission == permission &&
                    grant.isValid &&
                    (grant.resourceType == null || grant.resourceType == resourceType) &&
                    (grant.resourceId == null || grant.resourceId == resourceId)
        }

        return grant?.let {
            PermissionCheckResult(
                hasPermission = true,
                grantSource = GrantSource.DIRECT,
                grantId = it.id,
                expiresAt = it.expiresAt
            )
        }
    }

    private suspend fun checkRolePermission(
        userId: String,
        permission: Permission
    ): PermissionCheckResult? {
        val roles = userRoles.value[userId] ?: return null

        val roleWithPermission = roles.find { it.hasPermission(permission) }

        return roleWithPermission?.let {
            PermissionCheckResult(
                hasPermission = true,
                grantSource = GrantSource.ROLE,
                grantId = it.id
            )
        }
    }

    private suspend fun checkTeamPermission(
        userId: String,
        permission: Permission,
        resourceType: String?,
        resourceId: String?
    ): PermissionCheckResult? {
        val memberships = teamMemberships.value[userId] ?: return null

        for (membership in memberships) {
            val grant = permissionGrants.value.find { grant ->
                grant.granteeType == GranteeType.TEAM &&
                        grant.granteeId == membership.teamId &&
                        grant.permission == permission &&
                        grant.isValid &&
                        (grant.resourceType == null || grant.resourceType == resourceType) &&
                        (grant.resourceId == null || grant.resourceId == resourceId)
            }

            if (grant != null) {
                return PermissionCheckResult(
                    hasPermission = true,
                    grantSource = GrantSource.TEAM,
                    grantId = grant.id,
                    expiresAt = grant.expiresAt
                )
            }
        }

        return null
    }

    private suspend fun checkInheritedPermission(
        userId: String,
        permission: Permission,
        resourceType: String,
        resourceId: String
    ): PermissionCheckResult? {
        var currentResourceId = resourceId

        while (true) {
            val parentId = resourceInheritance.value[currentResourceId] ?: break

            val result = checkDirectPermission(userId, permission, resourceType, parentId)
                ?: checkTeamPermission(userId, permission, resourceType, parentId)

            if (result != null) {
                return result.copy(grantSource = GrantSource.INHERITANCE)
            }

            currentResourceId = parentId
        }

        return null
    }

    private suspend fun checkDelegatedPermission(
        userId: String,
        permission: Permission,
        resourceType: String?,
        resourceId: String?
    ): PermissionCheckResult? {
        val delegation = permissionDelegations.value.find { d ->
            d.delegateeId == userId &&
                    d.permission == permission &&
                    d.isActive &&
                    (d.resourceType == null || d.resourceType == resourceType) &&
                    (d.resourceId == null || d.resourceId == resourceId)
        }

        return delegation?.let {
            PermissionCheckResult(
                hasPermission = true,
                grantSource = GrantSource.DELEGATION,
                grantId = it.id,
                expiresAt = it.expiresAt
            )
        }
    }
}
