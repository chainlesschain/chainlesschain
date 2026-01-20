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
import androidx.compose.material.icons.filled.Preview
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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

    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(0) }
    var showExitDialog by remember { mutableStateOf(false) }

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
                    // AI assist button
                    IconButton(onClick = { /* TODO: AI assist */ }) {
                        Icon(Icons.Default.SmartToy, contentDescription = "AI Assist")
                    }

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
                // File info bar
                FileInfoBar(file = file!!)

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
}

/**
 * File info bar showing file metadata
 */
@Composable
private fun FileInfoBar(
    file: ProjectFileEntity,
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
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
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

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        else -> "${bytes / (1024 * 1024)} MB"
    }
}
