package com.chainlesschain.android.feature.project.editor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color

/**
 * Code Theme
 *
 * Defines color schemes for syntax highlighting.
 * Supports both light and dark themes with consistent styling.
 */
data class CodeTheme(
    val name: String,
    val isDark: Boolean,

    // Editor background and text
    val background: Color,
    val foreground: Color,
    val lineNumber: Color,
    val lineNumberBackground: Color,
    val selection: Color,
    val cursor: Color,
    val currentLine: Color,

    // Syntax colors
    val keyword: Color,
    val type: Color,
    val string: Color,
    val number: Color,
    val comment: Color,
    val operator: Color,
    val function: Color,
    val variable: Color,
    val annotation: Color,
    val tag: Color,
    val attribute: Color,
    val constant: Color,
    val regex: Color,

    // Special
    val error: Color,
    val warning: Color,
    val info: Color,
    val diff_added: Color,
    val diff_removed: Color,
    val diff_modified: Color
) {
    companion object {

        /**
         * VS Code Dark+ theme (default dark)
         */
        val Dark = CodeTheme(
            name = "Dark+",
            isDark = true,
            background = Color(0xFF1E1E1E),
            foreground = Color(0xFFD4D4D4),
            lineNumber = Color(0xFF858585),
            lineNumberBackground = Color(0xFF252526),
            selection = Color(0xFF264F78),
            cursor = Color(0xFFAEAFAD),
            currentLine = Color(0xFF2A2D2E),

            keyword = Color(0xFF569CD6),       // Blue
            type = Color(0xFF4EC9B0),          // Teal/Cyan
            string = Color(0xFFCE9178),        // Orange/Coral
            number = Color(0xFFB5CEA8),        // Light Green
            comment = Color(0xFF6A9955),       // Green
            operator = Color(0xFFD4D4D4),      // White
            function = Color(0xFFDCDCAA),      // Yellow
            variable = Color(0xFF9CDCFE),      // Light Blue
            annotation = Color(0xFFDCDCAA),    // Yellow
            tag = Color(0xFF569CD6),           // Blue
            attribute = Color(0xFF9CDCFE),     // Light Blue
            constant = Color(0xFF4FC1FF),      // Bright Blue
            regex = Color(0xFFD16969),         // Red

            error = Color(0xFFF44747),
            warning = Color(0xFFCCA700),
            info = Color(0xFF75BEFF),
            diff_added = Color(0xFF587C0C),
            diff_removed = Color(0xFF94151B),
            diff_modified = Color(0xFF0C7D9D)
        )

        /**
         * VS Code Light+ theme (default light)
         */
        val Light = CodeTheme(
            name = "Light+",
            isDark = false,
            background = Color(0xFFFFFFFF),
            foreground = Color(0xFF000000),
            lineNumber = Color(0xFF237893),
            lineNumberBackground = Color(0xFFF3F3F3),
            selection = Color(0xFFADD6FF),
            cursor = Color(0xFF000000),
            currentLine = Color(0xFFFFFB00).copy(alpha = 0.1f),

            keyword = Color(0xFF0000FF),       // Blue
            type = Color(0xFF267F99),          // Teal
            string = Color(0xFFA31515),        // Red
            number = Color(0xFF098658),        // Green
            comment = Color(0xFF008000),       // Green
            operator = Color(0xFF000000),      // Black
            function = Color(0xFF795E26),      // Brown
            variable = Color(0xFF001080),      // Dark Blue
            annotation = Color(0xFF795E26),    // Brown
            tag = Color(0xFF800000),           // Maroon
            attribute = Color(0xFFFF0000),     // Red
            constant = Color(0xFF0070C1),      // Blue
            regex = Color(0xFF811F3F),         // Dark Red

            error = Color(0xFFE51400),
            warning = Color(0xFFBF8803),
            info = Color(0xFF1A85FF),
            diff_added = Color(0xFF81B88B),
            diff_removed = Color(0xFFCA4B51),
            diff_modified = Color(0xFF66AFE0)
        )

        /**
         * Monokai theme
         */
        val Monokai = CodeTheme(
            name = "Monokai",
            isDark = true,
            background = Color(0xFF272822),
            foreground = Color(0xFFF8F8F2),
            lineNumber = Color(0xFF90908A),
            lineNumberBackground = Color(0xFF272822),
            selection = Color(0xFF49483E),
            cursor = Color(0xFFF8F8F0),
            currentLine = Color(0xFF3E3D32),

            keyword = Color(0xFFF92672),       // Pink
            type = Color(0xFF66D9EF),          // Cyan
            string = Color(0xFFE6DB74),        // Yellow
            number = Color(0xFFAE81FF),        // Purple
            comment = Color(0xFF75715E),       // Gray
            operator = Color(0xFFF92672),      // Pink
            function = Color(0xFFA6E22E),      // Green
            variable = Color(0xFFF8F8F2),      // White
            annotation = Color(0xFFA6E22E),    // Green
            tag = Color(0xFFF92672),           // Pink
            attribute = Color(0xFFA6E22E),     // Green
            constant = Color(0xFFAE81FF),      // Purple
            regex = Color(0xFFE6DB74),         // Yellow

            error = Color(0xFFF92672),
            warning = Color(0xFFE6DB74),
            info = Color(0xFF66D9EF),
            diff_added = Color(0xFFA6E22E),
            diff_removed = Color(0xFFF92672),
            diff_modified = Color(0xFF66D9EF)
        )

        /**
         * Dracula theme
         */
        val Dracula = CodeTheme(
            name = "Dracula",
            isDark = true,
            background = Color(0xFF282A36),
            foreground = Color(0xFFF8F8F2),
            lineNumber = Color(0xFF6272A4),
            lineNumberBackground = Color(0xFF282A36),
            selection = Color(0xFF44475A),
            cursor = Color(0xFFF8F8F2),
            currentLine = Color(0xFF44475A),

            keyword = Color(0xFFFF79C6),       // Pink
            type = Color(0xFF8BE9FD),          // Cyan
            string = Color(0xFFF1FA8C),        // Yellow
            number = Color(0xFFBD93F9),        // Purple
            comment = Color(0xFF6272A4),       // Gray/Blue
            operator = Color(0xFFFF79C6),      // Pink
            function = Color(0xFF50FA7B),      // Green
            variable = Color(0xFFF8F8F2),      // White
            annotation = Color(0xFF50FA7B),    // Green
            tag = Color(0xFFFF79C6),           // Pink
            attribute = Color(0xFF50FA7B),     // Green
            constant = Color(0xFFBD93F9),      // Purple
            regex = Color(0xFFFFB86C),         // Orange

            error = Color(0xFFFF5555),
            warning = Color(0xFFFFB86C),
            info = Color(0xFF8BE9FD),
            diff_added = Color(0xFF50FA7B),
            diff_removed = Color(0xFFFF5555),
            diff_modified = Color(0xFF8BE9FD)
        )

        /**
         * GitHub Light theme
         */
        val GitHubLight = CodeTheme(
            name = "GitHub Light",
            isDark = false,
            background = Color(0xFFFFFFFF),
            foreground = Color(0xFF24292E),
            lineNumber = Color(0xFF1B1F234D),
            lineNumberBackground = Color(0xFFFAFBFC),
            selection = Color(0xFFC8C8FA),
            cursor = Color(0xFF24292E),
            currentLine = Color(0xFFFFFBDD),

            keyword = Color(0xFFD73A49),       // Red
            type = Color(0xFF6F42C1),          // Purple
            string = Color(0xFF032F62),        // Dark Blue
            number = Color(0xFF005CC5),        // Blue
            comment = Color(0xFF6A737D),       // Gray
            operator = Color(0xFFD73A49),      // Red
            function = Color(0xFF6F42C1),      // Purple
            variable = Color(0xFFE36209),      // Orange
            annotation = Color(0xFF6F42C1),    // Purple
            tag = Color(0xFF22863A),           // Green
            attribute = Color(0xFF6F42C1),     // Purple
            constant = Color(0xFF005CC5),      // Blue
            regex = Color(0xFF032F62),         // Dark Blue

            error = Color(0xFFCB2431),
            warning = Color(0xFFB08800),
            info = Color(0xFF0366D6),
            diff_added = Color(0xFFE6FFED),
            diff_removed = Color(0xFFFFDCE0),
            diff_modified = Color(0xFFDBEDFF)
        )

        /**
         * GitHub Dark theme
         */
        val GitHubDark = CodeTheme(
            name = "GitHub Dark",
            isDark = true,
            background = Color(0xFF0D1117),
            foreground = Color(0xFFC9D1D9),
            lineNumber = Color(0xFF484F58),
            lineNumberBackground = Color(0xFF0D1117),
            selection = Color(0xFF388BFD26),
            cursor = Color(0xFFC9D1D9),
            currentLine = Color(0xFF161B22),

            keyword = Color(0xFFFF7B72),       // Coral
            type = Color(0xFFD2A8FF),          // Light Purple
            string = Color(0xFFA5D6FF),        // Light Blue
            number = Color(0xFF79C0FF),        // Blue
            comment = Color(0xFF8B949E),       // Gray
            operator = Color(0xFFFF7B72),      // Coral
            function = Color(0xFFD2A8FF),      // Light Purple
            variable = Color(0xFFFFA657),      // Orange
            annotation = Color(0xFFD2A8FF),    // Light Purple
            tag = Color(0xFF7EE787),           // Green
            attribute = Color(0xFFD2A8FF),     // Light Purple
            constant = Color(0xFF79C0FF),      // Blue
            regex = Color(0xFFA5D6FF),         // Light Blue

            error = Color(0xFFF85149),
            warning = Color(0xFFD29922),
            info = Color(0xFF58A6FF),
            diff_added = Color(0xFF238636),
            diff_removed = Color(0xFFDA3633),
            diff_modified = Color(0xFF1F6FEB)
        )

        /**
         * One Dark Pro theme
         */
        val OneDark = CodeTheme(
            name = "One Dark Pro",
            isDark = true,
            background = Color(0xFF282C34),
            foreground = Color(0xFFABB2BF),
            lineNumber = Color(0xFF495162),
            lineNumberBackground = Color(0xFF282C34),
            selection = Color(0xFF3E4451),
            cursor = Color(0xFF528BFF),
            currentLine = Color(0xFF2C313C),

            keyword = Color(0xFFC678DD),       // Purple
            type = Color(0xFFE5C07B),          // Yellow
            string = Color(0xFF98C379),        // Green
            number = Color(0xFFD19A66),        // Orange
            comment = Color(0xFF5C6370),       // Gray
            operator = Color(0xFF56B6C2),      // Cyan
            function = Color(0xFF61AFEF),      // Blue
            variable = Color(0xFFE06C75),      // Red
            annotation = Color(0xFFE5C07B),    // Yellow
            tag = Color(0xFFE06C75),           // Red
            attribute = Color(0xFFD19A66),     // Orange
            constant = Color(0xFFD19A66),      // Orange
            regex = Color(0xFF56B6C2),         // Cyan

            error = Color(0xFFE06C75),
            warning = Color(0xFFE5C07B),
            info = Color(0xFF61AFEF),
            diff_added = Color(0xFF98C379),
            diff_removed = Color(0xFFE06C75),
            diff_modified = Color(0xFF61AFEF)
        )

        /**
         * Nord theme
         */
        val Nord = CodeTheme(
            name = "Nord",
            isDark = true,
            background = Color(0xFF2E3440),
            foreground = Color(0xFFD8DEE9),
            lineNumber = Color(0xFF4C566A),
            lineNumberBackground = Color(0xFF2E3440),
            selection = Color(0xFF434C5E),
            cursor = Color(0xFFD8DEE9),
            currentLine = Color(0xFF3B4252),

            keyword = Color(0xFF81A1C1),       // Blue
            type = Color(0xFF8FBCBB),          // Teal
            string = Color(0xFFA3BE8C),        // Green
            number = Color(0xFFB48EAD),        // Purple
            comment = Color(0xFF616E88),       // Gray
            operator = Color(0xFF81A1C1),      // Blue
            function = Color(0xFF88C0D0),      // Cyan
            variable = Color(0xFFD8DEE9),      // White
            annotation = Color(0xFFD08770),    // Orange
            tag = Color(0xFF81A1C1),           // Blue
            attribute = Color(0xFF8FBCBB),     // Teal
            constant = Color(0xFFB48EAD),      // Purple
            regex = Color(0xFFEBCB8B),         // Yellow

            error = Color(0xFFBF616A),
            warning = Color(0xFFEBCB8B),
            info = Color(0xFF5E81AC),
            diff_added = Color(0xFFA3BE8C),
            diff_removed = Color(0xFFBF616A),
            diff_modified = Color(0xFF5E81AC)
        )

        /**
         * All available themes
         */
        val allThemes = listOf(
            Dark, Light, Monokai, Dracula,
            GitHubLight, GitHubDark, OneDark, Nord
        )

        /**
         * Get theme by name
         */
        fun getByName(name: String): CodeTheme {
            return allThemes.find { it.name.equals(name, ignoreCase = true) } ?: Dark
        }

        /**
         * Get default theme based on system dark mode
         */
        @Composable
        @ReadOnlyComposable
        fun default(isDarkTheme: Boolean): CodeTheme {
            return if (isDarkTheme) Dark else Light
        }
    }
}

/**
 * Editor settings
 */
data class EditorSettings(
    val theme: CodeTheme = CodeTheme.Dark,
    val fontSize: Int = 14,
    val lineHeight: Float = 1.4f,
    val tabSize: Int = 4,
    val useSpaces: Boolean = true,
    val showLineNumbers: Boolean = true,
    val showWhitespace: Boolean = false,
    val wordWrap: Boolean = false,
    val highlightCurrentLine: Boolean = true,
    val showIndentGuides: Boolean = true,
    val autoCloseBrackets: Boolean = true,
    val autoIndent: Boolean = true,
    val fontFamily: String = "monospace"
)
