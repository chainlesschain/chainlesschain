package com.chainlesschain.android.feature.knowledge.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType

/**
 * 知识库编辑界面
 *
 * 支持Markdown编辑、预览和工具栏
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeEditorScreen(
    itemId: String? = null,
    onNavigateBack: () -> Unit,
    viewModel: KnowledgeViewModel = hiltViewModel()
) {
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var isPreviewMode by remember { mutableStateOf(false) }

    val uiState by viewModel.uiState.collectAsState()
    val currentItem by viewModel.currentItem.collectAsState()

    // 加载现有条目
    LaunchedEffect(itemId) {
        itemId?.let { viewModel.loadItem(it) }
    }

    // 填充现有数据
    LaunchedEffect(currentItem) {
        currentItem?.let { item ->
            title = item.title
            content = item.content
            tags = item.tags.joinToString(", ")
        }
    }

    // 保存成功后返回
    LaunchedEffect(uiState.operationSuccess) {
        if (uiState.operationSuccess) {
            viewModel.clearSuccess()
            onNavigateBack()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (itemId == null) "新建知识库" else "编辑知识库") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 预览/编辑切换
                    IconButton(onClick = { isPreviewMode = !isPreviewMode }) {
                        Icon(
                            imageVector = if (isPreviewMode) Icons.Default.Edit else Icons.Default.Visibility,
                            contentDescription = if (isPreviewMode) "编辑" else "预览"
                        )
                    }

                    // 保存按钮
                    IconButton(
                        onClick = {
                            val tagList = tags.split(",")
                                .map { it.trim() }
                                .filter { it.isNotEmpty() }

                            if (itemId == null) {
                                viewModel.createItem(
                                    title = title,
                                    content = content,
                                    type = KnowledgeType.NOTE,
                                    tags = tagList
                                )
                            } else {
                                viewModel.updateItem(
                                    id = itemId,
                                    title = title,
                                    content = content,
                                    tags = tagList
                                )
                            }
                        },
                        enabled = !uiState.isLoading
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.Save, contentDescription = "保存")
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 标题输入
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                label = { Text("标题") },
                singleLine = true,
                enabled = !isPreviewMode
            )

            // 标签输入
            OutlinedTextField(
                value = tags,
                onValueChange = { tags = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                label = { Text("标签（逗号分隔）") },
                placeholder = { Text("例如：技术, 学习, 笔记") },
                singleLine = true,
                enabled = !isPreviewMode
            )

            Divider()

            if (isPreviewMode) {
                // 预览模式
                MarkdownPreview(
                    markdown = content,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp)
                )
            } else {
                // 编辑模式
                Column(modifier = Modifier.fillMaxSize()) {
                    // Markdown工具栏
                    MarkdownToolbar(
                        onInsertMarkdown = { markdown ->
                            content += markdown
                        }
                    )

                    Divider()

                    // 内容编辑器
                    OutlinedTextField(
                        value = content,
                        onValueChange = { content = it },
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        label = { Text("内容（支持Markdown）") },
                        placeholder = { Text("开始输入...") },
                        textStyle = LocalTextStyle.current.copy(
                            fontFamily = FontFamily.Monospace
                        )
                    )
                }
            }
        }

        // 错误提示
        uiState.error?.let { error ->
            Snackbar(
                modifier = Modifier.padding(16.dp),
                action = {
                    TextButton(onClick = { viewModel.clearError() }) {
                        Text("关闭")
                    }
                }
            ) {
                Text(error)
            }
        }
    }
}

/**
 * Markdown工具栏
 */
@Composable
fun MarkdownToolbar(
    onInsertMarkdown: (String) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        // 标题
        IconButton(onClick = { onInsertMarkdown("# ") }) {
            Text("H1", style = MaterialTheme.typography.labelSmall)
        }
        IconButton(onClick = { onInsertMarkdown("## ") }) {
            Text("H2", style = MaterialTheme.typography.labelSmall)
        }

        Divider(
            modifier = Modifier
                .width(1.dp)
                .height(24.dp)
        )

        // 加粗
        IconButton(onClick = { onInsertMarkdown("**加粗**") }) {
            Icon(
                imageVector = Icons.Default.FormatBold,
                contentDescription = "加粗",
                modifier = Modifier.size(20.dp)
            )
        }

        // 斜体
        IconButton(onClick = { onInsertMarkdown("*斜体*") }) {
            Icon(
                imageVector = Icons.Default.FormatItalic,
                contentDescription = "斜体",
                modifier = Modifier.size(20.dp)
            )
        }

        Divider(
            modifier = Modifier
                .width(1.dp)
                .height(24.dp)
        )

        // 列表
        IconButton(onClick = { onInsertMarkdown("\n- ") }) {
            Icon(
                imageVector = Icons.Default.FormatListBulleted,
                contentDescription = "列表",
                modifier = Modifier.size(20.dp)
            )
        }

        // 代码块
        IconButton(onClick = { onInsertMarkdown("\n```\n\n```") }) {
            Icon(
                imageVector = Icons.Default.Code,
                contentDescription = "代码块",
                modifier = Modifier.size(20.dp)
            )
        }

        // 引用
        IconButton(onClick = { onInsertMarkdown("\n> ") }) {
            Icon(
                imageVector = Icons.Default.FormatQuote,
                contentDescription = "引用",
                modifier = Modifier.size(20.dp)
            )
        }

        // 链接
        IconButton(onClick = { onInsertMarkdown("[链接文本](url)") }) {
            Icon(
                imageVector = Icons.Default.Link,
                contentDescription = "链接",
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/**
 * Markdown预览组件
 *
 * TODO: 集成Markwon库进行真正的Markdown渲染
 * 目前使用简单的文本显示
 */
@Composable
fun MarkdownPreview(
    markdown: String,
    modifier: Modifier = Modifier
) {
    SelectionContainer {
        Column(
            modifier = modifier.verticalScroll(rememberScrollState())
        ) {
            if (markdown.isEmpty()) {
                Text(
                    text = "暂无内容",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            } else {
                // 简单的Markdown渲染（待集成Markwon）
                Text(
                    text = markdown,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace
                )

                Spacer(modifier = Modifier.height(8.dp))

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer
                    )
                ) {
                    Text(
                        text = "💡 完整的Markdown渲染功能将在集成Markwon库后提供",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.labelMedium
                    )
                }
            }
        }
    }
}
