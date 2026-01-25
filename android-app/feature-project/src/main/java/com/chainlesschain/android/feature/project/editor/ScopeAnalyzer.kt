package com.chainlesschain.android.feature.project.editor

/**
 * 作用域分析器
 *
 * 分析代码文件，提取变量、函数、类等符号信息用于代码补全
 */
object ScopeAnalyzer {

    /**
     * 分析文件内容，提取符号
     */
    fun analyzeFile(content: String, language: String): List<Symbol> {
        return when (language.lowercase()) {
            "kotlin", "kt" -> analyzeKotlin(content)
            "java" -> analyzeJava(content)
            "python", "py" -> analyzePython(content)
            "javascript", "js" -> analyzeJavaScript(content)
            "typescript", "ts" -> analyzeTypeScript(content)
            else -> emptyList()
        }
    }

    /**
     * 分析Kotlin代码
     */
    private fun analyzeKotlin(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        // 提取函数
        val functionRegex = """(?:private|public|protected|internal)?\s*(?:suspend)?\s*fun\s+(\w+)\s*\(""".toRegex()
        functionRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.FUNCTION,
                kind = "function"
            ))
        }

        // 提取类
        val classRegex = """(?:data\s+|sealed\s+|abstract\s+)?class\s+(\w+)""".toRegex()
        classRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "class"
            ))
        }

        // 提取对象
        val objectRegex = """object\s+(\w+)""".toRegex()
        objectRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "object"
            ))
        }

        // 提取接口
        val interfaceRegex = """interface\s+(\w+)""".toRegex()
        interfaceRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "interface"
            ))
        }

        // 提取变量 (val/var)
        val variableRegex = """(?:private|public|protected|internal)?\s*(?:val|var|const)\s+(\w+)\s*[:=]""".toRegex()
        variableRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "variable"
            ))
        }

        // 提取属性（类成员）
        val propertyRegex = """^\s*(?:val|var)\s+(\w+)\s*:""".toRegex(RegexOption.MULTILINE)
        propertyRegex.findAll(content).forEach { match ->
            val name = match.groupValues[1]
            // 避免重复
            if (symbols.none { it.name == name }) {
                symbols.add(Symbol(
                    name = name,
                    type = SymbolType.PROPERTY,
                    kind = "property"
                ))
            }
        }

        return symbols.distinctBy { it.name }
    }

    /**
     * 分析Java代码
     */
    private fun analyzeJava(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        // 提取类
        val classRegex = """(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*class\s+(\w+)""".toRegex()
        classRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "class"
            ))
        }

        // 提取接口
        val interfaceRegex = """(?:public|private|protected)?\s*interface\s+(\w+)""".toRegex()
        interfaceRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "interface"
            ))
        }

        // 提取方法
        val methodRegex = """(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*\w+\s+(\w+)\s*\(""".toRegex()
        methodRegex.findAll(content).forEach { match ->
            val name = match.groupValues[1]
            // 排除关键字
            if (name != "class" && name != "interface" && name != "if" && name != "for") {
                symbols.add(Symbol(
                    name = name,
                    type = SymbolType.FUNCTION,
                    kind = "method"
                ))
            }
        }

        // 提取字段
        val fieldRegex = """(?:private|public|protected)?\s*(?:static)?\s*(?:final)?\s*\w+\s+(\w+)\s*[;=]""".toRegex()
        fieldRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "field"
            ))
        }

        return symbols.distinctBy { it.name }
    }

    /**
     * 分析Python代码
     */
    private fun analyzePython(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        // 提取函数
        val functionRegex = """def\s+(\w+)\s*\(""".toRegex()
        functionRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.FUNCTION,
                kind = "function"
            ))
        }

        // 提取类
        val classRegex = """class\s+(\w+)""".toRegex()
        classRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "class"
            ))
        }

        // 提取变量
        val variableRegex = """^(\w+)\s*=""".toRegex(RegexOption.MULTILINE)
        variableRegex.findAll(content).forEach { match ->
            val name = match.groupValues[1]
            // 排除关键字
            if (name != "def" && name != "class" && name != "if" && name != "for") {
                symbols.add(Symbol(
                    name = name,
                    type = SymbolType.VARIABLE,
                    kind = "variable"
                ))
            }
        }

        return symbols.distinctBy { it.name }
    }

    /**
     * 分析JavaScript代码
     */
    private fun analyzeJavaScript(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        // 提取函数声明
        val functionRegex = """function\s+(\w+)\s*\(""".toRegex()
        functionRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.FUNCTION,
                kind = "function"
            ))
        }

        // 提取箭头函数
        val arrowFunctionRegex = """(?:const|let|var)\s+(\w+)\s*=\s*\([^)]*\)\s*=>""".toRegex()
        arrowFunctionRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.FUNCTION,
                kind = "function"
            ))
        }

        // 提取类
        val classRegex = """class\s+(\w+)""".toRegex()
        classRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "class"
            ))
        }

        // 提取变量
        val variableRegex = """(?:const|let|var)\s+(\w+)""".toRegex()
        variableRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "variable"
            ))
        }

        return symbols.distinctBy { it.name }
    }

    /**
     * 分析TypeScript代码（扩展JavaScript）
     */
    private fun analyzeTypeScript(content: String): List<Symbol> {
        val symbols = analyzeJavaScript(content).toMutableList()

        // 提取接口
        val interfaceRegex = """interface\s+(\w+)""".toRegex()
        interfaceRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "interface"
            ))
        }

        // 提取类型别名
        val typeRegex = """type\s+(\w+)""".toRegex()
        typeRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "type"
            ))
        }

        // 提取枚举
        val enumRegex = """enum\s+(\w+)""".toRegex()
        enumRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.CLASS,
                kind = "enum"
            ))
        }

        return symbols.distinctBy { it.name }
    }

    /**
     * 提取当前行上下文中的局部变量
     */
    fun extractLocalVariables(content: String, cursorPosition: Int, language: String): List<Symbol> {
        // 获取光标所在行之前的内容
        val beforeCursor = content.substring(0, cursorPosition)

        return when (language.lowercase()) {
            "kotlin", "kt" -> extractKotlinLocalVars(beforeCursor)
            "java" -> extractJavaLocalVars(beforeCursor)
            "python", "py" -> extractPythonLocalVars(beforeCursor)
            "javascript", "js", "typescript", "ts" -> extractJSLocalVars(beforeCursor)
            else -> emptyList()
        }
    }

    private fun extractKotlinLocalVars(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        // 提取局部变量（在当前作用域内）
        val localVarRegex = """(?:val|var)\s+(\w+)\s*[:=]""".toRegex()
        localVarRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "local"
            ))
        }

        // 提取lambda参数
        val lambdaParamRegex = """\{\s*(\w+)(?:\s*,\s*(\w+))*\s*->""".toRegex()
        lambdaParamRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "parameter"
            ))
        }

        return symbols.distinctBy { it.name }
    }

    private fun extractJavaLocalVars(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        val localVarRegex = """\b\w+\s+(\w+)\s*[=;]""".toRegex()
        localVarRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "local"
            ))
        }

        return symbols.distinctBy { it.name }
    }

    private fun extractPythonLocalVars(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        val localVarRegex = """^    (\w+)\s*=""".toRegex(RegexOption.MULTILINE)
        localVarRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "local"
            ))
        }

        return symbols.distinctBy { it.name }
    }

    private fun extractJSLocalVars(content: String): List<Symbol> {
        val symbols = mutableListOf<Symbol>()

        val localVarRegex = """(?:const|let|var)\s+(\w+)""".toRegex()
        localVarRegex.findAll(content).forEach { match ->
            symbols.add(Symbol(
                name = match.groupValues[1],
                type = SymbolType.VARIABLE,
                kind = "local"
            ))
        }

        return symbols.distinctBy { it.name }
    }
}

/**
 * 符号
 */
data class Symbol(
    val name: String,
    val type: SymbolType,
    val kind: String,
    val detail: String? = null
) {
    fun toCompletionItem(): CompletionItem {
        return CompletionItem(
            label = name,
            type = when (type) {
                SymbolType.FUNCTION -> CompletionItemType.FUNCTION
                SymbolType.CLASS -> CompletionItemType.CLASS
                SymbolType.VARIABLE, SymbolType.PROPERTY -> CompletionItemType.VARIABLE
            },
            description = detail ?: kind,
            priority = when (type) {
                SymbolType.VARIABLE -> 10 // 局部变量优先级最高
                SymbolType.PROPERTY -> 8
                SymbolType.FUNCTION -> 6
                SymbolType.CLASS -> 4
            }
        )
    }
}

/**
 * 符号类型
 */
enum class SymbolType {
    FUNCTION,
    CLASS,
    VARIABLE,
    PROPERTY
}
