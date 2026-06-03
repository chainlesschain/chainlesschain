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
        initializeDefaultRoles()
    }

    private fun initializeDefaultRoles() {
        val defaultRoles = Role.builtInRoles.associateBy { it.id }
        _roles.value = defaultRoles
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
        if (role.isBuiltIn) return false // Cannot delete built-in roles
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

    fun getPermissionGrants(granteeId: String): Flow<List<PermissionGrant>> =
        _permissionGrants.map { grants ->
            grants.filter { it.granteeId == granteeId && it.isValid }
        }

    fun getPermissionGrantsForResource(
        resourceType: String,
        resourceId: String
    ): Flow<List<PermissionGrant>> = _permissionGrants.map { grants ->
        grants.filter { it.resourceType == resourceType && it.resourceId == resourceId && it.isValid }
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

    // ==================== Delegations ====================

    fun getActiveDelegations(delegateeId: String): Flow<List<PermissionDelegation>> =
        _delegations.map { delegations ->
            delegations.filter { it.delegateeId == delegateeId && it.isActive }
        }

    fun getDelegationsGrantedBy(delegatorId: String): Flow<List<PermissionDelegation>> =
        _delegations.map { delegations ->
            delegations.filter { it.delegatorId == delegatorId }
        }

    suspend fun createDelegation(delegation: PermissionDelegation): PermissionDelegation {
        val newDelegation = delegation.copy(id = UUID.randomUUID().toString())
        _delegations.value = _delegations.value + newDelegation
        return newDelegation
    }

    suspend fun revokeDelegation(delegationId: String): Boolean {
        val delegation = _delegations.value.find { it.id == delegationId } ?: return false
        val updated = delegation.copy(isRevoked = true, revokedAt = System.currentTimeMillis())
        _delegations.value = _delegations.value.map { if (it.id == delegationId) updated else it }
        return true
    }
}
