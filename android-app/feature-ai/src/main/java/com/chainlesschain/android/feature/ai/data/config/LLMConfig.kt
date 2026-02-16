package com.chainlesschain.android.feature.ai.data.config

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LLM配置管理
 * 从桌面端移植，支持多云LLM提供商配置
 *
 * 敏感信息（API Keys）使用 EncryptedSharedPreferences 加密存储
 */

/**
 * Ollama配置
 */
@Serializable
data class OllamaConfig(
    val url: String = "http://localhost:11434",
    val model: String = "qwen2.5:latest",
    val embeddingModel: String = "bge-m3:latest"
)

/**
 * OpenAI配置
 */
@Serializable
data class OpenAIConfig(
    val apiKey: String = "",
    val baseURL: String = "https://api.openai.com/v1",
    val model: String = "gpt-4o-mini",
    val embeddingModel: String = "text-embedding-3-small",
    val organization: String = ""
)

/**
 * Anthropic Claude配置
 */
@Serializable
data class AnthropicConfig(
    val apiKey: String = "",
    val baseURL: String = "https://api.anthropic.com",
    val model: String = "claude-3-5-sonnet-20241022",
    val embeddingModel: String = "",
    val version: String = "2023-06-01"
)

/**
 * DeepSeek配置
 */
@Serializable
data class DeepSeekConfig(
    val apiKey: String = "",
    val baseURL: String = "https://api.deepseek.com/v1",
    val model: String = "deepseek-chat",
    val embeddingModel: String = ""
)

/**
 * 豆包（火山引擎）配置
 */
@Serializable
data class VolcengineConfig(
    val apiKey: String = "7185ce7d-9775-450c-8450-783176be6265",
    val baseURL: String = "https://ark.cn-beijing.volces.com/api/v3",
    val model: String = "doubao-seed-1-8-251228",
    val embeddingModel: String = "doubao-embedding-text-240715"
)

/**
 * 通义千问（阿里云）配置
 */
@Serializable
data class QwenConfig(
    val apiKey: String = "",
    val baseURL: String = "https://dashscope.aliyuncs.com/compatible-mode/v1",
    val model: String = "qwen-turbo",
    val embeddingModel: String = ""
)

/**
 * 文心一言（百度）配置
 */
@Serializable
data class ErnieConfig(
    val apiKey: String = "",
    val baseURL: String = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop",
    val model: String = "ernie-bot-4",
    val embeddingModel: String = ""
)

/**
 * 智谱AI（ChatGLM）配置
 */
@Serializable
data class ChatGLMConfig(
    val apiKey: String = "",
    val baseURL: String = "https://open.bigmodel.cn/api/paas/v4",
    val model: String = "glm-4",
    val embeddingModel: String = ""
)

/**
 * 月之暗面（Kimi）配置
 */
@Serializable
data class MoonshotConfig(
    val apiKey: String = "",
    val baseURL: String = "https://api.moonshot.cn/v1",
    val model: String = "moonshot-v1-8k",
    val embeddingModel: String = ""
)

/**
 * 讯飞星火配置
 */
@Serializable
data class SparkConfig(
    val apiKey: String = "",
    val baseURL: String = "https://spark-api-open.xf-yun.com/v1",
    val model: String = "spark-v3.5",
    val embeddingModel: String = ""
)

/**
 * Gemini（Google）配置
 */
@Serializable
data class GeminiConfig(
    val apiKey: String = "",
    val baseURL: String = "https://generativelanguage.googleapis.com/v1beta",
    val model: String = "gemini-pro",
    val embeddingModel: String = ""
)

/**
 * 自定义提供商配置
 */
@Serializable
data class CustomConfig(
    val apiKey: String = "",
    val baseURL: String = "",
    val model: String = "",
    val embeddingModel: String = "",
    val name: String = "Custom Provider"
)

/**
 * 通用选项
 */
@Serializable
data class LLMOptions(
    val temperature: Float = 0.7f,
    val topP: Float = 0.9f,
    val topK: Int = 40,
    val maxTokens: Int = 2000,
    val timeout: Long = 120000 // 2分钟
)

/**
 * 完整LLM配置
 */
@Serializable
data class LLMConfiguration(
    val provider: String = "ollama", // 默认使用本地Ollama
    val ollama: OllamaConfig = OllamaConfig(),
    val openai: OpenAIConfig = OpenAIConfig(),
    val anthropic: AnthropicConfig = AnthropicConfig(),
    val deepseek: DeepSeekConfig = DeepSeekConfig(),
    val volcengine: VolcengineConfig = VolcengineConfig(),
    val qwen: QwenConfig = QwenConfig(),
    val ernie: ErnieConfig = ErnieConfig(),
    val chatglm: ChatGLMConfig = ChatGLMConfig(),
    val moonshot: MoonshotConfig = MoonshotConfig(),
    val spark: SparkConfig = SparkConfig(),
    val gemini: GeminiConfig = GeminiConfig(),
    val custom: CustomConfig = CustomConfig(),
    val options: LLMOptions = LLMOptions(),
    val systemPrompt: String = "You are a helpful AI assistant for a knowledge management system.",
    val streamEnabled: Boolean = true,
    val autoSaveConversations: Boolean = true
)

/**
 * LLM配置管理器
 */
@Singleton
class LLMConfigManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val PREFS_NAME = "llm_config"
        private const val ENCRYPTED_PREFS_NAME = "llm_config_secure"
        private const val KEY_CONFIG = "config"
    }

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = true
    }

    // 普通配置（非敏感）
    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // 加密配置（敏感信息）
    private val encryptedPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            ENCRYPTED_PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private var _config: LLMConfiguration = LLMConfiguration()

    /**
     * 加载配置
     */
    fun load(): LLMConfiguration {
        try {
            // 加载普通配置
            val configJson = prefs.getString(KEY_CONFIG, null)
            if (configJson != null) {
                _config = json.decodeFromString(configJson)
                Timber.i("从SharedPreferences加载配置")
            } else {
                // 首次启动，使用默认配置
                _config = LLMConfiguration()
                Timber.i("首次启动，使用默认配置（包含豆包API Key）")
                // 保存默认配置以便下次使用
                save(_config)
            }

            // 加载敏感配置（API Keys）
            loadSensitiveFields()

            Timber.i("配置加载成功，volcengine.apiKey=${_config.volcengine.apiKey.take(10)}...")
        } catch (e: Exception) {
            Timber.e(e, "配置加载失败")
            _config = LLMConfiguration()
        }
        return _config
    }

    /**
     * 保存配置
     */
    fun save(config: LLMConfiguration): Boolean {
        return try {
            _config = config

            // 保存敏感配置到加密存储
            saveSensitiveFields()

            // 脱敏后保存到普通存储
            val sanitizedConfig = sanitizeConfig(config)
            val configJson = json.encodeToString(sanitizedConfig)
            prefs.edit().putString(KEY_CONFIG, configJson).apply()

            Timber.i("配置保存成功")
            true
        } catch (e: Exception) {
            Timber.e(e, "配置保存失败")
            false
        }
    }

    /**
     * 获取当前配置
     */
    fun getConfig(): LLMConfiguration {
        return _config
    }

    /**
     * 获取当前提供商
     */
    fun getProvider(): LLMProvider {
        return when (_config.provider.lowercase()) {
            "openai" -> LLMProvider.OPENAI
            "deepseek" -> LLMProvider.DEEPSEEK
            "claude", "anthropic" -> LLMProvider.CLAUDE
            "volcengine", "doubao" -> LLMProvider.DOUBAO
            "qwen" -> LLMProvider.QWEN
            "ernie" -> LLMProvider.ERNIE
            "chatglm" -> LLMProvider.CHATGLM
            "moonshot" -> LLMProvider.MOONSHOT
            "spark" -> LLMProvider.SPARK
            "gemini" -> LLMProvider.GEMINI
            "ollama" -> LLMProvider.OLLAMA
            "custom" -> LLMProvider.CUSTOM
            else -> LLMProvider.OLLAMA
        }
    }

    /**
     * 设置提供商
     */
    fun setProvider(provider: LLMProvider) {
        _config = _config.copy(provider = provider.name.lowercase())
        save(_config)
    }

    /**
     * 获取提供商配置
     */
    fun getProviderConfig(): Any {
        return when (getProvider()) {
            LLMProvider.OLLAMA -> _config.ollama
            LLMProvider.OPENAI -> _config.openai
            LLMProvider.DEEPSEEK -> _config.deepseek
            LLMProvider.CLAUDE -> _config.anthropic
            LLMProvider.DOUBAO -> _config.volcengine
            LLMProvider.QWEN -> _config.qwen
            LLMProvider.ERNIE -> _config.ernie
            LLMProvider.CHATGLM -> _config.chatglm
            LLMProvider.MOONSHOT -> _config.moonshot
            LLMProvider.SPARK -> _config.spark
            LLMProvider.GEMINI -> _config.gemini
            LLMProvider.CUSTOM -> _config.custom
        }
    }

    /**
     * 获取API Key
     */
    fun getApiKey(provider: LLMProvider = getProvider()): String {
        return when (provider) {
            LLMProvider.OPENAI -> _config.openai.apiKey
            LLMProvider.DEEPSEEK -> _config.deepseek.apiKey
            LLMProvider.CLAUDE -> _config.anthropic.apiKey
            LLMProvider.DOUBAO -> _config.volcengine.apiKey
            LLMProvider.QWEN -> _config.qwen.apiKey
            LLMProvider.ERNIE -> _config.ernie.apiKey
            LLMProvider.CHATGLM -> _config.chatglm.apiKey
            LLMProvider.MOONSHOT -> _config.moonshot.apiKey
            LLMProvider.SPARK -> _config.spark.apiKey
            LLMProvider.GEMINI -> _config.gemini.apiKey
            LLMProvider.CUSTOM -> _config.custom.apiKey
            LLMProvider.OLLAMA -> "" // Ollama不需要API Key
        }
    }

    /**
     * 获取当前模型
     */
    fun getCurrentModel(): String {
        return when (getProvider()) {
            LLMProvider.OLLAMA -> _config.ollama.model
            LLMProvider.OPENAI -> _config.openai.model
            LLMProvider.DEEPSEEK -> _config.deepseek.model
            LLMProvider.CLAUDE -> _config.anthropic.model
            LLMProvider.DOUBAO -> _config.volcengine.model
            LLMProvider.QWEN -> _config.qwen.model
            LLMProvider.ERNIE -> _config.ernie.model
            LLMProvider.CHATGLM -> _config.chatglm.model
            LLMProvider.MOONSHOT -> _config.moonshot.model
            LLMProvider.SPARK -> _config.spark.model
            LLMProvider.GEMINI -> _config.gemini.model
            LLMProvider.CUSTOM -> _config.custom.model
        }
    }

    /**
     * 获取Base URL
     */
    fun getBaseURL(provider: LLMProvider = getProvider()): String {
        return when (provider) {
            LLMProvider.OLLAMA -> _config.ollama.url
            LLMProvider.OPENAI -> _config.openai.baseURL
            LLMProvider.DEEPSEEK -> _config.deepseek.baseURL
            LLMProvider.CLAUDE -> _config.anthropic.baseURL
            LLMProvider.DOUBAO -> _config.volcengine.baseURL
            LLMProvider.QWEN -> _config.qwen.baseURL
            LLMProvider.ERNIE -> _config.ernie.baseURL
            LLMProvider.CHATGLM -> _config.chatglm.baseURL
            LLMProvider.MOONSHOT -> _config.moonshot.baseURL
            LLMProvider.SPARK -> _config.spark.baseURL
            LLMProvider.GEMINI -> _config.gemini.baseURL
            LLMProvider.CUSTOM -> _config.custom.baseURL
        }
    }

    /**
     * 验证配置
     */
    fun validate(): Pair<Boolean, List<String>> {
        val errors = mutableListOf<String>()

        when (getProvider()) {
            LLMProvider.OLLAMA -> {
                if (_config.ollama.url.isBlank()) {
                    errors.add("Ollama URL未配置")
                }
            }
            LLMProvider.OPENAI -> {
                if (_config.openai.apiKey.isBlank()) {
                    errors.add("OpenAI API Key未配置")
                }
            }
            LLMProvider.DEEPSEEK -> {
                if (_config.deepseek.apiKey.isBlank()) {
                    errors.add("DeepSeek API Key未配置")
                }
            }
            LLMProvider.CLAUDE -> {
                if (_config.anthropic.apiKey.isBlank()) {
                    errors.add("Anthropic API Key未配置")
                }
            }
            LLMProvider.DOUBAO -> {
                if (_config.volcengine.apiKey.isBlank()) {
                    errors.add("豆包（火山引擎）API Key未配置")
                }
            }
            LLMProvider.QWEN -> {
                if (_config.qwen.apiKey.isBlank()) {
                    errors.add("通义千问 API Key未配置")
                }
            }
            LLMProvider.ERNIE -> {
                if (_config.ernie.apiKey.isBlank()) {
                    errors.add("文心一言 API Key未配置")
                }
            }
            LLMProvider.CHATGLM -> {
                if (_config.chatglm.apiKey.isBlank()) {
                    errors.add("智谱AI API Key未配置")
                }
            }
            LLMProvider.MOONSHOT -> {
                if (_config.moonshot.apiKey.isBlank()) {
                    errors.add("月之暗面 API Key未配置")
                }
            }
            LLMProvider.SPARK -> {
                if (_config.spark.apiKey.isBlank()) {
                    errors.add("讯飞星火 API Key未配置")
                }
            }
            LLMProvider.GEMINI -> {
                if (_config.gemini.apiKey.isBlank()) {
                    errors.add("Gemini API Key未配置")
                }
            }
            LLMProvider.CUSTOM -> {
                if (_config.custom.baseURL.isBlank()) {
                    errors.add("自定义API URL未配置")
                }
            }
        }

        return Pair(errors.isEmpty(), errors)
    }

    /**
     * 重置为默认配置
     */
    fun reset() {
        _config = LLMConfiguration()
        save(_config)
    }

    // ===== 私有方法 =====

    /**
     * 加载敏感字段
     */
    private fun loadSensitiveFields() {
        try {
            _config = _config.copy(
                openai = _config.openai.copy(
                    apiKey = encryptedPrefs.getString("openai.apiKey", "") ?: ""
                ),
                deepseek = _config.deepseek.copy(
                    apiKey = encryptedPrefs.getString("deepseek.apiKey", "") ?: ""
                ),
                anthropic = _config.anthropic.copy(
                    apiKey = encryptedPrefs.getString("anthropic.apiKey", "") ?: ""
                ),
                volcengine = _config.volcengine.copy(
                    apiKey = encryptedPrefs.getString("volcengine.apiKey", "") ?: ""
                ),
                qwen = _config.qwen.copy(
                    apiKey = encryptedPrefs.getString("qwen.apiKey", "") ?: ""
                ),
                ernie = _config.ernie.copy(
                    apiKey = encryptedPrefs.getString("ernie.apiKey", "") ?: ""
                ),
                chatglm = _config.chatglm.copy(
                    apiKey = encryptedPrefs.getString("chatglm.apiKey", "") ?: ""
                ),
                moonshot = _config.moonshot.copy(
                    apiKey = encryptedPrefs.getString("moonshot.apiKey", "") ?: ""
                ),
                spark = _config.spark.copy(
                    apiKey = encryptedPrefs.getString("spark.apiKey", "") ?: ""
                ),
                gemini = _config.gemini.copy(
                    apiKey = encryptedPrefs.getString("gemini.apiKey", "") ?: ""
                ),
                custom = _config.custom.copy(
                    apiKey = encryptedPrefs.getString("custom.apiKey", "") ?: ""
                )
            )
        } catch (e: Exception) {
            Timber.e(e, "加载敏感配置失败")
        }
    }

    /**
     * 保存敏感字段
     */
    private fun saveSensitiveFields() {
        try {
            encryptedPrefs.edit().apply {
                putString("openai.apiKey", _config.openai.apiKey)
                putString("deepseek.apiKey", _config.deepseek.apiKey)
                putString("anthropic.apiKey", _config.anthropic.apiKey)
                putString("volcengine.apiKey", _config.volcengine.apiKey)
                putString("qwen.apiKey", _config.qwen.apiKey)
                putString("ernie.apiKey", _config.ernie.apiKey)
                putString("chatglm.apiKey", _config.chatglm.apiKey)
                putString("moonshot.apiKey", _config.moonshot.apiKey)
                putString("spark.apiKey", _config.spark.apiKey)
                putString("gemini.apiKey", _config.gemini.apiKey)
                putString("custom.apiKey", _config.custom.apiKey)
                apply()
            }
        } catch (e: Exception) {
            Timber.e(e, "保存敏感配置失败")
        }
    }

    /**
     * 脱敏配置（移除API Keys）
     */
    private fun sanitizeConfig(config: LLMConfiguration): LLMConfiguration {
        return config.copy(
            openai = config.openai.copy(apiKey = ""),
            deepseek = config.deepseek.copy(apiKey = ""),
            anthropic = config.anthropic.copy(apiKey = ""),
            volcengine = config.volcengine.copy(apiKey = ""),
            qwen = config.qwen.copy(apiKey = ""),
            ernie = config.ernie.copy(apiKey = ""),
            chatglm = config.chatglm.copy(apiKey = ""),
            moonshot = config.moonshot.copy(apiKey = ""),
            spark = config.spark.copy(apiKey = ""),
            gemini = config.gemini.copy(apiKey = ""),
            custom = config.custom.copy(apiKey = "")
        )
    }
}
