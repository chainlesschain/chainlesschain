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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.viewmodel.ProjectUiEvent
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreateProjectScreen(
    viewModel: ProjectViewModel = hiltViewModel(),
    authViewModel: com.chainlesschain.android.feature.auth.presentation.AuthViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onProjectCreated: (String) -> Unit
) {
    val isLoading by viewModel.isLoading.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(ProjectType.OTHER) }
    var tagInput by remember { mutableStateOf("") }
    val tags = remember { mutableStateListOf<String>() }

    // AI Assistant state
    var showAiAssistant by remember { mutableStateOf(false) }
    var aiPrompt by remember { mutableStateOf("") }
    var isAiThinking by remember { mutableStateOf(false) }
    var aiSuggestion by remember { mutableStateOf<String?>(null) }

    // 获取认证状态并初始化用户上下文
    val authState by authViewModel.uiState.collectAsState()

    LaunchedEffect(authState.currentUser) {
        authState.currentUser?.let { user ->
            viewModel.setCurrentUser(user.id)
        }
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
                title = { Text("创建项目") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
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
                    // TODO: Integrate with AI service
                    isAiThinking = true
                    // Simulate AI response for now
                    aiSuggestion = "Based on your description, I suggest:\n\n" +
                        "- Project Name: ${if (aiPrompt.length > 20) aiPrompt.take(20) + "..." else aiPrompt}\n" +
                        "- Type: Document\n" +
                        "- Tags: AI, Project\n\n" +
                        "Would you like me to apply these suggestions?"
                    isAiThinking = false
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
                label = { Text("项目名称 *") },
                placeholder = { Text("输入项目名称") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 项目描述
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("项目描述") },
                placeholder = { Text("输入项目描述（可选）") },
                minLines = 3,
                maxLines = 5,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(24.dp))

            // 项目类型
            Text(
                text = "项目类型",
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
                text = "标签",
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = tagInput,
                onValueChange = { tagInput = it },
                label = { Text("添加标签") },
                placeholder = { Text("输入标签后按回车添加") },
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
                            Icon(Icons.Default.Add, contentDescription = "添加")
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
                                        contentDescription = "移除",
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
                    viewModel.createProject(
                        name = name.trim(),
                        description = description.trim().takeIf { it.isNotEmpty() },
                        type = selectedType,
                        tags = tags.toList().takeIf { it.isNotEmpty() }
                    )
                },
                enabled = name.isNotBlank() && !isLoading,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (isLoading) "创建中..." else "创建项目")
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

private fun getTypeDisplayName(type: String): String {
    return when (type) {
        ProjectType.DOCUMENT -> "文档"
        ProjectType.WEB -> "网站"
        ProjectType.APP -> "应用"
        ProjectType.DATA -> "数据"
        ProjectType.DESIGN -> "设计"
        ProjectType.RESEARCH -> "研究"
        ProjectType.OTHER -> "其他"
        else -> "未知"
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
                        text = "AI 创建助手",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "描述你的项目，AI 会帮你创建",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Icon(
                    imageVector = if (showAssistant) Icons.Default.Close else Icons.Default.SmartToy,
                    contentDescription = if (showAssistant) "关闭" else "展开",
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
                        text = "快速模板:",
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
                            text = "文档",
                            onClick = { onPromptChange("Create a documentation project") }
                        )
                        QuickTemplateChip(
                            text = "数据分析",
                            onClick = { onPromptChange("Create a data analysis project") }
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Input field
                    OutlinedTextField(
                        value = aiPrompt,
                        onValueChange = onPromptChange,
                        label = { Text("描述你想创建的项目") },
                        placeholder = { Text("例如：创建一个博客项目，包含文章、评论功能...") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 2,
                        maxLines = 4,
                        trailingIcon = {
                            if (aiPrompt.isNotBlank() && !isThinking) {
                                IconButton(onClick = onSubmitPrompt) {
                                    Icon(
                                        Icons.AutoMirrored.Filled.Send,
                                        contentDescription = "发送",
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
                                        text = "AI 建议",
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
                                        Text("忽略")
                                    }
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Button(onClick = onApplySuggestion) {
                                        Text("应用建议")
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
