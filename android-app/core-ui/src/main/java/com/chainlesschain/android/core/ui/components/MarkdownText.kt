package com.chainlesschain.android.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Composable for rendering Markdown text using pure Compose
 *
 * Supports: **bold**, *italic*, `code`, [links](url), # headers, - lists, ```code blocks```
 *
 * @param markdown The markdown content to render
 * @param modifier Modifier for the composable
 * @param textColor Color for the text (default uses LocalContentColor)
 * @param linkColor Color for links
 * @param fontSize Font size for the text
 * @param style TextStyle to apply
 */
@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    textColor: Color = LocalContentColor.current,
    linkColor: Color = MaterialTheme.colorScheme.primary,
    fontSize: TextUnit = TextUnit.Unspecified,
    style: TextStyle = LocalTextStyle.current
) {
    val uriHandler = LocalUriHandler.current
    val effectiveFontSize = if (fontSize != TextUnit.Unspecified) fontSize else style.fontSize

    val annotatedString = remember(markdown, textColor, linkColor, effectiveFontSize) {
        parseMarkdown(markdown, textColor, linkColor, effectiveFontSize)
    }

    ClickableText(
        text = annotatedString,
        modifier = modifier,
        style = style.copy(color = textColor),
        onClick = { offset ->
            annotatedString.getStringAnnotations(tag = "URL", start = offset, end = offset)
                .firstOrNull()?.let { annotation ->
                    try {
                        uriHandler.openUri(annotation.item)
                    } catch (e: Exception) {
                        // Ignore invalid URLs
                    }
                }
        }
    )
}

/**
 * Simple markdown text without extra features (lighter weight)
 */
@Composable
fun SimpleMarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    textColor: Color = LocalContentColor.current
) {
    MarkdownText(
        markdown = markdown,
        modifier = modifier,
        textColor = textColor
    )
}

/**
 * Parse markdown string to AnnotatedString
 */
private fun parseMarkdown(
    markdown: String,
    textColor: Color,
    linkColor: Color,
    fontSize: TextUnit
): AnnotatedString {
    return buildAnnotatedString {
        var currentIndex = 0
        val text = markdown

        while (currentIndex < text.length) {
            when {
                // Code block ```
                text.startsWith("```", currentIndex) -> {
                    val endIndex = text.indexOf("```", currentIndex + 3)
                    if (endIndex != -1) {
                        val codeContent = text.substring(currentIndex + 3, endIndex)
                            .trimStart { it == '\n' || it.isLetter() } // Remove language identifier
                            .trimEnd()
                        withStyle(SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            background = Color.Gray.copy(alpha = 0.2f),
                            fontSize = fontSize * 0.9f
                        )) {
                            append(codeContent)
                        }
                        currentIndex = endIndex + 3
                    } else {
                        append(text[currentIndex])
                        currentIndex++
                    }
                }

                // Inline code `
                text[currentIndex] == '`' -> {
                    val endIndex = text.indexOf('`', currentIndex + 1)
                    if (endIndex != -1) {
                        withStyle(SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            background = Color.Gray.copy(alpha = 0.2f)
                        )) {
                            append(text.substring(currentIndex + 1, endIndex))
                        }
                        currentIndex = endIndex + 1
                    } else {
                        append(text[currentIndex])
                        currentIndex++
                    }
                }

                // Bold **text** or __text__
                text.startsWith("**", currentIndex) || text.startsWith("__", currentIndex) -> {
                    val delimiter = text.substring(currentIndex, currentIndex + 2)
                    val endIndex = text.indexOf(delimiter, currentIndex + 2)
                    if (endIndex != -1) {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                            append(text.substring(currentIndex + 2, endIndex))
                        }
                        currentIndex = endIndex + 2
                    } else {
                        append(text[currentIndex])
                        currentIndex++
                    }
                }

                // Italic *text* or _text_
                (text[currentIndex] == '*' || text[currentIndex] == '_') &&
                        (currentIndex == 0 || !text[currentIndex - 1].isLetterOrDigit()) -> {
                    val delimiter = text[currentIndex]
                    val endIndex = text.indexOf(delimiter, currentIndex + 1)
                    if (endIndex != -1 && endIndex > currentIndex + 1) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                            append(text.substring(currentIndex + 1, endIndex))
                        }
                        currentIndex = endIndex + 1
                    } else {
                        append(text[currentIndex])
                        currentIndex++
                    }
                }

                // Links [text](url)
                text[currentIndex] == '[' -> {
                    val closeBracket = text.indexOf(']', currentIndex)
                    if (closeBracket != -1 && closeBracket + 1 < text.length && text[closeBracket + 1] == '(') {
                        val closeParen = text.indexOf(')', closeBracket + 2)
                        if (closeParen != -1) {
                            val linkText = text.substring(currentIndex + 1, closeBracket)
                            val linkUrl = text.substring(closeBracket + 2, closeParen)
                            pushStringAnnotation(tag = "URL", annotation = linkUrl)
                            withStyle(SpanStyle(
                                color = linkColor,
                                textDecoration = TextDecoration.Underline
                            )) {
                                append(linkText)
                            }
                            pop()
                            currentIndex = closeParen + 1
                        } else {
                            append(text[currentIndex])
                            currentIndex++
                        }
                    } else {
                        append(text[currentIndex])
                        currentIndex++
                    }
                }

                // Headers # ## ###
                text[currentIndex] == '#' && (currentIndex == 0 || text[currentIndex - 1] == '\n') -> {
                    var headerLevel = 0
                    var tempIndex = currentIndex
                    while (tempIndex < text.length && text[tempIndex] == '#') {
                        headerLevel++
                        tempIndex++
                    }
                    if (tempIndex < text.length && text[tempIndex] == ' ') {
                        val lineEnd = text.indexOf('\n', tempIndex).let { if (it == -1) text.length else it }
                        val headerText = text.substring(tempIndex + 1, lineEnd)
                        val headerFontSize = when (headerLevel) {
                            1 -> fontSize * 1.6f
                            2 -> fontSize * 1.4f
                            3 -> fontSize * 1.2f
                            else -> fontSize * 1.1f
                        }
                        withStyle(SpanStyle(
                            fontWeight = FontWeight.Bold,
                            fontSize = headerFontSize
                        )) {
                            append(headerText)
                        }
                        append("\n")
                        currentIndex = if (lineEnd < text.length) lineEnd + 1 else lineEnd
                    } else {
                        append(text[currentIndex])
                        currentIndex++
                    }
                }

                // List items - or *
                (text[currentIndex] == '-' || text[currentIndex] == '*') &&
                        currentIndex + 1 < text.length && text[currentIndex + 1] == ' ' &&
                        (currentIndex == 0 || text[currentIndex - 1] == '\n') -> {
                    append("• ")
                    currentIndex += 2
                }

                // Normal character
                else -> {
                    append(text[currentIndex])
                    currentIndex++
                }
            }
        }
    }
}
