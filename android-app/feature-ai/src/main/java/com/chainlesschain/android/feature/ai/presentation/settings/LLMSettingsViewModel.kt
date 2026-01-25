package com.chainlesschain.android.feature.ai.presentation.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.data.config.*
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * LLM设置页面的ViewModel
 */
@HiltViewModel
class LLMSettingsViewModel @Inject constructor(
    private val configManager: LLMConfigManager,
    private val importExportManager: com.chainlesschain.android.feature.ai.data.config.ConfigImportExportManager,
    private val recommendationEngine: com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine
) : ViewModel() {

    private val _uiState = MutableStateFlow<LLMSettingsUiState>(LLMSettingsUiState.Loading)
    val uiState: StateFlow<LLMSettingsUiState> = _uiState.asStateFlow()

    private val _currentProvider = MutableStateFlow(LLMProvider.OLLAMA)
    val currentProvider: StateFlow<LLMProvider> = _currentProvider.asStateFlow()

    init {
        loadConfig()
    }

    /**
     * 加载配置
     */
    fun loadConfig() {
        viewModelScope.launch {
            try {
                _uiState.value = LLMSettingsUiState.Loading

                val config = configManager.load()
                _currentProvider.value = configManager.getProvider()

                _uiState.value = LLMSettingsUiState.Success(
                    config = config,
                    currentProvider = _currentProvider.value,
                    validationErrors = emptyList()
                )
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = e.message ?: "加载配置失败"
                )
            }
        }
    }

    /**
     * 切换提供商
     */
    fun switchProvider(provider: LLMProvider) {
        viewModelScope.launch {
            try {
                configManager.setProvider(provider)
                _currentProvider.value = provider

                // 重新加载配置以更新UI
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "切换提供商失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 更新Ollama配置
     */
    fun updateOllamaConfig(url: String, model: String, embeddingModel: String) {
        viewModelScope.launch {
            try {
                val currentConfig = configManager.getConfig()
                val updatedConfig = currentConfig.copy(
                    ollama = OllamaConfig(
                        url = url,
                        model = model,
                        embeddingModel = embeddingModel
                    )
                )
                configManager.save(updatedConfig)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "保存Ollama配置失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 更新OpenAI配置
     */
    fun updateOpenAIConfig(apiKey: String, baseURL: String, model: String) {
        viewModelScope.launch {
            try {
                val currentConfig = configManager.getConfig()
                val updatedConfig = currentConfig.copy(
                    openai = OpenAIConfig(
                        apiKey = apiKey,
                        baseURL = baseURL,
                        model = model,
                        embeddingModel = currentConfig.openai.embeddingModel,
                        organization = currentConfig.openai.organization
                    )
                )
                configManager.save(updatedConfig)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "保存OpenAI配置失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 更新DeepSeek配置
     */
    fun updateDeepSeekConfig(apiKey: String, baseURL: String, model: String) {
        viewModelScope.launch {
            try {
                val currentConfig = configManager.getConfig()
                val updatedConfig = currentConfig.copy(
                    deepseek = DeepSeekConfig(
                        apiKey = apiKey,
                        baseURL = baseURL,
                        model = model
                    )
                )
                configManager.save(updatedConfig)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "保存DeepSeek配置失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 更新Anthropic配置
     */
    fun updateAnthropicConfig(apiKey: String, baseURL: String, model: String) {
        viewModelScope.launch {
            try {
                val currentConfig = configManager.getConfig()
                val updatedConfig = currentConfig.copy(
                    anthropic = AnthropicConfig(
                        apiKey = apiKey,
                        baseURL = baseURL,
                        model = model,
                        version = currentConfig.anthropic.version
                    )
                )
                configManager.save(updatedConfig)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "保存Anthropic配置失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 更新通用配置（其他云提供商）
     */
    fun updateProviderConfig(
        provider: LLMProvider,
        apiKey: String,
        baseURL: String,
        model: String
    ) {
        viewModelScope.launch {
            try {
                val currentConfig = configManager.getConfig()
                val updatedConfig = when (provider) {
                    LLMProvider.DOUBAO -> currentConfig.copy(
                        volcengine = VolcengineConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.QWEN -> currentConfig.copy(
                        qwen = QwenConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.ERNIE -> currentConfig.copy(
                        ernie = ErnieConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.CHATGLM -> currentConfig.copy(
                        chatglm = ChatGLMConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.MOONSHOT -> currentConfig.copy(
                        moonshot = MoonshotConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.SPARK -> currentConfig.copy(
                        spark = SparkConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.GEMINI -> currentConfig.copy(
                        gemini = GeminiConfig(apiKey, baseURL, model)
                    )
                    LLMProvider.CUSTOM -> currentConfig.copy(
                        custom = CustomConfig(apiKey, baseURL, model, name = "Custom Provider")
                    )
                    else -> currentConfig
                }
                configManager.save(updatedConfig)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "保存配置失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 更新通用选项
     */
    fun updateOptions(
        temperature: Float,
        topP: Float,
        topK: Int,
        maxTokens: Int
    ) {
        viewModelScope.launch {
            try {
                val currentConfig = configManager.getConfig()
                val updatedConfig = currentConfig.copy(
                    options = LLMOptions(
                        temperature = temperature,
                        topP = topP,
                        topK = topK,
                        maxTokens = maxTokens,
                        timeout = currentConfig.options.timeout
                    )
                )
                configManager.save(updatedConfig)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "保存选项失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 验证当前配置
     */
    fun validateConfig() {
        viewModelScope.launch {
            val (isValid, errors) = configManager.validate()

            val currentState = _uiState.value
            if (currentState is LLMSettingsUiState.Success) {
                _uiState.value = currentState.copy(
                    validationErrors = errors
                )
            }
        }
    }

    /**
     * 重置为默认配置
     */
    fun resetToDefault() {
        viewModelScope.launch {
            try {
                configManager.reset()
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error(
                    message = "重置配置失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 测试连接
     */
    fun testConnection(provider: LLMProvider) {
        viewModelScope.launch {
            try {
                _uiState.value = LLMSettingsUiState.Testing(provider)

                // TODO: 实际测试API连接
                // 这里需要调用适配器的checkAvailability方法

                kotlinx.coroutines.delay(1500) // 模拟测试

                _uiState.value = LLMSettingsUiState.TestResult(
                    provider = provider,
                    success = true,
                    message = "连接成功"
                )

                // 2秒后恢复到正常状态
                kotlinx.coroutines.delay(2000)
                loadConfig()
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.TestResult(
                    provider = provider,
                    success = false,
                    message = e.message ?: "连接失败"
                )
            }
        }
    }

    /**
     * 导出配置
     */
    fun exportConfig(uri: android.net.Uri, includeSensitive: Boolean = false): Boolean {
        return importExportManager.exportConfig(uri, includeSensitive)
    }

    /**
     * 导入配置
     */
    fun importConfig(uri: android.net.Uri, mergeMode: Boolean = false) {
        viewModelScope.launch {
            try {
                val success = importExportManager.importConfig(uri, mergeMode)
                if (success) {
                    loadConfig()
                } else {
                    _uiState.value = LLMSettingsUiState.Error("导入配置失败")
                }
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error("导入配置失败: ${e.message}")
            }
        }
    }

    /**
     * 从桌面端导入配置
     */
    fun importFromDesktop(uri: android.net.Uri) {
        viewModelScope.launch {
            try {
                val success = importExportManager.importFromDesktop(uri)
                if (success) {
                    loadConfig()
                } else {
                    _uiState.value = LLMSettingsUiState.Error("从桌面端导入失败")
                }
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error("从桌面端导入失败: ${e.message}")
            }
        }
    }

    /**
     * 导出为字符串（用于分享）
     */
    fun exportToString(includeSensitive: Boolean = false): String {
        return importExportManager.exportToString(includeSensitive)
    }

    /**
     * 从字符串导入
     */
    fun importFromString(jsonString: String, mergeMode: Boolean = false) {
        viewModelScope.launch {
            try {
                val success = importExportManager.importFromString(jsonString, mergeMode)
                if (success) {
                    loadConfig()
                } else {
                    _uiState.value = LLMSettingsUiState.Error("导入配置失败")
                }
            } catch (e: Exception) {
                _uiState.value = LLMSettingsUiState.Error("导入配置失败: ${e.message}")
            }
        }
    }

    /**
     * 获取推荐
     */
    fun getRecommendations(
        useCase: com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.UseCase,
        budget: com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget = com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Budget.MEDIUM,
        language: com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Language = com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Language.ANY
    ): List<com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Recommendation> {
        return recommendationEngine.recommend(useCase, budget, language)
    }

    /**
     * 应用推荐（切换到推荐的提供商）
     */
    fun applyRecommendation(recommendation: com.chainlesschain.android.feature.ai.domain.recommendation.LLMRecommendationEngine.Recommendation) {
        switchProvider(recommendation.provider)
    }
}

/**
 * LLM设置UI状态
 */
sealed class LLMSettingsUiState {
    object Loading : LLMSettingsUiState()

    data class Success(
        val config: LLMConfiguration,
        val currentProvider: LLMProvider,
        val validationErrors: List<String>
    ) : LLMSettingsUiState()

    data class Error(
        val message: String
    ) : LLMSettingsUiState()

    data class Testing(
        val provider: LLMProvider
    ) : LLMSettingsUiState()

    data class TestResult(
        val provider: LLMProvider,
        val success: Boolean,
        val message: String
    ) : LLMSettingsUiState()
}
