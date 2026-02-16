package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * LLM设置界面 - 统一管理所有LLM提供商的API密钥和配置
 *
 * 功能：
 * 1. 配置各个云端LLM提供商的API密钥
 * 2. 测试连接功能
 * 3. Ollama局域网自动发现
 * 4. 自定义端点配置
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LLMSettingsScreen(
    onNavigateBack: () -> Unit,
    viewModel: LLMSettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 显示提示消息
    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.llm_settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, stringResource(R.string.common_back))
                    }
                },
                actions = {
                    // 刷新Ollama服务发现
                    if (uiState.selectedProvider == LLMProvider.OLLAMA) {
                        IconButton(
                            onClick = { viewModel.discoverOllamaServices() },
                            enabled = !uiState.isDiscovering
                        ) {
                            Icon(
                                if (uiState.isDiscovering) Icons.Default.Refresh else Icons.Default.Wifi,
                                stringResource(R.string.llm_settings_discover)
                            )
                        }
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
        ) {
            // 提供商选择区域
            ProviderSelector(
                selectedProvider = uiState.selectedProvider,
                onProviderSelected = { viewModel.selectProvider(it) },
                modifier = Modifier.padding(16.dp)
            )

            HorizontalDivider()

            // 配置区域
            when (uiState.selectedProvider) {
                LLMProvider.OLLAMA -> {
                    OllamaConfiguration(
                        viewModel = viewModel,
                        uiState = uiState,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                    )
                }
                else -> {
                    CloudProviderConfiguration(
                        viewModel = viewModel,
                        uiState = uiState,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                    )
                }
            }
        }
    }
}

/**
 * 提供商选择器
 */
@Composable
fun ProviderSelector(
    selectedProvider: LLMProvider,
    onProviderSelected: (LLMProvider) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        Text(
            text = stringResource(R.string.llm_select_provider),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = 8.dp)
        )

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.height(200.dp)
        ) {
            items(LLMProvider.values().toList()) { provider ->
                ProviderCard(
                    provider = provider,
                    isSelected = provider == selectedProvider,
                    onClick = { onProviderSelected(provider) }
                )
            }
        }
    }
}

/**
 * 提供商卡片
 */
@Composable
fun ProviderCard(
    provider: LLMProvider,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val context = LocalContext.current
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = provider.displayName,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = getProviderDescription(context, provider),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (isSelected) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = stringResource(R.string.llm_settings_selected),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

/**
 * 云端提供商配置界面
 */
@Composable
fun CloudProviderConfiguration(
    viewModel: LLMSettingsViewModel,
    uiState: LLMSettingsUiState,
    modifier: Modifier = Modifier
) {
    var apiKey by remember { mutableStateOf("") }
    var endpoint by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    // 加载保存的配置
    LaunchedEffect(uiState.selectedProvider) {
        apiKey = uiState.currentApiKey ?: ""
        endpoint = uiState.currentEndpoint ?: ""
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = stringResource(R.string.llm_settings_config_title, uiState.selectedProvider.displayName),
            style = MaterialTheme.typography.titleLarge
        )

        // API密钥输入
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text("API Key") },
            placeholder = { Text(stringResource(R.string.llm_settings_api_key_hint)) },
            visualTransformation = if (showPassword)
                VisualTransformation.None
            else
                PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { showPassword = !showPassword }) {
                    Icon(
                        if (showPassword) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                        stringResource(R.string.llm_settings_toggle_key)
                    )
                }
            },
            modifier = Modifier.fillMaxWidth()
        )

        // 自定义端点（仅部分提供商需要）
        if (uiState.selectedProvider in listOf(LLMProvider.CUSTOM, LLMProvider.OPENAI)) {
            OutlinedTextField(
                value = endpoint,
                onValueChange = { endpoint = it },
                label = { Text(stringResource(R.string.llm_settings_api_endpoint)) },
                placeholder = { Text("https://api.example.com/v1") },
                leadingIcon = { Icon(Icons.Default.Link, null) },
                modifier = Modifier.fillMaxWidth()
            )
        }

        // 操作按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = {
                    viewModel.saveConfiguration(
                        apiKey = apiKey.takeIf { it.isNotBlank() },
                        endpoint = endpoint.takeIf { it.isNotBlank() }
                    )
                },
                modifier = Modifier.weight(1f),
                enabled = apiKey.isNotBlank() && !uiState.isTesting
            ) {
                Icon(Icons.Default.Save, null, Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.common_save))
            }

            OutlinedButton(
                onClick = {
                    viewModel.testConnection(
                        apiKey = apiKey.takeIf { it.isNotBlank() },
                        endpoint = endpoint.takeIf { it.isNotBlank() }
                    )
                },
                modifier = Modifier.weight(1f),
                enabled = apiKey.isNotBlank() && !uiState.isTesting
            ) {
                if (uiState.isTesting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(Icons.Default.CloudSync, null, Modifier.size(18.dp))
                }
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.llm_settings_test_connection))
            }
        }

        // 连接状态显示
        if (uiState.connectionStatus != null) {
            ConnectionStatusCard(
                isSuccess = uiState.connectionStatus,
                message = if (uiState.connectionStatus)
                    stringResource(R.string.llm_settings_test_success)
                else
                    stringResource(R.string.llm_settings_test_fail)
            )
        }

        Spacer(Modifier.weight(1f))

        // 提示信息
        ProviderHelpCard(provider = uiState.selectedProvider)
    }
}

/**
 * Ollama配置界面
 */
@Composable
fun OllamaConfiguration(
    viewModel: LLMSettingsViewModel,
    uiState: LLMSettingsUiState,
    modifier: Modifier = Modifier
) {
    var manualUrl by remember { mutableStateOf("http://") }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = stringResource(R.string.llm_settings_ollama_title),
            style = MaterialTheme.typography.titleLarge
        )

        // 局域网自动发现
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.secondaryContainer
            )
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.llm_settings_discovered_services),
                        style = MaterialTheme.typography.titleMedium
                    )
                    if (uiState.isDiscovering) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    }
                }

                if (uiState.discoveredOllamaServices.isEmpty()) {
                    Text(
                        text = if (uiState.isDiscovering)
                            stringResource(R.string.llm_settings_scanning)
                        else
                            stringResource(R.string.llm_settings_no_services),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
                    )
                } else {
                    uiState.discoveredOllamaServices.forEach { service ->
                        OllamaServiceItem(
                            url = service,
                            isSelected = service == uiState.currentEndpoint,
                            onSelect = { viewModel.selectOllamaService(service) }
                        )
                    }
                }
            }
        }

        // 手动输入URL
        OutlinedTextField(
            value = manualUrl,
            onValueChange = { manualUrl = it },
            label = { Text(stringResource(R.string.llm_settings_manual_input)) },
            placeholder = { Text("http://192.168.1.100:11434") },
            leadingIcon = { Icon(Icons.Default.Computer, null) },
            modifier = Modifier.fillMaxWidth()
        )

        Button(
            onClick = { viewModel.testOllamaConnection(manualUrl) },
            modifier = Modifier.fillMaxWidth(),
            enabled = manualUrl.startsWith("http") && !uiState.isTesting
        ) {
            if (uiState.isTesting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary
                )
            } else {
                Icon(Icons.Default.PlayArrow, null)
            }
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.llm_settings_test_connection))
        }

        // 连接状态
        if (uiState.connectionStatus != null) {
            ConnectionStatusCard(
                isSuccess = uiState.connectionStatus,
                message = if (uiState.connectionStatus) {
                    stringResource(R.string.llm_settings_ollama_success, uiState.availableModels.joinToString(", "))
                } else {
                    stringResource(R.string.llm_settings_ollama_fail)
                }
            )
        }

        Spacer(Modifier.weight(1f))

        // 帮助信息
        Card(
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer
            )
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = stringResource(R.string.llm_settings_usage_tips),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.llm_settings_ollama_usage_tips),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.8f)
                )
            }
        }
    }
}

/**
 * Ollama服务项
 */
@Composable
fun OllamaServiceItem(
    url: String,
    isSelected: Boolean,
    onSelect: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected)
                MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
            else
                MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Computer,
                    contentDescription = null,
                    tint = if (isSelected)
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = url,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            if (isSelected) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = stringResource(R.string.llm_settings_selected),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

/**
 * 连接状态卡片
 */
@Composable
fun ConnectionStatusCard(
    isSuccess: Boolean,
    message: String
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isSuccess)
                MaterialTheme.colorScheme.primaryContainer
            else
                MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                if (isSuccess) Icons.Default.CheckCircle else Icons.Default.Error,
                contentDescription = null,
                tint = if (isSuccess)
                    MaterialTheme.colorScheme.primary
                else
                    MaterialTheme.colorScheme.error
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

/**
 * 提供商帮助卡片
 */
@Composable
fun ProviderHelpCard(provider: LLMProvider) {
    val context = LocalContext.current
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = stringResource(R.string.llm_settings_get_api_key),
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = getProviderHelp(context, provider),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 获取提供商描述
 */
fun getProviderDescription(context: android.content.Context, provider: LLMProvider): String = when (provider) {
    LLMProvider.OPENAI -> "GPT-4, GPT-3.5-Turbo"
    LLMProvider.DEEPSEEK -> "DeepSeek-Chat, DeepSeek-Coder"
    LLMProvider.CLAUDE -> "Claude-3-Opus, Sonnet, Haiku"
    LLMProvider.GEMINI -> "Gemini-Pro, Gemini-Pro-Vision"
    LLMProvider.QWEN -> context.getString(R.string.llm_provider_dashscope)
    LLMProvider.ERNIE -> context.getString(R.string.llm_provider_ernie)
    LLMProvider.CHATGLM -> context.getString(R.string.llm_provider_zhipu)
    LLMProvider.MOONSHOT -> context.getString(R.string.llm_provider_kimi)
    LLMProvider.SPARK -> context.getString(R.string.llm_provider_spark)
    LLMProvider.DOUBAO -> context.getString(R.string.llm_provider_doubao)
    LLMProvider.OLLAMA -> context.getString(R.string.llm_provider_ollama)
    LLMProvider.CUSTOM -> context.getString(R.string.llm_provider_custom)
}

/**
 * 获取提供商帮助信息
 */
fun getProviderHelp(context: android.content.Context, provider: LLMProvider): String = when (provider) {
    LLMProvider.OPENAI -> context.getString(R.string.llm_help_openai)
    LLMProvider.DEEPSEEK -> context.getString(R.string.llm_help_deepseek)
    LLMProvider.CLAUDE -> context.getString(R.string.llm_help_claude)
    LLMProvider.GEMINI -> context.getString(R.string.llm_help_gemini)
    LLMProvider.QWEN -> context.getString(R.string.llm_help_qwen)
    LLMProvider.ERNIE -> context.getString(R.string.llm_help_ernie)
    LLMProvider.CHATGLM -> context.getString(R.string.llm_help_chatglm)
    LLMProvider.MOONSHOT -> context.getString(R.string.llm_help_moonshot)
    LLMProvider.SPARK -> context.getString(R.string.llm_help_spark)
    LLMProvider.DOUBAO -> context.getString(R.string.llm_help_doubao)
    LLMProvider.OLLAMA -> context.getString(R.string.llm_help_ollama)
    LLMProvider.CUSTOM -> context.getString(R.string.llm_help_custom)
}
