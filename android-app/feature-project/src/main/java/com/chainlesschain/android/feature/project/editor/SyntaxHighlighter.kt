package com.chainlesschain.android.feature.project.editor

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import java.util.regex.Pattern

/**
 * Syntax Highlighter
 *
 * Provides syntax highlighting for multiple programming languages:
 * - Kotlin, Java, Swift
 * - JavaScript, TypeScript
 * - Python, Go, Rust
 * - HTML, CSS, XML
 * - JSON, YAML, Markdown
 *
 * Features:
 * - Keywords, operators, strings, numbers, comments
 * - Light and dark theme support
 * - Efficient regex-based tokenization
 */
class SyntaxHighlighter(
    private val theme: CodeTheme = CodeTheme.Dark
) {

    companion object {
        // Maximum content length to highlight (performance limit)
        private const val MAX_HIGHLIGHT_LENGTH = 50000
    }

    /**
     * Highlight code content
     *
     * @param content Source code content
     * @param language Programming language
     * @return AnnotatedString with syntax highlighting
     */
    fun highlight(content: String, language: String?): AnnotatedString {
        if (content.isEmpty() || content.length > MAX_HIGHLIGHT_LENGTH) {
            return AnnotatedString(content)
        }

        val lang = language?.lowercase() ?: detectLanguage(content)
        val rules = getLanguageRules(lang)

        return buildAnnotatedString {
            append(content)

            // Apply highlighting rules
            rules.forEach { rule ->
                val matcher = rule.pattern.matcher(content)
                while (matcher.find()) {
                    val style = getStyleForToken(rule.tokenType)
                    addStyle(style, matcher.start(), matcher.end())
                }
            }
        }
    }

    /**
     * Highlight a single line
     */
    fun highlightLine(line: String, language: String?): AnnotatedString {
        return highlight(line, language)
    }

    /**
     * Get token style
     */
    private fun getStyleForToken(tokenType: TokenType): SpanStyle {
        return when (tokenType) {
            TokenType.KEYWORD -> SpanStyle(
                color = theme.keyword,
                fontWeight = FontWeight.Bold
            )
            TokenType.TYPE -> SpanStyle(
                color = theme.type,
                fontWeight = FontWeight.Medium
            )
            TokenType.STRING -> SpanStyle(
                color = theme.string
            )
            TokenType.NUMBER -> SpanStyle(
                color = theme.number
            )
            TokenType.COMMENT -> SpanStyle(
                color = theme.comment,
                fontStyle = FontStyle.Italic
            )
            TokenType.OPERATOR -> SpanStyle(
                color = theme.operator
            )
            TokenType.FUNCTION -> SpanStyle(
                color = theme.function
            )
            TokenType.VARIABLE -> SpanStyle(
                color = theme.variable
            )
            TokenType.ANNOTATION -> SpanStyle(
                color = theme.annotation
            )
            TokenType.TAG -> SpanStyle(
                color = theme.tag
            )
            TokenType.ATTRIBUTE -> SpanStyle(
                color = theme.attribute
            )
            TokenType.CONSTANT -> SpanStyle(
                color = theme.constant,
                fontWeight = FontWeight.Medium
            )
            TokenType.REGEX -> SpanStyle(
                color = theme.regex
            )
        }
    }

    /**
     * Detect language from content
     */
    private fun detectLanguage(content: String): String {
        val firstLine = content.lineSequence().firstOrNull()?.trim() ?: ""

        return when {
            // Shebang detection
            firstLine.startsWith("#!/usr/bin/env python") -> "python"
            firstLine.startsWith("#!/usr/bin/env node") -> "javascript"
            firstLine.startsWith("#!/bin/bash") -> "bash"

            // Package/import detection
            content.contains("package ") && content.contains("fun ") -> "kotlin"
            content.contains("package ") && content.contains("class ") -> "java"
            content.contains("import SwiftUI") -> "swift"
            content.contains("import React") || content.contains("from 'react'") -> "javascript"
            content.contains("import ") && content.contains("def ") -> "python"
            content.contains("package main") && content.contains("func ") -> "go"
            content.contains("use ") && content.contains("fn ") -> "rust"

            // Tag detection
            content.contains("<!DOCTYPE html>") || content.contains("<html") -> "html"
            content.contains("<?xml") -> "xml"

            // Other patterns
            content.contains("@Composable") -> "kotlin"
            content.startsWith("{") && content.contains("\"") -> "json"
            content.contains("---") && content.contains(":") -> "yaml"

            else -> "text"
        }
    }

    /**
     * Get highlighting rules for language
     */
    private fun getLanguageRules(language: String): List<HighlightRule> {
        return when (language) {
            "kotlin", "kt", "kts" -> kotlinRules
            "java" -> javaRules
            "javascript", "js", "jsx" -> javascriptRules
            "typescript", "ts", "tsx" -> typescriptRules
            "python", "py" -> pythonRules
            "swift" -> swiftRules
            "go" -> goRules
            "rust", "rs" -> rustRules
            "html" -> htmlRules
            "css", "scss", "sass" -> cssRules
            "xml" -> xmlRules
            "json" -> jsonRules
            "yaml", "yml" -> yamlRules
            "markdown", "md" -> markdownRules
            "sql" -> sqlRules
            "bash", "sh", "shell" -> bashRules
            else -> genericRules
        }
    }

    // === Language-specific rules ===

    private val kotlinRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"\"\"[\\s\\S]*?\"\"\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'(?:[^'\\\\]|\\\\.)*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("@\\w+"),
            TokenType.ANNOTATION
        ),
        HighlightRule(
            Pattern.compile("\\b(val|var|fun|class|interface|object|data|sealed|enum|annotation|companion|init|constructor|by|lazy|lateinit|override|open|abstract|final|private|protected|public|internal|suspend|inline|infix|operator|tailrec|external|expect|actual)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(if|else|when|for|while|do|try|catch|finally|throw|return|break|continue|in|is|as|when|where)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|null|this|super|it)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b(Int|Long|Float|Double|Boolean|String|Char|Byte|Short|Unit|Any|Nothing|Array|List|Map|Set|MutableList|MutableMap|MutableSet)\\b"),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?[fFLlDd]?\\b"),
            TokenType.NUMBER
        ),
        HighlightRule(
            Pattern.compile("\\b0x[0-9a-fA-F]+\\b"),
            TokenType.NUMBER
        ),
        HighlightRule(
            Pattern.compile("\\b([A-Z][a-zA-Z0-9]*)(\\s*\\()"),
            TokenType.FUNCTION
        )
    )

    private val javaRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("@\\w+"),
            TokenType.ANNOTATION
        ),
        HighlightRule(
            Pattern.compile("\\b(public|private|protected|static|final|abstract|synchronized|volatile|transient|native|strictfp|class|interface|enum|extends|implements|new|this|super|void|return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|throws|import|package|instanceof|assert)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|null)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b(int|long|float|double|boolean|char|byte|short|String|Object|Integer|Long|Float|Double|Boolean|Character|Byte|Short)\\b"),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?[fFLlDd]?\\b"),
            TokenType.NUMBER
        )
    )

    private val javascriptRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("`(?:[^`\\\\]|\\\\.)*`"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'(?:[^'\\\\]|\\\\.)*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b(const|let|var|function|class|extends|new|this|super|return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|import|export|from|as|async|await|yield|of|in|typeof|instanceof|delete|void)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|null|undefined|NaN|Infinity)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?\\b"),
            TokenType.NUMBER
        ),
        HighlightRule(
            Pattern.compile("/(?:[^/\\\\]|\\\\.)+/[gimsuvy]*"),
            TokenType.REGEX
        ),
        HighlightRule(
            Pattern.compile("=>"),
            TokenType.OPERATOR
        )
    )

    private val typescriptRules = javascriptRules + listOf(
        HighlightRule(
            Pattern.compile("\\b(type|interface|namespace|module|declare|abstract|implements|readonly|private|protected|public|static|enum|as|is|keyof|infer|extends)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(string|number|boolean|any|unknown|never|void|object|symbol|bigint)\\b"),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("<[A-Z]\\w*>"),
            TokenType.TYPE
        )
    )

    private val pythonRules = listOf(
        HighlightRule(
            Pattern.compile("#.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"\"\"[\\s\\S]*?\"\"\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'''[\\s\\S]*?'''"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'(?:[^'\\\\]|\\\\.)*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("@\\w+"),
            TokenType.ANNOTATION
        ),
        HighlightRule(
            Pattern.compile("\\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|break|continue|pass|lambda|async|await|global|nonlocal|assert|del|in|is|not|and|or)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(True|False|None)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b(self|cls)\\b"),
            TokenType.VARIABLE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?[jJ]?\\b"),
            TokenType.NUMBER
        ),
        HighlightRule(
            Pattern.compile("\\b(int|float|str|bool|list|dict|tuple|set|bytes|bytearray|object|type)\\b"),
            TokenType.TYPE
        )
    )

    private val swiftRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("@\\w+"),
            TokenType.ANNOTATION
        ),
        HighlightRule(
            Pattern.compile("\\b(func|class|struct|enum|protocol|extension|var|let|if|else|guard|switch|case|default|for|while|repeat|do|try|catch|throw|throws|rethrows|return|break|continue|fallthrough|import|typealias|associatedtype|init|deinit|subscript|static|override|final|private|fileprivate|internal|public|open|mutating|nonmutating|lazy|weak|unowned|inout|some|any|async|await|actor)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|nil|self|Self|super)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b(Int|Float|Double|Bool|String|Character|Array|Dictionary|Set|Optional|Any|AnyObject|Void)\\b"),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?\\b"),
            TokenType.NUMBER
        )
    )

    private val goRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("`[^`]*`"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b(package|import|func|type|struct|interface|map|chan|const|var|if|else|switch|case|default|for|range|select|go|defer|return|break|continue|fallthrough|goto)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|nil|iota)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|complex64|complex128|bool|string|byte|rune|error|any)\\b"),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?\\b"),
            TokenType.NUMBER
        )
    )

    private val rustRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("#\\[.*?\\]"),
            TokenType.ANNOTATION
        ),
        HighlightRule(
            Pattern.compile("\\b(fn|let|mut|const|static|struct|enum|trait|impl|mod|pub|crate|use|as|self|Self|super|where|if|else|match|for|while|loop|break|continue|return|async|await|move|ref|type|dyn|unsafe|extern)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|None|Some|Ok|Err)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\b(i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Option|Result|Box)\\b"),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?(_[iu]\\d+)?\\b"),
            TokenType.NUMBER
        )
    )

    private val htmlRules = listOf(
        HighlightRule(
            Pattern.compile("<!--[\\s\\S]*?-->"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("</?\\w+"),
            TokenType.TAG
        ),
        HighlightRule(
            Pattern.compile("\\s(\\w+)="),
            TokenType.ATTRIBUTE
        ),
        HighlightRule(
            Pattern.compile("\"[^\"]*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'[^']*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("/>|>"),
            TokenType.TAG
        )
    )

    private val cssRules = listOf(
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\\.\\w+"),
            TokenType.FUNCTION
        ),
        HighlightRule(
            Pattern.compile("#\\w+"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("@\\w+"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\"[^\"]*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'[^']*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?(px|em|rem|%|vh|vw|pt|cm|mm|in)?\\b"),
            TokenType.NUMBER
        ),
        HighlightRule(
            Pattern.compile("[\\w-]+(?=:)"),
            TokenType.ATTRIBUTE
        )
    )

    private val xmlRules = htmlRules

    private val jsonRules = listOf(
        HighlightRule(
            Pattern.compile("\"[^\"]*\"\\s*:"),
            TokenType.ATTRIBUTE
        ),
        HighlightRule(
            Pattern.compile(":\\s*\"[^\"]*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|null)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("-?\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?\\b"),
            TokenType.NUMBER
        )
    )

    private val yamlRules = listOf(
        HighlightRule(
            Pattern.compile("#.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("^\\w[\\w-]*(?=:)", Pattern.MULTILINE),
            TokenType.ATTRIBUTE
        ),
        HighlightRule(
            Pattern.compile("\"[^\"]*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'[^']*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b(true|false|null|~)\\b"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("-?\\b\\d+(\\.\\d+)?([eE][+-]?\\d+)?\\b"),
            TokenType.NUMBER
        ),
        HighlightRule(
            Pattern.compile("---"),
            TokenType.OPERATOR
        )
    )

    private val markdownRules = listOf(
        HighlightRule(
            Pattern.compile("^#{1,6}\\s.*$", Pattern.MULTILINE),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\*\\*[^*]+\\*\\*"),
            TokenType.CONSTANT
        ),
        HighlightRule(
            Pattern.compile("\\*[^*]+\\*"),
            TokenType.VARIABLE
        ),
        HighlightRule(
            Pattern.compile("`[^`]+`"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("```[\\s\\S]*?```"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\[([^\\]]+)\\]\\(([^)]+)\\)"),
            TokenType.FUNCTION
        ),
        HighlightRule(
            Pattern.compile("^\\s*[-*+]\\s", Pattern.MULTILINE),
            TokenType.OPERATOR
        ),
        HighlightRule(
            Pattern.compile("^\\s*\\d+\\.\\s", Pattern.MULTILINE),
            TokenType.NUMBER
        )
    )

    private val sqlRules = listOf(
        HighlightRule(
            Pattern.compile("--.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("/\\*[\\s\\S]*?\\*/"),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("'(?:[^'\\\\]|\\\\.)*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|BETWEEN|IS|NULL|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|ADD|COLUMN|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|DEFAULT|CONSTRAINT|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END)\\b", Pattern.CASE_INSENSITIVE),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(INT|INTEGER|BIGINT|SMALLINT|TINYINT|FLOAT|DOUBLE|DECIMAL|NUMERIC|CHAR|VARCHAR|TEXT|BLOB|DATE|TIME|DATETIME|TIMESTAMP|BOOLEAN|BOOL)\\b", Pattern.CASE_INSENSITIVE),
            TokenType.TYPE
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?\\b"),
            TokenType.NUMBER
        )
    )

    private val bashRules = listOf(
        HighlightRule(
            Pattern.compile("#.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'[^']*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\$\\{?\\w+\\}?"),
            TokenType.VARIABLE
        ),
        HighlightRule(
            Pattern.compile("\\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|break|continue|local|export|readonly|declare|typeset|source|alias|unalias)\\b"),
            TokenType.KEYWORD
        ),
        HighlightRule(
            Pattern.compile("\\b(echo|printf|read|cd|pwd|ls|cat|grep|sed|awk|find|xargs|sort|uniq|wc|head|tail|cut|tr|test|true|false)\\b"),
            TokenType.FUNCTION
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+\\b"),
            TokenType.NUMBER
        )
    )

    private val genericRules = listOf(
        HighlightRule(
            Pattern.compile("//.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("#.*$", Pattern.MULTILINE),
            TokenType.COMMENT
        ),
        HighlightRule(
            Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\""),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("'(?:[^'\\\\]|\\\\.)*'"),
            TokenType.STRING
        ),
        HighlightRule(
            Pattern.compile("\\b\\d+(\\.\\d+)?\\b"),
            TokenType.NUMBER
        )
    )
}

/**
 * Highlight rule
 */
data class HighlightRule(
    val pattern: Pattern,
    val tokenType: TokenType
)

/**
 * Token types for syntax highlighting
 */
enum class TokenType {
    KEYWORD,
    TYPE,
    STRING,
    NUMBER,
    COMMENT,
    OPERATOR,
    FUNCTION,
    VARIABLE,
    ANNOTATION,
    TAG,
    ATTRIBUTE,
    CONSTANT,
    REGEX
}
