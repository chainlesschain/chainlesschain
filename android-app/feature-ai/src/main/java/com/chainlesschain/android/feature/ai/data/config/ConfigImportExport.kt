package com.chainlesschain.android.feature.ai.data.config

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import java.io.InputStream
import java.io.OutputStream
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 配置导入/导出管理器
 * 支持与桌面端配置互通
 */
@Singleton
class ConfigImportExportManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val configManager: LLMConfigManager
) {

    companion object {
        private const val TAG = "ConfigImportExport"
        private const val CONFIG_FILE_NAME = "llm-config.json"
        private const val CONFIG_MIME_TYPE = "application/json"
    }

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = true
    }

    /**
     * 导出配置到JSON文件
     *
     * @param uri 目标文件URI（由用户通过文件选择器选择）
     * @param includeSensitive 是否包含敏感信息（API Keys）
     * @return 成功返回true
     */
    fun exportConfig(uri: Uri, includeSensitive: Boolean = false): Boolean {
        return try {
            val config = configManager.getConfig()

            // 如果不包含敏感信息，先脱敏
            val exportConfig = if (includeSensitive) {
                config
            } else {
                sanitizeConfig(config)
            }

            // 序列化为JSON
            val jsonString = json.encodeToString(exportConfig)

            // 写入文件
            context.contentResolver.openOutputStream(uri)?.use { outputStream ->
                outputStream.write(jsonString.toByteArray())
                outputStream.flush()
            }

            android.util.Log.i(TAG, "配置导出成功: $uri")
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "配置导出失败", e)
            false
        }
    }

    /**
     * 从JSON文件导入配置
     *
     * @param uri 源文件URI
     * @param mergeMode 合并模式：true=合并，false=覆盖
     * @return 成功返回true
     */
    fun importConfig(uri: Uri, mergeMode: Boolean = false): Boolean {
        return try {
            // 读取文件
            val jsonString = context.contentResolver.openInputStream(uri)?.use { inputStream ->
                inputStream.bufferedReader().use { it.readText() }
            } ?: throw Exception("无法读取文件")

            // 反序列化
            val importedConfig = json.decodeFromString<LLMConfiguration>(jsonString)

            // 应用配置
            val finalConfig = if (mergeMode) {
                // 合并模式：只更新非空字段
                mergeConfigs(configManager.getConfig(), importedConfig)
            } else {
                // 覆盖模式：完全替换
                importedConfig
            }

            // 保存
            configManager.save(finalConfig)

            android.util.Log.i(TAG, "配置导入成功: $uri")
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "配置导入失败", e)
            false
        }
    }

    /**
     * 从桌面端配置文件导入
     * 桌面端格式与安卓端相同，直接导入即可
     *
     * @param uri 桌面端配置文件URI
     * @return 成功返回true
     */
    fun importFromDesktop(uri: Uri): Boolean {
        return try {
            // 读取桌面端配置
            val jsonString = context.contentResolver.openInputStream(uri)?.use { inputStream ->
                inputStream.bufferedReader().use { it.readText() }
            } ?: throw Exception("无法读取文件")

            // 桌面端可能有一些额外字段，使用ignoreUnknownKeys
            val desktopConfig = json.decodeFromString<LLMConfiguration>(jsonString)

            // 直接应用（桌面端配置已经包含所有字段）
            configManager.save(desktopConfig)

            android.util.Log.i(TAG, "从桌面端导入配置成功")
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "从桌面端导入配置失败", e)
            false
        }
    }

    /**
     * 导出配置为字符串（用于分享、二维码等）
     *
     * @param includeSensitive 是否包含敏感信息
     * @return JSON字符串
     */
    fun exportToString(includeSensitive: Boolean = false): String {
        val config = configManager.getConfig()
        val exportConfig = if (includeSensitive) config else sanitizeConfig(config)
        return json.encodeToString(exportConfig)
    }

    /**
     * 从字符串导入配置（用于分享、二维码等）
     *
     * @param jsonString JSON字符串
     * @param mergeMode 合并模式
     * @return 成功返回true
     */
    fun importFromString(jsonString: String, mergeMode: Boolean = false): Boolean {
        return try {
            val importedConfig = json.decodeFromString<LLMConfiguration>(jsonString)

            val finalConfig = if (mergeMode) {
                mergeConfigs(configManager.getConfig(), importedConfig)
            } else {
                importedConfig
            }

            configManager.save(finalConfig)

            android.util.Log.i(TAG, "从字符串导入配置成功")
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "从字符串导入配置失败", e)
            false
        }
    }

    /**
     * 验证配置文件
     *
     * @param uri 配置文件URI
     * @return Pair(是否有效, 提供商名称)
     */
    fun validateConfigFile(uri: Uri): Pair<Boolean, String?> {
        return try {
            val jsonString = context.contentResolver.openInputStream(uri)?.use { inputStream ->
                inputStream.bufferedReader().use { it.readText() }
            } ?: return Pair(false, null)

            val config = json.decodeFromString<LLMConfiguration>(jsonString)

            Pair(true, config.provider)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "验证配置文件失败", e)
            Pair(false, null)
        }
    }

    /**
     * 生成配置快照（用于备份）
     *
     * @param name 快照名称
     * @return 快照文件名
     */
    fun createSnapshot(name: String = "backup"): String {
        val timestamp = System.currentTimeMillis()
        return "llm-config-${name}-${timestamp}.json"
    }

    // ===== 私有方法 =====

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

    /**
     * 合并配置
     * 只更新导入配置中非空/非默认的字段
     */
    private fun mergeConfigs(
        current: LLMConfiguration,
        imported: LLMConfiguration
    ): LLMConfiguration {
        return current.copy(
            provider = if (imported.provider.isNotBlank()) imported.provider else current.provider,

            ollama = mergeOllamaConfig(current.ollama, imported.ollama),
            openai = mergeOpenAIConfig(current.openai, imported.openai),
            deepseek = mergeDeepSeekConfig(current.deepseek, imported.deepseek),
            anthropic = mergeAnthropicConfig(current.anthropic, imported.anthropic),
            volcengine = mergeVolcengineConfig(current.volcengine, imported.volcengine),
            qwen = mergeQwenConfig(current.qwen, imported.qwen),
            ernie = mergeErnieConfig(current.ernie, imported.ernie),
            chatglm = mergeChatGLMConfig(current.chatglm, imported.chatglm),
            moonshot = mergeMoonshotConfig(current.moonshot, imported.moonshot),
            spark = mergeSparkConfig(current.spark, imported.spark),
            gemini = mergeGeminiConfig(current.gemini, imported.gemini),
            custom = mergeCustomConfig(current.custom, imported.custom),

            options = mergeOptions(current.options, imported.options),

            systemPrompt = if (imported.systemPrompt.isNotBlank()) imported.systemPrompt else current.systemPrompt,
            streamEnabled = imported.streamEnabled,
            autoSaveConversations = imported.autoSaveConversations
        )
    }

    private fun mergeOllamaConfig(current: OllamaConfig, imported: OllamaConfig): OllamaConfig {
        return current.copy(
            url = if (imported.url.isNotBlank()) imported.url else current.url,
            model = if (imported.model.isNotBlank()) imported.model else current.model,
            embeddingModel = if (imported.embeddingModel.isNotBlank()) imported.embeddingModel else current.embeddingModel
        )
    }

    private fun mergeOpenAIConfig(current: OpenAIConfig, imported: OpenAIConfig): OpenAIConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeDeepSeekConfig(current: DeepSeekConfig, imported: DeepSeekConfig): DeepSeekConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeAnthropicConfig(current: AnthropicConfig, imported: AnthropicConfig): AnthropicConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeVolcengineConfig(current: VolcengineConfig, imported: VolcengineConfig): VolcengineConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeQwenConfig(current: QwenConfig, imported: QwenConfig): QwenConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeErnieConfig(current: ErnieConfig, imported: ErnieConfig): ErnieConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeChatGLMConfig(current: ChatGLMConfig, imported: ChatGLMConfig): ChatGLMConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeMoonshotConfig(current: MoonshotConfig, imported: MoonshotConfig): MoonshotConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeSparkConfig(current: SparkConfig, imported: SparkConfig): SparkConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeGeminiConfig(current: GeminiConfig, imported: GeminiConfig): GeminiConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model
        )
    }

    private fun mergeCustomConfig(current: CustomConfig, imported: CustomConfig): CustomConfig {
        return current.copy(
            apiKey = if (imported.apiKey.isNotBlank()) imported.apiKey else current.apiKey,
            baseURL = if (imported.baseURL.isNotBlank()) imported.baseURL else current.baseURL,
            model = if (imported.model.isNotBlank()) imported.model else current.model,
            name = if (imported.name.isNotBlank()) imported.name else current.name
        )
    }

    private fun mergeOptions(current: LLMOptions, imported: LLMOptions): LLMOptions {
        return current.copy(
            temperature = imported.temperature,
            topP = imported.topP,
            topK = imported.topK,
            maxTokens = imported.maxTokens,
            timeout = imported.timeout
        )
    }
}
