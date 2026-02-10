package com.chainlesschain.android.remote.ui.ai

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.model.ChatMessageType
import com.chainlesschain.android.remote.model.ContextMode
import com.chainlesschain.android.remote.model.CreationProgress
import com.chainlesschain.android.remote.model.EnhancedChatMessage
import com.chainlesschain.android.remote.model.FileReference
import com.chainlesschain.android.remote.model.FileReferenceParser
import com.chainlesschain.android.remote.model.MessageRole
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.StepStatus
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.TaskStatus
import com.chainlesschain.android.remote.model.ThinkingStage
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteAIChatScreen(
    viewModel: RemoteAIChatViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val messages by viewModel.messages.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val planningState by viewModel.planningState.collectAsState()
    val currentPlan by viewModel.currentPlan.collectAsState()
    val showFilePicker by viewModel.showFilePicker.collectAsState()
    val availableFiles by viewModel.availableFiles.collectAsState()
    val filePickerQuery by viewModel.filePickerQuery.collectAsState()
    val creationProgress by viewModel.creationProgress.collectAsState()

    var inputText by remember { mutableStateOf("") }
    var cursorPosition by remember { mutableIntStateOf(0) }
    var showModelSelector by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    // Update ViewModel with input state
    LaunchedEffect(inputText, cursorPosition) {
        viewModel.updateInputState(inputText, cursorPosition)
        viewModel.onInputChanged(inputText, cursorPosition)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Remote AI Chat")
                        uiState.selectedModel?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    uiState.totalTokens?.let { tokens ->
                        TextButton(onClick = {}) { Text("$tokens tokens") }
                    }
                    IconButton(onClick = { showModelSelector = true }) {
                        Icon(Icons.Default.Tune, contentDescription = "Model")
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    IconButton(onClick = { viewModel.clearConversation() }) {
                        Icon(Icons.Default.DeleteSweep, contentDescription = "Clear")
                    }
                }
            )
        },
        bottomBar = {
            Column {
                // Context mode selector
                ContextModeSelector(
                    currentMode = uiState.contextMode,
                    onModeSelected = { viewModel.setContextMode(it) },
                    currentFile = uiState.currentFile
                )

                // Chat input
                ChatInputBar(
                    value = inputText,
                    onValueChange = { newText ->
                        inputText = newText
                        cursorPosition = newText.length
                    },
                    onSend = {
                        viewModel.sendMessage(inputText)
                        inputText = ""
                        cursorPosition = 0
                    },
                    enabled = connectionState == ConnectionState.CONNECTED && !uiState.isLoading,
                    showFilePicker = showFilePicker,
                    onAttachClick = { viewModel.dismissFilePicker() }
                )
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                connectionState != ConnectionState.CONNECTED -> {
                    EmptyConnectionState()
                }
                messages.isEmpty() -> {
                    EmptyConversationState(model = uiState.selectedModel)
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(messages, key = { it.id }) { message ->
                            EnhancedChatMessageItem(
                                message = message,
                                onConfirmPlan = { viewModel.confirmPlan() },
                                onRejectPlan = { viewModel.clearConversation() }
                            )
                        }

                        // Thinking indicator
                        if (uiState.isLoading) {
                            item {
                                ThinkingIndicator(stage = uiState.thinkingStage)
                            }
                        }
                    }
                }
            }

            // File picker popup
            AnimatedVisibility(
                visible = showFilePicker,
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut(),
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                FilePickerPopup(
                    files = FileReferenceParser.filterFiles(availableFiles, filePickerQuery),
                    query = filePickerQuery,
                    onFileSelected = { file ->
                        val (newText, newPos) = viewModel.selectFile(file)
                        inputText = newText
                        cursorPosition = newPos
                    },
                    onDismiss = { viewModel.dismissFilePicker() }
                )
            }

            // Error snackbar
            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        Row {
                            TextButton(onClick = { viewModel.retryLastMessage() }) { Text("Retry") }
                            TextButton(onClick = { viewModel.clearError() }) { Text("Close") }
                        }
                    }
                ) {
                    Text(error)
                }
            }
        }
    }

    // Creation progress dialog
    creationProgress?.let { progress ->
        CreationProgressDialog(
            progress = progress,
            onCancel = { viewModel.dismissCreationProgress() }
        )
    }

    // Model selector dialog
    if (showModelSelector) {
        ModelSelectorDialog(
            selectedModel = uiState.selectedModel,
            availableModels = uiState.availableModels,
            onModelSelected = {
                viewModel.selectModel(it)
                showModelSelector = false
            },
            onDismiss = { showModelSelector = false }
        )
    }

    // Settings dialog
    if (showSettings) {
        SettingsDialog(
            temperature = uiState.temperature,
            onTemperatureChange = { viewModel.setTemperature(it) },
            onDismiss = { showSettings = false }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContextModeSelector(
    currentMode: ContextMode,
    onModeSelected: (ContextMode) -> Unit,
    currentFile: FileReference?,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                ContextMode.entries.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = currentMode == mode,
                        onClick = { onModeSelected(mode) },
                        shape = SegmentedButtonDefaults.itemShape(
                            index = index,
                            count = ContextMode.entries.size
                        ),
                        icon = {
                            Icon(
                                imageVector = when (mode) {
                                    ContextMode.PROJECT -> Icons.Default.Folder
                                    ContextMode.FILE -> Icons.Default.Description
                                    ContextMode.GLOBAL -> Icons.Default.Public
                                },
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    ) {
                        Text(
                            text = when (mode) {
                                ContextMode.PROJECT -> "Project"
                                ContextMode.FILE -> "File"
                                ContextMode.GLOBAL -> "Global"
                            },
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                }
            }

            // Show current file if in FILE mode
            if (currentMode == ContextMode.FILE && currentFile != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = currentFile.name,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
fun ThinkingIndicator(
    stage: ThinkingStage?,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(16.dp),
            strokeWidth = 2.dp
        )

        val stageText = when (stage) {
            ThinkingStage.ANALYZING -> "Analyzing request..."
            ThinkingStage.PLANNING -> "Planning response..."
            ThinkingStage.GENERATING -> "Generating content..."
            ThinkingStage.REVIEWING -> "Reviewing output..."
            ThinkingStage.EXECUTING -> "Executing..."
            null -> "AI is thinking..."
        }

        Text(
            text = stageText,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
fun EnhancedChatMessageItem(
    message: EnhancedChatMessage,
    onConfirmPlan: () -> Unit = {},
    onRejectPlan: () -> Unit = {}
) {
    val isUser = message.role == MessageRole.USER
    val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Card(
            modifier = Modifier.widthIn(max = 320.dp),
            colors = CardDefaults.cardColors(
                containerColor = when (message.role) {
                    MessageRole.USER -> MaterialTheme.colorScheme.primaryContainer
                    MessageRole.ASSISTANT -> MaterialTheme.colorScheme.secondaryContainer
                    MessageRole.SYSTEM -> MaterialTheme.colorScheme.tertiaryContainer
                }
            ),
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isUser) 16.dp else 4.dp,
                bottomEnd = if (isUser) 4.dp else 16.dp
            )
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Content based on message type
                when (val type = message.messageType) {
                    is ChatMessageType.TaskPlanType -> {
                        TaskPlanCard(
                            plan = type.plan,
                            status = type.status,
                            onConfirm = onConfirmPlan,
                            onReject = onRejectPlan
                        )
                    }
                    is ChatMessageType.IntentRecognition -> {
                        IntentRecognitionCard(
                            intent = type.intent,
                            confidence = type.confidence
                        )
                    }
                    is ChatMessageType.Progress -> {
                        ProgressCard(info = type.info)
                    }
                    is ChatMessageType.FileReferenceType -> {
                        FileReferencesDisplay(files = type.files)
                        Text(message.content)
                    }
                    is ChatMessageType.CodeBlock -> {
                        CodeBlockDisplay(
                            language = type.language,
                            code = type.code,
                            filename = type.filename
                        )
                    }
                    else -> {
                        // Standard message with file reference highlighting
                        HighlightedMessageContent(content = message.content)
                    }
                }

                // Referenced files
                if (message.referencedFiles.isNotEmpty()) {
                    FileReferencesDisplay(files = message.referencedFiles)
                }

                // Timestamp and metadata
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = dateFormat.format(Date(message.timestamp)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        message.tokenUsage?.let { usage ->
                            Text(
                                text = "${usage.total} tokens",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        // Context mode indicator
                        Icon(
                            imageVector = when (message.contextMode) {
                                ContextMode.PROJECT -> Icons.Default.Folder
                                ContextMode.FILE -> Icons.Default.Description
                                ContextMode.GLOBAL -> Icons.Default.Public
                            },
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun HighlightedMessageContent(content: String) {
    val segments = remember(content) { FileReferenceParser.segmentText(content) }

    Text(
        text = buildAnnotatedString {
            segments.forEach { segment ->
                if (segment.isReference) {
                    withStyle(
                        SpanStyle(
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Medium,
                            background = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                        )
                    ) {
                        append(segment.text)
                    }
                } else {
                    append(segment.text)
                }
            }
        }
    )
}

@Composable
fun TaskPlanCard(
    plan: TaskPlan,
    status: PlanningState,
    onConfirm: () -> Unit,
    onReject: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = plan.title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )

        Text(
            text = plan.summary,
            style = MaterialTheme.typography.bodyMedium
        )

        // Task list
        plan.tasks.forEach { task ->
            TaskItemRow(task = task)
        }

        plan.estimatedDuration?.let { duration ->
            Text(
                text = "Estimated: $duration",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // Confirm/Reject buttons if confirming
        if (status == PlanningState.CONFIRMING) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onReject) {
                    Icon(Icons.Default.Close, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Reject")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onConfirm) {
                    Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Confirm & Execute")
                }
            }
        }
    }
}

@Composable
fun TaskItemRow(task: TaskItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Status indicator
        Box(
            modifier = Modifier
                .size(24.dp)
                .clip(CircleShape)
                .background(
                    when (task.status) {
                        TaskStatus.COMPLETED -> MaterialTheme.colorScheme.primary
                        TaskStatus.IN_PROGRESS -> MaterialTheme.colorScheme.secondary
                        TaskStatus.FAILED -> MaterialTheme.colorScheme.error
                        TaskStatus.SKIPPED -> MaterialTheme.colorScheme.outline
                        TaskStatus.PENDING -> MaterialTheme.colorScheme.surfaceVariant
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            when (task.status) {
                TaskStatus.COMPLETED -> Icon(
                    Icons.Default.Check,
                    null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onPrimary
                )
                TaskStatus.IN_PROGRESS -> CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onSecondary
                )
                else -> Text(
                    text = "${task.id}",
                    style = MaterialTheme.typography.labelSmall
                )
            }
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = task.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = task.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        // Progress for in-progress tasks
        if (task.status == TaskStatus.IN_PROGRESS && task.progress > 0) {
            Text(
                text = "${task.progress}%",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.secondary
            )
        }
    }
}

@Composable
fun IntentRecognitionCard(intent: String, confidence: Float) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Intent Recognized",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            val confidenceColor by animateColorAsState(
                targetValue = when {
                    confidence >= 0.8f -> MaterialTheme.colorScheme.primary
                    confidence >= 0.5f -> MaterialTheme.colorScheme.tertiary
                    else -> MaterialTheme.colorScheme.error
                },
                label = "confidence color"
            )

            Text(
                text = "${(confidence * 100).toInt()}%",
                style = MaterialTheme.typography.labelSmall,
                color = confidenceColor
            )
        }

        Text(
            text = intent,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
fun ProgressCard(info: com.chainlesschain.android.remote.model.ProgressInfo) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = info.message,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "${info.step}/${info.total}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }

        LinearProgressIndicator(
            progress = { info.percentage / 100f },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
fun FileReferencesDisplay(files: List<FileReference>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        files.take(3).forEach { file ->
            FilterChip(
                selected = false,
                onClick = { },
                label = {
                    Text(
                        text = file.name,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = if (file.isDirectory) Icons.Default.Folder else Icons.Default.Description,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                },
                modifier = Modifier.widthIn(max = 120.dp)
            )
        }

        if (files.size > 3) {
            FilterChip(
                selected = false,
                onClick = { },
                label = { Text("+${files.size - 3}") }
            )
        }
    }
}

@Composable
fun CodeBlockDisplay(
    language: String,
    code: String,
    filename: String?
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Code,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = filename ?: language,
                    style = MaterialTheme.typography.labelMedium
                )
            }

            Text(
                text = language,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // Code content
        Text(
            text = code,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(12.dp),
            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
        )
    }
}

@Composable
fun FilePickerPopup(
    files: List<FileReference>,
    query: String,
    onFileSelected: (FileReference) -> Unit,
    onDismiss: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp),
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 8.dp,
        shadowElevation = 4.dp
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (query.isEmpty()) "Select a file" else "Files matching \"$query\"",
                    style = MaterialTheme.typography.labelMedium
                )
                IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }

            if (files.isEmpty()) {
                Text(
                    text = "No files found",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp)
                )
            } else {
                LazyColumn(modifier = Modifier.height(200.dp)) {
                    items(files) { file ->
                        ListItem(
                            headlineContent = { Text(file.name) },
                            supportingContent = {
                                Text(
                                    text = file.path,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            },
                            leadingContent = {
                                Icon(
                                    imageVector = if (file.isDirectory) Icons.Default.Folder else Icons.Default.Description,
                                    contentDescription = null
                                )
                            },
                            modifier = Modifier.clickable { onFileSelected(file) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun CreationProgressDialog(
    progress: CreationProgress,
    onCancel: () -> Unit
) {
    Dialog(onDismissRequest = { if (progress.isComplete) onCancel() }) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = if (progress.isComplete) "Creation Complete" else "Creating Project...",
                    style = MaterialTheme.typography.titleLarge
                )

                progress.steps.forEach { step ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(
                                    when (step.status) {
                                        StepStatus.COMPLETED -> MaterialTheme.colorScheme.primary
                                        StepStatus.IN_PROGRESS -> MaterialTheme.colorScheme.secondary
                                        StepStatus.FAILED -> MaterialTheme.colorScheme.error
                                        StepStatus.PENDING -> MaterialTheme.colorScheme.surfaceVariant
                                    }
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            when (step.status) {
                                StepStatus.COMPLETED -> Icon(
                                    Icons.Default.Check,
                                    null,
                                    modifier = Modifier.size(16.dp),
                                    tint = MaterialTheme.colorScheme.onPrimary
                                )
                                StepStatus.IN_PROGRESS -> CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onSecondary
                                )
                                StepStatus.FAILED -> Icon(
                                    Icons.Default.Close,
                                    null,
                                    modifier = Modifier.size(16.dp),
                                    tint = MaterialTheme.colorScheme.onError
                                )
                                StepStatus.PENDING -> {}
                            }
                        }

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = step.name,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (step.status == StepStatus.IN_PROGRESS)
                                    FontWeight.Bold else FontWeight.Normal
                            )
                            Text(
                                text = step.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                progress.error?.let { error ->
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onCancel) {
                        Text(if (progress.isComplete) "Close" else "Cancel")
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyConnectionState() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(Icons.Default.CloudOff, null, modifier = Modifier.size(64.dp))
            Text("Not connected to PC")
            Text(
                "Connect on the main Remote Control screen first",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun EmptyConversationState(model: String?) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(Icons.Default.Chat, null, modifier = Modifier.size(64.dp))
            Text("Start a conversation")
            Text(
                "Chat with ${model ?: "LLM"} on your PC",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
fun ChatInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    enabled: Boolean,
    showFilePicker: Boolean = false,
    onAttachClick: () -> Unit = {}
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Attach file button
            IconButton(
                onClick = onAttachClick,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(
                    Icons.Default.AttachFile,
                    contentDescription = "Attach file",
                    tint = if (showFilePicker)
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Type a message... Use @ to reference files") },
                enabled = enabled,
                minLines = 1,
                maxLines = 4,
                shape = RoundedCornerShape(24.dp)
            )

            FilledIconButton(
                onClick = onSend,
                enabled = enabled && value.isNotBlank(),
                modifier = Modifier.size(48.dp)
            ) {
                Icon(Icons.Default.Send, contentDescription = "Send")
            }
        }
    }
}

@Composable
fun ModelSelectorDialog(
    selectedModel: String?,
    availableModels: List<String>,
    onModelSelected: (String) -> Unit,
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
                    Icons.Default.Tune,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    "Select Model",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
            }
        },
        text = {
            if (availableModels.isEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        Icons.Default.CloudOff,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                    Text(
                        "No models available",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        "Make sure your PC is connected and has models configured",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    )
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(availableModels) { model ->
                        EnhancedModelCard(
                            model = model,
                            isSelected = model == selectedModel,
                            onClick = { onModelSelected(model) }
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } }
    )
}

@Composable
private fun EnhancedModelCard(
    model: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val modelInfo = parseModelInfo(model)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            }
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (isSelected) 2.dp else 0.dp
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Model icon based on provider
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(
                        if (isSelected) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.surfaceVariant
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = modelInfo.icon,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = if (isSelected) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = modelInfo.displayName,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer
                        else MaterialTheme.colorScheme.onSurface
                    )

                    if (modelInfo.isRecommended) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.tertiaryContainer
                        ) {
                            Text(
                                text = "Recommended",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    ModelInfoChip(
                        label = modelInfo.provider,
                        color = MaterialTheme.colorScheme.secondary
                    )
                    ModelInfoChip(
                        label = modelInfo.tier,
                        color = when (modelInfo.tier) {
                            "Pro" -> MaterialTheme.colorScheme.primary
                            "Fast" -> MaterialTheme.colorScheme.tertiary
                            else -> MaterialTheme.colorScheme.outline
                        }
                    )
                }
            }

            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = "Selected",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

@Composable
private fun ModelInfoChip(
    label: String,
    color: Color
) {
    Surface(
        shape = RoundedCornerShape(4.dp),
        color = color.copy(alpha = 0.1f)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
        )
    }
}

private data class ModelInfo(
    val displayName: String,
    val provider: String,
    val tier: String,
    val icon: ImageVector,
    val isRecommended: Boolean
)

private fun parseModelInfo(model: String): ModelInfo {
    val lowerModel = model.lowercase()

    return when {
        lowerModel.contains("gpt-4") -> ModelInfo(
            displayName = "GPT-4",
            provider = "OpenAI",
            tier = "Pro",
            icon = Icons.Default.Cloud,
            isRecommended = true
        )
        lowerModel.contains("gpt-3.5") || lowerModel.contains("gpt3") -> ModelInfo(
            displayName = "GPT-3.5 Turbo",
            provider = "OpenAI",
            tier = "Fast",
            icon = Icons.Default.Cloud,
            isRecommended = false
        )
        lowerModel.contains("claude") -> ModelInfo(
            displayName = if (lowerModel.contains("opus")) "Claude Opus"
                         else if (lowerModel.contains("sonnet")) "Claude Sonnet"
                         else "Claude",
            provider = "Anthropic",
            tier = "Pro",
            icon = Icons.Default.Cloud,
            isRecommended = lowerModel.contains("opus")
        )
        lowerModel.contains("deepseek") -> ModelInfo(
            displayName = "DeepSeek",
            provider = "DeepSeek",
            tier = "Fast",
            icon = Icons.Default.Cloud,
            isRecommended = true
        )
        lowerModel.contains("qwen") -> ModelInfo(
            displayName = "Qwen",
            provider = "Alibaba",
            tier = "Fast",
            icon = Icons.Default.Cloud,
            isRecommended = false
        )
        lowerModel.contains("llama") -> ModelInfo(
            displayName = model,
            provider = "Ollama",
            tier = "Local",
            icon = Icons.Default.Code,
            isRecommended = false
        )
        lowerModel.contains("mistral") -> ModelInfo(
            displayName = "Mistral",
            provider = "Mistral AI",
            tier = "Fast",
            icon = Icons.Default.Cloud,
            isRecommended = false
        )
        lowerModel.contains("gemini") -> ModelInfo(
            displayName = "Gemini",
            provider = "Google",
            tier = "Pro",
            icon = Icons.Default.Cloud,
            isRecommended = false
        )
        else -> ModelInfo(
            displayName = model,
            provider = "Custom",
            tier = "Standard",
            icon = Icons.Default.Code,
            isRecommended = false
        )
    }
}

@Composable
fun SettingsDialog(
    temperature: Float,
    onTemperatureChange: (Float) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Chat Settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Temperature")
                    Text(String.format("%.1f", temperature), fontWeight = FontWeight.Bold)
                }
                Slider(
                    value = temperature,
                    onValueChange = onTemperatureChange,
                    valueRange = 0f..2f,
                    steps = 19
                )
                Text(
                    text = "Lower = more focused, Higher = more creative",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } }
    )
}
