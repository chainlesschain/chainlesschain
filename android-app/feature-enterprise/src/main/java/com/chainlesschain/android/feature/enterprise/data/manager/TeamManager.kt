package com.chainlesschain.android.feature.enterprise.data.manager

import com.chainlesschain.android.feature.enterprise.data.engine.AuditAction
import com.chainlesschain.android.feature.enterprise.data.engine.AuditLogger
import com.chainlesschain.android.feature.enterprise.data.engine.PermissionEngine
import com.chainlesschain.android.feature.enterprise.data.repository.TeamRepository
import com.chainlesschain.android.feature.enterprise.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manager for team operations
 */
@Singleton
class TeamManager @Inject constructor(
    private val teamRepository: TeamRepository,
    private val permissionEngine: PermissionEngine,
    private val auditLogger: AuditLogger
) {
    // ==================== Team CRUD ====================

    fun getAllTeams(): Flow<List<Team>> = teamRepository.getAllTeams()

    fun getTeamById(teamId: String): Team? = teamRepository.getTeamById(teamId)

    fun getTeamWithMembers(teamId: String): Flow<TeamWithMembers?> = teamRepository.getTeamWithMembers(teamId)

    fun getRootTeams(): Flow<List<Team>> = teamRepository.getTeamsByParent(null)

    fun getChildTeams(teamId: String): Flow<List<Team>> = teamRepository.getChildTeams(teamId)

    fun getTeamHierarchy(teamId: String): List<Team> = teamRepository.getTeamHierarchy(teamId)

    suspend fun createTeam(
        name: String,
        description: String?,
        parentTeamId: String? = null,
        creatorId: String
    ): Team {
        val team = Team(
            id = "",
            name = name,
            description = description,
            parentTeamId = parentTeamId,
            leaderId = creatorId,
            createdBy = creatorId,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
        val created = teamRepository.createTeam(team)

        // Add creator as lead member
        teamRepository.addTeamMember(created.id, TeamMember(
            id = "",
            teamId = created.id,
            userId = creatorId,
            role = TeamRole.LEAD,
            joinedAt = System.currentTimeMillis(),
            invitedBy = creatorId
        ))

        auditLogger.log(
            action = AuditAction.TEAM_CREATED,
            userId = creatorId,
            details = mapOf("teamId" to created.id, "teamName" to name)
        )

        return created
    }

    suspend fun updateTeam(team: Team, updaterId: String): Boolean {
        val success = teamRepository.updateTeam(team)
        if (success) {
            auditLogger.log(
                action = AuditAction.TEAM_UPDATED,
                userId = updaterId,
                details = mapOf("teamId" to team.id, "teamName" to team.name)
            )
        }
        return success
    }

    suspend fun deleteTeam(teamId: String, deleterId: String): Boolean {
        val team = teamRepository.getTeamById(teamId) ?: return false

        val children = teamRepository.getChildTeams(teamId).first()
        if (children.isNotEmpty()) return false

        val success = teamRepository.deleteTeam(teamId)
        if (success) {
            auditLogger.log(
                action = AuditAction.TEAM_DELETED,
                userId = deleterId,
                details = mapOf("teamId" to teamId, "teamName" to team.name)
            )
        }
        return success
    }

    // ==================== Team Members ====================

    fun getTeamMembers(teamId: String): Flow<List<TeamMember>> =
        teamRepository.getTeamMembers(teamId)

    fun getUserTeams(userId: String): Flow<List<Team>> =
        teamRepository.getUserTeams(userId)

    fun getMemberCount(teamId: String): Int = teamRepository.getMemberCount(teamId)

    suspend fun addMember(
        teamId: String,
        userId: String,
        role: TeamRole = TeamRole.MEMBER,
        addedBy: String
    ): Boolean {
        val member = TeamMember(
            id = "",
            teamId = teamId,
            userId = userId,
            role = role,
            joinedAt = System.currentTimeMillis(),
            invitedBy = addedBy
        )
        val success = teamRepository.addTeamMember(teamId, member)
        if (success) {
            auditLogger.log(
                action = AuditAction.TEAM_MEMBER_ADDED,
                userId = addedBy,
                targetUserId = userId,
                details = mapOf("teamId" to teamId, "role" to role.name)
            )
            permissionEngine.invalidateCache(userId)
        }
        return success
    }

    suspend fun removeMember(teamId: String, userId: String, removedBy: String): Boolean {
        val team = teamRepository.getTeamById(teamId) ?: return false

        if (team.leaderId == userId) return false

        val success = teamRepository.removeTeamMember(teamId, userId)
        if (success) {
            auditLogger.log(
                action = AuditAction.TEAM_MEMBER_REMOVED,
                userId = removedBy,
                targetUserId = userId,
                details = mapOf("teamId" to teamId)
            )
            permissionEngine.invalidateCache(userId)
        }
        return success
    }

    suspend fun updateMemberRole(
        teamId: String,
        userId: String,
        newRole: TeamRole,
        updatedBy: String
    ): Boolean {
        val success = teamRepository.updateTeamMemberRole(teamId, userId, newRole)
        if (success) {
            auditLogger.log(
                action = AuditAction.TEAM_MEMBER_REMOVED,
                userId = updatedBy,
                targetUserId = userId,
                details = mapOf("teamId" to teamId, "newRole" to newRole.name)
            )
            permissionEngine.invalidateCache(userId)
        }
        return success
    }

    suspend fun setTeamLead(teamId: String, userId: String, setBy: String): Boolean {
        val success = teamRepository.setTeamLead(teamId, userId)
        if (success) {
            auditLogger.log(
                action = AuditAction.TEAM_LEAD_CHANGED,
                userId = setBy,
                details = mapOf("teamId" to teamId, "newLeaderId" to userId)
            )
        }
        return success
    }

    // ==================== Search ====================

    fun searchTeams(query: String): Flow<List<Team>> = teamRepository.searchTeams(query)

    // ==================== Team Permissions ====================

    suspend fun hasTeamPermission(
        userId: String,
        teamId: String,
        permission: Permission
    ): Boolean {
        return permissionEngine.checkPermission(
            userId = userId,
            permission = permission,
            resourceType = "team",
            resourceId = teamId
        ).hasPermission
    }

    fun isTeamMember(teamId: String, userId: String): Boolean {
        return teamRepository.getTeamMember(teamId, userId) != null
    }

    fun isTeamLead(teamId: String, userId: String): Boolean {
        val member = teamRepository.getTeamMember(teamId, userId)
        return member?.role == TeamRole.LEAD
    }

    fun getUserRoleInTeam(teamId: String, userId: String): TeamRole? {
        return teamRepository.getTeamMember(teamId, userId)?.role
    }
}
