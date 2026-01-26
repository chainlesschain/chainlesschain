package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Class
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.Functions
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Segment
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup

/**
 * Autocomplete suggestion type
 */
enum class SuggestionType(val icon: ImageVector, val color: Color) {
    KEYWORD(Icons.Default.Key, Color(0xFF569CD6)),
    FUNCTION(Icons.Default.Functions, Color(0xFFDCDCAA)),
    CLASS(Icons.Default.Class, Color(0xFF4EC9B0)),
    VARIABLE(Icons.Default.Segment, Color(0xFF9CDCFE)),
    PROPERTY(Icons.Default.Extension, Color(0xFF9CDCFE)),
    SNIPPET(Icons.Default.Code, Color(0xFFCE9178))
}

/**
 * Autocomplete suggestion
 */
data class AutocompleteSuggestion(
    val text: String,
    val type: SuggestionType,
    val description: String? = null,
    val insertText: String? = null // If different from display text
)

/**
 * Autocomplete manager for code editor
 *
 * Provides context-aware autocomplete suggestions based on:
 * - Language keywords
 * - Function/method names
 * - Variable names
 * - Type names
 * - Code snippets
 */
class AutocompleteManager(
    private val language: String?
) {
    private val keywordSuggestions: List<AutocompleteSuggestion>
    private val snippetSuggestions: List<AutocompleteSuggestion>

    init {
        keywordSuggestions = getKeywordsForLanguage(language)
        snippetSuggestions = getSnippetsForLanguage(language)
    }

    /**
     * Get suggestions based on current context
     */
    fun getSuggestions(
        content: String,
        cursorPosition: Int
    ): List<AutocompleteSuggestion> {
        // Extract word before cursor
        val wordStart = findWordStart(content, cursorPosition)
        val prefix = content.substring(wordStart, cursorPosition)

        if (prefix.isBlank()) return emptyList()

        // Combine all suggestion sources
        val allSuggestions = buildList {
            addAll(keywordSuggestions)
            addAll(snippetSuggestions)
            addAll(extractIdentifiers(content))
        }

        // Filter by prefix (case-insensitive)
        return allSuggestions
            .filter { it.text.startsWith(prefix, ignoreCase = true) }
            .distinctBy { it.text }
            .sortedWith(
                compareByDescending<AutocompleteSuggestion> {
                    // Exact match (case-insensitive)
                    it.text.equals(prefix, ignoreCase = true)
                }.thenByDescending {
                    // Starts with exact case
                    it.text.startsWith(prefix)
                }.thenBy {
                    // Alphabetical
                    it.text
                }
            )
            .take(10) // Limit to 10 suggestions
    }

    /**
     * Find the start of the current word
     */
    private fun findWordStart(content: String, cursorPosition: Int): Int {
        var pos = cursorPosition - 1
        while (pos >= 0 && (content[pos].isLetterOrDigit() || content[pos] == '_')) {
            pos--
        }
        return pos + 1
    }

    /**
     * Extract identifiers from content for suggestions
     */
    private fun extractIdentifiers(content: String): List<AutocompleteSuggestion> {
        val identifierPattern = Regex("[a-zA-Z_][a-zA-Z0-9_]*")
        return identifierPattern.findAll(content)
            .map { it.value }
            .distinct()
            .filter { it.length > 2 } // Minimum 3 characters
            .map { AutocompleteSuggestion(it, SuggestionType.VARIABLE) }
            .toList()
    }

    /**
     * Get keywords for specific language
     */
    private fun getKeywordsForLanguage(language: String?): List<AutocompleteSuggestion> {
        return when (language?.lowercase()) {
            "kt", "kotlin" -> kotlinKeywords + kotlinTypes
            "java" -> javaKeywords + javaTypes
            "py", "python" -> pythonKeywords
            "js", "javascript", "ts", "typescript" -> jsKeywords + jsTypes
            "swift" -> swiftKeywords + swiftTypes
            else -> emptyList()
        }
    }

    /**
     * Get code snippets for specific language
     */
    private fun getSnippetsForLanguage(language: String?): List<AutocompleteSuggestion> {
        return when (language?.lowercase()) {
            "kt", "kotlin" -> kotlinSnippets
            "java" -> javaSnippets
            "py", "python" -> pythonSnippets
            "js", "javascript", "ts", "typescript" -> jsSnippets
            else -> emptyList()
        }
    }

    companion object {
        // Kotlin keywords and types
        private val kotlinKeywords = listOf(
            "fun", "val", "var", "class", "object", "interface", "enum", "sealed",
            "if", "else", "when", "for", "while", "do", "return", "break", "continue",
            "package", "import", "private", "public", "protected", "internal",
            "override", "open", "final", "abstract", "companion", "data", "suspend",
            "inline", "crossinline", "noinline", "reified", "by", "lazy"
        ).map { AutocompleteSuggestion(it, SuggestionType.KEYWORD, "Kotlin keyword") }

        private val kotlinTypes = listOf(
            "Int", "Long", "Float", "Double", "Boolean", "String", "Char", "Byte",
            "Unit", "Nothing", "Any", "List", "Map", "Set", "Array", "Flow", "StateFlow"
        ).map { AutocompleteSuggestion(it, SuggestionType.CLASS, "Kotlin type") }

        private val kotlinSnippets = listOf(
            AutocompleteSuggestion("func", SuggestionType.SNIPPET, "Function",
                "fun \${1:name}(\${2:params}): \${3:Unit} {\n    \${0}\n}"),
            AutocompleteSuggestion("class", SuggestionType.SNIPPET, "Class",
                "class \${1:Name} {\n    \${0}\n}"),
            AutocompleteSuggestion("dataclass", SuggestionType.SNIPPET, "Data class",
                "data class \${1:Name}(\n    \${2:val property: Type}\n)"),
            AutocompleteSuggestion("when", SuggestionType.SNIPPET, "When expression",
                "when (\${1:value}) {\n    \${2:condition} -> \${3:result}\n    else -> \${0}\n}"),
            AutocompleteSuggestion("foreach", SuggestionType.SNIPPET, "For each loop",
                "for (\${1:item} in \${2:collection}) {\n    \${0}\n}")
        )

        // Java keywords and types
        private val javaKeywords = listOf(
            "public", "private", "protected", "static", "final", "abstract",
            "class", "interface", "extends", "implements", "enum", "void",
            "if", "else", "switch", "case", "for", "while", "do", "return",
            "new", "this", "super", "import", "package"
        ).map { AutocompleteSuggestion(it, SuggestionType.KEYWORD, "Java keyword") }

        private val javaTypes = listOf(
            "int", "long", "float", "double", "boolean", "char", "byte",
            "String", "Integer", "Long", "Double", "Boolean",
            "List", "Map", "Set", "ArrayList", "HashMap"
        ).map { AutocompleteSuggestion(it, SuggestionType.CLASS, "Java type") }

        private val javaSnippets = listOf(
            AutocompleteSuggestion("method", SuggestionType.SNIPPET, "Method",
                "public \${1:void} \${2:name}(\${3:params}) {\n    \${0}\n}"),
            AutocompleteSuggestion("class", SuggestionType.SNIPPET, "Class",
                "public class \${1:Name} {\n    \${0}\n}"),
            AutocompleteSuggestion("foreach", SuggestionType.SNIPPET, "For each",
                "for (\${1:Type} \${2:item} : \${3:collection}) {\n    \${0}\n}")
        )

        // Python keywords
        private val pythonKeywords = listOf(
            "def", "class", "if", "elif", "else", "for", "while", "try",
            "except", "finally", "with", "import", "from", "return", "yield",
            "lambda", "async", "await", "True", "False", "None"
        ).map { AutocompleteSuggestion(it, SuggestionType.KEYWORD, "Python keyword") }

        private val pythonSnippets = listOf(
            AutocompleteSuggestion("def", SuggestionType.SNIPPET, "Function",
                "def \${1:name}(\${2:params}):\n    \${0}"),
            AutocompleteSuggestion("class", SuggestionType.SNIPPET, "Class",
                "class \${1:Name}:\n    def __init__(self\${2:, params}):\n        \${0}"),
            AutocompleteSuggestion("ifmain", SuggestionType.SNIPPET, "Main guard",
                "if __name__ == \"__main__\":\n    \${0}")
        )

        // JavaScript/TypeScript keywords and types
        private val jsKeywords = listOf(
            "function", "const", "let", "var", "if", "else", "for", "while",
            "switch", "case", "return", "class", "extends", "import", "export",
            "async", "await", "try", "catch", "interface", "type"
        ).map { AutocompleteSuggestion(it, SuggestionType.KEYWORD, "JS/TS keyword") }

        private val jsTypes = listOf(
            "string", "number", "boolean", "object", "any", "void",
            "Array", "Promise", "Map", "Set", "Date"
        ).map { AutocompleteSuggestion(it, SuggestionType.CLASS, "JS/TS type") }

        private val jsSnippets = listOf(
            AutocompleteSuggestion("func", SuggestionType.SNIPPET, "Function",
                "function \${1:name}(\${2:params}) {\n    \${0}\n}"),
            AutocompleteSuggestion("arrow", SuggestionType.SNIPPET, "Arrow function",
                "const \${1:name} = (\${2:params}) => {\n    \${0}\n}"),
            AutocompleteSuggestion("class", SuggestionType.SNIPPET, "Class",
                "class \${1:Name} {\n    constructor(\${2:params}) {\n        \${0}\n    }\n}")
        )

        // Swift keywords and types
        private val swiftKeywords = listOf(
            "func", "let", "var", "class", "struct", "enum", "protocol",
            "if", "else", "switch", "case", "for", "while", "return",
            "import", "private", "public", "override", "async", "await"
        ).map { AutocompleteSuggestion(it, SuggestionType.KEYWORD, "Swift keyword") }

        private val swiftTypes = listOf(
            "Int", "Float", "Double", "Bool", "String", "Character",
            "Array", "Dictionary", "Set", "Optional"
        ).map { AutocompleteSuggestion(it, SuggestionType.CLASS, "Swift type") }
    }
}

/**
 * Autocomplete popup component
 */
@Composable
fun AutocompletePopup(
    suggestions: List<AutocompleteSuggestion>,
    selectedIndex: Int,
    onSuggestionClick: (AutocompleteSuggestion) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (suggestions.isEmpty()) return

    Popup(
        onDismissRequest = onDismiss
    ) {
        Surface(
            modifier = modifier,
            shape = RoundedCornerShape(8.dp),
            shadowElevation = 8.dp,
            color = Color(0xFF252526) // VS Code dark theme
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(4.dp)
            ) {
                itemsIndexed(suggestions) { index, suggestion ->
                    AutocompleteSuggestionItem(
                        suggestion = suggestion,
                        isSelected = index == selectedIndex,
                        onClick = { onSuggestionClick(suggestion) }
                    )
                }
            }
        }
    }
}

/**
 * Single autocomplete suggestion item
 */
@Composable
private fun AutocompleteSuggestionItem(
    suggestion: AutocompleteSuggestion,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(
                if (isSelected) Color(0xFF094771) else Color.Transparent,
                shape = RoundedCornerShape(4.dp)
            )
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            imageVector = suggestion.type.icon,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = suggestion.type.color
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = suggestion.text,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp
                ),
                color = Color(0xFFD4D4D4)
            )
            suggestion.description?.let { desc ->
                Text(
                    text = desc,
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 11.sp
                    ),
                    color = Color(0xFF858585)
                )
            }
        }

        // Type badge
        Text(
            text = when (suggestion.type) {
                SuggestionType.KEYWORD -> "keyword"
                SuggestionType.FUNCTION -> "function"
                SuggestionType.CLASS -> "class"
                SuggestionType.VARIABLE -> "variable"
                SuggestionType.PROPERTY -> "property"
                SuggestionType.SNIPPET -> "snippet"
            },
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium
            ),
            color = suggestion.type.color.copy(alpha = 0.8f),
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
        )
    }
}
