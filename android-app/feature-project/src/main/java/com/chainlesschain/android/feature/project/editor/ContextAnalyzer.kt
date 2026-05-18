package com.chainlesschain.android.feature.project.editor

/**
 * 上下文分析器
 *
 * 分析光标位置的代码上下文，提供智能的上下文感知补全
 */
object ContextAnalyzer {

    /**
     * 分析光标位置的上下文
     */
    fun analyzeContext(fileContent: String, cursorPosition: Int, language: String): CompletionContext {
        if (cursorPosition <= 0) {
            return CompletionContext.General
        }

        val beforeCursor = fileContent.substring(0, cursorPosition)
        val currentLine = beforeCursor.substringAfterLast('\n')

        return when (language.lowercase()) {
            "kotlin", "kt" -> analyzeKotlinContext(currentLine, beforeCursor)
            "java" -> analyzeJavaContext(currentLine, beforeCursor)
            "python", "py" -> analyzePythonContext(currentLine, beforeCursor)
            "javascript", "js", "typescript", "ts" -> analyzeJSContext(currentLine, beforeCursor)
            else -> CompletionContext.General
        }
    }

    private fun analyzeKotlinContext(currentLine: String, beforeCursor: String): CompletionContext {
        // Import语句
        if (currentLine.trimStart().startsWith("import ")) {
            return CompletionContext.ImportStatement
        }

        // 类声明
        if (currentLine.contains(Regex("""class\s+\w*$"""))) {
            return CompletionContext.ClassDeclaration
        }

        // 函数声明
        if (currentLine.contains(Regex("""fun\s+\w*$"""))) {
            return CompletionContext.FunctionDeclaration
        }

        // 成员访问
        if (currentLine.contains(Regex("""\w+\.$"""))) {
            return CompletionContext.MemberAccess
        }

        // 函数调用
        if (currentLine.contains(Regex("""\w+\([^)]*$"""))) {
            return CompletionContext.FunctionCall
        }

        // 注解
        if (currentLine.trimStart().startsWith("@")) {
            return CompletionContext.Annotation
        }

        return CompletionContext.General
    }

    private fun analyzeJavaContext(currentLine: String, beforeCursor: String): CompletionContext {
        if (currentLine.trimStart().startsWith("import ")) {
            return CompletionContext.ImportStatement
        }

        if (currentLine.contains(Regex("""class\s+\w*$"""))) {
            return CompletionContext.ClassDeclaration
        }

        if (currentLine.contains(Regex("""\w+\.$"""))) {
            return CompletionContext.MemberAccess
        }

        if (currentLine.trimStart().startsWith("@")) {
            return CompletionContext.Annotation
        }

        return CompletionContext.General
    }

    private fun analyzePythonContext(currentLine: String, beforeCursor: String): CompletionContext {
        if (currentLine.trimStart().startsWith("import ") || currentLine.trimStart().startsWith("from ")) {
            return CompletionContext.ImportStatement
        }

        if (currentLine.contains(Regex("""class\s+\w*:?\s*$"""))) {
            return CompletionContext.ClassDeclaration
        }

        if (currentLine.contains(Regex("""\w+\.$"""))) {
            return CompletionContext.MemberAccess
        }

        return CompletionContext.General
    }

    private fun analyzeJSContext(currentLine: String, beforeCursor: String): CompletionContext {
        if (currentLine.trimStart().startsWith("import ")) {
            return CompletionContext.ImportStatement
        }

        if (currentLine.contains(Regex("""class\s+\w*$"""))) {
            return CompletionContext.ClassDeclaration
        }

        if (currentLine.contains(Regex("""\w+\.$"""))) {
            return CompletionContext.MemberAccess
        }

        return CompletionContext.General
    }

    /**
     * 根据上下文过滤补全项
     */
    fun filterByContext(completions: List<CompletionItem>, context: CompletionContext): List<CompletionItem> {
        return when (context) {
            is CompletionContext.ImportStatement -> {
                // 只显示类和包名
                completions.filter { it.type == CompletionItemType.CLASS }
            }
            is CompletionContext.ClassDeclaration -> {
                // 类名补全（可以是空的，让用户自己输入）
                emptyList()
            }
            is CompletionContext.MemberAccess -> {
                // 只显示方法和属性
                completions.filter {
                    it.type == CompletionItemType.FUNCTION ||
                    it.type == CompletionItemType.VARIABLE
                }
            }
            is CompletionContext.FunctionCall -> {
                // 优先显示函数
                completions.sortedByDescending {
                    if (it.type == CompletionItemType.FUNCTION) 10 else it.priority
                }
            }
            is CompletionContext.Annotation -> {
                // 注解补全（可以扩展）
                completions.filter { it.label.startsWith("@") || it.type == CompletionItemType.CLASS }
            }
            else -> completions
        }
    }
}

/**
 * 补全上下文
 */
sealed class CompletionContext {
    object ImportStatement : CompletionContext()
    object ClassDeclaration : CompletionContext()
    object FunctionDeclaration : CompletionContext()
    object MemberAccess : CompletionContext()
    object FunctionCall : CompletionContext()
    object Annotation : CompletionContext()
    object General : CompletionContext()
}
