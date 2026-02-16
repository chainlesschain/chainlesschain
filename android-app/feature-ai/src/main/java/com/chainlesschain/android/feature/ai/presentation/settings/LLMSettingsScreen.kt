package com.chainlesschain.android.feature.ai.presentation.settings

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.R
import com.chainlesschain.android.feature.ai.data.config.LLMConfiguration
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * LLM设置主界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LLMSettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToUsageStatistics: () -> Unit = {},
    viewModel: LLMSettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentProvider by viewModel.currentProvider.collectAsState()

    var showImportExportDialog by remember { mutableStateOf(false) }
    var showRecommendationDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.llm_settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.llm_settings_navigate_back))
                    }
                },
                actions = {
                    // 使用统计按钮
                    IconButton(onClick = onNavigateToUsageStatistics) {
                        Icon(Icons.Default.Analytics, contentDescription = stringResource(R.string.llm_settings_usage_statistics))
                    }
                    // 智能推荐按钮
                    IconButton(onClick = { showRecommendationDialog = true }) {
                        Icon(Icons.Default.Lightbulb, contentDescription = stringResource(R.string.llm_settings_smart_recommendation))
                    }
                    // 导入导出按钮
                    IconButton(onClick = { showImportExportDialog = true }) {
                        Icon(Icons.Default.ImportExport, contentDescription = stringResource(R.string.llm_settings_import_export))
                    }
                    // 刷新按钮
                    IconButton(onClick = { viewModel.loadConfig() }) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.llm_settings_refresh))
                    }
                    // 更多选项
                    var showMoreMenu by remember { mutableStateOf(false) }
                    IconButton(onClick = { showMoreMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.llm_settings_more))
                    }
                    DropdownMenu(
                        expanded = showMoreMenu,
                        onDismissRequest = { showMoreMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.llm_settings_reset_to_default)) },
                            onClick = {
                                viewModel.resetToDefault()
                                showMoreMenu = false
                            },
                            leadingIcon = {
                                Icon(Icons.Default.RestartAlt, contentDescription = null)
                            }
                        )
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
                            Text(stringResource(R.string.llm_settings_retry))
                        }
                    }
                }

                is LLMSettingsUiState.Success -> {
                    LLMSettingsContent(
                        config = state.config,
                        currentProvider = currentProvider,
                        validationErrors = state.validationErrors,
                        onProviderChange = { viewModel.switchProvider(it) },
                        onNavigateToUsageStatistics = onNavigateToUsageStatistics,
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
                        onNavigateToUsageStatistics = onNavigateToUsageStatistics,
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
                                Text(stringResource(R.string.llm_settings_testing_connection))
                            }
                        }
                    }
                }

                is LLMSettingsUiState.TestResult -> {
                    val testResult = uiState as LLMSettingsUiState.TestResult
                    // 显示测试结果，然后返回配置界面
                    LaunchedEffect(testResult) {
                        kotlinx.coroutines.delay(4000) // 4秒 - 让用户有足够时间看到结果
                        viewModel.loadConfig() // 回到配置界面
                    }

                    LLMSettingsContent(
                        config = LLMConfiguration(), // Dummy
                        currentProvider = currentProvider,
                        validationErrors = emptyList(),
                        onProviderChange = {},
                        onNavigateToUsageStatistics = onNavigateToUsageStatistics,
                        onUpdateOllama = { _, _, _ -> },
                        onUpdateOpenAI = { _, _, _ -> },
                        onUpdateDeepSeek = { _, _, _ -> },
                        onUpdateAnthropic = { _, _, _ -> },
                        onUpdateProvider = { _, _, _, _ -> },
                        onUpdateOptions = { _, _, _, _ -> },
                        onTestConnection = {},
                        onValidate = {}
                    )

                    // 显示测试结果 Snackbar
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        contentAlignment = Alignment.BottomCenter
                    ) {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(
                                containerColor = if (testResult.success) {
                                    MaterialTheme.colorScheme.primaryContainer
                                } else {
                                    MaterialTheme.colorScheme.errorContainer
                                }
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = if (testResult.success) Icons.Default.CheckCircle else Icons.Default.Error,
                                    contentDescription = null,
                                    tint = if (testResult.success) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onErrorContainer
                                    }
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = if (testResult.success) stringResource(R.string.llm_settings_connection_success) else stringResource(R.string.llm_settings_connection_failed),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = if (testResult.success) {
                                            MaterialTheme.colorScheme.onPrimaryContainer
                                        } else {
                                            MaterialTheme.colorScheme.onErrorContainer
                                        }
                                    )
                                    Text(
                                        text = testResult.message,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (testResult.success) {
                                            MaterialTheme.colorScheme.onPrimaryContainer
                                        } else {
                                            MaterialTheme.colorScheme.onErrorContainer
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Import/Export Dialog
        if (showImportExportDialog) {
            ImportExportDialog(
                viewModel = viewModel,
                onDismiss = { showImportExportDialog = false }
            )
        }

        // Recommendation Dialog
        if (showRecommendationDialog) {
            RecommendationDialog(
                viewModel = viewModel,
                onDismiss = { showRecommendationDialog = false }
            )
        }
    }
}

@Composable
private fun LLMSettingsContent(
    config: com.chainlesschain.android.feature.ai.data.config.LLMConfiguration,
    currentProvider: LLMProvider,
    validationErrors: List<String>,
    onProviderChange: (LLMProvider) -> Unit,
    onNavigateToUsageStatistics: () -> Unit,
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
        item {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onNavigateToUsageStatistics),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Analytics,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.llm_settings_usage_statistics),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                        Text(
                            text = stringResource(R.string.llm_settings_usage_stats_description),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.8f)
                        )
                    }
                    Icon(
                        imageVector = Icons.Default.ChevronRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
            }
        }
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
                    providerName = stringResource(R.string.llm_provider_doubao),
                    apiKey = config.volcengine.apiKey,
                    baseURL = config.volcengine.baseURL,
                    model = config.volcengine.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.DOUBAO) }
                )

                LLMProvider.QWEN -> GenericProviderConfigCard(
                    provider = LLMProvider.QWEN,
                    providerName = stringResource(R.string.llm_provider_qwen),
                    apiKey = config.qwen.apiKey,
                    baseURL = config.qwen.baseURL,
                    model = config.qwen.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.QWEN) }
                )

                LLMProvider.ERNIE -> GenericProviderConfigCard(
                    provider = LLMProvider.ERNIE,
                    providerName = stringResource(R.string.llm_provider_ernie),
                    apiKey = config.ernie.apiKey,
                    baseURL = config.ernie.baseURL,
                    model = config.ernie.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.ERNIE) }
                )

                LLMProvider.CHATGLM -> GenericProviderConfigCard(
                    provider = LLMProvider.CHATGLM,
                    providerName = stringResource(R.string.llm_provider_chatglm),
                    apiKey = config.chatglm.apiKey,
                    baseURL = config.chatglm.baseURL,
                    model = config.chatglm.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.CHATGLM) }
                )

                LLMProvider.MOONSHOT -> GenericProviderConfigCard(
                    provider = LLMProvider.MOONSHOT,
                    providerName = stringResource(R.string.llm_provider_moonshot),
                    apiKey = config.moonshot.apiKey,
                    baseURL = config.moonshot.baseURL,
                    model = config.moonshot.model,
                    onSave = onUpdateProvider,
                    onTest = { onTestConnection(LLMProvider.MOONSHOT) }
                )

                LLMProvider.SPARK -> GenericProviderConfigCard(
                    provider = LLMProvider.SPARK,
                    providerName = stringResource(R.string.llm_provider_spark),
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
                    providerName = stringResource(R.string.llm_provider_custom),
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
                Text(stringResource(R.string.llm_settings_validate_config))
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
                text = stringResource(R.string.llm_settings_provider_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(12.dp))

            val providers = listOf(
                LLMProvider.OLLAMA to stringResource(R.string.llm_settings_provider_ollama),
                LLMProvider.OPENAI to "OpenAI",
                LLMProvider.DEEPSEEK to "DeepSeek",
                LLMProvider.CLAUDE to stringResource(R.string.llm_settings_provider_claude),
                LLMProvider.DOUBAO to stringResource(R.string.llm_settings_provider_doubao),
                LLMProvider.QWEN to stringResource(R.string.llm_settings_provider_qwen),
                LLMProvider.ERNIE to stringResource(R.string.llm_settings_provider_ernie),
                LLMProvider.CHATGLM to stringResource(R.string.llm_settings_provider_chatglm),
                LLMProvider.MOONSHOT to stringResource(R.string.llm_settings_provider_moonshot),
                LLMProvider.SPARK to stringResource(R.string.llm_settings_provider_spark),
                LLMProvider.GEMINI to stringResource(R.string.llm_settings_provider_gemini),
                LLMProvider.CUSTOM to stringResource(R.string.llm_settings_provider_custom)
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
                    text = stringResource(R.string.llm_settings_config_error),
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
        title = stringResource(R.string.llm_settings_ollama_title),
        description = stringResource(R.string.llm_settings_ollama_description),
        onSave = { onSave(url, model, embeddingModel) },
        onTest = onTest
    ) {
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text(stringResource(R.string.llm_settings_server_url)) },
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
            label = { Text(stringResource(R.string.llm_settings_model_name)) },
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
            label = { Text(stringResource(R.string.llm_settings_embedding_model)) },
            placeholder = { Text("nomic-embed-text") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Memory, contentDescription = null)
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
        title = stringResource(R.string.llm_settings_openai_title),
        description = stringResource(R.string.llm_settings_openai_description),
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
                        contentDescription = if (showApiKey) stringResource(R.string.llm_settings_api_key_show) else stringResource(R.string.llm_settings_api_key_hide)
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
            label = { Text(stringResource(R.string.llm_settings_model)) },
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
        title = stringResource(R.string.llm_settings_deepseek_title),
        description = stringResource(R.string.llm_settings_deepseek_description),
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
            label = { Text(stringResource(R.string.llm_settings_model)) },
            placeholder = { Text("deepseek-chat") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Psychology, contentDescription = null)
            }
        )
    }
}

/**
 * 导入导出对话框
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ImportExportDialog(
    viewModel: LLMSettingsViewModel,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var showResult by remember { mutableStateOf<String?>(null) }
    var isProcessing by remember { mutableStateOf(false) }

    val exportFullSuccessMsg = stringResource(R.string.llm_settings_export_full_success)
    val exportSafeSuccessMsg = stringResource(R.string.llm_settings_export_safe_success)
    val exportFailedMsg = stringResource(R.string.llm_settings_export_failed)
    val importSuccessMsg = stringResource(R.string.llm_settings_import_success)

    // Export launcher - Create document
    val exportFullLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        uri?.let {
            isProcessing = true
            val success = viewModel.exportConfig(it, includeSensitive = true)
            showResult = if (success) exportFullSuccessMsg else exportFailedMsg
            isProcessing = false
        }
    }

    val exportSafeLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        uri?.let {
            isProcessing = true
            val success = viewModel.exportConfig(it, includeSensitive = false)
            showResult = if (success) exportSafeSuccessMsg else exportFailedMsg
            isProcessing = false
        }
    }

    // Import launcher - Open document
    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let {
            isProcessing = true
            viewModel.importConfig(it, mergeMode = false)
            showResult = importSuccessMsg
            isProcessing = false
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.llm_settings_import_export_title)) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Result message
                if (showResult != null) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = showResult!!,
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                if (isProcessing) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(stringResource(R.string.llm_settings_import_export_processing))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Text(
                    text = stringResource(R.string.llm_settings_import_export_description),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Export Section
                Text(
                    text = stringResource(R.string.llm_settings_export_section),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            showResult = null
                            exportFullLauncher.launch("llm-config-full.json")
                        },
                        modifier = Modifier.weight(1f),
                        enabled = !isProcessing
                    ) {
                        Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(stringResource(R.string.llm_settings_export_full))
                    }

                    OutlinedButton(
                        onClick = {
                            showResult = null
                            exportSafeLauncher.launch("llm-config-safe.json")
                        },
                        modifier = Modifier.weight(1f),
                        enabled = !isProcessing
                    ) {
                        Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(stringResource(R.string.llm_settings_export_safe))
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Import Section
                Text(
                    text = stringResource(R.string.llm_settings_import_section),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            showResult = null
                            importLauncher.launch(arrayOf("application/json"))
                        },
                        modifier = Modifier.weight(1f),
                        enabled = !isProcessing
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(stringResource(R.string.llm_settings_import_from_file))
                    }
                }

                Text(
                    text = stringResource(R.string.llm_settings_import_export_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.llm_settings_import_export_close))
            }
        }
    )
}

/**
 * 智能推荐对话框
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RecommendationDialog(
    viewModel: LLMSettingsViewModel,
    onDismiss: () -> Unit
) {
    var selectedUseCase by remember {
        mutableStateOf(com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase.GENERAL)
    }
    var selectedBudget by remember {
        mutableStateOf(com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget.MEDIUM)
    }

    val recommendations = remember(selectedUseCase, selectedBudget) {
        viewModel.getRecommendations(selectedUseCase, selectedBudget)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.llm_settings_recommendation_title)) },
        text = {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    Text(
                        text = stringResource(R.string.llm_settings_recommendation_description),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                // Use Case Selector
                item {
                    Text(
                        text = stringResource(R.string.llm_settings_recommendation_use_case),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(4.dp))

                    val useCases = listOf(
                        com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase.FREE to stringResource(R.string.llm_settings_recommendation_use_case_free),
                        com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase.COST_EFFECTIVE to stringResource(R.string.llm_settings_recommendation_use_case_cost),
                        com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase.HIGH_QUALITY to stringResource(R.string.llm_settings_recommendation_use_case_quality),
                        com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase.CHINESE to stringResource(R.string.llm_settings_recommendation_use_case_chinese),
                        com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase.GENERAL to stringResource(R.string.llm_settings_recommendation_use_case_general)
                    )

                    useCases.chunked(2).forEach { rowItems ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            rowItems.forEach { (useCase, label) ->
                                FilterChip(
                                    selected = selectedUseCase == useCase,
                                    onClick = { selectedUseCase = useCase },
                                    label = { Text(label) },
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            // Fill remaining space if odd number
                            if (rowItems.size == 1) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }

                // Budget Selector
                item {
                    Text(
                        text = stringResource(R.string.llm_settings_recommendation_budget),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(4.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        val budgets = listOf(
                            com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget.LOW to stringResource(R.string.llm_settings_recommendation_budget_low),
                            com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget.MEDIUM to stringResource(R.string.llm_settings_recommendation_budget_medium),
                            com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget.HIGH to stringResource(R.string.llm_settings_recommendation_budget_high),
                            com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget.UNLIMITED to stringResource(R.string.llm_settings_recommendation_budget_unlimited)
                        )

                        budgets.forEach { (budget, label) ->
                            FilterChip(
                                selected = selectedBudget == budget,
                                onClick = { selectedBudget = budget },
                                label = { Text(label) },
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }

                // Recommendations
                item {
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.llm_settings_recommendation_results, recommendations.size),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }

                items(recommendations.take(5)) { recommendation ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = if (recommendation.score >= 0.8)
                                MaterialTheme.colorScheme.primaryContainer
                            else
                                MaterialTheme.colorScheme.surfaceVariant
                        )
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = recommendation.provider.displayName,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )

                                // Score badge
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = MaterialTheme.colorScheme.primary
                                ) {
                                    Text(
                                        text = stringResource(R.string.llm_settings_recommendation_score, (recommendation.score * 100).toInt()),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onPrimary,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(4.dp))

                            Text(
                                text = recommendation.reason,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )

                            Spacer(modifier = Modifier.height(8.dp))

                            Button(
                                onClick = {
                                    viewModel.applyRecommendation(recommendation)
                                    onDismiss()
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(stringResource(R.string.llm_settings_recommendation_apply))
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.llm_settings_recommendation_close))
            }
        }
    )
}

// 继续下一部分...
