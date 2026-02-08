package com.chainlesschain.android.feature.project.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileMove
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.model.ChatContextMode
import com.chainlesschain.android.feature.project.model.FileTreeNode
import com.chainlesschain.android.feature.project.model.ProjectDetailState
import com.chainlesschain.android.feature.project.model.TaskStep
import com.chainlesschain.android.feature.project.model.ThinkingStage
import com.chainlesschain.android.feature.project.model.UpdateProjectRequest
import com.chainlesschain.android.feature.project.ui.components.BreadcrumbItem
import com.chainlesschain.android.feature.project.ui.components.BreadcrumbNav
import com.chainlesschain.android.feature.project.ui.components.FileSearchBar
import com.chainlesschain.android.feature.project.ui.components.ProjectChatPanel
import com.chainlesschain.android.feature.project.viewmodel.ProjectUiEvent
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailScreen(
    projectId: String,
    viewModel: ProjectViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToFile: (String, String) -> Unit
) {
    val detailState by viewModel.projectDetailState.collectAsState()
    val fileTree by viewModel.fileTree.collectAsState()
    val activities by viewModel.projectActivities.collectAsState()
    val openFiles by viewModel.openFiles.collectAsState()

    // AI Chat states
    val chatMessages by viewModel.chatMessages.collectAsState()
    val chatInputText by viewModel.chatInputText.collectAsState()
    val isAiResponding by viewModel.isAiResponding.collectAsState()

    // Context mode states
    val contextMode by viewModel.contextMode.collectAsState()
    val selectedFileForContext by viewModel.selectedFileForContext.collectAsState()

    // File mention states
    val projectFiles by viewModel.projectFiles.collectAsState()
    val isFileMentionVisible by viewModel.isFileMentionVisible.collectAsState()
    val fileMentionSearchQuery by viewModel.fileMentionSearchQuery.collectAsState()

    // External file states (for AI chat)
    val externalFiles by viewModel.availableExternalFiles.collectAsState()
    val externalFileSearchQuery by viewModel.externalFileSearchQuery.collectAsState()

    // Thinking and task plan states
    val currentThinkingStage by viewModel.currentThinkingStage.collectAsState()
    val currentTaskPlan by viewModel.currentTaskPlan.collectAsState()

    // File search states
    val fileSearchQuery by viewModel.fileSearchQuery.collectAsState()
    val isFileSearchExpanded by viewModel.isFileSearchExpanded.collectAsState()
    val filteredFiles by viewModel.filteredFiles.collectAsState()

    // Model selection states
    val currentModel by viewModel.currentModel.collectAsState()
    val currentProvider by viewModel.currentProvider.collectAsState()
    val contextStats by viewModel.contextStats.collectAsState()
    val totalContextTokens by viewModel.totalContextTokens.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(0) }
    var showMenu by remember { mutableStateOf(false) }
    var showNewFileDialog by remember { mutableStateOf(false) }
    var showNewFolderDialog by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showEditDialog by remember { mutableStateOf(false) }
    var showAddBottomSheet by remember { mutableStateOf(false) }
    var renameTargetNode by remember { mutableStateOf<FileTreeNode?>(null) }
    var moveTargetNode by remember { mutableStateOf<FileTreeNode?>(null) }

    // 加载项目详情
    LaunchedEffect(projectId) {
        viewModel.loadProjectDetail(projectId)
    }

    // 处理 UI 事件
    LaunchedEffect(Unit) {
        viewModel.uiEvents.collect { event ->
            when (event) {
                is ProjectUiEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is ProjectUiEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.error)
                }
                is ProjectUiEvent.NavigateBack -> {
                    onNavigateBack()
                }
                is ProjectUiEvent.NavigateToFile -> {
                    onNavigateToFile(event.projectId, event.fileId)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    when (val state = detailState) {
                        is ProjectDetailState.Success -> Text(state.project.name)
                        else -> Text("项目详情")
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    if (detailState is ProjectDetailState.Success) {
                        val project = (detailState as ProjectDetailState.Success).project

                        IconButton(onClick = { viewModel.toggleFavorite(projectId) }) {
                            Icon(
                                imageVector = if (project.isFavorite) Icons.Filled.Star else Icons.Filled.StarBorder,
                                contentDescription = "收藏",
                                tint = if (project.isFavorite) Color(0xFFFFC107) else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        Box {
                            IconButton(onClick = { showMenu = true }) {
                                Icon(Icons.Default.MoreVert, contentDescription = "更多")
                            }

                            DropdownMenu(
                                expanded = showMenu,
                                onDismissRequest = { showMenu = false }
                            ) {
                                DropdownMenuItem(
                                    text = { Text("编辑项目") },
                                    leadingIcon = { Icon(Icons.Default.Edit, null) },
                                    onClick = {
                                        showEditDialog = true
                                        showMenu = false
                                    }
                                )

                                when (project.status) {
                                    ProjectStatus.ACTIVE -> {
                                        DropdownMenuItem(
                                            text = { Text("暂停项目") },
                                            leadingIcon = { Icon(Icons.Default.Pause, null) },
                                            onClick = {
                                                viewModel.updateProjectStatus(projectId, ProjectStatus.PAUSED)
                                                showMenu = false
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("完成项目") },
                                            leadingIcon = { Icon(Icons.Default.CheckCircle, null) },
                                            onClick = {
                                                viewModel.updateProjectStatus(projectId, ProjectStatus.COMPLETED)
                                                showMenu = false
                                            }
                                        )
                                    }
                                    ProjectStatus.PAUSED -> {
                                        DropdownMenuItem(
                                            text = { Text("继续项目") },
                                            leadingIcon = { Icon(Icons.Default.PlayArrow, null) },
                                            onClick = {
                                                viewModel.updateProjectStatus(projectId, ProjectStatus.ACTIVE)
                                                showMenu = false
                                            }
                                        )
                                    }
                                    ProjectStatus.COMPLETED -> {
                                        DropdownMenuItem(
                                            text = { Text("重新开始") },
                                            leadingIcon = { Icon(Icons.Default.PlayArrow, null) },
                                            onClick = {
                                                viewModel.updateProjectStatus(projectId, ProjectStatus.ACTIVE)
                                                showMenu = false
                                            }
                                        )
                                    }
                                    else -> {}
                                }

                                DropdownMenuItem(
                                    text = { Text(if (project.isArchived) "取消归档" else "归档") },
                                    leadingIcon = { Icon(Icons.Default.Archive, null) },
                                    onClick = {
                                        viewModel.toggleArchive(projectId)
                                        showMenu = false
                                    }
                                )

                                DropdownMenuItem(
                                    text = { Text("删除项目") },
                                    leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                                    onClick = {
                                        showDeleteDialog = true
                                        showMenu = false
                                    }
                                )
                            }
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            if (selectedTab == 0 && detailState is ProjectDetailState.Success) {
                FloatingActionButton(onClick = { showAddBottomSheet = true }) {
                    Icon(Icons.Default.Add, contentDescription = "添加")
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        when (val state = detailState) {
            is ProjectDetailState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            is ProjectDetailState.Error -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = state.message,
                            color = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        TextButton(onClick = onNavigateBack) {
                            Text("返回")
                        }
                    }
                }
            }
            is ProjectDetailState.Success -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                ) {
                    // Breadcrumb navigation
                    BreadcrumbNav(
                        items = listOf(
                            BreadcrumbItem("Projects", onClick = onNavigateBack),
                            BreadcrumbItem(state.project.name)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    // 项目信息卡片
                    ProjectInfoCard(
                        project = state.project,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )

                    // 标签页
                    TabRow(selectedTabIndex = selectedTab) {
                        Tab(
                            selected = selectedTab == 0,
                            onClick = { selectedTab = 0 },
                            text = { Text("文件") }
                        )
                        Tab(
                            selected = selectedTab == 1,
                            onClick = { selectedTab = 1 },
                            text = { Text("AI 助手") }
                        )
                        Tab(
                            selected = selectedTab == 2,
                            onClick = { selectedTab = 2 },
                            text = { Text("活动") }
                        )
                    }

                    // 标签页内容
                    when (selectedTab) {
                        0 -> Column(modifier = Modifier.fillMaxSize()) {
                            // File search bar
                            FileSearchBar(
                                query = fileSearchQuery,
                                onQueryChange = { viewModel.updateFileSearchQuery(it) },
                                isExpanded = isFileSearchExpanded,
                                onExpandedChange = { viewModel.setFileSearchExpanded(it) },
                                resultCount = if (fileSearchQuery.isBlank()) projectFiles.size else filteredFiles.size,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                            )

                            // File tree
                            FileTreeView(
                                fileTree = if (fileSearchQuery.isBlank()) fileTree else buildFilteredTree(filteredFiles),
                                onNodeClick = { node ->
                                    if (node.isFile()) {
                                        viewModel.openFile(node.id)
                                    } else {
                                        viewModel.toggleFileTreeNode(node.id)
                                    }
                                },
                                onDeleteFile = { viewModel.deleteFile(it) },
                                onRenameFile = { node -> renameTargetNode = node },
                                onMoveFile = { node -> moveTargetNode = node },
                                modifier = Modifier.weight(1f)
                            )
                        }
                        1 -> ProjectChatPanel(
                            messages = chatMessages,
                            isAiResponding = isAiResponding,
                            inputText = chatInputText,
                            onInputChange = { viewModel.updateChatInput(it) },
                            onSendMessage = { viewModel.sendChatMessage() },
                            onQuickAction = { viewModel.executeQuickAction(it) },
                            onClearChat = { viewModel.clearChatHistory() },
                            onRetry = { viewModel.retryChatMessage() },
                            // Context mode props
                            contextMode = contextMode,
                            onContextModeChange = { viewModel.setContextMode(it) },
                            selectedFileName = selectedFileForContext?.name,
                            // File mention props - Project Files
                            projectFiles = projectFiles,
                            isFileMentionVisible = isFileMentionVisible,
                            fileMentionSearchQuery = fileMentionSearchQuery,
                            onFileMentionSearchChange = { viewModel.updateFileMentionSearchQuery(it) },
                            onFileSelected = { viewModel.addFileMention(it) },
                            onShowFileMention = {
                                viewModel.showFileMentionPopup()
                                viewModel.loadAvailableExternalFiles() // Load external files when popup opens
                            },
                            onHideFileMention = { viewModel.hideFileMentionPopup() },
                            // File mention props - External Files
                            externalFiles = externalFiles,
                            externalFileSearchQuery = externalFileSearchQuery,
                            onExternalFileSearchChange = { viewModel.updateExternalFileSearchQuery(it) },
                            onExternalFileSelected = { viewModel.importExternalFileForChat(it) },
                            // Thinking stage props
                            currentThinkingStage = currentThinkingStage,
                            // Task plan props
                            currentTaskPlan = currentTaskPlan,
                            onConfirmTaskPlan = { viewModel.confirmTaskPlan() },
                            onCancelTaskPlan = { viewModel.cancelTaskPlan() },
                            onModifyTaskPlan = { viewModel.modifyTaskPlan() },
                            onRetryTaskStep = { viewModel.retryTaskStep(it) },
                            // Model selection props
                            currentModel = currentModel,
                            currentProvider = currentProvider,
                            onModelSelected = { model, provider ->
                                viewModel.setModel(model)
                                viewModel.setProvider(provider)
                            },
                            // Context stats props
                            contextStats = contextStats,
                            totalContextTokens = totalContextTokens,
                            maxContextTokens = 4000
                        )
                        2 -> ActivityListView(activities = activities)
                    }
                }
            }
        }
    }

    // 添加文件/文件夹底部菜单
    if (showAddBottomSheet) {
        val sheetState = rememberModalBottomSheetState()
        ModalBottomSheet(
            onDismissRequest = { showAddBottomSheet = false },
            sheetState = sheetState
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                Text(
                    text = "添加",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(bottom = 16.dp)
                )

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            showAddBottomSheet = false
                            showNewFileDialog = true
                        }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.NoteAdd, contentDescription = null)
                    Spacer(modifier = Modifier.width(16.dp))
                    Text("新建文件")
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            showAddBottomSheet = false
                            showNewFolderDialog = true
                        }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.CreateNewFolder, contentDescription = null)
                    Spacer(modifier = Modifier.width(16.dp))
                    Text("新建文件夹")
                }

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }

    // 新建文件对话框
    if (showNewFileDialog) {
        var fileName by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showNewFileDialog = false },
            title = { Text("新建文件") },
            text = {
                OutlinedTextField(
                    value = fileName,
                    onValueChange = { fileName = it },
                    label = { Text("文件名") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (fileName.isNotBlank()) {
                            viewModel.addFile(name = fileName, type = "file")
                            showNewFileDialog = false
                        }
                    },
                    enabled = fileName.isNotBlank()
                ) {
                    Text("创建")
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewFileDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    // 新建文件夹对话框
    if (showNewFolderDialog) {
        var folderName by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showNewFolderDialog = false },
            title = { Text("新建文件夹") },
            text = {
                OutlinedTextField(
                    value = folderName,
                    onValueChange = { folderName = it },
                    label = { Text("文件夹名") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (folderName.isNotBlank()) {
                            viewModel.addFile(name = folderName, type = "folder")
                            showNewFolderDialog = false
                        }
                    },
                    enabled = folderName.isNotBlank()
                ) {
                    Text("创建")
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewFolderDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    // 编辑项目对话框
    if (showEditDialog) {
        val state = detailState
        if (state is ProjectDetailState.Success) {
            EditProjectDialog(
                project = state.project,
                onDismiss = { showEditDialog = false },
                onConfirm = { name, description, type ->
                    viewModel.updateProject(
                        projectId,
                        UpdateProjectRequest(name = name, description = description, type = type)
                    )
                    showEditDialog = false
                }
            )
        }
    }

    // 重命名文件对话框
    renameTargetNode?.let { node ->
        RenameFileDialog(
            currentName = node.name,
            onDismiss = { renameTargetNode = null },
            onConfirm = { newName ->
                viewModel.renameFile(node.id, newName)
                renameTargetNode = null
            }
        )
    }

    // 移动文件对话框
    moveTargetNode?.let { node ->
        MoveFileDialog(
            fileName = node.name,
            folders = projectFiles.filter { it.type == "folder" && it.id != node.id },
            onDismiss = { moveTargetNode = null },
            onConfirm = { targetFolderId ->
                viewModel.moveFile(node.id, targetFolderId)
                moveTargetNode = null
            }
        )
    }

    // 删除确认对话框
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("删除项目") },
            text = { Text("确定要删除此项目吗？此操作无法撤销。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deleteProject(projectId)
                        showDeleteDialog = false
                    }
                ) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("取消")
                }
            }
        )
    }
}

@Composable
private fun ProjectInfoCard(
    project: ProjectEntity,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            project.description?.takeIf { it.isNotBlank() }?.let { desc ->
                Text(
                    text = desc,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = "状态",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = project.getStatusDisplayName(),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Column {
                    Text(
                        text = "类型",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = project.getTypeDisplayName(),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Column {
                    Text(
                        text = "文件数",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "${project.fileCount}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                Column {
                    Text(
                        text = "大小",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = project.getReadableSize(),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

@Composable
private fun FileTreeView(
    fileTree: List<FileTreeNode>,
    onNodeClick: (FileTreeNode) -> Unit,
    onDeleteFile: (String) -> Unit,
    onRenameFile: (FileTreeNode) -> Unit,
    onMoveFile: (FileTreeNode) -> Unit,
    modifier: Modifier = Modifier
) {
    if (fileTree.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Default.Folder,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "暂无文件",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            items(fileTree, key = { it.id }) { node ->
                FileTreeNodeItem(
                    node = node,
                    depth = 0,
                    onNodeClick = onNodeClick,
                    onDeleteFile = onDeleteFile,
                    onRenameFile = onRenameFile,
                    onMoveFile = onMoveFile
                )
            }
        }
    }
}

/**
 * Build a flat file tree from filtered files for search results
 */
private fun buildFilteredTree(files: List<ProjectFileEntity>): List<FileTreeNode> {
    return files.map { file ->
        FileTreeNode(
            id = file.id,
            name = file.name,
            path = file.path,
            type = file.type,
            extension = file.extension,
            size = file.size,
            isDirty = file.isDirty,
            isOpen = file.isOpen,
            isExpanded = false
        )
    }
}

@Composable
private fun FileTreeNodeItem(
    node: FileTreeNode,
    depth: Int,
    onNodeClick: (FileTreeNode) -> Unit,
    onDeleteFile: (String) -> Unit,
    onRenameFile: (FileTreeNode) -> Unit,
    onMoveFile: (FileTreeNode) -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }

    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onNodeClick(node) }
                .padding(
                    start = (depth * 24).dp,
                    top = 8.dp,
                    bottom = 8.dp,
                    end = 8.dp
                ),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (node.isFolder()) {
                Icon(
                    imageVector = if (node.isExpanded) Icons.Default.ExpandMore else Icons.Default.ChevronRight,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.width(4.dp))
                Icon(
                    imageVector = Icons.Default.Folder,
                    contentDescription = null,
                    tint = Color(0xFFFFC107),
                    modifier = Modifier.size(20.dp)
                )
            } else {
                Spacer(modifier = Modifier.width(24.dp))
                Icon(
                    imageVector = Icons.Default.InsertDriveFile,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(modifier = Modifier.width(8.dp))

            Text(
                text = node.name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )

            if (node.isDirty) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(MaterialTheme.colorScheme.primary)
                )
                Spacer(modifier = Modifier.width(8.dp))
            }

            Box {
                IconButton(
                    onClick = { showMenu = true },
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        Icons.Default.MoreVert,
                        contentDescription = "更多",
                        modifier = Modifier.size(16.dp)
                    )
                }

                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("重命名") },
                        leadingIcon = { Icon(Icons.Default.EditNote, null) },
                        onClick = {
                            onRenameFile(node)
                            showMenu = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("移动到...") },
                        leadingIcon = { Icon(Icons.Default.DriveFileMove, null) },
                        onClick = {
                            onMoveFile(node)
                            showMenu = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("删除") },
                        leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                        onClick = {
                            onDeleteFile(node.id)
                            showMenu = false
                        }
                    )
                }
            }
        }

        // 子节点
        AnimatedVisibility(
            visible = node.isExpanded && node.children.isNotEmpty(),
            enter = expandVertically(),
            exit = shrinkVertically()
        ) {
            Column {
                node.children.forEach { child ->
                    FileTreeNodeItem(
                        node = child,
                        depth = depth + 1,
                        onNodeClick = onNodeClick,
                        onDeleteFile = onDeleteFile,
                        onRenameFile = onRenameFile,
                        onMoveFile = onMoveFile
                    )
                }
            }
        }
    }
}

@Composable
private fun ActivityListView(activities: List<ProjectActivityEntity>) {
    if (activities.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Default.History,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "暂无活动记录",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(activities, key = { it.id }) { activity ->
                ActivityItem(activity = activity)
            }
        }
    }
}

@Composable
private fun ActivityItem(activity: ProjectActivityEntity) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.Top
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.primary)
                .align(Alignment.Top)
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = activity.description,
                style = MaterialTheme.typography.bodyMedium
            )

            Text(
                text = formatActivityTime(activity.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

private fun formatActivityTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)} 分钟前"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)} 小时前"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)} 天前"
        else -> {
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

/**
 * 编辑项目对话框
 */
@Composable
private fun EditProjectDialog(
    project: ProjectEntity,
    onDismiss: () -> Unit,
    onConfirm: (name: String, description: String?, type: String) -> Unit
) {
    var editName by remember { mutableStateOf(project.name) }
    var editDesc by remember { mutableStateOf(project.description ?: "") }
    var editType by remember { mutableStateOf(project.type) }
    var typeMenuExpanded by remember { mutableStateOf(false) }

    val typeOptions = remember {
        listOf(
            ProjectType.DOCUMENT to "文档",
            ProjectType.WEB to "网站",
            ProjectType.APP to "应用",
            ProjectType.DATA to "数据",
            ProjectType.DESIGN to "设计",
            ProjectType.RESEARCH to "研究",
            ProjectType.ANDROID to "Android",
            ProjectType.BACKEND to "后端",
            ProjectType.OTHER to "其他"
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑项目") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = editName,
                    onValueChange = { editName = it },
                    label = { Text("项目名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = editDesc,
                    onValueChange = { editDesc = it },
                    label = { Text("项目描述") },
                    maxLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
                Box {
                    OutlinedTextField(
                        value = typeOptions.firstOrNull { it.first == editType }?.second ?: editType,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("项目类型") },
                        trailingIcon = {
                            IconButton(onClick = { typeMenuExpanded = !typeMenuExpanded }) {
                                Icon(
                                    imageVector = if (typeMenuExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                    contentDescription = null
                                )
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { typeMenuExpanded = true }
                    )
                    DropdownMenu(
                        expanded = typeMenuExpanded,
                        onDismissRequest = { typeMenuExpanded = false }
                    ) {
                        typeOptions.forEach { (type, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    editType = type
                                    typeMenuExpanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onConfirm(editName, editDesc.ifBlank { null }, editType)
                },
                enabled = editName.isNotBlank()
            ) {
                Text("保存")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 重命名文件对话框
 */
@Composable
private fun RenameFileDialog(
    currentName: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var newName by remember { mutableStateOf(currentName) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("重命名") },
        text = {
            OutlinedTextField(
                value = newName,
                onValueChange = { newName = it },
                label = { Text("新名称") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(newName) },
                enabled = newName.isNotBlank() && newName != currentName
            ) {
                Text("确定")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 移动文件对话框
 */
@Composable
private fun MoveFileDialog(
    fileName: String,
    folders: List<ProjectFileEntity>,
    onDismiss: () -> Unit,
    onConfirm: (targetFolderId: String?) -> Unit
) {
    var selectedFolderId by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("移动 \"$fileName\"") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "选择目标文件夹:",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))

                // 根目录选项
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { selectedFolderId = null },
                    colors = CardDefaults.cardColors(
                        containerColor = if (selectedFolderId == null)
                            MaterialTheme.colorScheme.primaryContainer
                        else
                            MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Folder, null, tint = Color(0xFFFFC107))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("/ (根目录)", style = MaterialTheme.typography.bodyMedium)
                    }
                }

                // 文件夹列表
                folders.forEach { folder ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedFolderId = folder.id },
                        colors = CardDefaults.cardColors(
                            containerColor = if (selectedFolderId == folder.id)
                                MaterialTheme.colorScheme.primaryContainer
                            else
                                MaterialTheme.colorScheme.surfaceVariant
                        )
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Folder, null, tint = Color(0xFFFFC107))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(folder.name, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                if (folders.isEmpty()) {
                    Text(
                        text = "没有其他文件夹",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 8.dp)
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(selectedFolderId) }) {
                Text("移动")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
