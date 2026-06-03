package com.chainlesschain.android.feature.collaboration.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.collaboration.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollaborationScreen(
    viewModel: CollaborationViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentSession by viewModel.currentSession.collectAsState()

    var showCreateDialog by remember { mutableStateOf(false) }
    var selectedTab by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Collaboration") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    SyncStatusIndicator(uiState.syncStatus)
                    IconButton(onClick = { showCreateDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "New Session")
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
            // Tabs
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("Sessions") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("History") }
                )
            }

            when {
                uiState.isLoading && uiState.sessions.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
                selectedTab == 0 -> {
                    val session = currentSession
                    if (session != null) {
                        ActiveSessionPanel(
                            session = session,
                            onLeave = { viewModel.leaveSession(session.id, session.hostUserId) },
                            onClose = { viewModel.closeSession(session.id) },
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        SessionListPanel(
                            sessions = uiState.sessions,
                            onJoinSession = { session ->
                                viewModel.joinSession(session.id, "current-user", "Current User")
                            },
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }
                selectedTab == 1 -> {
                    VersionHistoryPanel(
                        versions = uiState.versions,
                        onRestore = { viewModel.restoreVersion(it.versionId) },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    // Conflict Dialog
    if (uiState.hasConflict) {
        ConflictDialog(
            description = uiState.conflictDescription ?: "A conflict was detected",
            onResolve = { strategy ->
                viewModel.resolveConflict(strategy, "current-user")
            }
        )
    }

    if (showCreateDialog) {
        CreateSessionDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { documentId, documentType ->
                viewModel.createSession(documentId, documentType, "current-user", "Current User")
                showCreateDialog = false
            }
        )
    }

    uiState.message?.let {
        LaunchedEffect(it) { viewModel.clearMessage() }
    }
    uiState.error?.let {
        LaunchedEffect(it) { viewModel.clearError() }
    }
}

@Composable
private fun SyncStatusIndicator(status: SyncStatus) {
    val (color, icon) = when (status) {
        SyncStatus.SYNCED -> Color(0xFF4CAF50) to Icons.Default.CloudDone
        SyncStatus.SYNCING -> Color(0xFF2196F3) to Icons.Default.Sync
        SyncStatus.PENDING -> Color(0xFFFF9800) to Icons.Default.CloudQueue
        SyncStatus.CONFLICT -> Color(0xFFF44336) to Icons.Default.Warning
        SyncStatus.OFFLINE -> Color.Gray to Icons.Default.CloudOff
    }

    Icon(
        imageVector = icon,
        contentDescription = status.name,
        tint = color,
        modifier = Modifier.padding(horizontal = 8.dp)
    )
}

@Composable
private fun SessionListPanel(
    sessions: List<CollaborationSession>,
    onJoinSession: (CollaborationSession) -> Unit,
    modifier: Modifier = Modifier
) {
    if (sessions.isEmpty()) {
        Box(
            modifier = modifier,
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.Groups,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.outline
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text("No active sessions", color = MaterialTheme.colorScheme.outline)
            }
        }
    } else {
        LazyColumn(
            modifier = modifier,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(sessions, key = { it.id }) { session ->
                SessionCard(
                    session = session,
                    onJoin = { onJoinSession(session) }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionCard(
    session: CollaborationSession,
    onJoin: () -> Unit
) {
    Card(onClick = onJoin) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Document: ${session.documentId.take(8)}...",
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(onClick = {}, label = { Text(session.documentType.name) })
                    AssistChip(
                        onClick = {},
                        label = { Text("${session.participantCount} users") }
                    )
                }
                // Active users avatars
                Row(
                    modifier = Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy((-8).dp)
                ) {
                    session.activeUsers.take(5).forEach { user ->
                        UserAvatar(user = user)
                    }
                    if (session.activeUsers.size > 5) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Text(
                                "+${session.activeUsers.size - 5}",
                                style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.padding(4.dp)
                            )
                        }
                    }
                }
            }
            Button(onClick = onJoin) {
                Text("Join")
            }
        }
    }
}

@Composable
private fun UserAvatar(user: ActiveUser) {
    val color = try {
        Color(android.graphics.Color.parseColor(user.color))
    } catch (e: Exception) {
        MaterialTheme.colorScheme.primary
    }

    Surface(
        shape = MaterialTheme.shapes.small,
        color = color,
        modifier = Modifier.size(32.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                user.displayName.take(1).uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = Color.White
            )
        }
    }
}

@Composable
private fun ActiveSessionPanel(
    session: CollaborationSession,
    onLeave: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(16.dp)
    ) {
        // Session header
        Card(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Active Session", style = MaterialTheme.typography.titleLarge)
                        Text(
                            session.documentType.name,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }
                    Row {
                        OutlinedButton(onClick = onLeave) {
                            Text("Leave")
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        if (session.hostUserId == "current-user") {
                            Button(
                                onClick = onClose,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.error
                                )
                            ) {
                                Text("Close")
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Participants
        Text("Participants (${session.participantCount})", style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(8.dp))

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(session.activeUsers, key = { it.userId }) { user ->
                ParticipantItem(user = user, isHost = user.userId == session.hostUserId)
            }
        }
    }
}

@Composable
private fun ParticipantItem(
    user: ActiveUser,
    isHost: Boolean
) {
    val color = try {
        Color(android.graphics.Color.parseColor(user.color))
    } catch (e: Exception) {
        MaterialTheme.colorScheme.primary
    }

    Card {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Avatar
            Surface(
                shape = MaterialTheme.shapes.small,
                color = color,
                modifier = Modifier.size(40.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        user.displayName.take(1).uppercase(),
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White
                    )
                }
            }

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(user.displayName, style = MaterialTheme.typography.bodyLarge)
                    if (isHost) {
                        Spacer(modifier = Modifier.width(8.dp))
                        AssistChip(onClick = {}, label = { Text("Host") })
                    }
                }
                user.cursorPosition?.let {
                    Text(
                        "Line ${it.line}, Col ${it.column}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }

            // Editing indicator
            if (user.isEditing) {
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = Color(0xFF4CAF50).copy(alpha = 0.2f)
                ) {
                    Text(
                        "Editing",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF4CAF50),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun VersionHistoryPanel(
    versions: List<DocumentVersion>,
    onRestore: (DocumentVersion) -> Unit,
    modifier: Modifier = Modifier
) {
    if (versions.isEmpty()) {
        Box(
            modifier = modifier,
            contentAlignment = Alignment.Center
        ) {
            Text("No version history", color = MaterialTheme.colorScheme.outline)
        }
    } else {
        LazyColumn(
            modifier = modifier,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(versions, key = { it.versionId }) { version ->
                VersionItem(version = version, onRestore = { onRestore(version) })
            }
        }
    }
}

@Composable
private fun VersionItem(
    version: DocumentVersion,
    onRestore: () -> Unit
) {
    Card {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    version.message ?: "Version ${version.versionId.take(8)}",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "By ${version.authorName} • ${version.operations.size} changes",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
            TextButton(onClick = onRestore) {
                Text("Restore")
            }
        }
    }
}

@Composable
private fun ConflictDialog(
    description: String,
    onResolve: (ResolutionStrategy) -> Unit
) {
    AlertDialog(
        onDismissRequest = {},
        icon = { Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFF44336)) },
        title = { Text("Conflict Detected") },
        text = {
            Column {
                Text(description)
                Spacer(modifier = Modifier.height(16.dp))
                Text("How would you like to resolve this?", style = MaterialTheme.typography.labelMedium)
            }
        },
        confirmButton = {
            Column {
                TextButton(onClick = { onResolve(ResolutionStrategy.LOCAL_WINS) }) {
                    Text("Keep My Changes")
                }
                TextButton(onClick = { onResolve(ResolutionStrategy.REMOTE_WINS) }) {
                    Text("Use Remote Changes")
                }
                TextButton(onClick = { onResolve(ResolutionStrategy.MERGE) }) {
                    Text("Merge Both")
                }
            }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateSessionDialog(
    onDismiss: () -> Unit,
    onCreate: (String, DocumentType) -> Unit
) {
    var documentId by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(DocumentType.NOTE) }
    var expanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Session") },
        text = {
            Column {
                OutlinedTextField(
                    value = documentId,
                    onValueChange = { documentId = it },
                    label = { Text("Document ID") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedType.name,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Document Type") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        DocumentType.entries.forEach { type ->
                            DropdownMenuItem(
                                text = { Text(type.name) },
                                onClick = {
                                    selectedType = type
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(documentId, selectedType) },
                enabled = documentId.isNotBlank()
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
