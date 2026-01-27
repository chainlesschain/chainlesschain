package com.chainlesschain.android.feature.ai.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.domain.model.LLMModel
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * 新建对话界面
 *
 * 包含模型选择和API Key配置
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewConversationScreen(
    onNavigateBack: () -> Unit,
    onConversationCreated: (String) -> Unit,
    viewModel: ConversationViewModel = hiltViewModel()
) {
    var title by remember { mutableStateOf("") }
    var selectedModel by remember { mutableStateOf<LLMModel?>(null) }
    var showModelPicker by remember { mutableStateOf(false) }
    var apiKey by remember { mutableStateOf("") }
    var showApiKeyInput by remember { mutableStateOf(false) }

    val uiState by viewModel.uiState.collectAsState()

    // 当选择模型时，自动加载已保存的API Key
    LaunchedEffect(selectedModel) {
        selectedModel?.let { model ->
            if (model.provider != LLMProvider.OLLAMA) {
                val savedApiKey = viewModel.getApiKey(model.provider)
                if (savedApiKey != null) {
                    apiKey = savedApiKey
                }
            }
        }
    }

    // 创建成功后导航
    LaunchedEffect(uiState.operationSuccess) {
        if (uiState.operationSuccess) {
            viewModel.currentConversation.value?.let { conversation ->
                onConversationCreated(conversation.id)
            }
            viewModel.clearSuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("新建对话") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 创建按钮
                    TextButton(
                        onClick = {
                            if (title.isBlank()) {
                                title = "新对话"
                            }
                            selectedModel?.let { model ->
                                // 先设置当前模型（setApiKey需要currentModel）
                                viewModel.setCurrentModel(model)

                                // 保存API Key
                                if (apiKey.isNotEmpty()) {
                                    viewModel.setApiKey(apiKey)
                                }

                                // 创建对话
                                viewModel.createConversation(title, model.id)
                            }
                        },
                        enabled = selectedModel != null && !uiState.isLoading
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text("创建")
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 标题输入
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("对话标题") },
                placeholder = { Text("例如：学习Kotlin") },
                singleLine = true
            )

            // 模型选择
            OutlinedCard(
                onClick = { showModelPicker = true },
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "选择模型",
                            style = MaterialTheme.typography.labelMedium
                        )
                        Text(
                            text = selectedModel?.name ?: "请选择...",
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (selectedModel != null) {
                                MaterialTheme.colorScheme.onSurface
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                    Icon(
                        imageVector = Icons.Default.ChevronRight,
                        contentDescription = null
                    )
                }
            }

            // API Key输入（仅非Ollama模型需要）
            if (selectedModel != null && selectedModel?.provider != LLMProvider.OLLAMA) {
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("API Key") },
                    placeholder = { Text("输入${selectedModel?.provider?.displayName} API Key") },
                    singleLine = true,
                    trailingIcon = {
                        IconButton(onClick = { showApiKeyInput = !showApiKeyInput }) {
                            Icon(
                                imageVector = if (showApiKeyInput) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                contentDescription = if (showApiKeyInput) "隐藏" else "显示"
                            )
                        }
                    },
                    visualTransformation = if (showApiKeyInput) {
                        androidx.compose.ui.text.input.VisualTransformation.None
                    } else {
                        androidx.compose.ui.text.input.PasswordVisualTransformation()
                    }
                )

                Text(
                    text = "API Key将加密保存在本地",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Ollama提示
            if (selectedModel?.provider == LLMProvider.OLLAMA) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                        Text(
                            text = "Ollama本地模型无需API Key，请确保Ollama服务正在运行",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Text(
                        text = error,
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }
        }

        // 模型选择对话框
        if (showModelPicker) {
            ModelPickerDialog(
                onDismiss = { showModelPicker = false },
                onModelSelected = { model ->
                    selectedModel = model
                    showModelPicker = false
                }
            )
        }
    }
}

/**
 * 模型选择对话框
 */
@Composable
fun ModelPickerDialog(
    onDismiss: () -> Unit,
    onModelSelected: (LLMModel) -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("选择模型") },
        text = {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // OpenAI模型
                item {
                    Text(
                        text = "OpenAI",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                items(LLMProvider.DEFAULT_MODELS[LLMProvider.OPENAI] ?: emptyList()) { model ->
                    ModelCard(
                        model = model,
                        onClick = { onModelSelected(model) }
                    )
                }

                // DeepSeek模型
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "DeepSeek",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                items(LLMProvider.DEFAULT_MODELS[LLMProvider.DEEPSEEK] ?: emptyList()) { model ->
                    ModelCard(
                        model = model,
                        onClick = { onModelSelected(model) }
                    )
                }

                // DOUBAO (火山引擎/豆包) 模型
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "豆包 (火山引擎)",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                items(LLMProvider.DEFAULT_MODELS[LLMProvider.DOUBAO] ?: emptyList()) { model ->
                    ModelCard(
                        model = model,
                        onClick = { onModelSelected(model) }
                    )
                }

                // Ollama模型
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Ollama (本地)",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                items(LLMProvider.DEFAULT_MODELS[LLMProvider.OLLAMA] ?: emptyList()) { model ->
                    ModelCard(
                        model = model,
                        onClick = { onModelSelected(model) }
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 模型卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelCard(
    model: LLMModel,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = model.name,
                    style = MaterialTheme.typography.bodyLarge
                )
                Text(
                    text = "最大${model.maxTokens} tokens",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
