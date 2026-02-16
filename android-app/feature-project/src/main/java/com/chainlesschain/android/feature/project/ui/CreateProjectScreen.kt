package com.chainlesschain.android.feature.project.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DesignServices
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Web
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.R
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.viewmodel.ProjectUiEvent
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreateProjectScreen(
    viewModel: ProjectViewModel = hiltViewModel(),
    userId: String? = null,
    onNavigateBack: () -> Unit,
    onProjectCreated: (String) -> Unit
) {
    val isLoading by viewModel.isLoading.collectAsState()
    val currentUserId by viewModel.currentUserId.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(ProjectType.OTHER) }
    var tagInput by remember { mutableStateOf("") }
    val tags = remember { mutableStateListOf<String>() }

    val scope = rememberCoroutineScope()

    // 确保用户ID已设置
    LaunchedEffect(userId) {
        userId?.let { viewModel.setCurrentUser(it) }
    }

    // AI Assistant state
    var showAiAssistant by remember { mutableStateOf(false) }
    var aiPrompt by remember { mutableStateOf("") }
    var isAiThinking by remember { mutableStateOf(false) }
    var aiSuggestion by remember { mutableStateOf<String?>(null) }

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
                is ProjectUiEvent.NavigateToProject -> {
                    onProjectCreated(event.projectId)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.create_project)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            // AI Assistant Section
            AiAssistantSection(
                showAssistant = showAiAssistant,
                onToggleAssistant = { showAiAssistant = !showAiAssistant },
                aiPrompt = aiPrompt,
                onPromptChange = { aiPrompt = it },
                isThinking = isAiThinking,
                suggestion = aiSuggestion,
                onSubmitPrompt = {
                    isAiThinking = true
                    scope.launch {
                        try {
                            val response = viewModel.generateAISuggestion(aiPrompt)
                            aiSuggestion = response
                        } catch (e: Exception) {
                            aiSuggestion = "AI 服务暂时不可用，请稍后重试。\n\n" +
                                "建议：\n" +
                                "- 项目名称: ${if (aiPrompt.length > 20) aiPrompt.take(20) + "..." else aiPrompt}\n" +
                                "- 类型: 文档\n" +
                                "- 标签: AI, Project"
                        } finally {
                            isAiThinking = false
                        }
                    }
                },
                onApplySuggestion = {
                    // Apply AI suggestions to form
                    if (aiPrompt.isNotBlank()) {
                        name = aiPrompt.take(50)
                        description = "AI-generated project based on: $aiPrompt"
                    }
                    showAiAssistant = false
                    aiSuggestion = null
                },
                onDismissSuggestion = {
                    aiSuggestion = null
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 项目名称
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(stringResource(R.string.project_name_required)) },
                placeholder = { Text(stringResource(R.string.enter_project_name)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 项目描述
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text(stringResource(R.string.project_description)) },
                placeholder = { Text(stringResource(R.string.enter_project_description)) },
                minLines = 3,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(24.dp))

            // 项目类型
            Text(
                text = stringResource(R.string.project_type),
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(12.dp))

            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ProjectType.ALL_TYPES.forEach { type ->
                    ProjectTypeCard(
                        type = type,
                        isSelected = selectedType == type,
                        onClick = { selectedType = type }
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // 标签
            Text(
                text = stringResource(R.string.tags),
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = tagInput,
                onValueChange = { tagInput = it },
                label = { Text(stringResource(R.string.add_tags)) },
                placeholder = { Text(stringResource(R.string.enter_tag_hint)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = {
                    if (tagInput.isNotBlank()) {
                        IconButton(onClick = {
                            if (tagInput.isNotBlank() && !tags.contains(tagInput.trim())) {
                                tags.add(tagInput.trim())
                                tagInput = ""
                            }
                        }) {
                            Icon(Icons.Default.Add, contentDescription = stringResource(R.string.add))
                        }
                    }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(
                    onDone = {
                        if (tagInput.isNotBlank() && !tags.contains(tagInput.trim())) {
                            tags.add(tagInput.trim())
                            tagInput = ""
                        }
                    }
                )
            )

            if (tags.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))

                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    tags.forEach { tag ->
                        InputChip(
                            selected = false,
                            onClick = {},
                            label = { Text(tag) },
                            trailingIcon = {
                                IconButton(
                                    onClick = { tags.remove(tag) },
                                    modifier = Modifier.size(18.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Close,
                                        contentDescription = stringResource(R.string.remove),
                                        modifier = Modifier.size(14.dp)
                                    )
                                }
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // 创建按钮
            Button(
                onClick = {
                    // 确保用户ID已设置
                    val effectiveUserId = userId ?: currentUserId
                    if (effectiveUserId != null) {
                        viewModel.setCurrentUser(effectiveUserId)
                        viewModel.createProject(
                            name = name.trim(),
                            description = description.trim().takeIf { it.isNotEmpty() },
                            type = selectedType,
                            tags = tags.toList().takeIf { it.isNotEmpty() }
                        )
                    } else {
                        scope.launch {
                            snackbarHostState.showSnackbar(context.getString(R.string.login_required_to_create))
                        }
                    }
                },
                enabled = name.isNotBlank() && !isLoading,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(stringResource(if (isLoading) R.string.creating else R.string.create_project))
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun ProjectTypeCard(
    type: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val (icon, color) = getTypeIconAndColor(type)

    Card(
        modifier = Modifier
            .width(100.dp)
            .clickable(onClick = onClick)
            .then(
                if (isSelected) {
                    Modifier.border(
                        width = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                        shape = RoundedCornerShape(12.dp)
                    )
                } else {
                    Modifier
                }
            ),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            }
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(color.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = color,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = getTypeDisplayName(type),
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}

private fun getTypeIconAndColor(type: String): Pair<ImageVector, Color> {
    return when (type) {
        ProjectType.DOCUMENT -> Icons.Default.Description to Color(0xFF2196F3)
        ProjectType.WEB -> Icons.Default.Web to Color(0xFFFF9800)
        ProjectType.APP -> Icons.Default.Apps to Color(0xFF4CAF50)
        ProjectType.DATA -> Icons.Default.Analytics to Color(0xFF9C27B0)
        ProjectType.DESIGN -> Icons.Default.DesignServices to Color(0xFFE91E63)
        ProjectType.RESEARCH -> Icons.Default.Science to Color(0xFF00BCD4)
        else -> Icons.Default.Folder to Color(0xFF607D8B)
    }
}

@Composable
private fun getTypeDisplayName(type: String): String {
    return when (type) {
        ProjectType.DOCUMENT -> stringResource(R.string.type_document)
        ProjectType.WEB -> stringResource(R.string.type_web)
        ProjectType.APP -> stringResource(R.string.type_app)
        ProjectType.DATA -> stringResource(R.string.type_data)
        ProjectType.DESIGN -> stringResource(R.string.type_design)
        ProjectType.RESEARCH -> stringResource(R.string.type_research)
        ProjectType.OTHER -> stringResource(R.string.type_other)
        else -> stringResource(R.string.type_unknown)
    }
}

/**
 * AI Assistant Section for project creation
 */
@Composable
private fun AiAssistantSection(
    showAssistant: Boolean,
    onToggleAssistant: () -> Unit,
    aiPrompt: String,
    onPromptChange: (String) -> Unit,
    isThinking: Boolean,
    suggestion: String?,
    onSubmitPrompt: () -> Unit,
    onApplySuggestion: () -> Unit,
    onDismissSuggestion: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggleAssistant),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = stringResource(R.string.ai_creation_assistant),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = stringResource(R.string.ai_creation_assistant_desc),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Icon(
                    imageVector = if (showAssistant) Icons.Default.Close else Icons.Default.SmartToy,
                    contentDescription = stringResource(if (showAssistant) R.string.close else R.string.expand),
                    tint = MaterialTheme.colorScheme.primary
                )
            }

            // Expandable content
            AnimatedVisibility(
                visible = showAssistant,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column {
                    Spacer(modifier = Modifier.height(16.dp))

                    // Quick templates
                    Text(
                        text = stringResource(R.string.quick_templates),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        QuickTemplateChip(
                            text = "Web App",
                            onClick = { onPromptChange("Create a web application project") }
                        )
                        QuickTemplateChip(
                            text = stringResource(R.string.template_document),
                            onClick = { onPromptChange("Create a documentation project") }
                        )
                        QuickTemplateChip(
                            text = stringResource(R.string.template_data_analysis),
                            onClick = { onPromptChange("Create a data analysis project") }
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Input field
                    OutlinedTextField(
                        value = aiPrompt,
                        onValueChange = onPromptChange,
                        label = { Text(stringResource(R.string.describe_project)) },
                        placeholder = { Text(stringResource(R.string.describe_project_example)) },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 2,
                        maxLines = 4,
                        trailingIcon = {
                            if (aiPrompt.isNotBlank() && !isThinking) {
                                IconButton(onClick = onSubmitPrompt) {
                                    Icon(
                                        Icons.AutoMirrored.Filled.Send,
                                        contentDescription = stringResource(R.string.send),
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                            } else if (isThinking) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    strokeWidth = 2.dp
                                )
                            }
                        }
                    )

                    // AI Suggestion
                    if (suggestion != null) {
                        Spacer(modifier = Modifier.height(16.dp))
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = Icons.Default.SmartToy,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp),
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = stringResource(R.string.ai_suggestion),
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = suggestion,
                                    style = MaterialTheme.typography.bodySmall
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.End
                                ) {
                                    TextButton(onClick = onDismissSuggestion) {
                                        Text(stringResource(R.string.ignore))
                                    }
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Button(onClick = onApplySuggestion) {
                                        Text(stringResource(R.string.apply_suggestion))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Quick template chip
 */
@Composable
private fun QuickTemplateChip(
    text: String,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary
        )
    }
}
