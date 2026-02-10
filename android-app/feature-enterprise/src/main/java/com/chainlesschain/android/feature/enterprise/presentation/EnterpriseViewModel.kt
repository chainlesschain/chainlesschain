package com.chainlesschain.android.feature.enterprise.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.enterprise.data.engine.AuditLogger
import com.chainlesschain.android.feature.enterprise.data.manager.RBACManager
import com.chainlesschain.android.feature.enterprise.data.manager.TeamManager
import com.chainlesschain.android.feature.enterprise.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EnterpriseViewModel @Inject constructor(
    private val rbacManager: RBACManager,
    private val teamManager: TeamManager,
    private val auditLogger: AuditLogger
) : ViewModel() {

    // ==================== UI State ====================

    private val _uiState = MutableStateFlow(EnterpriseUiState())
    val uiState: StateFlow<EnterpriseUiState> = _uiState.asStateFlow()

    private val _selectedTab = MutableStateFlow(EnterpriseTab.ROLES)
    val selectedTab: StateFlow<EnterpriseTab> = _selectedTab.asStateFlow()

    // Current user ID (would come from auth in real app)
    private val currentUserId = "current-user"

    init {
        loadRoles()
        loadTeams()
        loadAuditLogs()
    }

    // ==================== Tab Selection ====================

    fun selectTab(tab: EnterpriseTab) {
        _selectedTab.value = tab
    }

    // ==================== Roles ====================

    private fun loadRoles() {
        viewModelScope.launch {
            rbacManager.getAllRoles().collect { roles ->
                _uiState.update { it.copy(roles = roles, isLoading = false) }
            }
        }
    }

    fun createRole(name: String, description: String, permissions: Set<Permission>) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                rbacManager.createRole(name, description, permissions, currentUserId)
                _uiState.update { it.copy(message = "Role created successfully") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun updateRole(role: Role) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val success = rbacManager.updateRole(role, currentUserId)
                if (success) {
                    _uiState.update { it.copy(message = "Role updated successfully") }
                } else {
                    _uiState.update { it.copy(error = "Failed to update role") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun deleteRole(roleId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val success = rbacManager.deleteRole(roleId, currentUserId)
                if (success) {
                    _uiState.update { it.copy(message = "Role deleted successfully") }
                } else {
                    _uiState.update { it.copy(error = "Cannot delete system role") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun selectRole(role: Role?) {
        _uiState.update { it.copy(selectedRole = role) }
    }

    // ==================== Teams ====================

    private fun loadTeams() {
        viewModelScope.launch {
            teamManager.getAllTeams().collect { teams ->
                _uiState.update { it.copy(teams = teams) }
            }
        }
    }

    fun createTeam(name: String, description: String?, parentTeamId: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                teamManager.createTeam(name, description, parentTeamId, currentUserId)
                _uiState.update { it.copy(message = "Team created successfully") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun updateTeam(team: Team) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val success = teamManager.updateTeam(team, currentUserId)
                if (success) {
                    _uiState.update { it.copy(message = "Team updated successfully") }
                } else {
                    _uiState.update { it.copy(error = "Failed to update team") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun deleteTeam(teamId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val success = teamManager.deleteTeam(teamId, currentUserId)
                if (success) {
                    _uiState.update { it.copy(message = "Team deleted successfully") }
                } else {
                    _uiState.update { it.copy(error = "Cannot delete team with children") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun selectTeam(team: Team?) {
        _uiState.update { it.copy(selectedTeam = team) }
        team?.let { loadTeamMembers(it.id) }
    }

    private fun loadTeamMembers(teamId: String) {
        viewModelScope.launch {
            teamManager.getTeamMembers(teamId).collect { members ->
                _uiState.update { it.copy(teamMembers = members) }
            }
        }
    }

    fun addTeamMember(teamId: String, userId: String, role: TeamRole = TeamRole.MEMBER) {
        viewModelScope.launch {
            try {
                val success = teamManager.addMember(teamId, userId, role, currentUserId)
                if (success) {
                    _uiState.update { it.copy(message = "Member added successfully") }
                } else {
                    _uiState.update { it.copy(error = "Failed to add member") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun removeTeamMember(teamId: String, userId: String) {
        viewModelScope.launch {
            try {
                val success = teamManager.removeMember(teamId, userId, currentUserId)
                if (success) {
                    _uiState.update { it.copy(message = "Member removed successfully") }
                } else {
                    _uiState.update { it.copy(error = "Cannot remove team lead") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Audit Logs ====================

    private fun loadAuditLogs() {
        viewModelScope.launch {
            auditLogger.getLogs().collect { logs ->
                _uiState.update { it.copy(auditLogs = logs) }
            }
        }
    }

    // ==================== Messages ====================

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

data class EnterpriseUiState(
    val isLoading: Boolean = true,
    val roles: List<Role> = emptyList(),
    val teams: List<Team> = emptyList(),
    val teamMembers: List<TeamMember> = emptyList(),
    val auditLogs: List<AuditLog> = emptyList(),
    val selectedRole: Role? = null,
    val selectedTeam: Team? = null,
    val message: String? = null,
    val error: String? = null
)

enum class EnterpriseTab {
    ROLES,
    TEAMS,
    PERMISSIONS,
    AUDIT
}

data class AuditLog(
    val id: String,
    val action: String,
    val userId: String,
    val targetUserId: String? = null,
    val resourceType: String? = null,
    val resourceId: String? = null,
    val details: Map<String, Any> = emptyMap(),
    val timestamp: Long = System.currentTimeMillis()
)
