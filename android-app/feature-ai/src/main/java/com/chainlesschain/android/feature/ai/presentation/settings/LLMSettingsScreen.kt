package com.chainlesschain.android.feature.ai.presentation.settings

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * LLM设置主界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LLMSettingsScreen(
    onNavigateBack: () -> Unit,
    viewModel: LLMSettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentProvider by viewModel.currentProvider.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("LLM配置") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 刷新按钮
                    IconButton(onClick = { viewModel.loadConfig() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                    // 重置按钮
                    IconButton(onClick = { viewModel.resetToDefault() }) {
                        Icon(Icons.Default.RestartAlt, contentDescription = "重置")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when (val state = uiState) {
                is LLMSettingsUiState.Loading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }

                is LLMSettingsUiState.Error -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Error,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = state.message,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadConfig() }) {
                            Text("重试")
                        }
                    }
                }

                is LLMSettingsUiState.Success -> {
                    LLMSettingsContent(
                        config = state.config,
                        currentProvider = currentProvider,
                        validationErrors = state.validationErrors,
                        onProviderChange = { viewModel.switchProvider(it) },
                        onUpdateOllama = { url, model, embedding ->
                            viewModel.updateOllamaConfig(url, model, embedding)
                        },
                        onUpdateOpenAI = { key, url, model ->
                            viewModel.updateOpenAIConfig(key, url, model)
                        },
                        onUpdateDeepSeek = { key, url, model ->
                            viewModel.updateDeepSeekConfig(key, url, model)
                        },
                        onUpdateAnthropic = { key, url, model ->
                            viewModel.updateAnthropicConfig(key, url, model)
                        },
                        onUpdateProvider = { provider, key, url, model ->
                            viewModel.updateProviderConfig(provider, key, url, model)
                        },
                        onUpdateOptions = { temp, topP, topK, maxTokens ->
                            viewModel.updateOptions(temp, topP, topK, maxTokens)
                        },
                        onTestConnection = { viewModel.testConnection(it) },
                        onValidate = { viewModel.validateConfig() }
                    )
                }

                is LLMSettingsUiState.Testing -> {
                    LLMSettingsContent(
                        config = LLMConfiguration(), // Dummy
                        currentProvider = currentProvider,
                        validationErrors = emptyList(),
                        onProviderChange = {},
                        onUpdateOllama = { _, _, _ -> },
                        onUpdateOpenAI = { _, _, _ -> },
                        onUpdateDeepSeek = { _, _, _ -> },
                        onUpdateAnthropic = { _, _, _ -> },
                        onUpdateProvider = { _, _, _, _ -> },
                        onUpdateOptions = { _, _, _, _ -> },
                        onTestConnection = {},
                        onValidate = {}
                    )
                    // 显示测试中的提示
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.8f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Card(
                            modifier = Modifier.padding(32.dp)
                        ) {
                            Column(
                                modifier = Modifier.padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                CircularProgressIndicator()
                                Spacer(modifier = Modifier.height(16.dp))
                                Text("测试连接中...")
                            }
                        }
                    }
                }

                is LLMSettingsUiState.TestResult -> {
                    // 显示测试结果提示（暂时）
                }
            }
        }
    }
}

@Composable
private fun LLMSettingsContent(
    config: com.chainlesschain.android.feature.ai.data.config.LLMConfiguration,
    currentProvider: LLMProvider,
    validationErrors: List<String>,
    onProviderChange: (LLMProvider) -> Unit,
    onUpdateOllama: (String, String, String) -> Unit,
    onUpdateOpenAI: (String, String, String) -> Unit,
    onUpdateDeepSeek: (String, String, String) -> Unit,
    onUpdateAnthropic: (String, String, String) -> Unit,
    onUpdateProvider: (LLMProvider, String, String, String) -> Unit,
    onUpdateOptions: (Float, Float, Int, Int) -> Unit,
    onTestConnection: (LLMProvider) -> Unit,
    onValidate: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 提供商选择器
        item {
            ProviderSelector(
                currentProvider = currentProvider,
                onProviderChange = onProviderChange
            )
        }

        // 验证错误提示
        if (validationErrors.isNotEmpty()) {
            item {
                ValidationErrorsCard(errors = validationErrors)
            }
        }

        // 当前提供商的配置
        item {
            when (currentProvider) {
                LLMProvider.OLLAMA -> OllamaConfigCard(
                    config = config.ollama,
                    onSave = onUpdateOllama,
                    onTest = { onTestConnection(LLMProvider.OLLAMA) }
                )

                LLMProvider.OPENAI -> OpenAIConfigCard(
                    config = config.openai,
                    onSave = onUpdateOpenAI,
                    onTest = { onTestConnection(LLMProvider.OPENAI) }
                )

                LLMProvider.DEEPSEEK -> DeepSeekConfigCard(
                    config = config.deepseek,
                    onSave = onUpdateDeepSeek,
                    onTest = { onTestConnection(LLMProvider.DEEPSEEK) }
                )

                LLMProvider.CLAUDE -> AnthropicConfigCard(
                    config = config.anthropic,
                    onSave = onUpdateAnthropic,
                    onTest = { onTestConnection(LLMProvider.CLAUDE) }
                )

                LLMProvider.DOUBAO -> GenericProviderConfigCard(
                    provider = LLMProvider.DOUBAO,
                    providerName = "豆包（火山引擎）",
                    apiKey = config.volcengine.apiKey,
                    baseURL = config.volcengine.baseURL,
                    model = config.volcengine.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.DOUBAO) }
                )

                LLMProvider.QWEN -> GenericProviderConfigCard(
                    provider = LLMProvider.QWEN,
                    providerName = "通义千问",
                    apiKey = config.qwen.apiKey,
                    baseURL = config.qwen.baseURL,
                    model = config.qwen.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.QWEN) }
                )

                LLMProvider.ERNIE -> GenericProviderConfigCard(
                    provider = LLMProvider.ERNIE,
                    providerName = "文心一言",
                    apiKey = config.ernie.apiKey,
                    baseURL = config.ernie.baseURL,
                    model = config.ernie.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.ERNIE) }
                )

                LLMProvider.CHATGLM -> GenericProviderConfigCard(
                    provider = LLMProvider.CHATGLM,
                    providerName = "智谱AI",
                    apiKey = config.chatglm.apiKey,
                    baseURL = config.chatglm.baseURL,
                    model = config.chatglm.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.CHATGLM) }
                )

                LLMProvider.MOONSHOT -> GenericProviderConfigCard(
                    provider = LLMProvider.MOONSHOT,
                    providerName = "月之暗面",
                    apiKey = config.moonshot.apiKey,
                    baseURL = config.moonshot.baseURL,
                    model = config.moonshot.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.MOONSHOT) }
                )

                LLMProvider.SPARK -> GenericProviderConfigCard(
                    provider = LLMProvider.SPARK,
                    providerName = "讯飞星火",
                    apiKey = config.spark.apiKey,
                    baseURL = config.spark.baseURL,
                    model = config.spark.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.SPARK) }
                )

                LLMProvider.GEMINI -> GenericProviderConfigCard(
                    provider = LLMProvider.GEMINI,
                    providerName = "Gemini",
                    apiKey = config.gemini.apiKey,
                    baseURL = config.gemini.baseURL,
                    model = config.gemini.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.GEMINI) }
                )

                LLMProvider.CUSTOM -> GenericProviderConfigCard(
                    provider = LLMProvider.CUSTOM,
                    providerName = "自定义",
                    apiKey = config.custom.apiKey,
                    baseURL = config.custom.baseURL,
                    model = config.custom.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.CUSTOM) }
                )
            }
        }

        // 通用选项
        item {
            OptionsCard(
                options = config.options,
                onSave = onUpdateOptions
            )
        }

        // 验证按钮
        item {
            Button(
                onClick = onValidate,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Check, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("验证配置")
            }
        }
    }
}

/**
 * 提供商选择器
 */
@Composable
private fun ProviderSelector(
    currentProvider: LLMProvider,
    onProviderChange: (LLMProvider) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "LLM提供商",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(12.dp))

            val providers = listOf(
                LLMProvider.OLLAMA to "Ollama (本地)",
                LLMProvider.OPENAI to "OpenAI",
                LLMProvider.DEEPSEEK to "DeepSeek",
                LLMProvider.CLAUDE to "Claude (Anthropic)",
                LLMProvider.DOUBAO to "豆包 (火山引擎)",
                LLMProvider.QWEN to "通义千问 (阿里云)",
                LLMProvider.ERNIE to "文心一言 (百度)",
                LLMProvider.CHATGLM to "智谱AI",
                LLMProvider.MOONSHOT to "月之暗面 (Kimi)",
                LLMProvider.SPARK to "讯飞星火",
                LLMProvider.GEMINI to "Gemini (Google)",
                LLMProvider.CUSTOM to "自定义"
            )

            providers.forEach { (provider, name) ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onProviderChange(provider) }
                        .background(
                            if (provider == currentProvider)
                                MaterialTheme.colorScheme.primaryContainer
                            else
                                MaterialTheme.colorScheme.surface
                        )
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    RadioButton(
                        selected = provider == currentProvider,
                        onClick = { onProviderChange(provider) }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = name,
                        style = MaterialTheme.typography.bodyLarge
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
            }
        }
    }
}

/**
 * 验证错误卡片
 */
@Composable
private fun ValidationErrorsCard(errors: List<String>) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "配置错误",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            errors.forEach { error ->
                Text(
                    text = "• $error",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer
                )
            }
        }
    }
}

/**
 * Ollama配置卡片
 */
@Composable
private fun OllamaConfigCard(
    config: com.chainlesschain.android.feature.ai.data.config.OllamaConfig,
    onSave: (String, String, String) -> Unit,
    onTest: () -> Unit
) {
    var url by remember { mutableStateOf(config.url) }
    var model by remember { mutableStateOf(config.model) }
    var embeddingModel by remember { mutableStateOf(config.embeddingModel) }

    ProviderConfigCardTemplate(
        title = "Ollama配置",
        description = "本地LLM，完全免费",
        onSave = { onSave(url, model, embeddingModel) },
        onTest = onTest
    ) {
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("服务器地址") },
            placeholder = { Text("http://localhost:11434") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Link, contentDescription = null)
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            label = { Text("模型名称") },
            placeholder = { Text("qwen2:7b") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Psychology, contentDescription = null)
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = embeddingModel,
            onValueChange = { embeddingModel = it },
            label = { Text("嵌入模型") },
            placeholder = { Text("nomic-embed-text") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.VectorizeTouch, contentDescription = null)
            }
        )
    }
}

/**
 * OpenAI配置卡片
 */
@Composable
private fun OpenAIConfigCard(
    config: com.chainlesschain.android.feature.ai.data.config.OpenAIConfig,
    onSave: (String, String, String) -> Unit,
    onTest: () -> Unit
) {
    var apiKey by remember { mutableStateOf(config.apiKey) }
    var baseURL by remember { mutableStateOf(config.baseURL) }
    var model by remember { mutableStateOf(config.model) }
    var showApiKey by remember { mutableStateOf(false) }

    ProviderConfigCardTemplate(
        title = "OpenAI配置",
        description = "GPT系列模型",
        onSave = { onSave(apiKey, baseURL, model) },
        onTest = onTest
    ) {
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text("API Key") },
            placeholder = { Text("sk-...") },
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (showApiKey) VisualTransformation.None else PasswordVisualTransformation(),
            leadingIcon = {
                Icon(Icons.Default.Key, contentDescription = null)
            },
            trailingIcon = {
                IconButton(onClick = { showApiKey = !showApiKey }) {
                    Icon(
                        if (showApiKey) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (showApiKey) "隐藏" else "显示"
                    )
                }
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = baseURL,
            onValueChange = { baseURL = it },
            label = { Text("Base URL") },
            placeholder = { Text("https://api.openai.com/v1") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Link, contentDescription = null)
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            label = { Text("模型") },
            placeholder = { Text("gpt-4o-mini") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Psychology, contentDescription = null)
            }
        )
    }
}

/**
 * DeepSeek配置卡片
 */
@Composable
private fun DeepSeekConfigCard(
    config: com.chainlesschain.android.feature.ai.data.config.DeepSeekConfig,
    onSave: (String, String, String) -> Unit,
    onTest: () -> Unit
) {
    var apiKey by remember { mutableStateOf(config.apiKey) }
    var baseURL by remember { mutableStateOf(config.baseURL) }
    var model by remember { mutableStateOf(config.model) }
    var showApiKey by remember { mutableStateOf(false) }

    ProviderConfigCardTemplate(
        title = "DeepSeek配置",
        description = "性价比极高的中文模型",
        onSave = { onSave(apiKey, baseURL, model) },
        onTest = onTest
    ) {
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text("API Key") },
            placeholder = { Text("sk-...") },
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (showApiKey) VisualTransformation.None else PasswordVisualTransformation(),
            leadingIcon = {
                Icon(Icons.Default.Key, contentDescription = null)
            },
            trailingIcon = {
                IconButton(onClick = { showApiKey = !showApiKey }) {
                    Icon(
                        if (showApiKey) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = null
                    )
                }
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = baseURL,
            onValueChange = { baseURL = it },
            label = { Text("Base URL") },
            placeholder = { Text("https://api.deepseek.com/v1") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Link, contentDescription = null)
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            label = { Text("模型") },
            placeholder = { Text("deepseek-chat") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Psychology, contentDescription = null)
            }
        )
    }
}

// 继续下一部分...
