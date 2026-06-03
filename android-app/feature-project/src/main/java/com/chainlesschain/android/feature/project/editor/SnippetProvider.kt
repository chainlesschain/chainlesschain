package com.chainlesschain.android.feature.project.editor

/**
 * 代码片段提供者
 *
 * 提供常用代码模板的快速输入
 */
object SnippetProvider {

    /**
     * 获取指定语言的代码片段
     */
    fun getSnippets(language: String): List<CodeSnippet> {
        return when (language.lowercase()) {
            "kotlin", "kt" -> kotlinSnippets
            "java" -> javaSnippets
            "python", "py" -> pythonSnippets
            "javascript", "js" -> javascriptSnippets
            "typescript", "ts" -> typescriptSnippets
            "cpp", "c++" -> cppSnippets
            "c" -> cSnippets
            "go" -> goSnippets
            "rust", "rs" -> rustSnippets
            else -> emptyList()
        }
    }

    // Kotlin代码片段
    private val kotlinSnippets = listOf(
        CodeSnippet(
            label = "fun",
            description = "Function declaration",
            template = "fun \${1:functionName}(\${2:params}): \${3:Unit} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "class",
            description = "Class declaration",
            template = "class \${1:ClassName}(\${2:params}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "data class",
            description = "Data class declaration",
            template = "data class \${1:ClassName}(\n    \${0:// properties}\n)"
        ),
        CodeSnippet(
            label = "sealed class",
            description = "Sealed class declaration",
            template = "sealed class \${1:ClassName} {\n    \${0:// subclasses}\n}"
        ),
        CodeSnippet(
            label = "object",
            description = "Singleton object",
            template = "object \${1:ObjectName} {\n    \${0:// members}\n}"
        ),
        CodeSnippet(
            label = "companion object",
            description = "Companion object",
            template = "companion object {\n    \${0:// static members}\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "if-else",
            description = "If-else statement",
            template = "if (\${1:condition}) {\n    \${2:// TODO}\n} else {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "when",
            description = "When expression",
            template = "when (\${1:value}) {\n    \${2:condition} -> \${3:result}\n    else -> \${0:default}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for (\${1:item} in \${2:collection}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "while",
            description = "While loop",
            template = "while (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "try-catch",
            description = "Try-catch block",
            template = "try {\n    \${1:// code}\n} catch (e: \${2:Exception}) {\n    \${0:// handle error}\n}"
        ),
        CodeSnippet(
            label = "lateinit var",
            description = "Late-initialized variable",
            template = "private lateinit var \${1:variableName}: \${0:Type}"
        ),
        CodeSnippet(
            label = "lazy",
            description = "Lazy-initialized property",
            template = "private val \${1:propertyName}: \${2:Type} by lazy {\n    \${0:// initialization}\n}"
        ),
        CodeSnippet(
            label = "extension fun",
            description = "Extension function",
            template = "fun \${1:Type}.\${2:functionName}(\${3:params}): \${4:ReturnType} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "suspend fun",
            description = "Suspend function",
            template = "suspend fun \${1:functionName}(\${2:params}): \${3:ReturnType} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "Composable",
            description = "Jetpack Compose function",
            template = "@Composable\nfun \${1:ComponentName}(\n    \${2:params}\n) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "ViewModel",
            description = "ViewModel class",
            template = "class \${1:ViewModelName}(\n    \${2:dependencies}\n) : ViewModel() {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "StateFlow",
            description = "StateFlow property",
            template = "private val _\${1:stateName} = MutableStateFlow(\${2:initialValue})\nval \${1:stateName}: StateFlow<\${3:Type}> = _\${1:stateName}.asStateFlow()"
        ),
        CodeSnippet(
            label = "main",
            description = "Main function",
            template = "fun main() {\n    \${0:// TODO}\n}"
        )
    )

    // Java代码片段
    private val javaSnippets = listOf(
        CodeSnippet(
            label = "class",
            description = "Class declaration",
            template = "public class \${1:ClassName} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "interface",
            description = "Interface declaration",
            template = "public interface \${1:InterfaceName} {\n    \${0:// methods}\n}"
        ),
        CodeSnippet(
            label = "method",
            description = "Method declaration",
            template = "public \${1:void} \${2:methodName}(\${3:params}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "main",
            description = "Main method",
            template = "public static void main(String[] args) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "if-else",
            description = "If-else statement",
            template = "if (\${1:condition}) {\n    \${2:// TODO}\n} else {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for (int \${1:i} = 0; \${1:i} < \${2:length}; \${1:i}++) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for-each",
            description = "Enhanced for loop",
            template = "for (\${1:Type} \${2:item} : \${3:collection}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "while",
            description = "While loop",
            template = "while (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "try-catch",
            description = "Try-catch block",
            template = "try {\n    \${1:// code}\n} catch (\${2:Exception} e) {\n    \${0:// handle error}\n}"
        ),
        CodeSnippet(
            label = "switch",
            description = "Switch statement",
            template = "switch (\${1:value}) {\n    case \${2:constant}:\n        \${3:// TODO}\n        break;\n    default:\n        \${0:// TODO}\n}"
        )
    )

    // Python代码片段
    private val pythonSnippets = listOf(
        CodeSnippet(
            label = "def",
            description = "Function definition",
            template = "def \${1:function_name}(\${2:params}):\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "class",
            description = "Class definition",
            template = "class \${1:ClassName}:\n    def __init__(self\${2:, params}):\n        \${0:pass}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if \${1:condition}:\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "if-else",
            description = "If-else statement",
            template = "if \${1:condition}:\n    \${2:pass}\nelse:\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for \${1:item} in \${2:collection}:\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "while",
            description = "While loop",
            template = "while \${1:condition}:\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "try-except",
            description = "Try-except block",
            template = "try:\n    \${1:pass}\nexcept \${2:Exception} as e:\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "with",
            description = "Context manager",
            template = "with \${1:expression} as \${2:variable}:\n    \${0:pass}"
        ),
        CodeSnippet(
            label = "lambda",
            description = "Lambda function",
            template = "lambda \${1:params}: \${0:expression}"
        ),
        CodeSnippet(
            label = "main",
            description = "Main guard",
            template = "if __name__ == '__main__':\n    \${0:pass}"
        )
    )

    // JavaScript代码片段
    private val javascriptSnippets = listOf(
        CodeSnippet(
            label = "function",
            description = "Function declaration",
            template = "function \${1:functionName}(\${2:params}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "arrow function",
            description = "Arrow function",
            template = "const \${1:functionName} = (\${2:params}) => {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "class",
            description = "Class declaration",
            template = "class \${1:ClassName} {\n    constructor(\${2:params}) {\n        \${0:// TODO}\n    }\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for (let \${1:i} = 0; \${1:i} < \${2:length}; \${1:i}++) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for-of",
            description = "For-of loop",
            template = "for (const \${1:item} of \${2:collection}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "async function",
            description = "Async function",
            template = "async function \${1:functionName}(\${2:params}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "try-catch",
            description = "Try-catch block",
            template = "try {\n    \${1:// code}\n} catch (error) {\n    \${0:// handle error}\n}"
        ),
        CodeSnippet(
            label = "promise",
            description = "Promise",
            template = "new Promise((resolve, reject) => {\n    \${0:// TODO}\n})"
        ),
        CodeSnippet(
            label = "import",
            description = "ES6 import",
            template = "import { \${1:exports} } from '\${0:module}'"
        )
    )

    // TypeScript代码片段
    private val typescriptSnippets = javascriptSnippets + listOf(
        CodeSnippet(
            label = "interface",
            description = "Interface declaration",
            template = "interface \${1:InterfaceName} {\n    \${0:// properties}\n}"
        ),
        CodeSnippet(
            label = "type",
            description = "Type alias",
            template = "type \${1:TypeName} = \${0:Type}"
        ),
        CodeSnippet(
            label = "enum",
            description = "Enum declaration",
            template = "enum \${1:EnumName} {\n    \${0:// values}\n}"
        )
    )

    // C++代码片段
    private val cppSnippets = listOf(
        CodeSnippet(
            label = "class",
            description = "Class declaration",
            template = "class \${1:ClassName} {\npublic:\n    \${1:ClassName}();\n    ~\${1:ClassName}();\nprivate:\n    \${0:// members}\n};"
        ),
        CodeSnippet(
            label = "function",
            description = "Function declaration",
            template = "\${1:void} \${2:functionName}(\${3:params}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for (int \${1:i} = 0; \${1:i} < \${2:length}; \${1:i}++) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "while",
            description = "While loop",
            template = "while (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "try-catch",
            description = "Try-catch block",
            template = "try {\n    \${1:// code}\n} catch (const \${2:std::exception}& e) {\n    \${0:// handle error}\n}"
        ),
        CodeSnippet(
            label = "main",
            description = "Main function",
            template = "int main() {\n    \${0:// TODO}\n    return 0;\n}"
        )
    )

    // C代码片段
    private val cSnippets = listOf(
        CodeSnippet(
            label = "function",
            description = "Function declaration",
            template = "\${1:void} \${2:functionName}(\${3:params}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for (int \${1:i} = 0; \${1:i} < \${2:length}; \${1:i}++) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "while",
            description = "While loop",
            template = "while (\${1:condition}) {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "struct",
            description = "Struct declaration",
            template = "typedef struct \${1:StructName} {\n    \${0:// members}\n} \${1:StructName};"
        ),
        CodeSnippet(
            label = "main",
            description = "Main function",
            template = "int main(int argc, char *argv[]) {\n    \${0:// TODO}\n    return 0;\n}"
        )
    )

    // Go代码片段
    private val goSnippets = listOf(
        CodeSnippet(
            label = "func",
            description = "Function declaration",
            template = "func \${1:functionName}(\${2:params}) \${3:returnType} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "method",
            description = "Method declaration",
            template = "func (\${1:receiver} \${2:Type}) \${3:methodName}(\${4:params}) \${5:returnType} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "struct",
            description = "Struct declaration",
            template = "type \${1:StructName} struct {\n    \${0:// fields}\n}"
        ),
        CodeSnippet(
            label = "interface",
            description = "Interface declaration",
            template = "type \${1:InterfaceName} interface {\n    \${0:// methods}\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If statement",
            template = "if \${1:condition} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for \${1:i} := 0; \${1:i} < \${2:length}; \${1:i}++ {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for-range",
            description = "Range loop",
            template = "for \${1:index}, \${2:value} := range \${3:collection} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "goroutine",
            description = "Goroutine",
            template = "go func() {\n    \${0:// TODO}\n}()"
        ),
        CodeSnippet(
            label = "main",
            description = "Main function",
            template = "func main() {\n    \${0:// TODO}\n}"
        )
    )

    // Rust代码片段
    private val rustSnippets = listOf(
        CodeSnippet(
            label = "fn",
            description = "Function declaration",
            template = "fn \${1:function_name}(\${2:params}) \${3:-> ReturnType} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "struct",
            description = "Struct declaration",
            template = "struct \${1:StructName} {\n    \${0:// fields}\n}"
        ),
        CodeSnippet(
            label = "enum",
            description = "Enum declaration",
            template = "enum \${1:EnumName} {\n    \${0:// variants}\n}"
        ),
        CodeSnippet(
            label = "impl",
            description = "Implementation block",
            template = "impl \${1:TypeName} {\n    \${0:// methods}\n}"
        ),
        CodeSnippet(
            label = "trait",
            description = "Trait declaration",
            template = "trait \${1:TraitName} {\n    \${0:// methods}\n}"
        ),
        CodeSnippet(
            label = "if",
            description = "If expression",
            template = "if \${1:condition} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "for",
            description = "For loop",
            template = "for \${1:item} in \${2:collection} {\n    \${0:// TODO}\n}"
        ),
        CodeSnippet(
            label = "match",
            description = "Match expression",
            template = "match \${1:value} {\n    \${2:pattern} => \${3:result},\n    _ => \${0:default},\n}"
        ),
        CodeSnippet(
            label = "main",
            description = "Main function",
            template = "fn main() {\n    \${0:// TODO}\n}"
        )
    )
}

/**
 * 代码片段
 */
data class CodeSnippet(
    val label: String,
    val description: String,
    val template: String,
    val priority: Int = 5
) {
    /**
     * 解析模板占位符
     * 格式: ${序号:默认值}
     * 例如: ${1:functionName} -> 第1个光标位置，默认值为"functionName"
     */
    fun parseTabStops(): List<TabStop> {
        val regex = """\$\{(\d+):([^}]+)\}""".toRegex()
        val tabStops = mutableListOf<TabStop>()

        regex.findAll(template).forEach { match ->
            val order = match.groupValues[1].toIntOrNull() ?: 0
            val placeholder = match.groupValues[2]
            val start = match.range.first
            tabStops.add(TabStop(order, placeholder, start))
        }

        return tabStops.sortedBy { it.order }
    }

    /**
     * 获取插入文本（移除占位符标记）
     */
    fun getInsertText(): String {
        return template.replace("""\$\{\d+:([^}]+)\}""".toRegex(), "$1")
    }
}

/**
 * Tab停止点（光标位置）
 */
data class TabStop(
    val order: Int,
    val placeholder: String,
    val position: Int
)
