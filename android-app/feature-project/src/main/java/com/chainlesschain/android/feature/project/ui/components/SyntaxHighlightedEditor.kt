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
 */
private fun highlightSyntax(
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
        "xml", "html" -> highlightXml(code, colors)
        "md", "markdown" -> highlightMarkdown(code, colors)
        "yaml", "yml" -> highlightYaml(code, colors)
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
