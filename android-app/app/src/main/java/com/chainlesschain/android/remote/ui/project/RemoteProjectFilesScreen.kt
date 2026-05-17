package com.chainlesschain.android.remote.ui.project

import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.RemoteProjectFileFull
import kotlinx.coroutines.launch
import java.io.File

/**
 * Sub-phase 7.5 v2 (2026-05-17 真机 E2E fix): 远程项目文件 CRUD 屏（全 RPC）。
 *
 * 修 4 个真机 bug：
 *   1. 文件夹内创建嵌套 — currentPath stack + breadcrumb + 进入文件夹 + filterByPath
 *   2. PC → 手机刷新 — TopBar Refresh icon (pull-to-refresh API material3 当前不可用)
 *   3. 编辑 dialog 内容空 — 改 editing Pair<file, content> 单原子 state + remember(file.id)
 *   4. 用其它应用打开 — long-press 弹菜单，FileProvider 写临时文件 + Intent.ACTION_VIEW
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
    val context = LocalContext.current

    var currentPath by remember { mutableStateOf("") }
    var showAddMenu by remember { mutableStateOf(false) }
    var showCreateFileDialog by remember { mutableStateOf(false) }
    var showCreateFolderDialog by remember { mutableStateOf(false) }

    // #3 修：editing 用 Pair 单原子 state — file + content 一起 set，避免分两次
    // setState 让 dialog 用空 content 渲染后才更新。
    var editing by remember { mutableStateOf<Pair<RemoteProjectFileFull, String>?>(null) }
    var contextMenuFile by remember { mutableStateOf<RemoteProjectFileFull?>(null) }

    LaunchedEffect(projectId) { viewModel.load(projectId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(projectName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            text = if (currentPath.isEmpty()) "远程文件 · 根目录" else "远程文件 · /$currentPath",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = {
                        // #1: 非根目录返上级；根目录退屏
                        if (currentPath.isNotEmpty()) {
                            currentPath = currentPath.substringBeforeLast('/', "")
                        } else {
                            onNavigateBack()
                        }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.load(projectId) }) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                    Box {
                        IconButton(onClick = { showAddMenu = true }) {
                            Icon(Icons.Default.Add, contentDescription = "新建")
                        }
                        DropdownMenu(expanded = showAddMenu, onDismissRequest = { showAddMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("新建文件") },
                                leadingIcon = { Icon(Icons.Default.NoteAdd, null) },
                                onClick = { showAddMenu = false; showCreateFileDialog = true },
                            )
                            DropdownMenuItem(
                                text = { Text("新建文件夹") },
                                leadingIcon = { Icon(Icons.Default.CreateNewFolder, null) },
                                onClick = { showAddMenu = false; showCreateFolderDialog = true },
                            )
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            if (currentPath.isNotEmpty()) {
                Breadcrumb(currentPath = currentPath, onJump = { currentPath = it })
            }
            when (val s = state) {
                RemoteProjectFilesViewModel.State.Idle,
                RemoteProjectFilesViewModel.State.Loading -> LoadingBox()
                is RemoteProjectFilesViewModel.State.Error -> ErrorBox(s.message) { viewModel.load(projectId) }
                is RemoteProjectFilesViewModel.State.Loaded -> {
                    val filtered = filterByPath(s.files, currentPath)
                    if (filtered.isEmpty()) {
                        EmptyBox(currentPath = currentPath)
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(filtered, key = { it.id }) { file ->
                                FileRow(
                                    file = file,
                                    onClick = {
                                        if (file.isFolder == 1) {
                                            currentPath = file.filePath.trimStart('/')
                                        } else {
                                            scope.launch {
                                                val content = viewModel.fetchContent(file.id) ?: ""
                                                editing = file to content
                                            }
                                        }
                                    },
                                    onLongPress = { contextMenuFile = file },
                                    onDelete = { viewModel.delete(projectId, file.id) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateFileDialog) {
        CreateFileDialog(
            isFolder = false,
            currentPath = currentPath,
            onDismiss = { showCreateFileDialog = false },
            onConfirm = { name, content ->
                val fullPath = if (currentPath.isEmpty()) name else "$currentPath/$name"
                viewModel.createFile(projectId, fullPath, content) { showCreateFileDialog = false }
            },
            busy = busy,
        )
    }
    if (showCreateFolderDialog) {
        CreateFileDialog(
            isFolder = true,
            currentPath = currentPath,
            onDismiss = { showCreateFolderDialog = false },
            onConfirm = { name, _ ->
                val fullPath = if (currentPath.isEmpty()) name else "$currentPath/$name"
                viewModel.createFolder(projectId, fullPath) { showCreateFolderDialog = false }
            },
            busy = busy,
        )
    }

    editing?.let { (file, content) ->
        EditFileDialog(
            file = file,
            initialContent = content,
            busy = busy,
            onDismiss = { editing = null },
            onSave = { newContent ->
                viewModel.saveContent(projectId, file.id, newContent) { editing = null }
            },
        )
    }

    contextMenuFile?.let { file ->
        FileContextMenu(
            file = file,
            onDismiss = { contextMenuFile = null },
            onOpenInApp = {
                contextMenuFile = null
                if (file.isFolder == 0) {
                    scope.launch {
                        val content = viewModel.fetchContent(file.id) ?: ""
                        editing = file to content
                    }
                }
            },
            onOpenExternal = {
                contextMenuFile = null
                if (file.isFolder == 0) {
                    scope.launch {
                        val content = viewModel.fetchContent(file.id) ?: ""
                        openWithExternalApp(context, file, content)
                    }
                }
            },
            onDelete = {
                contextMenuFile = null
                viewModel.delete(projectId, file.id)
            },
        )
    }
}

private fun openWithExternalApp(
    context: android.content.Context,
    file: RemoteProjectFileFull,
    content: String,
) {
    try {
        val cacheDir = File(context.cacheDir, "remote-files").apply { mkdirs() }
        val tempFile = File(cacheDir, file.fileName)
        tempFile.writeText(content, Charsets.UTF_8)
        val authority = "${context.packageName}.fileprovider"
        val uri = FileProvider.getUriForFile(context, authority, tempFile)
        val ext = file.fileName.substringAfterLast('.', "").lowercase()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "text/plain"
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(Intent.createChooser(intent, "用其它应用打开 ${file.fileName}"))
    } catch (e: Exception) {
        android.widget.Toast.makeText(
            context,
            "无法打开：${e.message ?: "未知错误"}",
            android.widget.Toast.LENGTH_SHORT,
        ).show()
    }
}

/**
 * #1 按 currentPath 过滤直接子项（不递归显示孙级）。
 */
private fun filterByPath(
    all: List<RemoteProjectFileFull>,
    currentPath: String,
): List<RemoteProjectFileFull> {
    if (currentPath.isEmpty()) {
        return all.filter { !it.filePath.contains('/') }
    }
    val prefix = "$currentPath/"
    return all.filter { f ->
        f.filePath.startsWith(prefix) &&
            !f.filePath.removePrefix(prefix).contains('/')
    }
}

@Composable
private fun Breadcrumb(currentPath: String, onJump: (String) -> Unit) {
    val parts = currentPath.split('/').filter { it.isNotEmpty() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Default.Home,
            contentDescription = "根目录",
            modifier = Modifier
                .size(18.dp)
                .clickable { onJump("") },
            tint = MaterialTheme.colorScheme.primary,
        )
        var accum = ""
        parts.forEach { part ->
            Icon(Icons.Default.ChevronRight, null, modifier = Modifier.size(16.dp))
            accum = if (accum.isEmpty()) part else "$accum/$part"
            val target = accum
            Text(
                part,
                modifier = Modifier
                    .padding(horizontal = 4.dp)
                    .clickable { onJump(target) },
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(
    file: RemoteProjectFileFull,
    onClick: () -> Unit,
    onLongPress: () -> Unit,
    onDelete: () -> Unit,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .combinedClickable(onClick = onClick, onLongClick = onLongPress)
                .padding(12.dp),
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
                    formatSize(file.fileSize),
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
                TextButton(onClick = { onDelete(); showDeleteConfirm = false }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun FileContextMenu(
    file: RemoteProjectFileFull,
    onDismiss: () -> Unit,
    onOpenInApp: () -> Unit,
    onOpenExternal: () -> Unit,
    onDelete: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(file.fileName) },
        text = {
            Column {
                if (file.isFolder == 0) {
                    ContextMenuRow(icon = Icons.Default.Edit, label = "在应用内编辑", onClick = onOpenInApp)
                    ContextMenuRow(icon = Icons.Default.OpenInNew, label = "用其它应用打开", onClick = onOpenExternal)
                }
                ContextMenuRow(
                    icon = Icons.Default.Delete,
                    label = "删除",
                    onClick = onDelete,
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun ContextMenuRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    tint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint)
        Spacer(Modifier.width(12.dp))
        Text(label, color = tint, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun CreateFileDialog(
    isFolder: Boolean,
    currentPath: String,
    onDismiss: () -> Unit,
    onConfirm: (name: String, content: String) -> Unit,
    busy: Boolean,
) {
    var name by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isFolder) "新建文件夹" else "新建文件") },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (currentPath.isNotEmpty()) {
                    Text(
                        "位置：/$currentPath",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(if (isFolder) "文件夹名" else "文件名（如 README.md）") },
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
                onClick = { if (name.isNotBlank()) onConfirm(name.trim(), content) },
                enabled = !busy && name.isNotBlank(),
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
    // #3 修：remember(file.id) — 切换不同 file 时重新捕新 initialContent；
    // editing 是 Pair atom setState 保证 dialog 首次组合时已是非空 fetchContent 结果。
    var content by remember(file.id) { mutableStateOf(initialContent) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text("编辑 ${file.fileName}", style = MaterialTheme.typography.titleMedium)
                if (file.filePath != file.fileName) {
                    Text(
                        "/${file.filePath}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
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
private fun LoadingBox() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun EmptyBox(currentPath: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                modifier = Modifier.size(64.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                if (currentPath.isEmpty()) "项目下还没有文件\n点右上角 + 新建" else "此文件夹为空\n点 + 在此目录新建",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ErrorBox(message: String, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
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

private fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format("%.1f KB", kb)
    val mb = kb / 1024.0
    return String.format("%.1f MB", mb)
}
