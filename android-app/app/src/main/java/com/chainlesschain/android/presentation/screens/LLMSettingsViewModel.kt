package com.chainlesschain.android.presentation.screens

import androidx.lifecycle.ViewModel
import timber.log.Timber
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import com.chainlesschain.android.R
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * LLM设置界面ViewModel
 *
 * 功能：
 * 1. 管理API密钥的保存和读取（加密）
 * 2. 测试LLM连接
 * 3. Ollama服务自动发现
 * 4. 提供商切换
 */
@HiltViewModel
class LLMSettingsViewModel @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val securePreferences: SecurePreferences,
    private val llmAdapterFactory: LLMAdapterFactory
) : ViewModel() {

    private val _uiState = MutableStateFlow(LLMSettingsUiState())
    val uiState: StateFlow<LLMSettingsUiState> = _uiState.asStateFlow()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    init {
        // 默认选择DeepSeek
        selectProvider(LLMProvider.DEEPSEEK)
    }

    /**
     * 选择提供商
     */
    fun selectProvider(provider: LLMProvider) {
        _uiState.update { state ->
            val apiKey = when (provider) {
                LLMProvider.OPENAI -> securePreferences.getOpenAIApiKey()
                LLMProvider.DEEPSEEK -> securePreferences.getDeepSeekApiKey()
                LLMProvider.OLLAMA -> null // Ollama不需要API Key
                else -> securePreferences.getApiKeyForProvider(provider.name)
            }

            val endpoint = when (provider) {
                LLMProvider.OLLAMA -> securePreferences.getOllamaBaseUrl()
                LLMProvider.CUSTOM -> securePreferences.getCustomApiEndpoint()
                else -> null
            }

            state.copy(
                selectedProvider = provider,
                currentApiKey = apiKey,
                currentEndpoint = endpoint,
                connectionStatus = null,
                message = null
            )
        }

        // 如果是Ollama，自动开始发现
        if (provider == LLMProvider.OLLAMA) {
            discoverOllamaServices()
        }
    }

    /**
     * 保存配置
     */
    fun saveConfiguration(apiKey: String?, endpoint: String?) {
        viewModelScope.launch {
            try {
                val provider = _uiState.value.selectedProvider

                // 保存API Key
                apiKey?.let { key ->
                    when (provider) {
                        LLMProvider.OPENAI -> securePreferences.saveOpenAIApiKey(key)
                        LLMProvider.DEEPSEEK -> securePreferences.saveDeepSeekApiKey(key)
                        LLMProvider.CUSTOM -> securePreferences.saveCustomApiKey(key)
                        else -> securePreferences.saveApiKeyForProvider(provider.name, key)
                    }
                }

                // 保存端点
                when (provider) {
                    LLMProvider.OLLAMA -> endpoint?.let { securePreferences.saveOllamaBaseUrl(it) }
                    LLMProvider.CUSTOM -> endpoint?.let { securePreferences.saveCustomApiEndpoint(it) }
                    else -> {}
                }

                _uiState.update { it.copy(
                    currentApiKey = apiKey,
                    currentEndpoint = endpoint,
                    message = context.getString(R.string.llm_config_saved)
                )}
            } catch (e: Exception) {
                _uiState.update { it.copy(
                    message = context.getString(R.string.llm_save_failed, e.message ?: "")
                )}
            }
        }
    }

    /**
     * 测试连接
     */
    fun testConnection(apiKey: String?, endpoint: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTesting = true, connectionStatus = null) }

            try {
                val provider = _uiState.value.selectedProvider
                val adapter = createAdapter(provider, apiKey, endpoint)

                withContext(Dispatchers.IO) {
                    val isAvailable = adapter.checkAvailability()

                    _uiState.update { it.copy(
                        isTesting = false,
                        connectionStatus = isAvailable,
                        message = if (isAvailable) context.getString(R.string.llm_connection_success) else context.getString(R.string.llm_connection_failed)
                    )}
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(
                    isTesting = false,
                    connectionStatus = false,
                    message = context.getString(R.string.llm_test_error, e.message ?: "")
                )}
            }
        }
    }

    /**
     * 测试Ollama连接
     */
    fun testOllamaConnection(url: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTesting = true, connectionStatus = null) }

            try {
                withContext(Dispatchers.IO) {
                    // 测试连接并获取模型列表
                    val request = Request.Builder()
                        .url("$url/api/tags")
                        .get()
                        .build()

                    val response = httpClient.newCall(request).execute()
                    val isSuccess = response.use { it.isSuccessful }

                    if (isSuccess) {
                        // 解析模型列表（简化版本）
                        val models = listOf("qwen2:7b", "llama3:8b", "deepseek-coder:6.7b")

                        // 保存成功的URL
                        securePreferences.saveOllamaBaseUrl(url)

                        _uiState.update { it.copy(
                            isTesting = false,
                            connectionStatus = true,
                            currentEndpoint = url,
                            availableModels = models,
                            message = context.getString(R.string.llm_connection_success)
                        )}
                    } else {
                        _uiState.update { it.copy(
                            isTesting = false,
                            connectionStatus = false,
                            message = context.getString(R.string.llm_connection_http_failed, response.code)
                        )}
                    }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(
                    isTesting = false,
                    connectionStatus = false,
                    message = context.getString(R.string.llm_test_error, e.message ?: "")
                )}
            }
        }
    }

    /**
     * 发现Ollama服务（局域网扫描）
     */
    fun discoverOllamaServices() {
        viewModelScope.launch {
            _uiState.update { it.copy(
                isDiscovering = true,
                discoveredOllamaServices = emptyList()
            )}

            try {
                val discovered = withContext(Dispatchers.IO) {
                    discoverOllamaInLAN()
                }

                _uiState.update { it.copy(
                    isDiscovering = false,
                    discoveredOllamaServices = discovered,
                    message = if (discovered.isEmpty())
                        context.getString(R.string.llm_discovery_no_service)
                    else
                        context.getString(R.string.llm_discovery_found, discovered.size)
                )}
            } catch (e: Exception) {
                _uiState.update { it.copy(
                    isDiscovering = false,
                    message = context.getString(R.string.llm_scan_failed, e.message ?: "")
                )}
            }
        }
    }

    /**
     * 选择Ollama服务
     */
    fun selectOllamaService(url: String) {
        testOllamaConnection(url)
    }

    /**
     * 清除消息
     */
    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    /**
     * 创建LLM适配器
     */
    private fun createAdapter(
        provider: LLMProvider,
        apiKey: String?,
        endpoint: String?
    ): LLMAdapter {
        return when (provider) {
            LLMProvider.OLLAMA -> {
                llmAdapterFactory.createOllamaAdapter(endpoint ?: "http://localhost:11434")
            }
            else -> {
                llmAdapterFactory.createAdapter(provider, apiKey)
            }
        }
    }

    /**
     * 局域网Ollama服务发现
     * 扫描常见端口和本地IP段
     */
    private suspend fun discoverOllamaInLAN(): List<String> {
        val discovered = mutableListOf<String>()

        try {
            // 获取本机IP
            val localIp = InetAddress.getLocalHost().hostAddress ?: return emptyList()
            val ipPrefix = localIp.substringBeforeLast(".")

            // 扫描局域网常见IP段（192.168.x.1-254）
            val commonIPs = listOf(
                "localhost",
                "127.0.0.1",
                localIp,
                "$ipPrefix.1", // 通常是路由器
            ) + (2..10).map { "$ipPrefix.$it" } // 前10个IP

            val port = 11434 // Ollama默认端口

            commonIPs.forEach { ip ->
                try {
                    val url = "http://$ip:$port"
                    val request = Request.Builder()
                        .url("$url/api/tags")
                        .get()
                        .build()

                    val response = httpClient.newCall(request).execute()
                    response.use {
                        if (it.isSuccessful) {
                            discovered.add(url)
                        }
                    }
                } catch (_: Exception) {
                    // Expected: connection refused for unreachable IPs
                }
            }
        } catch (e: Exception) {
            Timber.w(e, "Ollama LAN discovery failed")
        }

        return discovered.distinct()
    }
}

/**
 * LLM设置界面UI状态
 */
@Immutable
data class LLMSettingsUiState(
    val selectedProvider: LLMProvider = LLMProvider.DEEPSEEK,
    val currentApiKey: String? = null,
    val currentEndpoint: String? = null,
    val isTesting: Boolean = false,
    val connectionStatus: Boolean? = null,
    val message: String? = null,

    // Ollama特定字段
    val isDiscovering: Boolean = false,
    val discoveredOllamaServices: List<String> = emptyList(),
    val availableModels: List<String> = emptyList()
)
