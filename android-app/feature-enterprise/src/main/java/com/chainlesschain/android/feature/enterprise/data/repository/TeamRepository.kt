package com.chainlesschain.android.feature.enterprise.data.repository

import com.chainlesschain.android.feature.enterprise.domain.model.Team
import com.chainlesschain.android.feature.enterprise.domain.model.TeamMember
import com.chainlesschain.android.feature.enterprise.domain.model.TeamRole
import com.chainlesschain.android.feature.enterprise.domain.model.TeamWithMembers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for team data operations
 */
@Singleton
class TeamRepository @Inject constructor() {

    private val _teams = MutableStateFlow<Map<String, Team>>(emptyMap())
    private val _teamMembers = MutableStateFlow<Map<String, List<TeamMember>>>(emptyMap()) // teamId -> members

    // ==================== Teams ====================

    fun getAllTeams(): Flow<List<Team>> = _teams.map { it.values.toList() }

    fun getTeamById(teamId: String): Team? = _teams.value[teamId]

    fun getTeamWithMembers(teamId: String): Flow<TeamWithMembers?> = combine(_teams, _teamMembers) { teams, members ->
        teams[teamId]?.let { team ->
            val teamMembers = members[teamId] ?: emptyList()
            val childTeams = teams.values.filter { it.parentTeamId == teamId }
            TeamWithMembers(team, teamMembers, childTeams)
        }
    }

    fun getTeamsByParent(parentId: String?): Flow<List<Team>> = _teams.map { teams ->
        teams.values.filter { it.parentTeamId == parentId }
    }

    fun getTeamHierarchy(teamId: String): List<Team> {
        val result = mutableListOf<Team>()
        var currentTeam = _teams.value[teamId]
        while (currentTeam != null) {
            result.add(currentTeam)
            currentTeam = currentTeam.parentTeamId?.let { _teams.value[it] }
        }
        return result.reversed()
    }

    fun getChildTeams(teamId: String): Flow<List<Team>> = _teams.map { teams ->
        teams.values.filter { it.parentTeamId == teamId }
    }

    suspend fun createTeam(team: Team): Team {
        val newTeam = team.copy(
            id = UUID.randomUUID().toString(),
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
        _teams.value = _teams.value + (newTeam.id to newTeam)
        return newTeam
    }

    suspend fun updateTeam(team: Team): Boolean {
        if (!_teams.value.containsKey(team.id)) return false
        val updated = team.copy(updatedAt = System.currentTimeMillis())
        _teams.value = _teams.value + (team.id to updated)
        return true
    }

    suspend fun deleteTeam(teamId: String): Boolean {
        if (!_teams.value.containsKey(teamId)) return false
        // Check for child teams
        val hasChildren = _teams.value.values.any { it.parentTeamId == teamId }
        if (hasChildren) return false // Cannot delete team with children

        _teams.value = _teams.value - teamId
        _teamMembers.value = _teamMembers.value - teamId
        return true
    }

    // ==================== Team Members ====================

    fun getTeamMembers(teamId: String): Flow<List<TeamMember>> = _teamMembers.map { members ->
        members[teamId] ?: emptyList()
    }

    fun getUserTeams(userId: String): Flow<List<Team>> = _teamMembers.map { allMembers ->
        val teamIds = allMembers.filter { (_, members) ->
            members.any { it.userId == userId && it.isActive }
        }.keys
        teamIds.mapNotNull { _teams.value[it] }
    }

    fun getTeamMember(teamId: String, userId: String): TeamMember? {
        return _teamMembers.value[teamId]?.find { it.userId == userId }
    }

    fun getMemberCount(teamId: String): Int {
        return _teamMembers.value[teamId]?.count { it.isActive } ?: 0
    }

    suspend fun addTeamMember(teamId: String, member: TeamMember): Boolean {
        if (!_teams.value.containsKey(teamId)) return false

        val currentMembers = _teamMembers.value[teamId] ?: emptyList()
        if (currentMembers.any { it.userId == member.userId }) return false // Already a member

        val newMember = member.copy(
            id = UUID.randomUUID().toString(),
            teamId = teamId,
            joinedAt = System.currentTimeMillis()
        )
        _teamMembers.value = _teamMembers.value + (teamId to (currentMembers + newMember))
        return true
    }

    suspend fun removeTeamMember(teamId: String, userId: String): Boolean {
        val currentMembers = _teamMembers.value[teamId] ?: return false
        val member = currentMembers.find { it.userId == userId } ?: return false

        _teamMembers.value = _teamMembers.value + (teamId to (currentMembers - member))
        return true
    }

    suspend fun updateTeamMemberRole(teamId: String, userId: String, role: TeamRole): Boolean {
        val currentMembers = _teamMembers.value[teamId] ?: return false
        val memberIndex = currentMembers.indexOfFirst { it.userId == userId }
        if (memberIndex == -1) return false

        val updatedMember = currentMembers[memberIndex].copy(role = role)
        val updatedMembers = currentMembers.toMutableList()
        updatedMembers[memberIndex] = updatedMember

        _teamMembers.value = _teamMembers.value + (teamId to updatedMembers)
        return true
    }

    suspend fun setTeamLead(teamId: String, userId: String): Boolean {
        val team = _teams.value[teamId] ?: return false
        getTeamMember(teamId, userId) ?: return false

        // Remove lead role from previous lead
        _teamMembers.value[teamId]?.forEach { m ->
            if (m.role == TeamRole.LEAD && m.userId != userId) {
                updateTeamMemberRole(teamId, m.userId, TeamRole.MEMBER)
            }
        }

        // Set new lead
        updateTeamMemberRole(teamId, userId, TeamRole.LEAD)
        _teams.value = _teams.value + (teamId to team.copy(
            leaderId = userId,
            updatedAt = System.currentTimeMillis()
        ))

        return true
    }

    // ==================== Search ====================

    fun searchTeams(query: String): Flow<List<Team>> = _teams.map { teams ->
        if (query.isBlank()) {
            teams.values.toList()
        } else {
            teams.values.filter { team ->
                team.name.contains(query, ignoreCase = true) ||
                team.description?.contains(query, ignoreCase = true) == true
            }
        }
    }
}
