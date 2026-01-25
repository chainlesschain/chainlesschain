package com.chainlesschain.android.feature.filebrowser.ai

import android.content.ContentResolver
import android.net.Uri
import android.util.Log
import com.chainlesschain.android.feature.ai.data.llm.OllamaAdapter
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.fold
import java.io.BufferedReader
import java.io.InputStreamReader
import javax.inject.Inject
import javax.inject.Singleton

/**
 * File Summarizer using LLM
 *
 * Generates intelligent summaries of file content using AI.
 *
 * Features:
 * - Text file summarization
 * - Code file analysis and explanation
 * - Document extraction and summary
 * - Multi-language support
 * - Summary caching
 * - Customizable summary length
 *
 * Supported file types:
 * - Text files (.txt, .md, .log)
 * - Code files (.kt, .java, .py, .js, .cpp, etc.)
 * - Documents (.pdf text, OCR results)
 * - Configuration files (.json, .xml, .yaml)
 *
 * Integration:
 * - Can integrate with Ollama (local LLM)
 * - Can integrate with cloud LLM APIs
 * - Fallback to rule-based summarization
 *
 * @see <a href="https://ollama.ai">Ollama</a>
 */
@Singleton
class FileSummarizer @Inject constructor(
    private val ollamaAdapter: OllamaAdapter
) {

    companion object {
        private const val TAG = "FileSummarizer"

        // Maximum file size to summarize (1MB)
        private const val MAX_FILE_SIZE = 1024 * 1024

        // Maximum content length for LLM (10K characters)
        private const val MAX_CONTENT_LENGTH = 10000

        // Summary length options
        const val LENGTH_SHORT = 50    // ~1 sentence
        const val LENGTH_MEDIUM = 200  // ~3-5 sentences
        const val LENGTH_LONG = 500    // ~1 paragraph

        // Default Ollama model for summarization
        private const val DEFAULT_OLLAMA_MODEL = "qwen2:7b"
    }

    /**
     * Summary result
     *
     * @property summary Generated summary text
     * @property keyPoints List of key points extracted
     * @property language Detected language
     * @property wordCount Original content word count
     * @property method Summarization method used
     */
    data class SummaryResult(
        val summary: String,
        val keyPoints: List<String> = emptyList(),
        val language: String? = null,
        val wordCount: Int = 0,
        val method: SummarizationMethod = SummarizationMethod.RULE_BASED
    ) {
        /**
         * Check if summary is empty
         */
        fun isEmpty(): Boolean = summary.isBlank()

        /**
         * Check if summary is available
         */
        fun isNotEmpty(): Boolean = summary.isNotBlank()
    }

    /**
     * Summarization method
     */
    enum class SummarizationMethod {
        LLM,           // Using LLM (Ollama, OpenAI, etc.)
        RULE_BASED,    // Using rule-based extraction
        STATISTICAL,   // Using statistical methods
        HYBRID         // Combination of methods
    }

    /**
     * File type for summarization
     */
    enum class FileType {
        TEXT,
        CODE,
        DOCUMENT,
        CONFIG,
        LOG,
        UNKNOWN
    }

    /**
     * Generate summary for file
     *
     * @param contentResolver Content resolver for file access
     * @param uri File URI
     * @param mimeType File MIME type
     * @param fileName File name for type detection
     * @param maxLength Maximum summary length
     * @return Summary result
     */
    suspend fun summarizeFile(
        contentResolver: ContentResolver,
        uri: String,
        mimeType: String?,
        fileName: String,
        maxLength: Int = LENGTH_MEDIUM
    ): SummaryResult = withContext(Dispatchers.IO) {
        try {
            // Check file size
            val fileSize = getFileSize(contentResolver, uri)
            if (fileSize > MAX_FILE_SIZE) {
                return@withContext SummaryResult(
                    summary = "文件过大，无法生成摘要（最大 ${MAX_FILE_SIZE / 1024}KB）",
                    method = SummarizationMethod.RULE_BASED
                )
            }

            // Load file content
            val content = loadTextContent(contentResolver, uri)
            if (content.isNullOrBlank()) {
                return@withContext SummaryResult(
                    summary = "无法读取文件内容",
                    method = SummarizationMethod.RULE_BASED
                )
            }

            // Detect file type
            val fileType = detectFileType(fileName, mimeType)

            // Generate summary based on file type
            generateSummary(content, fileType, fileName, maxLength)
        } catch (e: Exception) {
            Log.e(TAG, "Error summarizing file: $uri", e)
            SummaryResult(
                summary = "生成摘要失败: ${e.message}",
                method = SummarizationMethod.RULE_BASED
            )
        }
    }

    /**
     * Generate summary from content
     *
     * @param content File content
     * @param fileType File type
     * @param fileName File name
     * @param maxLength Maximum summary length
     * @return Summary result
     */
    private suspend fun generateSummary(
        content: String,
        fileType: FileType,
        fileName: String,
        maxLength: Int
    ): SummaryResult {
        // Truncate content if too long
        val truncatedContent = if (content.length > MAX_CONTENT_LENGTH) {
            content.substring(0, MAX_CONTENT_LENGTH) + "..."
        } else {
            content
        }

        // Try LLM summarization first (if Ollama is available)
        val llmAvailable = try {
            ollamaAdapter.checkAvailability()
        } catch (e: Exception) {
            Log.w(TAG, "Ollama not available, falling back to rule-based", e)
            false
        }

        if (llmAvailable) {
            try {
                val llmSummary = tryLLMSummarization(truncatedContent, fileType, fileName, maxLength)
                if (llmSummary != null) {
                    Log.d(TAG, "Successfully generated LLM summary")
                    return llmSummary
                }
            } catch (e: Exception) {
                Log.w(TAG, "LLM summarization failed, falling back to rule-based", e)
            }
        }

        // Fallback to rule-based summarization
        Log.d(TAG, "Using rule-based summarization")
        return when (fileType) {
            FileType.CODE -> summarizeCode(truncatedContent, fileName, maxLength)
            FileType.DOCUMENT, FileType.TEXT -> summarizeText(truncatedContent, maxLength)
            FileType.CONFIG -> summarizeConfig(truncatedContent, fileName, maxLength)
            FileType.LOG -> summarizeLog(truncatedContent, maxLength)
            FileType.UNKNOWN -> summarizeGeneric(truncatedContent, maxLength)
        }
    }

    /**
     * Summarize code file
     *
     * Extracts:
     * - Language
     * - Classes/Functions
     * - Key features
     */
    private fun summarizeCode(
        content: String,
        fileName: String,
        maxLength: Int
    ): SummaryResult {
        val language = detectCodeLanguage(fileName)
        val lines = content.lines()

        // Extract key elements
        val classes = mutableListOf<String>()
        val functions = mutableListOf<String>()
        val imports = mutableListOf<String>()

        lines.forEach { line ->
            val trimmed = line.trim()
            when {
                // Class definitions
                trimmed.startsWith("class ") || trimmed.contains("class ") -> {
                    val className = extractClassName(trimmed)
                    if (className.isNotBlank()) classes.add(className)
                }
                // Function definitions
                trimmed.startsWith("fun ") || trimmed.startsWith("function ") ||
                trimmed.startsWith("def ") || trimmed.contains("public ") -> {
                    val funcName = extractFunctionName(trimmed)
                    if (funcName.isNotBlank()) functions.add(funcName)
                }
                // Imports
                trimmed.startsWith("import ") || trimmed.startsWith("from ") -> {
                    imports.add(trimmed)
                }
            }
        }

        // Build summary
        val summary = buildString {
            append("$language 代码文件")
            if (classes.isNotEmpty()) {
                append("，包含 ${classes.size} 个类")
                if (classes.size <= 3) {
                    append(": ${classes.joinToString(", ")}")
                }
            }
            if (functions.isNotEmpty()) {
                append("，${functions.size} 个函数")
                if (functions.size <= 5) {
                    append(": ${functions.take(5).joinToString(", ")}")
                }
            }
            append("。共 ${lines.size} 行代码。")
        }

        val keyPoints = mutableListOf<String>()
        if (classes.isNotEmpty()) {
            keyPoints.add("类: ${classes.take(5).joinToString(", ")}")
        }
        if (functions.isNotEmpty()) {
            keyPoints.add("函数: ${functions.take(5).joinToString(", ")}")
        }

        return SummaryResult(
            summary = summary.take(maxLength),
            keyPoints = keyPoints,
            language = language,
            wordCount = content.split("\\s+".toRegex()).size,
            method = SummarizationMethod.RULE_BASED
        )
    }

    /**
     * Summarize text/document file
     *
     * Extracts:
     * - First few sentences
     * - Key topics
     * - Word count
     */
    private fun summarizeText(
        content: String,
        maxLength: Int
    ): SummaryResult {
        val lines = content.lines().filter { it.isNotBlank() }
        val words = content.split("\\s+".toRegex())

        // Extract first paragraph or sentences
        val firstParagraph = lines.take(5).joinToString(" ").trim()

        // Extract potential headings (lines that are short and uppercase)
        val headings = lines.filter { line ->
            line.length < 50 && line.any { it.isUpperCase() }
        }.take(3)

        // Build summary
        val summary = if (firstParagraph.isNotBlank()) {
            firstParagraph.take(maxLength)
        } else {
            "文本文件，共 ${words.size} 个单词，${lines.size} 行。"
        }

        val keyPoints = mutableListOf<String>()
        if (headings.isNotEmpty()) {
            keyPoints.add("主题: ${headings.joinToString(", ")}")
        }
        keyPoints.add("${words.size} 个单词，${lines.size} 行")

        return SummaryResult(
            summary = summary,
            keyPoints = keyPoints,
            wordCount = words.size,
            method = SummarizationMethod.RULE_BASED
        )
    }

    /**
     * Summarize configuration file
     *
     * Extracts:
     * - File format
     * - Top-level keys
     * - Configuration structure
     */
    private fun summarizeConfig(
        content: String,
        fileName: String,
        maxLength: Int
    ): SummaryResult {
        val format = when {
            fileName.endsWith(".json") -> "JSON"
            fileName.endsWith(".xml") -> "XML"
            fileName.endsWith(".yaml") || fileName.endsWith(".yml") -> "YAML"
            fileName.endsWith(".properties") -> "Properties"
            fileName.endsWith(".toml") -> "TOML"
            else -> "配置"
        }

        val lines = content.lines().filter { it.isNotBlank() }

        // Extract top-level keys (simplified)
        val keys = mutableListOf<String>()
        lines.forEach { line ->
            val trimmed = line.trim()
            when {
                trimmed.startsWith("\"") && trimmed.contains("\":") -> {
                    val key = trimmed.substringAfter("\"").substringBefore("\"")
                    if (key.isNotBlank()) keys.add(key)
                }
                trimmed.contains("=") -> {
                    val key = trimmed.substringBefore("=").trim()
                    if (key.isNotBlank() && !key.startsWith("#")) keys.add(key)
                }
            }
        }

        val summary = buildString {
            append("$format 配置文件")
            if (keys.isNotEmpty()) {
                append("，包含 ${keys.size} 个配置项")
                if (keys.size <= 5) {
                    append(": ${keys.joinToString(", ")}")
                }
            }
            append("。")
        }

        return SummaryResult(
            summary = summary.take(maxLength),
            keyPoints = if (keys.isNotEmpty()) listOf("配置项: ${keys.take(10).joinToString(", ")}") else emptyList(),
            wordCount = content.split("\\s+".toRegex()).size,
            method = SummarizationMethod.RULE_BASED
        )
    }

    /**
     * Summarize log file
     *
     * Extracts:
     * - Log level distribution
     * - Error count
     * - Time range
     */
    private fun summarizeLog(
        content: String,
        maxLength: Int
    ): SummaryResult {
        val lines = content.lines()

        // Count log levels
        var errorCount = 0
        var warnCount = 0
        var infoCount = 0

        lines.forEach { line ->
            val upper = line.uppercase()
            when {
                upper.contains("ERROR") -> errorCount++
                upper.contains("WARN") -> warnCount++
                upper.contains("INFO") -> infoCount++
            }
        }

        val summary = buildString {
            append("日志文件，共 ${lines.size} 行。")
            if (errorCount > 0) append(" 错误: $errorCount")
            if (warnCount > 0) append(" 警告: $warnCount")
            if (infoCount > 0) append(" 信息: $infoCount")
        }

        val keyPoints = mutableListOf<String>()
        if (errorCount > 0) keyPoints.add("$errorCount 个错误")
        if (warnCount > 0) keyPoints.add("$warnCount 个警告")

        return SummaryResult(
            summary = summary.take(maxLength),
            keyPoints = keyPoints,
            wordCount = content.split("\\s+".toRegex()).size,
            method = SummarizationMethod.RULE_BASED
        )
    }

    /**
     * Generic summarization
     */
    private fun summarizeGeneric(
        content: String,
        maxLength: Int
    ): SummaryResult {
        val lines = content.lines().filter { it.isNotBlank() }
        val words = content.split("\\s+".toRegex())

        val summary = "文件包含 ${words.size} 个单词，${lines.size} 行。"

        return SummaryResult(
            summary = summary,
            wordCount = words.size,
            method = SummarizationMethod.RULE_BASED
        )
    }

    /**
     * Try LLM-based summarization using Ollama
     *
     * @param content File content
     * @param fileType File type
     * @param fileName File name
     * @param maxLength Maximum summary length
     * @return Summary result or null if LLM failed
     */
    private suspend fun tryLLMSummarization(
        content: String,
        fileType: FileType,
        fileName: String,
        maxLength: Int
    ): SummaryResult? = withContext(Dispatchers.IO) {
        try {
            // Build prompt based on file type
            val prompt = buildSummaryPrompt(content, fileType, fileName, maxLength)

            // Create messages for LLM
            val messages = listOf(
                Message(
                    id = "system",
                    conversationId = "summarize",
                    role = MessageRole.SYSTEM,
                    content = "你是一个专业的文件分析助手。你的任务是分析文件内容并生成简洁、准确的摘要。",
                    createdAt = System.currentTimeMillis()
                ),
                Message(
                    id = "user",
                    conversationId = "summarize",
                    role = MessageRole.USER,
                    content = prompt,
                    createdAt = System.currentTimeMillis()
                )
            )

            // Call Ollama API (non-streaming for summary)
            val response = ollamaAdapter.chat(
                messages = messages,
                model = DEFAULT_OLLAMA_MODEL,
                temperature = 0.3f,  // Lower temperature for more focused summaries
                maxTokens = maxLength * 4  // Estimate tokens
            )

            // Parse response to extract summary and key points
            val (summary, keyPoints) = parseAIResponse(response)

            SummaryResult(
                summary = summary.take(maxLength),
                keyPoints = keyPoints,
                language = detectLanguage(content),
                wordCount = content.split("\\s+".toRegex()).size,
                method = SummarizationMethod.LLM
            )
        } catch (e: Exception) {
            Log.e(TAG, "LLM summarization failed", e)
            null
        }
    }

    /**
     * Build summary prompt based on file type
     */
    private fun buildSummaryPrompt(
        content: String,
        fileType: FileType,
        fileName: String,
        maxLength: Int
    ): String {
        val lengthDesc = when {
            maxLength <= LENGTH_SHORT -> "一句话"
            maxLength <= LENGTH_MEDIUM -> "3-5句话"
            else -> "一段话"
        }

        return when (fileType) {
            FileType.CODE -> """
                |请分析以下代码文件并生成摘要。
                |
                |文件名: $fileName
                |
                |代码内容:
                |```
                |$content
                |```
                |
                |请提供:
                |1. 摘要 ($lengthDesc)
                |2. 关键点 (列表格式，每行一个要点)
                |
                |格式要求:
                |摘要: [你的摘要]
                |关键点:
                |- [要点1]
                |- [要点2]
                |...
            """.trimMargin()

            FileType.DOCUMENT, FileType.TEXT -> """
                |请分析以下文档并生成摘要。
                |
                |文件名: $fileName
                |
                |文档内容:
                |$content
                |
                |请提供:
                |1. 摘要 ($lengthDesc)
                |2. 关键点 (列表格式，每行一个要点)
                |
                |格式要求:
                |摘要: [你的摘要]
                |关键点:
                |- [要点1]
                |- [要点2]
                |...
            """.trimMargin()

            FileType.CONFIG -> """
                |请分析以下配置文件并生成摘要。
                |
                |文件名: $fileName
                |
                |配置内容:
                |$content
                |
                |请提供:
                |1. 摘要 ($lengthDesc)
                |2. 主要配置项 (列表格式)
                |
                |格式要求:
                |摘要: [你的摘要]
                |关键点:
                |- [配置项1]
                |- [配置项2]
                |...
            """.trimMargin()

            FileType.LOG -> """
                |请分析以下日志文件并生成摘要。
                |
                |文件名: $fileName
                |
                |日志内容:
                |$content
                |
                |请提供:
                |1. 摘要 ($lengthDesc)
                |2. 关键事件或错误 (列表格式)
                |
                |格式要求:
                |摘要: [你的摘要]
                |关键点:
                |- [事件1]
                |- [事件2]
                |...
            """.trimMargin()

            FileType.UNKNOWN -> """
                |请分析以下文件并生成摘要。
                |
                |文件名: $fileName
                |
                |文件内容:
                |$content
                |
                |请提供简短的摘要 ($lengthDesc)。
            """.trimMargin()
        }
    }

    /**
     * Parse AI response to extract summary and key points
     */
    private fun parseAIResponse(response: String): Pair<String, List<String>> {
        val lines = response.lines()
        var summary = ""
        val keyPoints = mutableListOf<String>()

        var inSummary = false
        var inKeyPoints = false

        lines.forEach { line ->
            val trimmed = line.trim()

            when {
                trimmed.startsWith("摘要:") || trimmed.startsWith("Summary:") -> {
                    summary = trimmed.substringAfter(":").trim()
                    inSummary = true
                    inKeyPoints = false
                }
                trimmed.startsWith("关键点:") || trimmed.startsWith("Key Points:") ||
                trimmed.startsWith("主要配置项:") || trimmed.startsWith("关键事件或错误:") -> {
                    inSummary = false
                    inKeyPoints = true
                }
                trimmed.startsWith("-") || trimmed.startsWith("•") || trimmed.startsWith("*") -> {
                    if (inKeyPoints) {
                        val point = trimmed.substring(1).trim()
                        if (point.isNotBlank()) {
                            keyPoints.add(point)
                        }
                    }
                }
                trimmed.isNotBlank() -> {
                    if (inSummary && summary.isBlank()) {
                        summary = trimmed
                    } else if (inKeyPoints && trimmed.matches(Regex("\\d+\\..*"))) {
                        // Handle numbered lists like "1. Point"
                        val point = trimmed.substringAfter(".").trim()
                        if (point.isNotBlank()) {
                            keyPoints.add(point)
                        }
                    }
                }
            }
        }

        // Fallback: if parsing failed, use the entire response as summary
        if (summary.isBlank()) {
            summary = response.lines().firstOrNull { it.isNotBlank() } ?: response
        }

        return Pair(summary, keyPoints.take(5))  // Limit to 5 key points
    }

    /**
     * Detect content language
     */
    private fun detectLanguage(content: String): String {
        val chineseChars = content.count { it in '\u4e00'..'\u9fff' }
        val totalChars = content.length

        return if (chineseChars.toFloat() / totalChars > 0.3f) {
            "中文"
        } else {
            "English"
        }
    }

    /**
     * Detect file type
     */
    private fun detectFileType(fileName: String, mimeType: String?): FileType {
        val ext = fileName.substringAfterLast(".", "").lowercase()

        return when {
            // Code files
            ext in setOf("kt", "java", "py", "js", "ts", "cpp", "c", "h", "rs", "go", "rb", "php", "swift") -> FileType.CODE
            // Config files
            ext in setOf("json", "xml", "yaml", "yml", "toml", "properties", "ini", "conf") -> FileType.CONFIG
            // Log files
            ext in setOf("log", "logs") -> FileType.LOG
            // Text/Document files
            ext in setOf("txt", "md", "markdown", "rst", "doc", "docx") -> FileType.TEXT
            mimeType?.startsWith("text/") == true -> FileType.TEXT
            else -> FileType.UNKNOWN
        }
    }

    /**
     * Detect code language
     */
    private fun detectCodeLanguage(fileName: String): String {
        val ext = fileName.substringAfterLast(".", "").lowercase()
        return when (ext) {
            "kt" -> "Kotlin"
            "java" -> "Java"
            "py" -> "Python"
            "js" -> "JavaScript"
            "ts" -> "TypeScript"
            "cpp", "cc" -> "C++"
            "c" -> "C"
            "rs" -> "Rust"
            "go" -> "Go"
            "rb" -> "Ruby"
            "php" -> "PHP"
            "swift" -> "Swift"
            "cs" -> "C#"
            else -> "Unknown"
        }
    }

    /**
     * Extract class name from code line
     */
    private fun extractClassName(line: String): String {
        val pattern = Regex("class\\s+(\\w+)")
        val match = pattern.find(line)
        return match?.groupValues?.getOrNull(1) ?: ""
    }

    /**
     * Extract function name from code line
     */
    private fun extractFunctionName(line: String): String {
        val patterns = listOf(
            Regex("fun\\s+(\\w+)"),      // Kotlin
            Regex("function\\s+(\\w+)"), // JavaScript
            Regex("def\\s+(\\w+)"),      // Python
            Regex("\\w+\\s+(\\w+)\\s*\\(") // Java/C++
        )

        for (pattern in patterns) {
            val match = pattern.find(line)
            if (match != null) {
                return match.groupValues.getOrNull(1) ?: ""
            }
        }
        return ""
    }

    /**
     * Load text content from URI
     */
    private fun loadTextContent(
        contentResolver: ContentResolver,
        uri: String
    ): String? {
        return try {
            val inputStream = contentResolver.openInputStream(Uri.parse(uri)) ?: return null
            val reader = BufferedReader(InputStreamReader(inputStream))
            val content = reader.use { it.readText() }
            inputStream.close()
            content
        } catch (e: Exception) {
            Log.e(TAG, "Error loading text content: $uri", e)
            null
        }
    }

    /**
     * Get file size
     */
    private fun getFileSize(contentResolver: ContentResolver, uri: String): Long {
        return try {
            contentResolver.openInputStream(Uri.parse(uri))?.use { stream ->
                stream.available().toLong()
            } ?: 0L
        } catch (e: Exception) {
            0L
        }
    }
}
