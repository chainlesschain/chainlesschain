package com.chainlesschain.android.feature.project.editor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 代码补全引擎
 *
 * 整合关键字、代码片段、作用域分析，提供统一的代码补全服务
 */
class CodeCompletionEngine {

    companion object {
        private const val MAX_COMPLETION_ITEMS = 50
        private const val MIN_PREFIX_LENGTH = 1
    }

    // 缓存文件符号
    private val symbolCache = mutableMapOf<String, List<Symbol>>()

    /**
     * 获取代码补全建议
     *
     * @param fileContent 文件内容
     * @param fileName 文件名（用于检测语言）
     * @param cursorPosition 光标位置
     * @param prefix 当前输入的前缀
     * @return 补全建议列表
     */
    suspend fun getCompletions(
        fileContent: String,
        fileName: String,
        cursorPosition: Int,
        prefix: String
    ): List<CompletionItem> = withContext(Dispatchers.Default) {
        if (prefix.length < MIN_PREFIX_LENGTH) {
            return@withContext emptyList()
        }

        val language = KeywordProvider.detectLanguage(fileName)
        val completions = mutableListOf<CompletionItem>()

        // 1. 关键字补全
        val keywords = KeywordProvider.getKeywords(language)
            .filter { it.label.startsWith(prefix, ignoreCase = true) }
            .map { it.copy(priority = 2) }
        completions.addAll(keywords)

        // 2. 代码片段补全
        val snippets = SnippetProvider.getSnippets(language)
            .filter { it.label.startsWith(prefix, ignoreCase = true) }
            .map { snippet ->
                CompletionItem(
                    label = snippet.label,
                    type = CompletionItemType.SNIPPET,
                    description = snippet.description,
                    insertText = snippet.getInsertText(),
                    priority = 3
                )
            }
        completions.addAll(snippets)

        // 3. 作用域符号补全（函数、类、变量等）
        val fileSymbols = getOrAnalyzeFileSymbols(fileContent, language, fileName)
        val symbolCompletions = fileSymbols
            .filter { it.name.startsWith(prefix, ignoreCase = true) }
            .map { it.toCompletionItem() }
        completions.addAll(symbolCompletions)

        // 4. 局部变量补全（优先级最高）
        val localVars = ScopeAnalyzer.extractLocalVariables(fileContent, cursorPosition, language)
            .filter { it.name.startsWith(prefix, ignoreCase = true) }
            .map { it.toCompletionItem() }
        completions.addAll(localVars)

        // 按优先级和字母顺序排序，去重
        completions
            .distinctBy { it.label }
            .sortedWith(
                compareByDescending<CompletionItem> { it.priority }
                    .thenBy { it.label.lowercase() }
            )
            .take(MAX_COMPLETION_ITEMS)
    }

    /**
     * 获取指定位置的补全触发器类型
     */
    fun getCompletionTrigger(fileContent: String, cursorPosition: Int): CompletionTrigger {
        if (cursorPosition <= 0) {
            return CompletionTrigger.NONE
        }

        val charBeforeCursor = fileContent.getOrNull(cursorPosition - 1) ?: return CompletionTrigger.NONE

        return when (charBeforeCursor) {
            '.' -> CompletionTrigger.MEMBER_ACCESS
            ':' -> {
                // 检查是否是 :: (Kotlin作用域解析)
                if (cursorPosition >= 2 && fileContent[cursorPosition - 2] == ':') {
                    CompletionTrigger.SCOPE_RESOLUTION
                } else {
                    CompletionTrigger.TYPE_ANNOTATION
                }
            }
            '(' -> CompletionTrigger.FUNCTION_PARAMETERS
            '<' -> CompletionTrigger.GENERIC_PARAMETERS
            '@' -> CompletionTrigger.ANNOTATION
            else -> {
                if (charBeforeCursor.isLetterOrDigit() || charBeforeCursor == '_') {
                    CompletionTrigger.IDENTIFIER
                } else {
                    CompletionTrigger.NONE
                }
            }
        }
    }

    /**
     * 提取当前输入的前缀
     */
    fun extractPrefix(fileContent: String, cursorPosition: Int): String {
        if (cursorPosition <= 0) {
            return ""
        }

        val beforeCursor = fileContent.substring(0, cursorPosition)

        // 查找最后一个非标识符字符
        var start = cursorPosition - 1
        while (start >= 0) {
            val char = beforeCursor[start]
            if (!char.isLetterOrDigit() && char != '_') {
                break
            }
            start--
        }

        return beforeCursor.substring(start + 1)
    }

    /**
     * 应用补全项
     *
     * @param fileContent 原文件内容
     * @param cursorPosition 光标位置
     * @param completionItem 选中的补全项
     * @return Pair<新文件内容, 新光标位置>
     */
    fun applyCompletion(
        fileContent: String,
        cursorPosition: Int,
        completionItem: CompletionItem
    ): Pair<String, Int> {
        val prefix = extractPrefix(fileContent, cursorPosition)
        val prefixStart = cursorPosition - prefix.length

        // 替换前缀为补全文本
        val newContent = fileContent.substring(0, prefixStart) +
                completionItem.insertText +
                fileContent.substring(cursorPosition)

        // 计算新光标位置
        val newCursorPosition = prefixStart + completionItem.insertText.length

        return newContent to newCursorPosition
    }

    /**
     * 清除文件符号缓存
     */
    fun clearCache(fileName: String? = null) {
        if (fileName != null) {
            symbolCache.remove(fileName)
        } else {
            symbolCache.clear()
        }
    }

    /**
     * 预分析文件（用于提前缓存）
     */
    suspend fun preAnalyzeFile(fileContent: String, fileName: String) = withContext(Dispatchers.Default) {
        val language = KeywordProvider.detectLanguage(fileName)
        if (language != "unknown") {
            val symbols = ScopeAnalyzer.analyzeFile(fileContent, language)
            symbolCache[fileName] = symbols
        }
    }

    // Private helpers

    private fun getOrAnalyzeFileSymbols(fileContent: String, language: String, fileName: String): List<Symbol> {
        // 检查缓存
        symbolCache[fileName]?.let { return it }

        // 分析并缓存
        if (language != "unknown") {
            val symbols = ScopeAnalyzer.analyzeFile(fileContent, language)
            symbolCache[fileName] = symbols
            return symbols
        }

        return emptyList()
    }

    /**
     * 获取函数签名帮助
     */
    fun getSignatureHelp(
        fileContent: String,
        cursorPosition: Int,
        fileName: String
    ): SignatureHelp? {
        // 查找当前函数调用
        val beforeCursor = fileContent.substring(0, cursorPosition)
        val functionCallRegex = """(\w+)\s*\(([^)]*)$""".toRegex()
        val match = functionCallRegex.findAll(beforeCursor).lastOrNull() ?: return null

        val functionName = match.groupValues[1]
        val currentParams = match.groupValues[2]
        val parameterIndex = currentParams.count { it == ',' }

        return SignatureHelp(
            functionName = functionName,
            parameterIndex = parameterIndex,
            signature = "$functionName(...)"
        )
    }
}

/**
 * 补全触发器类型
 */
enum class CompletionTrigger {
    NONE,                   // 无触发
    IDENTIFIER,             // 标识符输入
    MEMBER_ACCESS,          // 成员访问 (.)
    SCOPE_RESOLUTION,       // 作用域解析 (::)
    TYPE_ANNOTATION,        // 类型注解 (:)
    FUNCTION_PARAMETERS,    // 函数参数 (()
    GENERIC_PARAMETERS,     // 泛型参数 (<>)
    ANNOTATION              // 注解 (@)
}

/**
 * 函数签名帮助
 */
data class SignatureHelp(
    val functionName: String,
    val parameterIndex: Int,
    val signature: String,
    val documentation: String? = null
)
