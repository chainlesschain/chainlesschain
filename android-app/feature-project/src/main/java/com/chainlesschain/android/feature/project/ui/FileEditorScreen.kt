package com.chainlesschain.android.feature.project.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Preview
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.ToggleOff
import androidx.compose.material.icons.filled.ToggleOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.feature.project.ui.components.AIAssistAction
import com.chainlesschain.android.feature.project.ui.components.AIAssistDialog
import com.chainlesschain.android.feature.project.ui.components.BreadcrumbItem
import com.chainlesschain.android.feature.project.ui.components.BreadcrumbNav
import com.chainlesschain.android.feature.project.ui.components.SyntaxHighlightedEditor
import com.chainlesschain.android.feature.project.viewmodel.FileEditorViewModel
import com.chainlesschain.android.feature.project.viewmodel.FileEditorUiEvent

/**
 * File editor screen for viewing and editing project files
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileEditorScreen(
    projectId: String,
    fileId: String,
    viewModel: FileEditorViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val file by viewModel.currentFile.collectAsState()
    val content by viewModel.fileContent.collectAsState()
    val isDirty by viewModel.isDirty.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val isSaving by viewModel.isSaving.collectAsState()
    val isAutoSaveEnabled by viewModel.isAutoSaveEnabled.collectAsState()
    val lastSaveTime by viewModel.lastSaveTime.collectAsState()
    val isAIProcessing by viewModel.isAIProcessing.collectAsState()
    val aiResult by viewModel.aiResult.collectAsState()

    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(0) }
    var showExitDialog by remember { mutableStateOf(false) }
    var showOptionsMenu by remember { mutableStateOf(false) }
    var showAIAssistDialog by remember { mutableStateOf(false) }
    var showAIResultDialog by remember { mutableStateOf(false) }

    // Load file on start
    LaunchedEffect(fileId) {
        viewModel.loadFile(projectId, fileId)
    }

    // Handle UI events
    LaunchedEffect(Unit) {
        viewModel.uiEvents.collect { event ->
            when (event) {
                is FileEditorUiEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is FileEditorUiEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.error)
                }
                is FileEditorUiEvent.NavigateBack -> {
                    onNavigateBack()
                }
                is FileEditorUiEvent.FileSaved -> {
                    snackbarHostState.showSnackbar("File saved")
                }
                is FileEditorUiEvent.AIResultReady -> {
                    showAIAssistDialog = false
                    showAIResultDialog = true
                }
            }
        }
    }

    // Handle back press with unsaved changes
    val handleBack: () -> Unit = {
        if (isDirty) {
            showExitDialog = true
        } else {
            onNavigateBack()
        }
    }

    val isMarkdown = file?.extension?.lowercase() in listOf("md", "markdown")

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = file?.name ?: "Loading...",
                            maxLines = 1
                        )
                        if (isDirty) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(MaterialTheme.colorScheme.primary)
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = handleBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Save button
                    IconButton(
                        onClick = { viewModel.saveFile() },
                        enabled = isDirty && !isSaving
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                Icons.Default.Save,
                                contentDescription = "Save",
                                tint = if (isDirty) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    // Options menu
                    Box {
                        IconButton(onClick = { showOptionsMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More options")
                        }
                        DropdownMenu(
                            expanded = showOptionsMenu,
                            onDismissRequest = { showOptionsMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Auto-save: ${if (isAutoSaveEnabled) "ON" else "OFF"}") },
                                leadingIcon = {
                                    Icon(
                                        if (isAutoSaveEnabled) Icons.Default.ToggleOn else Icons.Default.ToggleOff,
                                        contentDescription = null,
                                        tint = if (isAutoSaveEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                },
                                onClick = {
                                    viewModel.toggleAutoSave()
                                    showOptionsMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("AI Assist") },
                                leadingIcon = { Icon(Icons.Default.SmartToy, null) },
                                onClick = {
                                    showAIAssistDialog = true
                                    showOptionsMenu = false
                                }
                            )
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        if (isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (file == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "File not found",
                    color = MaterialTheme.colorScheme.error
                )
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                // Breadcrumb navigation
                file?.let { currentFile ->
                    val breadcrumbItems = buildList {
                        add(BreadcrumbItem("Projects", onClick = onNavigateBack))
                        add(BreadcrumbItem("Project")) // Project name not available in current context

                        // Add path segments
                        val pathParts = currentFile.path.split("/")
                        if (pathParts.size > 1) {
                            pathParts.dropLast(1).forEach { part ->
                                add(BreadcrumbItem(part))
                            }
                        }

                        // Add current file
                        add(BreadcrumbItem(currentFile.name))
                    }

                    BreadcrumbNav(
                        items = breadcrumbItems,
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                // File info bar
                FileInfoBar(
                    file = file!!,
                    isAutoSaveEnabled = isAutoSaveEnabled,
                    lastSaveTime = lastSaveTime
                )

                // Tab row for markdown files (Edit / Preview)
                if (isMarkdown) {
                    TabRow(selectedTabIndex = selectedTab) {
                        Tab(
                            selected = selectedTab == 0,
                            onClick = { selectedTab = 0 },
                            text = { Text("Edit") },
                            icon = { Icon(Icons.Default.Edit, null) }
                        )
                        Tab(
                            selected = selectedTab == 1,
                            onClick = { selectedTab = 1 },
                            text = { Text("Preview") },
                            icon = { Icon(Icons.Default.Preview, null) }
                        )
                    }
                }

                // Content area
                when {
                    isMarkdown && selectedTab == 1 -> {
                        // Markdown preview using MarkdownText
                        MarkdownPreview(
                            content = content,
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(16.dp)
                        )
                    }
                    else -> {
                        // Syntax highlighted code editor
                        SyntaxHighlightedEditor(
                            content = content,
                            onContentChange = { viewModel.updateContent(it) },
                            language = file?.extension,
                            modifier = Modifier.fillMaxSize(),
                            readOnly = false,
                            showLineNumbers = true
                        )
                    }
                }
            }
        }
    }

    // Exit dialog for unsaved changes
    if (showExitDialog) {
        AlertDialog(
            onDismissRequest = { showExitDialog = false },
            title = { Text("Unsaved changes") },
            text = { Text("You have unsaved changes. Do you want to save before leaving?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.saveFile()
                        showExitDialog = false
                        onNavigateBack()
                    }
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                Row {
                    TextButton(
                        onClick = {
                            showExitDialog = false
                        }
                    ) {
                        Text("Cancel")
                    }
                    TextButton(
                        onClick = {
                            showExitDialog = false
                            onNavigateBack()
                        }
                    ) {
                        Text("Discard", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        )
    }

    // AI Assist Dialog
    if (showAIAssistDialog) {
        AIAssistDialog(
            fileName = file?.name,
            fileExtension = file?.extension,
            onActionSelected = { action ->
                viewModel.processAIAssist(action)
            },
            onDismiss = {
                if (!isAIProcessing) {
                    showAIAssistDialog = false
                }
            },
            isProcessing = isAIProcessing
        )
    }

    // AI Result Dialog
    if (showAIResultDialog && aiResult != null) {
        AIResultDialog(
            result = aiResult!!,
            onApply = {
                viewModel.applyAIResult()
                showAIResultDialog = false
            },
            onDiscard = {
                viewModel.discardAIResult()
                showAIResultDialog = false
            },
            onDismiss = {
                showAIResultDialog = false
            }
        )
    }
}

/**
 * File info bar showing file metadata and auto-save status
 */
@Composable
private fun FileInfoBar(
    file: ProjectFileEntity,
    isAutoSaveEnabled: Boolean,
    lastSaveTime: Long?,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // First row: File type, size, path
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Code,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = file.extension?.uppercase() ?: "TXT",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    text = formatFileSize(file.size),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = file.path,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1
                )
            }

            // Second row: Auto-save status
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (isAutoSaveEnabled) Icons.Default.ToggleOn else Icons.Default.ToggleOff,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = if (isAutoSaveEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "Auto-save ${if (isAutoSaveEnabled) "ON" else "OFF"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                lastSaveTime?.let { time ->
                    Text(
                        text = "Saved ${formatTimeAgo(time)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    )
                }
            }
        }
    }
}

/**
 * Format time ago (e.g., "2s ago", "1m ago")
 */
private fun formatTimeAgo(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 1000 -> "just now"
        diff < 60 * 1000 -> "${diff / 1000}s ago"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}m ago"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}h ago"
        else -> "${diff / (24 * 60 * 60 * 1000)}d ago"
    }
}

/**
 * Markdown preview using Markwon
 */
@Composable
private fun MarkdownPreview(
    content: String,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Box(
        modifier = modifier.verticalScroll(scrollState)
    ) {
        MarkdownText(
            markdown = content,
            textColor = MaterialTheme.colorScheme.onSurface,
            linkColor = MaterialTheme.colorScheme.primary,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

/**
 * AI结果对话框
 * 显示AI处理结果，允许用户应用或丢弃
 */
@Composable
private fun AIResultDialog(
    result: String,
    onApply: () -> Unit,
    onDiscard: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.SmartToy,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = "AI 处理结果",
                    style = MaterialTheme.typography.titleLarge
                )
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
            ) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
                    )
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        // Use markdown rendering for AI result
                        MarkdownText(
                            markdown = result,
                            textColor = MaterialTheme.colorScheme.onSurface,
                            linkColor = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Info text
                Text(
                    text = "您可以选择应用此结果到文件，或者丢弃它。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onDiscard) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Text("丢弃")
                    }
                }
                TextButton(
                    onClick = onApply,
                    colors = androidx.compose.material3.ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Text("应用到文件")
                    }
                }
            }
        }
    )
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        else -> "${bytes / (1024 * 1024)} MB"
    }
}
