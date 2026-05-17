package com.chainlesschain.android.remote.ui.project

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.RemoteProjectFileFull
import kotlinx.coroutines.launch

/**
 * Sub-phase 7.5 (2026-05-17): 远程项目文件 CRUD 屏 — 全 RPC，无本地 Room 依赖。
 *
 * 区别于 ProjectFilesScreen (本地 Room mirror)：本屏适合 FROM_PC 项目，因为
 * Sub-phase 10 拉项目仅 metadata，没下文件内容。所有读写直接打 PC SQLite。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteProjectFilesScreen(
    projectId: String,
    projectName: String,
    onNavigateBack: () -> Unit,
    viewModel: RemoteProjectFilesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val scope = rememberCoroutineScope()

    var showAddMenu by remember { mutableStateOf(false) }
    var showCreateFileDialog by remember { mutableStateOf(false) }
    var showCreateFolderDialog by remember { mutableStateOf(false) }
    var editingFile by remember { mutableStateOf<RemoteProjectFileFull?>(null) }
    var editingContent by remember { mutableStateOf("") }

    LaunchedEffect(projectId) { viewModel.load(projectId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(projectName, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = "远程文件",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { showAddMenu = true }) {
                            Icon(Icons.Default.Add, contentDescription = "新建")
                        }
                        DropdownMenu(
                            expanded = showAddMenu,
                            onDismissRequest = { showAddMenu = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("新建文件") },
                                leadingIcon = { Icon(Icons.Default.NoteAdd, null) },
                                onClick = {
                                    showAddMenu = false
                                    showCreateFileDialog = true
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("新建文件夹") },
                                leadingIcon = { Icon(Icons.Default.CreateNewFolder, null) },
                                onClick = {
                                    showAddMenu = false
                                    showCreateFolderDialog = true
                                },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        when (val s = state) {
            RemoteProjectFilesViewModel.State.Idle,
            RemoteProjectFilesViewModel.State.Loading -> LoadingBox(padding)
            is RemoteProjectFilesViewModel.State.Error -> ErrorBox(padding, s.message) {
                viewModel.load(projectId)
            }
            is RemoteProjectFilesViewModel.State.Loaded -> {
                if (s.files.isEmpty()) {
                    EmptyBox(padding)
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(padding),
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(s.files, key = { it.id }) { file ->
                            FileRow(
                                file = file,
                                onClick = {
                                    if (file.isFolder == 0) {
                                        scope.launch {
                                            val content = viewModel.fetchContent(file.id) ?: ""
                                            editingFile = file
                                            editingContent = content
                                        }
                                    }
                                },
                                onDelete = { viewModel.delete(projectId, file.id) },
                            )
                        }
                    }
                }
            }
        }
    }

    if (showCreateFileDialog) {
        CreateFileDialog(
            isFolder = false,
            onDismiss = { showCreateFileDialog = false },
            onConfirm = { path, content ->
                viewModel.createFile(projectId, path, content) {
                    showCreateFileDialog = false
                }
            },
            busy = busy,
        )
    }
    if (showCreateFolderDialog) {
        CreateFileDialog(
            isFolder = true,
            onDismiss = { showCreateFolderDialog = false },
            onConfirm = { path, _ ->
                viewModel.createFolder(projectId, path) {
                    showCreateFolderDialog = false
                }
            },
            busy = busy,
        )
    }

    editingFile?.let { file ->
        EditFileDialog(
            file = file,
            initialContent = editingContent,
            busy = busy,
            onDismiss = { editingFile = null },
            onSave = { newContent ->
                viewModel.saveContent(projectId, file.id, newContent) {
                    editingFile = null
                }
            },
        )
    }
}

@Composable
private fun FileRow(
    file: RemoteProjectFileFull,
    onClick: () -> Unit,
    onDelete: () -> Unit,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = file.isFolder == 0) { onClick() },
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (file.isFolder == 1) Icons.Default.Folder else Icons.Default.Description,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    file.fileName,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 1,
                )
                Text(
                    file.filePath,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 1,
                )
            }
            if (file.fileSize > 0) {
                Text(
                    "${file.fileSize} B",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(8.dp))
            }
            IconButton(onClick = { showDeleteConfirm = true }) {
                Icon(Icons.Default.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.error)
            }
        }
    }
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除 ${if (file.isFolder == 1) "文件夹" else "文件"}") },
            text = { Text("确定删除 '${file.fileName}' ？") },
            confirmButton = {
                TextButton(onClick = {
                    onDelete()
                    showDeleteConfirm = false
                }) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun CreateFileDialog(
    isFolder: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (path: String, content: String) -> Unit,
    busy: Boolean,
) {
    var path by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isFolder) "新建文件夹" else "新建文件") },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = path,
                    onValueChange = { path = it },
                    label = { Text(if (isFolder) "文件夹路径" else "文件路径（如 README.md）") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                if (!isFolder) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = content,
                        onValueChange = { content = it },
                        label = { Text("初始内容（可选）") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(120.dp),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { if (path.isNotBlank()) onConfirm(path.trim(), content) },
                enabled = !busy && path.isNotBlank(),
            ) { Text(if (busy) "创建中..." else "创建") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun EditFileDialog(
    file: RemoteProjectFileFull,
    initialContent: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var content by remember { mutableStateOf(initialContent) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑 ${file.fileName}") },
        text = {
            OutlinedTextField(
                value = content,
                onValueChange = { content = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(320.dp),
            )
        },
        confirmButton = {
            Button(onClick = { onSave(content) }, enabled = !busy) {
                Text(if (busy) "保存中..." else "保存")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun LoadingBox(p: PaddingValues) {
    Box(Modifier.fillMaxSize().padding(p), Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun EmptyBox(p: PaddingValues) {
    Box(Modifier.fillMaxSize().padding(p), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                modifier = Modifier.size(64.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "项目下还没有文件\n点击右上角 + 新建",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ErrorBox(p: PaddingValues, message: String, onRetry: () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .padding(p)
            .padding(24.dp), Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(64.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(message, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onRetry) { Text("重试") }
        }
    }
}
