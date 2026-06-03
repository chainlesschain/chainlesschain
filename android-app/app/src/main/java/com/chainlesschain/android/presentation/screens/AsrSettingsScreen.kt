package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * SeedASR 配置页 —— 输 x-api-key（控制台 → 语音技术 → 录音文件识别大模型 → API Key）
 */
@HiltViewModel
class AsrSettingsViewModel @Inject constructor(
    private val configManager: LLMConfigManager
) : ViewModel() {

    fun loadConfig(onLoaded: (apiKey: String, resourceId: String) -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            configManager.load()
            val asr = configManager.getConfig().asrVolcengine
            onLoaded(asr.apiKey, asr.resourceId)
        }
    }

    fun save(apiKey: String, resourceId: String, onDone: () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            val current = configManager.getConfig()
            configManager.save(
                current.copy(
                    asrVolcengine = current.asrVolcengine.copy(
                        apiKey = apiKey.trim(),
                        resourceId = resourceId.trim().ifBlank { "volc.seedasr.auc" }
                    )
                )
            )
            onDone()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AsrSettingsScreen(
    onNavigateBack: () -> Unit,
    viewModel: AsrSettingsViewModel = hiltViewModel()
) {
    var apiKey by remember { mutableStateOf("") }
    var resourceId by remember { mutableStateOf("volc.seedasr.auc") }
    var keyVisible by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        viewModel.loadConfig { k, r ->
            apiKey = k
            resourceId = r
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("语音识别设置") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Text(
                    "豆包 SeedASR 大模型（录音文件识别）",
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "在火山引擎控制台 → 语音技术 → 录音文件识别大模型，开通后会得到一个 API Key（形如 8950XXXX-...）。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            item {
                OutlinedTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it },
                    label = { Text("API Key (x-api-key)") },
                    placeholder = { Text("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx") },
                    singleLine = true,
                    visualTransformation = if (keyVisible) VisualTransformation.None
                                           else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { keyVisible = !keyVisible }) {
                            Icon(
                                if (keyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (keyVisible) "隐藏" else "显示"
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = resourceId,
                    onValueChange = { resourceId = it },
                    label = { Text("Resource ID") },
                    singleLine = true,
                    supportingText = { Text("默认 volc.seedasr.auc，一般不用改") },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Button(
                    onClick = {
                        viewModel.save(apiKey, resourceId) {
                            scope.launch { snackbar.showSnackbar("已保存") }
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Save, contentDescription = null)
                    Spacer(Modifier.height(0.dp))
                    Text("  保存")
                }
            }
        }
    }
}
