package com.chainlesschain.android.feature.ai.presentation.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.ai.R
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * Anthropic配置卡片
 */
@Composable
fun AnthropicConfigCard(
    config: com.chainlesschain.android.feature.ai.data.config.AnthropicConfig,
    onSave: (String, String, String) -> Unit,
    onTest: () -> Unit
) {
    var apiKey by remember { mutableStateOf(config.apiKey) }
    var baseURL by remember { mutableStateOf(config.baseURL) }
    var model by remember { mutableStateOf(config.model) }
    var showApiKey by remember { mutableStateOf(false) }

    ProviderConfigCardTemplate(
        title = stringResource(R.string.llm_settings_anthropic_title),
        description = stringResource(R.string.llm_settings_anthropic_description),
        onSave = { onSave(apiKey, baseURL, model) },
        onTest = onTest
    ) {
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text("API Key") },
            placeholder = { Text("sk-ant-...") },
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
            placeholder = { Text("https://api.anthropic.com") },
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
            placeholder = { Text("claude-3-5-sonnet-20241022") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Psychology, contentDescription = null)
            }
        )
    }
}

/**
 * 通用提供商配置卡片
 */
@Composable
fun GenericProviderConfigCard(
    provider: LLMProvider,
    providerName: String,
    apiKey: String,
    baseURL: String,
    model: String,
    onSave: (LLMProvider, String, String, String) -> Unit,
    onTest: () -> Unit
) {
    var apiKeyState by remember { mutableStateOf(apiKey) }
    var baseURLState by remember { mutableStateOf(baseURL) }
    var modelState by remember { mutableStateOf(model) }
    var showApiKey by remember { mutableStateOf(false) }

    ProviderConfigCardTemplate(
        title = stringResource(R.string.llm_settings_generic_config_title, providerName),
        description = stringResource(R.string.llm_settings_generic_config_description, providerName),
        onSave = { onSave(provider, apiKeyState, baseURLState, modelState) },
        onTest = onTest
    ) {
        OutlinedTextField(
            value = apiKeyState,
            onValueChange = { apiKeyState = it },
            label = { Text("API Key") },
            placeholder = { Text(stringResource(R.string.llm_settings_generic_api_key_placeholder)) },
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
            value = baseURLState,
            onValueChange = { baseURLState = it },
            label = { Text("Base URL") },
            placeholder = { Text("https://api.example.com") },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Link, contentDescription = null)
            }
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = modelState,
            onValueChange = { modelState = it },
            label = { Text(stringResource(R.string.llm_settings_model)) },
            placeholder = { Text(stringResource(R.string.llm_settings_generic_model_placeholder)) },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = {
                Icon(Icons.Default.Psychology, contentDescription = null)
            }
        )
    }
}

/**
 * 通用选项卡片
 */
@Composable
fun OptionsCard(
    options: com.chainlesschain.android.feature.ai.data.config.LLMOptions,
    onSave: (Float, Float, Int, Int) -> Unit
) {
    var temperature by remember { mutableStateOf(options.temperature) }
    var topP by remember { mutableStateOf(options.topP) }
    var topK by remember { mutableStateOf(options.topK) }
    var maxTokens by remember { mutableStateOf(options.maxTokens) }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = stringResource(R.string.llm_options_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(16.dp))

            // Temperature
            Text(stringResource(R.string.llm_options_temperature, String.format("%.2f", temperature)))
            Slider(
                value = temperature,
                onValueChange = { temperature = it },
                valueRange = 0f..2f,
                steps = 19
            )
            Text(
                text = stringResource(R.string.llm_options_temperature_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Top P
            Text(stringResource(R.string.llm_options_top_p, String.format("%.2f", topP)))
            Slider(
                value = topP,
                onValueChange = { topP = it },
                valueRange = 0f..1f,
                steps = 9
            )
            Text(
                text = stringResource(R.string.llm_options_top_p_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Top K
            OutlinedTextField(
                value = topK.toString(),
                onValueChange = {
                    it.toIntOrNull()?.let { value -> topK = value }
                },
                label = { Text("Top K") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )
            Text(
                text = stringResource(R.string.llm_options_top_k_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Max Tokens
            OutlinedTextField(
                value = maxTokens.toString(),
                onValueChange = {
                    it.toIntOrNull()?.let { value -> maxTokens = value }
                },
                label = { Text(stringResource(R.string.llm_options_max_tokens)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )
            Text(
                text = stringResource(R.string.llm_options_max_tokens_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick = { onSave(temperature, topP, topK, maxTokens) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Save, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(stringResource(R.string.llm_options_save))
            }
        }
    }
}

/**
 * 提供商配置卡片模板
 */
@Composable
fun ProviderConfigCardTemplate(
    title: String,
    description: String,
    onSave: () -> Unit,
    onTest: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // 标题和描述
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 配置表单
            content()

            Spacer(modifier = Modifier.height(16.dp))

            // 操作按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onSave,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Save, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.llm_config_save))
                }

                OutlinedButton(
                    onClick = onTest,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.llm_config_test))
                }
            }
        }
    }
}
