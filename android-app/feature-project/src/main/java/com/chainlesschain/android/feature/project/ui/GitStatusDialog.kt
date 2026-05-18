package com.chainlesschain.android.feature.project.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.chainlesschain.android.feature.project.R
import androidx.compose.ui.window.DialogProperties
import com.chainlesschain.android.feature.project.git.FileChangeType
import com.chainlesschain.android.feature.project.git.GitFileStatus
import com.chainlesschain.android.feature.project.git.GitManager
import com.chainlesschain.android.feature.project.git.GitOperationState
import com.chainlesschain.android.feature.project.git.GitResult
import com.chainlesschain.android.feature.project.git.GitStatus
import kotlinx.coroutines.launch

/**
 * Git Status Dialog
 *
 * Shows current Git status with options to:
 * - View changed files (staged/unstaged)
 * - Stage/unstage files
 * - Create commits
 * - View diffs
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitStatusDialog(
    projectPath: String,
    gitManager: GitManager,
    onDismiss: () -> Unit,
    onViewHistory: () -> Unit
) {
    val status by gitManager.gitStatus.collectAsState()
    val operationState by gitManager.operationState.collectAsState()
    val scope = rememberCoroutineScope()

    var commitMessage by remember { mutableStateOf("") }
    var selectedFile by remember { mutableStateOf<GitFileStatus?>(null) }
    var showDiffDialog by remember { mutableStateOf(false) }
    var diffContent by remember { mutableStateOf("") }

    // Load status on mount
    LaunchedEffect(projectPath) {
        gitManager.refreshStatus(projectPath)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false
        )
    ) {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = stringResource(R.string.git_status),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                        status?.let {
                            Text(
                                text = stringResource(R.string.branch_label, it.branch),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    Row {
                        IconButton(onClick = {
                            scope.launch {
                                gitManager.refreshStatus(projectPath)
                            }
                        }) {
                            Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.refresh))
                        }

                        TextButton(onClick = onViewHistory) {
                            Text(stringResource(R.string.history))
                        }

                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.close))
                        }
                    }
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                // Loading indicator
                if (operationState is GitOperationState.Running) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = (operationState as GitOperationState.Running).message,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                // File sections
                status?.let { gitStatus ->
                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                    ) {
                        // Staged files
                        if (gitStatus.stagedFiles.isNotEmpty()) {
                            item {
                                SectionHeader(
                                    title = stringResource(R.string.staged_changes),
                                    count = gitStatus.stagedFiles.size,
                                    color = Color(0xFF4CAF50),
                                    onAction = {
                                        scope.launch {
                                            gitManager.unstageAll(projectPath)
                                        }
                                    },
                                    actionText = stringResource(R.string.unstage_all)
                                )
                            }

                            items(gitStatus.stagedFiles, key = { it.path }) { file ->
                                FileStatusItem(
                                    file = file,
                                    isStaged = true,
                                    onToggle = {
                                        scope.launch {
                                            gitManager.unstageFile(projectPath, file.path)
                                        }
                                    },
                                    onViewDiff = {
                                        selectedFile = file
                                        scope.launch {
                                            diffContent = gitManager.getFileDiff(projectPath, file.path, staged = true)
                                            showDiffDialog = true
                                        }
                                    }
                                )
                            }
                        }

                        // Unstaged files
                        if (gitStatus.unstagedFiles.isNotEmpty()) {
                            item {
                                SectionHeader(
                                    title = stringResource(R.string.unstaged_changes),
                                    count = gitStatus.unstagedFiles.size,
                                    color = Color(0xFFFF9800),
                                    onAction = {
                                        scope.launch {
                                            gitStatus.unstagedFiles.forEach { file ->
                                                gitManager.stageFile(projectPath, file.path)
                                            }
                                        }
                                    },
                                    actionText = stringResource(R.string.stage_all)
                                )
                            }

                            items(gitStatus.unstagedFiles, key = { it.path }) { file ->
                                FileStatusItem(
                                    file = file,
                                    isStaged = false,
                                    onToggle = {
                                        scope.launch {
                                            gitManager.stageFile(projectPath, file.path)
                                        }
                                    },
                                    onViewDiff = {
                                        selectedFile = file
                                        scope.launch {
                                            diffContent = gitManager.getFileDiff(projectPath, file.path, staged = false)
                                            showDiffDialog = true
                                        }
                                    },
                                    onDiscard = {
                                        scope.launch {
                                            gitManager.discardChanges(projectPath, file.path)
                                        }
                                    }
                                )
                            }
                        }

                        // Untracked files
                        if (gitStatus.untrackedFiles.isNotEmpty()) {
                            item {
                                SectionHeader(
                                    title = stringResource(R.string.untracked_files),
                                    count = gitStatus.untrackedFiles.size,
                                    color = Color(0xFF9E9E9E),
                                    onAction = {
                                        scope.launch {
                                            gitManager.stageAll(projectPath)
                                        }
                                    },
                                    actionText = stringResource(R.string.add_all)
                                )
                            }

                            items(gitStatus.untrackedFiles, key = { it.path }) { file ->
                                FileStatusItem(
                                    file = file,
                                    isStaged = false,
                                    onToggle = {
                                        scope.launch {
                                            gitManager.stageFile(projectPath, file.path)
                                        }
                                    },
                                    onViewDiff = null
                                )
                            }
                        }

                        // No changes message
                        if (!gitStatus.hasUncommittedChanges) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(32.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Icon(
                                            imageVector = Icons.Default.Check,
                                            contentDescription = null,
                                            modifier = Modifier.size(48.dp),
                                            tint = Color(0xFF4CAF50)
                                        )
                                        Spacer(modifier = Modifier.height(8.dp))
                                        Text(
                                            text = stringResource(R.string.working_tree_clean),
                                            style = MaterialTheme.typography.bodyLarge,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Commit section
                    if (gitStatus.stagedFiles.isNotEmpty()) {
                        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                        Text(
                            text = stringResource(R.string.commit_message),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        OutlinedTextField(
                            value = commitMessage,
                            onValueChange = { commitMessage = it },
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text(stringResource(R.string.enter_commit_message)) },
                            minLines = 2,
                            maxLines = 4
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Button(
                            onClick = {
                                scope.launch {
                                    val result = gitManager.commit(projectPath, commitMessage)
                                    if (result is GitResult.Success) {
                                        commitMessage = ""
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = commitMessage.isNotBlank() && operationState is GitOperationState.Idle
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(R.string.commit_files_count, gitStatus.stagedFiles.size))
                        }
                    }
                }
            }
        }
    }

    // Diff dialog
    if (showDiffDialog && selectedFile != null) {
        DiffDialog(
            fileName = selectedFile?.path ?: "",
            diffContent = diffContent,
            onDismiss = {
                showDiffDialog = false
                selectedFile = null
            }
        )
    }
}

@Composable
private fun SectionHeader(
    title: String,
    count: Int,
    color: Color,
    onAction: () -> Unit,
    actionText: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(color, RoundedCornerShape(4.dp))
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "$title ($count)",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium
            )
        }

        TextButton(onClick = onAction) {
            Text(actionText, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun FileStatusItem(
    file: GitFileStatus,
    isStaged: Boolean,
    onToggle: () -> Unit,
    onViewDiff: (() -> Unit)?,
    onDiscard: (() -> Unit)? = null
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status indicator
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .background(
                        getStatusColor(file),
                        RoundedCornerShape(4.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = file.statusIcon,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // File path
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.path.substringAfterLast('/'),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (file.path.contains('/')) {
                    Text(
                        text = file.path.substringBeforeLast('/'),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            // Actions
            if (onViewDiff != null) {
                IconButton(onClick = onViewDiff, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = stringResource(R.string.view_diff),
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            if (onDiscard != null && !isStaged) {
                IconButton(onClick = onDiscard, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = stringResource(R.string.discard_changes),
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.error
                    )
                }
            }

            // Stage/unstage checkbox
            Checkbox(
                checked = isStaged,
                onCheckedChange = { onToggle() }
            )
        }
    }
}

@Composable
private fun DiffDialog(
    fileName: String,
    diffContent: String,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = stringResource(R.string.diff_title, fileName.substringAfterLast('/')),
                style = MaterialTheme.typography.titleMedium
            )
        },
        text = {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(400.dp)
                    .background(
                        Color(0xFF1E1E1E),
                        RoundedCornerShape(8.dp)
                    )
                    .padding(8.dp)
            ) {
                items(diffContent.lines()) { line ->
                    val (bgColor, textColor) = when {
                        line.startsWith("+") && !line.startsWith("+++") ->
                            Color(0xFF2E4A2E) to Color(0xFF98C379)
                        line.startsWith("-") && !line.startsWith("---") ->
                            Color(0xFF4A2E2E) to Color(0xFFE06C75)
                        line.startsWith("@@") ->
                            Color(0xFF2E3A4A) to Color(0xFF61AFEF)
                        else ->
                            Color.Transparent to Color(0xFFABB2BF)
                    }

                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodySmall,
                        color = textColor,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(bgColor)
                            .padding(horizontal = 4.dp, vertical = 1.dp)
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.close))
            }
        }
    )
}

private fun getStatusColor(file: GitFileStatus): Color {
    return when {
        file.isNew -> Color(0xFF4CAF50)      // Green for new
        file.isDeleted -> Color(0xFFF44336)  // Red for deleted
        file.isModified -> Color(0xFFFF9800) // Orange for modified
        else -> Color(0xFF9E9E9E)            // Gray for other
    }
}
