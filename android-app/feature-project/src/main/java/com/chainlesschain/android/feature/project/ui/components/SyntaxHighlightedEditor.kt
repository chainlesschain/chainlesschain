package com.chainlesschain.android.feature.project.ui.components

import android.graphics.Typeface
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import java.util.regex.Pattern

/**
 * Language-specific syntax highlighting colors
 */
data class SyntaxColors(
    val keyword: Color = Color(0xFF569CD6),      // Blue
    val string: Color = Color(0xFFCE9178),       // Orange
    val comment: Color = Color(0xFF6A9955),      // Green
    val number: Color = Color(0xFFB5CEA8),       // Light green
    val function: Color = Color(0xFFDCDCAA),     // Yellow
    val operator: Color = Color(0xFFD4D4D4),     // Light gray
    val type: Color = Color(0xFF4EC9B0),         // Cyan
    val annotation: Color = Color(0xFFDCDCAA),   // Yellow
    val variable: Color = Color(0xFF9CDCFE),     // Light blue
    val property: Color = Color(0xFF9CDCFE),     // Light blue
    val default: Color = Color(0xFFD4D4D4)       // Light gray
)

/**
 * Syntax highlighted code editor component
 */
@Composable
fun SyntaxHighlightedEditor(
    content: String,
    onContentChange: (String) -> Unit,
    language: String?,
    modifier: Modifier = Modifier,
    readOnly: Boolean = false,
    showLineNumbers: Boolean = true,
    syntaxColors: SyntaxColors = SyntaxColors()
) {
    val horizontalScrollState = rememberScrollState()
    val verticalScrollState = rememberScrollState()

    val lines = content.split("\n")
    val highlightedText = remember(content, language) {
        highlightSyntax(content, language, syntaxColors)
    }

    Surface(
        modifier = modifier,
        color = Color(0xFF1E1E1E), // VS Code dark background
        shape = MaterialTheme.shapes.medium
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(verticalScrollState)
        ) {
            // Line numbers
            if (showLineNumbers) {
                Column(
                    modifier = Modifier
                        .background(Color(0xFF252526))
                        .padding(horizontal = 8.dp, vertical = 8.dp)
                ) {
                    lines.forEachIndexed { index, _ ->
                        Text(
                            text = (index + 1).toString(),
                            style = TextStyle(
                                fontFamily = FontFamily.Monospace,
                                fontSize = 14.sp,
                                color = Color(0xFF858585)
                            ),
                            textAlign = TextAlign.End,
                            modifier = Modifier.width(40.dp)
                        )
                    }
                }
            }

            // Code content
            Box(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(horizontalScrollState)
                    .padding(8.dp)
            ) {
                if (readOnly) {
                    Text(
                        text = highlightedText,
                        style = TextStyle(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 14.sp,
                            lineHeight = 20.sp
                        )
                    )
                } else {
                    var textFieldValue by remember(content) {
                        mutableStateOf(TextFieldValue(content))
                    }

                    BasicTextField(
                        value = textFieldValue,
                        onValueChange = { newValue ->
                            textFieldValue = newValue
                            onContentChange(newValue.text)
                        },
                        textStyle = TextStyle(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                            color = syntaxColors.default
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }
}

/**
 * Read-only syntax highlighted code view
 */
@Composable
fun SyntaxHighlightedView(
    content: String,
    language: String?,
    modifier: Modifier = Modifier,
    showLineNumbers: Boolean = true,
    syntaxColors: SyntaxColors = SyntaxColors()
) {
    SyntaxHighlightedEditor(
        content = content,
        onContentChange = {},
        language = language,
        modifier = modifier,
        readOnly = true,
        showLineNumbers = showLineNumbers,
        syntaxColors = syntaxColors
    )
}

/**
 * Highlight syntax based on language
 * Supports 14+ programming languages
 */
internal fun highlightSyntax(
    code: String,
    language: String?,
    colors: SyntaxColors
): AnnotatedString {
    return when (language?.lowercase()) {
        "kt", "kotlin" -> highlightKotlin(code, colors)
        "java" -> highlightJava(code, colors)
        "py", "python" -> highlightPython(code, colors)
        "js", "javascript", "ts", "typescript", "jsx", "tsx" -> highlightJavaScript(code, colors)
        "swift" -> highlightSwift(code, colors)
        "json" -> highlightJson(code, colors)
        "xml", "html", "htm" -> highlightXml(code, colors)
        "md", "markdown" -> highlightMarkdown(code, colors)
        "yaml", "yml" -> highlightYaml(code, colors)
        "go" -> highlightGo(code, colors)
        "rs", "rust" -> highlightRust(code, colors)
        "c", "h" -> highlightC(code, colors)
        "cpp", "cc", "cxx", "hpp", "hxx" -> highlightCpp(code, colors)
        "css", "scss", "sass", "less" -> highlightCss(code, colors)
        "sql" -> highlightSql(code, colors)
        "sh", "bash", "zsh" -> highlightShell(code, colors)
        "dart" -> highlightDart(code, colors)
        "php" -> highlightPhp(code, colors)
        "rb", "ruby" -> highlightRuby(code, colors)
        else -> buildAnnotatedString { append(code) }
    }
}

// Kotlin syntax highlighting
private fun highlightKotlin(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "fun", "val", "var", "class", "object", "interface", "enum", "sealed",
        "if", "else", "when", "for", "while", "do", "return", "break", "continue",
        "package", "import", "private", "public", "protected", "internal",
        "override", "open", "final", "abstract", "companion", "data", "suspend",
        "inline", "crossinline", "noinline", "reified", "typealias", "by", "lazy",
        "true", "false", "null", "this", "super", "is", "as", "in", "out"
    )

    val types = listOf(
        "Int", "Long", "Float", "Double", "Boolean", "String", "Char", "Byte", "Short",
        "Unit", "Nothing", "Any", "List", "Map", "Set", "Array", "Pair", "Triple",
        "Flow", "StateFlow", "LiveData", "MutableList", "MutableMap", "MutableSet"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// Java syntax highlighting
private fun highlightJava(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "public", "private", "protected", "static", "final", "abstract",
        "class", "interface", "extends", "implements", "enum", "void",
        "if", "else", "switch", "case", "default", "for", "while", "do",
        "return", "break", "continue", "throw", "throws", "try", "catch", "finally",
        "new", "this", "super", "null", "true", "false", "import", "package",
        "synchronized", "volatile", "transient", "native", "instanceof"
    )

    val types = listOf(
        "int", "long", "float", "double", "boolean", "char", "byte", "short",
        "String", "Integer", "Long", "Float", "Double", "Boolean", "Object",
        "List", "Map", "Set", "ArrayList", "HashMap", "HashSet"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// Python syntax highlighting
private fun highlightPython(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "def", "class", "if", "elif", "else", "for", "while", "try", "except",
        "finally", "with", "as", "import", "from", "return", "yield", "raise",
        "pass", "break", "continue", "lambda", "global", "nonlocal", "assert",
        "True", "False", "None", "and", "or", "not", "in", "is", "async", "await"
    )

    val types = listOf(
        "int", "float", "str", "bool", "list", "dict", "set", "tuple",
        "List", "Dict", "Set", "Tuple", "Optional", "Any", "Union"
    )

    return buildHighlightedString(code, keywords, types, colors, "#")
}

// JavaScript/TypeScript syntax highlighting
private fun highlightJavaScript(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "function", "const", "let", "var", "if", "else", "for", "while", "do",
        "switch", "case", "default", "break", "continue", "return", "throw",
        "try", "catch", "finally", "class", "extends", "new", "this", "super",
        "import", "export", "from", "as", "async", "await", "typeof", "instanceof",
        "true", "false", "null", "undefined", "interface", "type", "enum"
    )

    val types = listOf(
        "string", "number", "boolean", "object", "any", "void", "never",
        "Array", "Object", "Promise", "Map", "Set", "Date", "RegExp"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// Swift syntax highlighting
private fun highlightSwift(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "func", "let", "var", "class", "struct", "enum", "protocol", "extension",
        "if", "else", "switch", "case", "default", "for", "while", "repeat",
        "return", "break", "continue", "throw", "try", "catch", "guard",
        "import", "private", "public", "internal", "fileprivate", "open",
        "override", "final", "static", "lazy", "weak", "unowned",
        "true", "false", "nil", "self", "Self", "super", "async", "await"
    )

    val types = listOf(
        "Int", "Float", "Double", "Bool", "String", "Character", "Any", "AnyObject",
        "Array", "Dictionary", "Set", "Optional", "Result", "Void"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// JSON syntax highlighting
private fun highlightJson(code: String, colors: SyntaxColors): AnnotatedString {
    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                code[i] == '"' -> {
                    // String
                    val endIndex = findStringEnd(code, i)
                    val str = code.substring(i, endIndex)

                    // Check if it's a key (followed by :)
                    val afterStr = code.substring(endIndex).trimStart()
                    val isKey = afterStr.startsWith(":")

                    withStyle(SpanStyle(color = if (isKey) colors.property else colors.string)) {
                        append(str)
                    }
                    i = endIndex
                }
                code[i].isDigit() || (code[i] == '-' && i + 1 < code.length && code[i + 1].isDigit()) -> {
                    // Number
                    val start = i
                    while (i < code.length && (code[i].isDigit() || code[i] == '.' || code[i] == '-' || code[i] == 'e' || code[i] == 'E')) {
                        i++
                    }
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                code.substring(i).startsWith("true") -> {
                    withStyle(SpanStyle(color = colors.keyword)) { append("true") }
                    i += 4
                }
                code.substring(i).startsWith("false") -> {
                    withStyle(SpanStyle(color = colors.keyword)) { append("false") }
                    i += 5
                }
                code.substring(i).startsWith("null") -> {
                    withStyle(SpanStyle(color = colors.keyword)) { append("null") }
                    i += 4
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

// XML/HTML syntax highlighting
private fun highlightXml(code: String, colors: SyntaxColors): AnnotatedString {
    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                code.substring(i).startsWith("<!--") -> {
                    // Comment
                    val endIndex = code.indexOf("-->", i).let { if (it == -1) code.length else it + 3 }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == '<' -> {
                    // Tag
                    val endIndex = code.indexOf('>', i).let { if (it == -1) code.length else it + 1 }
                    val tag = code.substring(i, endIndex)

                    // Split into parts: <tagname attr="value">
                    withStyle(SpanStyle(color = colors.keyword)) {
                        append(tag) // Simplified - could be more granular
                    }
                    i = endIndex
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

// Markdown syntax highlighting
private fun highlightMarkdown(code: String, colors: SyntaxColors): AnnotatedString {
    return buildAnnotatedString {
        code.lines().forEach { line ->
            when {
                line.startsWith("#") -> {
                    withStyle(SpanStyle(color = colors.keyword, fontWeight = FontWeight.Bold)) {
                        append(line)
                    }
                }
                line.startsWith("- ") || line.startsWith("* ") || line.matches(Regex("^\\d+\\. .*")) -> {
                    withStyle(SpanStyle(color = colors.type)) {
                        append(line)
                    }
                }
                line.startsWith(">") -> {
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(line)
                    }
                }
                line.startsWith("```") -> {
                    withStyle(SpanStyle(color = colors.string)) {
                        append(line)
                    }
                }
                else -> append(line)
            }
            append("\n")
        }
    }
}

// YAML syntax highlighting
private fun highlightYaml(code: String, colors: SyntaxColors): AnnotatedString {
    return buildAnnotatedString {
        code.lines().forEach { line ->
            when {
                line.trimStart().startsWith("#") -> {
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(line)
                    }
                }
                line.contains(":") -> {
                    val colonIndex = line.indexOf(':')
                    withStyle(SpanStyle(color = colors.property)) {
                        append(line.substring(0, colonIndex + 1))
                    }
                    append(line.substring(colonIndex + 1))
                }
                else -> append(line)
            }
            append("\n")
        }
    }
}

// Helper function to build highlighted string
private fun buildHighlightedString(
    code: String,
    keywords: List<String>,
    types: List<String>,
    colors: SyntaxColors,
    commentPrefix: String = "//"
): AnnotatedString {
    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                // Comment
                code.substring(i).startsWith(commentPrefix) -> {
                    val endIndex = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                // Block comment
                code.substring(i).startsWith("/*") -> {
                    val endIndex = code.indexOf("*/", i).let { if (it == -1) code.length else it + 2 }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                // String
                code[i] == '"' || code[i] == '\'' || code[i] == '`' -> {
                    val quote = code[i]
                    val endIndex = findQuoteEnd(code, i, quote)
                    withStyle(SpanStyle(color = colors.string)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                // Annotation
                code[i] == '@' -> {
                    val start = i
                    i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) {
                        i++
                    }
                    withStyle(SpanStyle(color = colors.annotation)) {
                        append(code.substring(start, i))
                    }
                }
                // Number
                code[i].isDigit() -> {
                    val start = i
                    while (i < code.length && (code[i].isDigit() || code[i] == '.' || code[i] == 'f' || code[i] == 'L' || code[i] == 'x' || code[i].lowercaseChar() in 'a'..'f')) {
                        i++
                    }
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                // Word (potential keyword/type)
                code[i].isLetter() || code[i] == '_' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) {
                        i++
                    }
                    val word = code.substring(start, i)
                    val color = when {
                        word in keywords -> colors.keyword
                        word in types -> colors.type
                        else -> colors.default
                    }
                    withStyle(SpanStyle(color = color)) {
                        append(word)
                    }
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

private fun findQuoteEnd(code: String, start: Int, quote: Char): Int {
    var i = start + 1
    while (i < code.length) {
        if (code[i] == quote && (i == start + 1 || code[i - 1] != '\\')) {
            return i + 1
        }
        i++
    }
    return code.length
}

private fun findStringEnd(code: String, start: Int): Int {
    var i = start + 1
    while (i < code.length) {
        if (code[i] == '"' && code[i - 1] != '\\') {
            return i + 1
        }
        i++
    }
    return code.length
}

// Go syntax highlighting
private fun highlightGo(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "func", "var", "const", "type", "struct", "interface", "map", "chan",
        "if", "else", "switch", "case", "default", "for", "range", "break", "continue",
        "return", "go", "defer", "select", "package", "import", "fallthrough", "goto",
        "true", "false", "nil", "iota"
    )

    val types = listOf(
        "int", "int8", "int16", "int32", "int64",
        "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
        "float32", "float64", "complex64", "complex128",
        "bool", "byte", "rune", "string", "error", "any"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// Rust syntax highlighting
private fun highlightRust(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl",
        "if", "else", "match", "loop", "while", "for", "in", "break", "continue", "return",
        "pub", "mod", "use", "crate", "super", "self", "Self", "as", "where",
        "async", "await", "move", "ref", "dyn", "unsafe", "extern", "type",
        "true", "false", "None", "Some", "Ok", "Err"
    )

    val types = listOf(
        "i8", "i16", "i32", "i64", "i128", "isize",
        "u8", "u16", "u32", "u64", "u128", "usize",
        "f32", "f64", "bool", "char", "str", "String",
        "Vec", "Box", "Option", "Result", "HashMap", "HashSet"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// C syntax highlighting
private fun highlightC(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "auto", "break", "case", "char", "const", "continue", "default", "do",
        "double", "else", "enum", "extern", "float", "for", "goto", "if",
        "int", "long", "register", "return", "short", "signed", "sizeof", "static",
        "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while",
        "NULL", "true", "false"
    )

    val types = listOf(
        "int", "char", "float", "double", "void", "long", "short", "unsigned",
        "signed", "size_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
        "int8_t", "int16_t", "int32_t", "int64_t", "bool"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// C++ syntax highlighting
private fun highlightCpp(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor",
        "bool", "break", "case", "catch", "char", "class", "compl", "const",
        "constexpr", "const_cast", "continue", "decltype", "default", "delete",
        "do", "double", "dynamic_cast", "else", "enum", "explicit", "export",
        "extern", "false", "float", "for", "friend", "goto", "if", "inline",
        "int", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq",
        "nullptr", "operator", "or", "or_eq", "private", "protected", "public",
        "register", "reinterpret_cast", "return", "short", "signed", "sizeof",
        "static", "static_assert", "static_cast", "struct", "switch", "template",
        "this", "throw", "true", "try", "typedef", "typeid", "typename", "union",
        "unsigned", "using", "virtual", "void", "volatile", "wchar_t", "while",
        "xor", "xor_eq", "override", "final"
    )

    val types = listOf(
        "string", "vector", "map", "set", "list", "deque", "queue", "stack",
        "pair", "tuple", "array", "shared_ptr", "unique_ptr", "weak_ptr",
        "optional", "variant", "any", "function"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// CSS syntax highlighting
private fun highlightCss(code: String, colors: SyntaxColors): AnnotatedString {
    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                // Comment
                code.substring(i).startsWith("/*") -> {
                    val endIndex = code.indexOf("*/", i).let { if (it == -1) code.length else it + 2 }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                // Selector (starts line or after }, before {)
                code[i] == '.' || code[i] == '#' || code[i].isLetter() -> {
                    val braceIndex = code.indexOf('{', i)
                    if (braceIndex != -1 && !code.substring(i, braceIndex).contains('}')) {
                        // This is a selector
                        withStyle(SpanStyle(color = colors.type)) {
                            append(code.substring(i, braceIndex))
                        }
                        i = braceIndex
                    } else {
                        // Property or value
                        val colonIndex = code.indexOf(':', i)
                        val semiIndex = code.indexOf(';', i)
                        if (colonIndex != -1 && (semiIndex == -1 || colonIndex < semiIndex)) {
                            // Property name
                            withStyle(SpanStyle(color = colors.property)) {
                                append(code.substring(i, colonIndex))
                            }
                            i = colonIndex
                        } else {
                            append(code[i])
                            i++
                        }
                    }
                }
                // Color value
                code[i] == '#' && i + 1 < code.length && code[i + 1].isLetterOrDigit() -> {
                    val start = i
                    i++
                    while (i < code.length && code[i].isLetterOrDigit()) i++
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                // String
                code[i] == '"' || code[i] == '\'' -> {
                    val quote = code[i]
                    val endIndex = findQuoteEnd(code, i, quote)
                    withStyle(SpanStyle(color = colors.string)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                // Number with unit
                code[i].isDigit() -> {
                    val start = i
                    while (i < code.length && (code[i].isDigit() || code[i] == '.' || code[i] == '%' ||
                        code[i].lowercaseChar() in listOf('p', 'x', 'e', 'm', 'r', 'v', 'w', 'h', 's'))) {
                        i++
                    }
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

// SQL syntax highlighting
private fun highlightSql(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
        "DELETE", "CREATE", "TABLE", "DROP", "ALTER", "ADD", "INDEX", "VIEW",
        "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT",
        "IN", "LIKE", "BETWEEN", "IS", "NULL", "AS", "ORDER", "BY", "GROUP",
        "HAVING", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "COUNT", "SUM",
        "AVG", "MIN", "MAX", "ASC", "DESC", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
        "CONSTRAINT", "DEFAULT", "UNIQUE", "CHECK", "CASCADE", "IF", "EXISTS",
        "CASE", "WHEN", "THEN", "ELSE", "END", "BEGIN", "COMMIT", "ROLLBACK",
        "TRANSACTION", "GRANT", "REVOKE", "TRUE", "FALSE"
    )

    val types = listOf(
        "INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "FLOAT", "DOUBLE",
        "DECIMAL", "NUMERIC", "REAL", "VARCHAR", "CHAR", "TEXT", "BLOB",
        "DATE", "TIME", "DATETIME", "TIMESTAMP", "BOOLEAN", "BOOL", "SERIAL"
    )

    // Case-insensitive matching for SQL
    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                code.substring(i).startsWith("--") -> {
                    val endIndex = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code.substring(i).startsWith("/*") -> {
                    val endIndex = code.indexOf("*/", i).let { if (it == -1) code.length else it + 2 }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == '\'' -> {
                    val endIndex = findQuoteEnd(code, i, '\'')
                    withStyle(SpanStyle(color = colors.string)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i].isDigit() -> {
                    val start = i
                    while (i < code.length && (code[i].isDigit() || code[i] == '.')) i++
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                code[i].isLetter() || code[i] == '_' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    val word = code.substring(start, i)
                    val color = when {
                        word.uppercase() in keywords -> colors.keyword
                        word.uppercase() in types -> colors.type
                        else -> colors.default
                    }
                    withStyle(SpanStyle(color = color)) {
                        append(word)
                    }
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

// Shell/Bash syntax highlighting
private fun highlightShell(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until",
        "do", "done", "in", "function", "return", "local", "export", "readonly",
        "declare", "typeset", "unset", "shift", "source", "alias", "unalias",
        "true", "false", "break", "continue", "exit"
    )

    val builtins = listOf(
        "echo", "printf", "read", "cd", "pwd", "ls", "cp", "mv", "rm", "mkdir",
        "rmdir", "touch", "cat", "grep", "sed", "awk", "find", "xargs", "sort",
        "uniq", "wc", "head", "tail", "cut", "tr", "chmod", "chown", "sudo",
        "apt", "yum", "brew", "npm", "pip", "git", "docker", "kubectl"
    )

    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                code[i] == '#' -> {
                    val endIndex = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == '"' || code[i] == '\'' -> {
                    val quote = code[i]
                    val endIndex = findQuoteEnd(code, i, quote)
                    withStyle(SpanStyle(color = colors.string)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == '$' -> {
                    val start = i
                    i++
                    if (i < code.length && code[i] == '{') {
                        val endIndex = code.indexOf('}', i).let { if (it == -1) code.length else it + 1 }
                        withStyle(SpanStyle(color = colors.variable)) {
                            append(code.substring(start, endIndex))
                        }
                        i = endIndex
                    } else {
                        while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                        withStyle(SpanStyle(color = colors.variable)) {
                            append(code.substring(start, i))
                        }
                    }
                }
                code[i].isLetter() || code[i] == '_' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_' || code[i] == '-')) i++
                    val word = code.substring(start, i)
                    val color = when {
                        word in keywords -> colors.keyword
                        word in builtins -> colors.function
                        else -> colors.default
                    }
                    withStyle(SpanStyle(color = color)) {
                        append(word)
                    }
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

// Dart syntax highlighting
private fun highlightDart(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "abstract", "as", "assert", "async", "await", "break", "case", "catch",
        "class", "const", "continue", "covariant", "default", "deferred", "do",
        "dynamic", "else", "enum", "export", "extends", "extension", "external",
        "factory", "false", "final", "finally", "for", "Function", "get", "hide",
        "if", "implements", "import", "in", "interface", "is", "late", "library",
        "mixin", "new", "null", "on", "operator", "part", "required", "rethrow",
        "return", "set", "show", "static", "super", "switch", "sync", "this",
        "throw", "true", "try", "typedef", "var", "void", "while", "with", "yield"
    )

    val types = listOf(
        "int", "double", "num", "bool", "String", "List", "Map", "Set",
        "Future", "Stream", "Iterable", "Object", "dynamic", "void",
        "Widget", "BuildContext", "State", "StatelessWidget", "StatefulWidget"
    )

    return buildHighlightedString(code, keywords, types, colors)
}

// PHP syntax highlighting
private fun highlightPhp(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "abstract", "and", "array", "as", "break", "callable", "case", "catch",
        "class", "clone", "const", "continue", "declare", "default", "die", "do",
        "echo", "else", "elseif", "empty", "enddeclare", "endfor", "endforeach",
        "endif", "endswitch", "endwhile", "eval", "exit", "extends", "final",
        "finally", "fn", "for", "foreach", "function", "global", "goto", "if",
        "implements", "include", "include_once", "instanceof", "insteadof",
        "interface", "isset", "list", "match", "namespace", "new", "or", "print",
        "private", "protected", "public", "readonly", "require", "require_once",
        "return", "static", "switch", "throw", "trait", "try", "unset", "use",
        "var", "while", "xor", "yield", "true", "false", "null"
    )

    val types = listOf(
        "int", "float", "bool", "string", "array", "object", "callable", "iterable",
        "void", "mixed", "never", "null"
    )

    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                code.substring(i).startsWith("//") -> {
                    val endIndex = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code.substring(i).startsWith("#") && !code.substring(i).startsWith("#[") -> {
                    val endIndex = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code.substring(i).startsWith("/*") -> {
                    val endIndex = code.indexOf("*/", i).let { if (it == -1) code.length else it + 2 }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == '$' -> {
                    val start = i
                    i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    withStyle(SpanStyle(color = colors.variable)) {
                        append(code.substring(start, i))
                    }
                }
                code[i] == '"' || code[i] == '\'' -> {
                    val quote = code[i]
                    val endIndex = findQuoteEnd(code, i, quote)
                    withStyle(SpanStyle(color = colors.string)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i].isDigit() -> {
                    val start = i
                    while (i < code.length && (code[i].isDigit() || code[i] == '.')) i++
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                code[i].isLetter() || code[i] == '_' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    val word = code.substring(start, i)
                    val color = when {
                        word in keywords -> colors.keyword
                        word in types -> colors.type
                        else -> colors.default
                    }
                    withStyle(SpanStyle(color = color)) {
                        append(word)
                    }
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}

// Ruby syntax highlighting
private fun highlightRuby(code: String, colors: SyntaxColors): AnnotatedString {
    val keywords = listOf(
        "BEGIN", "END", "alias", "and", "begin", "break", "case", "class",
        "def", "defined?", "do", "else", "elsif", "end", "ensure", "false",
        "for", "if", "in", "module", "next", "nil", "not", "or", "redo",
        "rescue", "retry", "return", "self", "super", "then", "true", "undef",
        "unless", "until", "when", "while", "yield", "__FILE__", "__LINE__",
        "attr_reader", "attr_writer", "attr_accessor", "private", "protected",
        "public", "require", "require_relative", "include", "extend", "raise"
    )

    val types = listOf(
        "Array", "Hash", "String", "Integer", "Float", "Symbol", "Proc",
        "Lambda", "Class", "Module", "Object", "NilClass", "TrueClass", "FalseClass"
    )

    return buildAnnotatedString {
        var i = 0
        while (i < code.length) {
            when {
                code[i] == '#' -> {
                    val endIndex = code.indexOf('\n', i).let { if (it == -1) code.length else it }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code.substring(i).startsWith("=begin") -> {
                    val endIndex = code.indexOf("=end", i).let { if (it == -1) code.length else it + 4 }
                    withStyle(SpanStyle(color = colors.comment)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == '"' || code[i] == '\'' -> {
                    val quote = code[i]
                    val endIndex = findQuoteEnd(code, i, quote)
                    withStyle(SpanStyle(color = colors.string)) {
                        append(code.substring(i, endIndex))
                    }
                    i = endIndex
                }
                code[i] == ':' && i + 1 < code.length && code[i + 1].isLetter() -> {
                    val start = i
                    i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    withStyle(SpanStyle(color = colors.type)) {
                        append(code.substring(start, i))
                    }
                }
                code[i] == '@' -> {
                    val start = i
                    i++
                    if (i < code.length && code[i] == '@') i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    withStyle(SpanStyle(color = colors.variable)) {
                        append(code.substring(start, i))
                    }
                }
                code[i].isDigit() -> {
                    val start = i
                    while (i < code.length && (code[i].isDigit() || code[i] == '.' || code[i] == '_')) i++
                    withStyle(SpanStyle(color = colors.number)) {
                        append(code.substring(start, i))
                    }
                }
                code[i].isLetter() || code[i] == '_' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_' || code[i] == '?' || code[i] == '!')) i++
                    val word = code.substring(start, i)
                    val color = when {
                        word in keywords -> colors.keyword
                        word in types -> colors.type
                        word.first().isUpperCase() -> colors.type
                        else -> colors.default
                    }
                    withStyle(SpanStyle(color = color)) {
                        append(word)
                    }
                }
                else -> {
                    append(code[i])
                    i++
                }
            }
        }
    }
}
