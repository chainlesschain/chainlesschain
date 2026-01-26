package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Enhanced code editor with folding support
 *
 * Features:
 * - Syntax highlighting
 * - Line numbers
 * - Code folding (collapse/expand regions)
 * - Autocomplete support (placeholder for future integration)
 */
@Composable
fun EnhancedCodeEditor(
    content: String,
    onContentChange: (String) -> Unit,
    language: String?,
    modifier: Modifier = Modifier,
    readOnly: Boolean = false,
    showLineNumbers: Boolean = true,
    enableCodeFolding: Boolean = true,
    syntaxColors: SyntaxColors = SyntaxColors()
) {
    val horizontalScrollState = rememberScrollState()
    val verticalScrollState = rememberScrollState()

    val lines = content.split("\n")
    val foldingManager = remember(language) { CodeFoldingManager(language) }
    val foldableRegions = remember(content, language) {
        if (enableCodeFolding) foldingManager.detectFoldableRegions(content) else emptyList()
    }

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
            // Line numbers and folding icons
            if (showLineNumbers) {
                Column(
                    modifier = Modifier
                        .background(Color(0xFF252526))
                        .padding(horizontal = 8.dp, vertical = 8.dp)
                ) {
                    lines.forEachIndexed { index, _ ->
                        if (!foldingManager.isLineFolded(index)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                // Folding icon
                                if (enableCodeFolding) {
                                    val region = foldableRegions.find { it.startLine == index }
                                    if (region != null) {
                                        Icon(
                                            imageVector = if (foldingManager.isRegionFolded(region))
                                                Icons.Default.KeyboardArrowRight
                                            else
                                                Icons.Default.KeyboardArrowDown,
                                            contentDescription = "Toggle fold",
                                            modifier = Modifier
                                                .size(16.dp)
                                                .clickable {
                                                    foldingManager.toggleFold(region)
                                                },
                                            tint = Color(0xFF858585)
                                        )
                                    } else {
                                        Spacer(modifier = Modifier.width(16.dp))
                                    }
                                }

                                // Line number
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

                            // If this line starts a folded region, show "..." indicator
                            if (enableCodeFolding) {
                                val foldedRegion = foldableRegions.find {
                                    it.startLine == index && foldingManager.isRegionFolded(it)
                                }
                                if (foldedRegion != null) {
                                    Text(
                                        text = "  ...",
                                        style = TextStyle(
                                            fontFamily = FontFamily.Monospace,
                                            fontSize = 14.sp,
                                            color = Color(0xFF858585)
                                        ),
                                        modifier = Modifier.padding(start = 16.dp)
                                    )
                                }
                            }
                        }
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
                    // Read-only view with folding
                    Column {
                        lines.forEachIndexed { index, line ->
                            if (!foldingManager.isLineFolded(index)) {
                                Text(
                                    text = line,
                                    style = TextStyle(
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 14.sp,
                                        lineHeight = 20.sp,
                                        color = syntaxColors.default
                                    )
                                )

                                // Show ellipsis for folded regions
                                if (enableCodeFolding) {
                                    val foldedRegion = foldableRegions.find {
                                        it.startLine == index && foldingManager.isRegionFolded(it)
                                    }
                                    if (foldedRegion != null) {
                                        Text(
                                            text = "  ... (${foldedRegion.endLine - foldedRegion.startLine} lines hidden)",
                                            style = TextStyle(
                                                fontFamily = FontFamily.Monospace,
                                                fontSize = 14.sp,
                                                color = Color(0xFF858585)
                                            )
                                        )
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // Editable view
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
 * Code folding controls composable
 *
 * Provides buttons to fold/unfold all regions
 */
@Composable
fun CodeFoldingControls(
    foldingManager: CodeFoldingManager,
    foldableRegions: List<FoldableRegion>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "Fold All",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable {
                    foldingManager.foldAll(foldableRegions)
                    onRefresh()
                }
                .padding(8.dp)
        )

        Spacer(modifier = Modifier.width(16.dp))

        Text(
            text = "Unfold All",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable {
                    foldingManager.unfoldAll()
                    onRefresh()
                }
                .padding(8.dp)
        )
    }
}
