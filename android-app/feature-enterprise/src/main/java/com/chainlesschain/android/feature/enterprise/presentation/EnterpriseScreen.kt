package com.chainlesschain.android.feature.enterprise.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.enterprise.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnterpriseScreen(
    viewModel: EnterpriseViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val selectedTab by viewModel.selectedTab.collectAsState()

    var showCreateRoleDialog by remember { mutableStateOf(false) }
    var showCreateTeamDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Enterprise Management") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    when (selectedTab) {
                        EnterpriseTab.ROLES -> {
                            IconButton(onClick = { showCreateRoleDialog = true }) {
                                Icon(Icons.Default.Add, contentDescription = "Add Role")
                            }
                        }
                        EnterpriseTab.TEAMS -> {
                            IconButton(onClick = { showCreateTeamDialog = true }) {
                                Icon(Icons.Default.Add, contentDescription = "Add Team")
                            }
                        }
                        else -> {}
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Tab Row
            TabRow(selectedTabIndex = selectedTab.ordinal) {
                EnterpriseTab.entries.forEach { tab ->
                    Tab(
                        selected = selectedTab == tab,
                        onClick = { viewModel.selectTab(tab) },
                        text = { Text(tab.name.lowercase().replaceFirstChar { it.uppercase() }) },
                        icon = {
                            Icon(
                                imageVector = when (tab) {
                                    EnterpriseTab.ROLES -> Icons.Default.Shield
                                    EnterpriseTab.TEAMS -> Icons.Default.Group
                                    EnterpriseTab.PERMISSIONS -> Icons.Default.Lock
                                    EnterpriseTab.AUDIT -> Icons.Default.History
                                },
                                contentDescription = null
                            )
                        }
                    )
                }
            }

            // Content
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                else -> {
                    when (selectedTab) {
                        EnterpriseTab.ROLES -> RolesTab(
                            roles = uiState.roles,
                            selectedRole = uiState.selectedRole,
                            onSelectRole = viewModel::selectRole,
                            onDeleteRole = viewModel::deleteRole
                        )
                        EnterpriseTab.TEAMS -> TeamsTab(
                            teams = uiState.teams,
                            selectedTeam = uiState.selectedTeam,
                            teamMembers = uiState.teamMembers,
                            onSelectTeam = viewModel::selectTeam,
                            onDeleteTeam = viewModel::deleteTeam,
                            onRemoveMember = viewModel::removeTeamMember
                        )
                        EnterpriseTab.PERMISSIONS -> PermissionsTab()
                        EnterpriseTab.AUDIT -> AuditTab(logs = uiState.auditLogs)
                    }
                }
            }
        }
    }

    // Dialogs
    if (showCreateRoleDialog) {
        CreateRoleDialog(
            onDismiss = { showCreateRoleDialog = false },
            onCreate = { name, description, permissions ->
                viewModel.createRole(name, description, permissions)
                showCreateRoleDialog = false
            }
        )
    }

    if (showCreateTeamDialog) {
        CreateTeamDialog(
            onDismiss = { showCreateTeamDialog = false },
            onCreate = { name, description ->
                viewModel.createTeam(name, description)
                showCreateTeamDialog = false
            }
        )
    }

    // Snackbars
    uiState.message?.let { message ->
        LaunchedEffect(message) {
            viewModel.clearMessage()
        }
    }

    uiState.error?.let { error ->
        LaunchedEffect(error) {
            viewModel.clearError()
        }
    }
}

@Composable
private fun RolesTab(
    roles: List<Role>,
    selectedRole: Role?,
    onSelectRole: (Role?) -> Unit,
    onDeleteRole: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(roles) { role ->
            RoleCard(
                role = role,
                isSelected = role == selectedRole,
                onSelect = { onSelectRole(role) },
                onDelete = { onDeleteRole(role.id) }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RoleCard(
    role: Role,
    isSelected: Boolean,
    onSelect: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = role.name,
                        style = MaterialTheme.typography.titleMedium
                    )
                    if (role.isSystem) {
                        Spacer(modifier = Modifier.width(8.dp))
                        AssistChip(
                            onClick = {},
                            label = { Text("System") },
                            modifier = Modifier.height(24.dp)
                        )
                    }
                }
                Text(
                    text = role.description ?: "",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "${role.permissions.size} permissions",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            if (!role.isSystem) {
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Delete",
                        tint = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
    }
}

@Composable
private fun TeamsTab(
    teams: List<Team>,
    selectedTeam: Team?,
    teamMembers: List<TeamMember>,
    onSelectTeam: (Team?) -> Unit,
    onDeleteTeam: (String) -> Unit,
    onRemoveMember: (String, String) -> Unit
) {
    Row(modifier = Modifier.fillMaxSize()) {
        // Teams list
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(teams) { team ->
                TeamCard(
                    team = team,
                    isSelected = team == selectedTeam,
                    onSelect = { onSelectTeam(team) },
                    onDelete = { onDeleteTeam(team.id) }
                )
            }
        }

        // Team details
        selectedTeam?.let { team ->
            VerticalDivider()
            TeamDetailPanel(
                team = team,
                members = teamMembers,
                onRemoveMember = { userId -> onRemoveMember(team.id, userId) }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TeamCard(
    team: Team,
    isSelected: Boolean,
    onSelect: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = team.name,
                    style = MaterialTheme.typography.titleMedium
                )
                team.description?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    text = "${team.memberCount} members",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Delete",
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
private fun TeamDetailPanel(
    team: Team,
    members: List<TeamMember>,
    onRemoveMember: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .width(300.dp)
            .fillMaxHeight()
            .padding(16.dp)
    ) {
        Text(
            text = team.name,
            style = MaterialTheme.typography.headlineSmall
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Members",
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(modifier = Modifier.height(8.dp))
        LazyColumn {
            items(members) { member ->
                ListItem(
                    headlineContent = { Text(member.userId) },
                    supportingContent = { Text(member.role.name) },
                    trailingContent = {
                        if (member.role != TeamRole.LEAD) {
                            IconButton(onClick = { onRemoveMember(member.userId) }) {
                                Icon(Icons.Default.RemoveCircle, contentDescription = "Remove")
                            }
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun PermissionsTab() {
    val permissionCategories = Permission.entries.groupBy { permission ->
        permission.name.split("_").first()
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        permissionCategories.forEach { (category, permissions) ->
            item {
                Text(
                    text = category,
                    style = MaterialTheme.typography.titleMedium
                )
            }
            items(permissions) { permission ->
                ListItem(
                    headlineContent = { Text(permission.name) },
                    leadingContent = {
                        Icon(Icons.Default.Security, contentDescription = null)
                    }
                )
            }
        }
    }
}

@Composable
private fun AuditTab(logs: List<AuditLog>) {
    if (logs.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text("No audit logs")
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(logs) { log ->
                AuditLogCard(log)
            }
        }
    }
}

@Composable
private fun AuditLogCard(log: AuditLog) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = log.action,
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = formatTimestamp(log.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            Text(
                text = "By: ${log.userId}",
                style = MaterialTheme.typography.bodyMedium
            )
            log.targetUserId?.let {
                Text(
                    text = "Target: $it",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun CreateRoleDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String, Set<Permission>) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    val selectedPermissions = remember { mutableStateListOf<Permission>() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Role") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Role Name") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name, description, selectedPermissions.toSet()) },
                enabled = name.isNotBlank()
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun CreateTeamDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String?) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Team") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Team Name") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name, description.ifBlank { null }) },
                enabled = name.isNotBlank()
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

private fun formatTimestamp(timestamp: Long): String {
    val sdf = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.getDefault())
    return sdf.format(java.util.Date(timestamp))
}
