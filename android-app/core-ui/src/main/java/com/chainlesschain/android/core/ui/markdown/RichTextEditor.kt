package com.chainlesschain.android.core.ui.markdown

import android.text.Editable
import android.text.Spanned
import android.text.TextWatcher
import android.widget.EditText
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon
import io.noties.markwon.editor.MarkwonEditor
import io.noties.markwon.editor.MarkwonEditorTextWatcher
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin
import io.noties.markwon.syntax.Prism4jThemeDefault
import io.noties.markwon.syntax.SyntaxHighlightPlugin
import io.noties.prism4j.Prism4j
import java.util.concurrent.Executors

/**
 * 富文本Markdown编辑器
 *
 * 功能：
 * - Markdown语法高亮
 * - 实时预览
 * - 格式化工具栏（粗体、斜体、标题等）
 * - 三种编辑模式（编辑/预览/分屏）
 *
 * @param value 当前文本内容
 * @param onValueChange 文本变化回调
 * @param modifier Modifier
 * @param placeholder 占位符文本
 * @param initialMode 初始编辑模式
 *
 * @since v0.31.0
 */
@Composable
fun RichTextEditor(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "输入Markdown文本...",
    initialMode: EditorMode = EditorMode.EDIT
) {
    var editorMode by remember { mutableStateOf(initialMode) }
    var textValue by remember(value) { mutableStateOf(value) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // 工具栏
        MarkdownToolbar(
            currentMode = editorMode,
            onModeChange = { editorMode = it },
            onFormatClick = { format ->
                val result = insertMarkdown(textValue, format)
                textValue = result
                onValueChange(result)
            }
        )

        Divider()

        // 编辑器内容区域
        when (editorMode) {
            EditorMode.EDIT -> {
                MarkdownTextField(
                    value = textValue,
                    onValueChange = {
                        textValue = it
                        onValueChange(it)
                    },
                    placeholder = placeholder,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                )
            }
            EditorMode.PREVIEW -> {
                MarkdownPreview(
                    markdown = textValue,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                )
            }
            EditorMode.SPLIT -> {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    // 左侧编辑
                    MarkdownTextField(
                        value = textValue,
                        onValueChange = {
                            textValue = it
                            onValueChange(it)
                        },
                        placeholder = placeholder,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    )

                    VerticalDivider()

                    // 右侧预览
                    MarkdownPreview(
                        markdown = textValue,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    )
                }
            }
        }
    }
}

/**
 * Markdown工具栏
 */
@Composable
private fun MarkdownToolbar(
    currentMode: EditorMode,
    onModeChange: (EditorMode) -> Unit,
    onFormatClick: (MarkdownFormat) -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 格式化按钮
            ToolbarButton(
                icon = Icons.Default.FormatBold,
                tooltip = "粗体",
                onClick = { onFormatClick(MarkdownFormat.BOLD) }
            )

            ToolbarButton(
                icon = Icons.Default.FormatItalic,
                tooltip = "斜体",
                onClick = { onFormatClick(MarkdownFormat.ITALIC) }
            )

            ToolbarButton(
                icon = Icons.Default.FormatStrikethrough,
                tooltip = "删除线",
                onClick = { onFormatClick(MarkdownFormat.STRIKETHROUGH) }
            )

            ToolbarButton(
                icon = Icons.Default.Title,
                tooltip = "标题",
                onClick = { onFormatClick(MarkdownFormat.HEADING) }
            )

            VerticalDivider(modifier = Modifier.height(24.dp))

            ToolbarButton(
                icon = Icons.Default.FormatListBulleted,
                tooltip = "无序列表",
                onClick = { onFormatClick(MarkdownFormat.UNORDERED_LIST) }
            )

            ToolbarButton(
                icon = Icons.Default.FormatListNumbered,
                tooltip = "有序列表",
                onClick = { onFormatClick(MarkdownFormat.ORDERED_LIST) }
            )

            ToolbarButton(
                icon = Icons.Default.Code,
                tooltip = "代码块",
                onClick = { onFormatClick(MarkdownFormat.CODE_BLOCK) }
            )

            ToolbarButton(
                icon = Icons.Default.Link,
                tooltip = "链接",
                onClick = { onFormatClick(MarkdownFormat.LINK) }
            )

            Spacer(modifier = Modifier.weight(1f))

            VerticalDivider(modifier = Modifier.height(24.dp))

            // 模式切换按钮
            IconButton(
                onClick = {
                    onModeChange(
                        when (currentMode) {
                            EditorMode.EDIT -> EditorMode.PREVIEW
                            EditorMode.PREVIEW -> EditorMode.SPLIT
                            EditorMode.SPLIT -> EditorMode.EDIT
                        }
                    )
                }
            ) {
                Icon(
                    imageVector = when (currentMode) {
                        EditorMode.EDIT -> Icons.Default.Edit
                        EditorMode.PREVIEW -> Icons.Default.Visibility
                        EditorMode.SPLIT -> Icons.Default.ViewColumn
                    },
                    contentDescription = "切换模式",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

/**
 * 工具栏按钮
 */
@Composable
private fun ToolbarButton(
    icon: ImageVector,
    tooltip: String,
    onClick: () -> Unit
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(40.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = tooltip,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Markdown文本编辑器（带语法高亮）
 */
@Composable
fun MarkdownTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "输入Markdown文本..."
) {
    val context = LocalContext.current

    AndroidView(
        factory = { ctx ->
            EditText(ctx).apply {
                // 创建Markwon和Editor
                val prism4j = Prism4j(GrammarLocatorImpl())
                val markwon = Markwon.builder(ctx)
                    .usePlugin(SyntaxHighlightPlugin.create(prism4j, Prism4jThemeDefault.create()))
                    .usePlugin(StrikethroughPlugin.create())
                    .usePlugin(TablePlugin.create(ctx))
                    .usePlugin(LinkifyPlugin.create())
                    .build()

                val editor = MarkwonEditor.create(markwon)

                // 设置样式
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                setPadding(32, 32, 32, 32)
                hint = placeholder
                setText(value)

                // 添加TextWatcher进行语法高亮
                addTextChangedListener(MarkwonEditorTextWatcher.withPreRender(
                    editor,
                    Executors.newCachedThreadPool(),
                    this
                ))

                // 文本变化监听
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        if (s.toString() != value) {
                            onValueChange(s.toString())
                        }
                    }
                })
            }
        },
        update = { editText ->
            if (editText.text.toString() != value) {
                editText.setText(value)
            }
        },
        modifier = modifier
            .background(MaterialTheme.colorScheme.surface)
    )
}

/**
 * Markdown预览组件
 */
@Composable
fun MarkdownPreview(
    markdown: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()

    Box(
        modifier = modifier
            .background(MaterialTheme.colorScheme.surface)
            .verticalScroll(scrollState)
            .padding(16.dp)
    ) {
        AndroidView(
            factory = { ctx ->
                android.widget.TextView(ctx).apply {
                    // 创建Markwon实例
                    val prism4j = Prism4j(GrammarLocatorImpl())
                    val markwon = Markwon.builder(ctx)
                        .usePlugin(SyntaxHighlightPlugin.create(prism4j, Prism4jThemeDefault.create()))
                        .usePlugin(StrikethroughPlugin.create())
                        .usePlugin(TablePlugin.create(ctx))
                        .usePlugin(LinkifyPlugin.create())
                        .build()

                    // 渲染Markdown
                    markwon.setMarkdown(this, markdown)
                    setPadding(0, 0, 0, 0)
                }
            },
            update = { textView ->
                val prism4j = Prism4j(GrammarLocatorImpl())
                val markwon = Markwon.builder(context)
                    .usePlugin(SyntaxHighlightPlugin.create(prism4j, Prism4jThemeDefault.create()))
                    .usePlugin(StrikethroughPlugin.create())
                    .usePlugin(TablePlugin.create(context))
                    .usePlugin(LinkifyPlugin.create())
                    .build()

                markwon.setMarkdown(textView, markdown)
            },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

/**
 * 编辑器模式
 */
enum class EditorMode {
    /** 仅编辑 */
    EDIT,

    /** 仅预览 */
    PREVIEW,

    /** 分屏模式 */
    SPLIT
}

/**
 * Markdown格式类型
 */
enum class MarkdownFormat {
    BOLD,
    ITALIC,
    STRIKETHROUGH,
    HEADING,
    UNORDERED_LIST,
    ORDERED_LIST,
    CODE_BLOCK,
    LINK
}

// GrammarLocator implementation moved to GrammarLocatorImpl.kt
