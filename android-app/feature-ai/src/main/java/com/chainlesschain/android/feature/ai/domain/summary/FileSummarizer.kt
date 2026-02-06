package com.chainlesschain.android.feature.ai.domain.summary

import android.content.Context
import android.net.Uri
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.Role
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件智能摘要服务
 *
 * 使用 LLM 生成文件内容摘要，支持：
 * - 文本文件摘要
 * - Markdown 文件摘要
 * - 代码文件摘要
 * - 摘要缓存
 *
 * @since v0.32.0
 */
@Singleton
class FileSummarizer @Inject constructor(
    @ApplicationContext private val context: Context,
    private val llmAdapter: LLMAdapter,
    private val summaryCache: FileSummaryCache
) {
    companion object {
        private const val TAG = "FileSummarizer"
        private const val MAX_CONTENT_LENGTH = 8000 // 最大内容长度（字符）
        private const val SUMMARY_MODEL = "qwen2:7b" // 默认使用 Qwen2 模型

        // 支持的文件类型
        private val SUPPORTED_EXTENSIONS = setOf(
            "txt", "md", "markdown",
            "kt", "java", "py", "js", "ts", "tsx", "jsx",
            "json", "xml", "yaml", "yml",
            "html", "css", "scss",
            "sh", "bash", "zsh",
            "sql", "gradle", "properties"
        )

        // 摘要提示词模板
        private const val SUMMARY_PROMPT_TEMPLATE = """请为以下文件内容生成简洁的摘要。

文件名: %s
文件类型: %s

内容:
```
%s
```

要求：
1. 用中文回答
2. 摘要长度控制在 100-200 字
3. 重点描述文件的主要功能或内容
4. 如果是代码文件，说明主要功能和关键类/函数
5. 如果是文档文件，概述主要内容和结构"""

        private const val CODE_ANALYSIS_PROMPT_TEMPLATE = """分析以下代码文件并生成技术摘要。

文件名: %s
编程语言: %s

代码:
```%s
%s
```

请提供：
1. 文件用途（一句话概述）
2. 主要功能点（3-5 个要点）
3. 关键类/函数/组件
4. 依赖关系（如果有）"""
    }

    /**
     * 生成文件摘要
     *
     * @param uri 文件 URI
     * @param fileName 文件名
     * @param forceRefresh 是否强制刷新（忽略缓存）
     * @return 摘要结果
     */
    suspend fun summarize(
        uri: Uri,
        fileName: String,
        forceRefresh: Boolean = false
    ): Result<FileSummary> = withContext(Dispatchers.IO) {
        try {
            val extension = fileName.substringAfterLast('.', "").lowercase()

            // 检查是否支持该文件类型
            if (!isSupported(extension)) {
                return@withContext Result.failure(
                    UnsupportedFileTypeException("不支持的文件类型: $extension")
                )
            }

            // 读取文件内容
            val content = readFileContent(uri)
            if (content.isBlank()) {
                return@withContext Result.failure(
                    EmptyFileException("文件内容为空")
                )
            }

            // 计算内容哈希（用于缓存）
            val contentHash = computeHash(content)

            // 检查缓存
            if (!forceRefresh) {
                summaryCache.get(contentHash)?.let { cached ->
                    return@withContext Result.success(cached)
                }
            }

            // 截断过长内容
            val truncatedContent = if (content.length > MAX_CONTENT_LENGTH) {
                content.take(MAX_CONTENT_LENGTH) + "\n\n... (内容已截断)"
            } else {
                content
            }

            // 选择提示词模板
            val fileType = getFileType(extension)
            val prompt = if (isCodeFile(extension)) {
                String.format(
                    CODE_ANALYSIS_PROMPT_TEMPLATE,
                    fileName,
                    getLanguageName(extension),
                    extension,
                    truncatedContent
                )
            } else {
                String.format(
                    SUMMARY_PROMPT_TEMPLATE,
                    fileName,
                    fileType,
                    truncatedContent
                )
            }

            // 调用 LLM 生成摘要
            val messages = listOf(
                Message(
                    id = "system",
                    role = Role.SYSTEM,
                    content = "你是一个专业的文件分析助手，擅长生成简洁准确的文件摘要。"
                ),
                Message(
                    id = "user",
                    role = Role.USER,
                    content = prompt
                )
            )

            val summaryText = llmAdapter.chat(
                messages = messages,
                model = SUMMARY_MODEL,
                temperature = 0.3f,
                maxTokens = 500
            )

            // 构建摘要对象
            val summary = FileSummary(
                fileName = fileName,
                fileType = fileType,
                contentHash = contentHash,
                summary = summaryText.trim(),
                contentLength = content.length,
                generatedAt = System.currentTimeMillis(),
                isCodeFile = isCodeFile(extension)
            )

            // 缓存结果
            summaryCache.put(contentHash, summary)

            Result.success(summary)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * 批量生成摘要
     */
    suspend fun summarizeBatch(
        files: List<Pair<Uri, String>>,
        onProgress: (Int, Int) -> Unit = { _, _ -> }
    ): List<Result<FileSummary>> = withContext(Dispatchers.IO) {
        files.mapIndexed { index, (uri, fileName) ->
            onProgress(index + 1, files.size)
            summarize(uri, fileName)
        }
    }

    /**
     * 读取文件内容
     */
    private fun readFileContent(uri: Uri): String {
        return context.contentResolver.openInputStream(uri)?.use { inputStream ->
            BufferedReader(InputStreamReader(inputStream)).use { reader ->
                reader.readText()
            }
        } ?: ""
    }

    /**
     * 计算内容哈希
     */
    private fun computeHash(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(content.toByteArray())
        return hashBytes.joinToString("") { "%02x".format(it) }
    }

    /**
     * 检查是否支持该文件类型
     */
    fun isSupported(extension: String): Boolean {
        return extension.lowercase() in SUPPORTED_EXTENSIONS
    }

    /**
     * 获取文件类型描述
     */
    private fun getFileType(extension: String): String {
        return when (extension.lowercase()) {
            "txt" -> "文本文件"
            "md", "markdown" -> "Markdown 文档"
            "kt" -> "Kotlin 代码"
            "java" -> "Java 代码"
            "py" -> "Python 代码"
            "js" -> "JavaScript 代码"
            "ts" -> "TypeScript 代码"
            "tsx", "jsx" -> "React 组件"
            "json" -> "JSON 配置"
            "xml" -> "XML 配置"
            "yaml", "yml" -> "YAML 配置"
            "html" -> "HTML 页面"
            "css", "scss" -> "样式表"
            "sh", "bash", "zsh" -> "Shell 脚本"
            "sql" -> "SQL 脚本"
            "gradle" -> "Gradle 构建脚本"
            "properties" -> "配置文件"
            else -> "未知类型"
        }
    }

    /**
     * 获取编程语言名称
     */
    private fun getLanguageName(extension: String): String {
        return when (extension.lowercase()) {
            "kt" -> "Kotlin"
            "java" -> "Java"
            "py" -> "Python"
            "js", "jsx" -> "JavaScript"
            "ts", "tsx" -> "TypeScript"
            "sh", "bash", "zsh" -> "Shell"
            "sql" -> "SQL"
            "gradle" -> "Groovy/Kotlin DSL"
            else -> extension.uppercase()
        }
    }

    /**
     * 判断是否为代码文件
     */
    private fun isCodeFile(extension: String): Boolean {
        return extension.lowercase() in setOf(
            "kt", "java", "py", "js", "ts", "tsx", "jsx",
            "sh", "bash", "zsh", "sql", "gradle"
        )
    }
}

/**
 * 文件摘要结果
 */
data class FileSummary(
    val fileName: String,
    val fileType: String,
    val contentHash: String,
    val summary: String,
    val contentLength: Int,
    val generatedAt: Long,
    val isCodeFile: Boolean
)

/**
 * 不支持的文件类型异常
 */
class UnsupportedFileTypeException(message: String) : Exception(message)

/**
 * 空文件异常
 */
class EmptyFileException(message: String) : Exception(message)
