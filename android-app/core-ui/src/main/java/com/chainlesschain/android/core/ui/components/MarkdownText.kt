package com.chainlesschain.android.core.ui.components

import android.widget.TextView
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin

/**
 * Composable for rendering Markdown text using Markwon
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
    linkColor: Color = Color(0xFF2196F3),
    fontSize: TextUnit = TextUnit.Unspecified,
    style: TextStyle = LocalTextStyle.current
) {
    val context = LocalContext.current

    // Create and remember Markwon instance
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(LinkifyPlugin.create())
            .build()
    }

    // Convert style values to Android units
    val textColorArgb = textColor.toArgb()
    val linkColorArgb = linkColor.toArgb()
    val textSizeFloat = if (fontSize != TextUnit.Unspecified) {
        fontSize.value
    } else {
        style.fontSize.value.takeIf { it > 0 } ?: 16f
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                setTextColor(textColorArgb)
                setLinkTextColor(linkColorArgb)
                textSize = textSizeFloat
                // Enable text selection
                setTextIsSelectable(true)
            }
        },
        update = { textView ->
            textView.setTextColor(textColorArgb)
            textView.setLinkTextColor(linkColorArgb)
            textView.textSize = textSizeFloat
            // Render markdown
            markwon.setMarkdown(textView, markdown)
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
    val context = LocalContext.current

    val markwon = remember(context) {
        Markwon.create(context)
    }

    val textColorArgb = textColor.toArgb()

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                setTextColor(textColorArgb)
                setTextIsSelectable(true)
            }
        },
        update = { textView ->
            textView.setTextColor(textColorArgb)
            markwon.setMarkdown(textView, markdown)
        }
    )
}
