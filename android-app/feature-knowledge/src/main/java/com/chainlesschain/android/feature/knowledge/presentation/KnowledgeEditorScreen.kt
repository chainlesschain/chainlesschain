package com.chainlesschain.android.feature.knowledge.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.ui.markdown.RichTextEditor
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType

/**
 * 知识库编辑界面
 *
 * 支持Markdown编辑、预览和分屏模式（通过RichTextEditor组件）
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
                        enabled = !uiState.isLoading && title.isNotBlank()
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
                label = { Text("标题 *") },
                placeholder = { Text("请输入标题") },
                singleLine = true,
                isError = title.isBlank() && title.isNotEmpty(),
                supportingText = {
                    if (title.isBlank() && title.isNotEmpty()) {
                        Text("标题不能为空")
                    }
                }
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
                singleLine = true
            )

            Divider()

            // Markdown编辑器（支持编辑/预览/分屏模式）
            RichTextEditor(
                value = content,
                onValueChange = { content = it },
                modifier = Modifier.fillMaxSize(),
                placeholder = "开始输入Markdown内容..."
            )
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
