package com.chainlesschain.android.feature.enterprise.data.repository

import com.chainlesschain.android.feature.enterprise.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for RBAC data operations
 */
@Singleton
class RBACRepository @Inject constructor() {

    private val _roles = MutableStateFlow<Map<String, Role>>(emptyMap())
    private val _permissionGrants = MutableStateFlow<List<PermissionGrant>>(emptyList())
    private val _delegations = MutableStateFlow<List<PermissionDelegation>>(emptyList())
    private val _userRoles = MutableStateFlow<Map<String, Set<String>>>(emptyMap()) // userId -> roleIds

    init {
        // Initialize with default roles
        initializeDefaultRoles()
    }

    private fun initializeDefaultRoles() {
        val defaultRoles = listOf(
            Role(
                id = "owner",
                name = "Owner",
                description = "Full access to all resources",
                permissions = Permission.entries.toSet(),
                isSystem = true,
                level = 0
            ),
            Role(
                id = "admin",
                name = "Administrator",
                description = "Administrative access",
                permissions = Permission.entries.filter {
                    it != Permission.ORGANIZATION_DELETE && it != Permission.SYSTEM_SETTINGS
                }.toSet(),
                isSystem = true,
                level = 1
            ),
            Role(
                id = "manager",
                name = "Manager",
                description = "Team management access",
                permissions = setOf(
                    Permission.KNOWLEDGE_READ, Permission.KNOWLEDGE_WRITE, Permission.KNOWLEDGE_DELETE,
                    Permission.PROJECT_READ, Permission.PROJECT_WRITE,
                    Permission.TASK_READ, Permission.TASK_WRITE, Permission.TASK_ASSIGN,
                    Permission.TEAM_READ, Permission.TEAM_MANAGE_MEMBERS,
                    Permission.USER_READ
                ),
                isSystem = true,
                level = 2
            ),
            Role(
                id = "member",
                name = "Member",
                description = "Standard member access",
                permissions = setOf(
                    Permission.KNOWLEDGE_READ, Permission.KNOWLEDGE_WRITE,
                    Permission.PROJECT_READ,
                    Permission.TASK_READ, Permission.TASK_WRITE,
                    Permission.AI_CHAT, Permission.AI_ANALYZE,
                    Permission.SOCIAL_READ, Permission.SOCIAL_WRITE,
                    Permission.TEAM_READ, Permission.USER_READ
                ),
                isSystem = true,
                level = 3
            ),
            Role(
                id = "guest",
                name = "Guest",
                description = "Read-only access",
                permissions = setOf(
                    Permission.KNOWLEDGE_READ,
                    Permission.PROJECT_READ,
                    Permission.TASK_READ,
                    Permission.TEAM_READ
                ),
                isSystem = true,
                level = 4
            )
        )

        _roles.value = defaultRoles.associateBy { it.id }
    }

    // ==================== Roles ====================

    fun getAllRoles(): Flow<List<Role>> = _roles.map { it.values.toList() }

    fun getRoleById(roleId: String): Role? = _roles.value[roleId]

    suspend fun createRole(role: Role): Role {
        val newRole = role.copy(id = UUID.randomUUID().toString())
        _roles.value = _roles.value + (newRole.id to newRole)
        return newRole
    }

    suspend fun updateRole(role: Role): Boolean {
        if (!_roles.value.containsKey(role.id)) return false
        _roles.value = _roles.value + (role.id to role)
        return true
    }

    suspend fun deleteRole(roleId: String): Boolean {
        val role = _roles.value[roleId] ?: return false
        if (role.isSystem) return false // Cannot delete system roles
        _roles.value = _roles.value - roleId
        return true
    }

    // ==================== User Roles ====================

    fun getUserRoles(userId: String): Set<String> = _userRoles.value[userId] ?: emptySet()

    fun getUserRolesFlow(userId: String): Flow<Set<Role>> = _userRoles.map { userRoles ->
        val roleIds = userRoles[userId] ?: emptySet()
        roleIds.mapNotNull { _roles.value[it] }.toSet()
    }

    suspend fun assignRoleToUser(userId: String, roleId: String): Boolean {
        if (!_roles.value.containsKey(roleId)) return false
        val currentRoles = _userRoles.value[userId] ?: emptySet()
        _userRoles.value = _userRoles.value + (userId to (currentRoles + roleId))
        return true
    }

    suspend fun removeRoleFromUser(userId: String, roleId: String): Boolean {
        val currentRoles = _userRoles.value[userId] ?: return false
        if (roleId !in currentRoles) return false
        _userRoles.value = _userRoles.value + (userId to (currentRoles - roleId))
        return true
    }

    // ==================== Permission Grants ====================

    fun getPermissionGrants(userId: String): Flow<List<PermissionGrant>> =
        _permissionGrants.map { grants ->
            grants.filter { it.userId == userId }
        }

    fun getPermissionGrantsForResource(
        resourceType: String,
        resourceId: String
    ): Flow<List<PermissionGrant>> = _permissionGrants.map { grants ->
        grants.filter { it.resourceType == resourceType && it.resourceId == resourceId }
    }

    suspend fun grantPermission(grant: PermissionGrant): PermissionGrant {
        val newGrant = grant.copy(id = UUID.randomUUID().toString())
        _permissionGrants.value = _permissionGrants.value + newGrant
        return newGrant
    }

    suspend fun revokePermission(grantId: String): Boolean {
        val grant = _permissionGrants.value.find { it.id == grantId } ?: return false
        _permissionGrants.value = _permissionGrants.value - grant
        return true
    }

    suspend fun revokeAllPermissions(userId: String, resourceType: String, resourceId: String): Int {
        val toRemove = _permissionGrants.value.filter {
            it.userId == userId && it.resourceType == resourceType && it.resourceId == resourceId
        }
        _permissionGrants.value = _permissionGrants.value - toRemove.toSet()
        return toRemove.size
    }

    // ==================== Delegations ====================

    fun getActiveDelegations(userId: String): Flow<List<PermissionDelegation>> =
        _delegations.map { delegations ->
            val now = System.currentTimeMillis()
            delegations.filter {
                it.delegateeId == userId &&
                it.isActive &&
                (it.expiresAt == null || it.expiresAt > now)
            }
        }

    fun getDelegationsGrantedBy(userId: String): Flow<List<PermissionDelegation>> =
        _delegations.map { delegations ->
            delegations.filter { it.delegatorId == userId }
        }

    suspend fun createDelegation(delegation: PermissionDelegation): PermissionDelegation {
        val newDelegation = delegation.copy(id = UUID.randomUUID().toString())
        _delegations.value = _delegations.value + newDelegation
        return newDelegation
    }

    suspend fun revokeDelegation(delegationId: String): Boolean {
        val delegation = _delegations.value.find { it.id == delegationId } ?: return false
        val updated = delegation.copy(isActive = false, revokedAt = System.currentTimeMillis())
        _delegations.value = _delegations.value.map { if (it.id == delegationId) updated else it }
        return true
    }

    suspend fun cleanupExpiredDelegations(): Int {
        val now = System.currentTimeMillis()
        val expired = _delegations.value.filter {
            it.isActive && it.expiresAt != null && it.expiresAt < now
        }
        expired.forEach { revokeDelegation(it.id) }
        return expired.size
    }
}
