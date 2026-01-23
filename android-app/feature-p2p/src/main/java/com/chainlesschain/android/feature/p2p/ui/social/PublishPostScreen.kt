package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostViewModel
import kotlinx.coroutines.flow.collectLatest

/**
 * 发布动态页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PublishPostScreen(
    myDid: String,
    onNavigateBack: () -> Unit,
    viewModel: PostViewModel = hiltViewModel()
) {
    var content by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf(PostVisibility.PUBLIC) }
    var tags by remember { mutableStateOf("") }
    var isPublishing by remember { mutableStateOf(false) }

    val snackbarHostState = remember { SnackbarHostState() }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is PostEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is PostEvent.PostPublished -> {
                    onNavigateBack()
                }
                else -> {}
            }
        }
    }

    // 处理发布
    val handlePublish = {
        if (content.isNotBlank()) {
            isPublishing = true

            // 解析标签
            val tagList = tags
                .split(",", "，", " ")
                .map { it.trim().removePrefix("#") }
                .filter { it.isNotBlank() }

            viewModel.publishPost(
                content = content.trim(),
                tags = tagList,
                visibility = visibility
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("发布动态") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.Close, contentDescription = "关闭")
                    }
                },
                actions = {
                    Button(
                        onClick = handlePublish,
                        enabled = content.isNotBlank() && !isPublishing
                    ) {
                        if (isPublishing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text("发布")
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 内容输入框
            OutlinedTextField(
                value = content,
                onValueChange = { content = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                placeholder = { Text("分享新鲜事...") },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences
                ),
                maxLines = Int.MAX_VALUE
            )

            // 标签输入
            OutlinedTextField(
                value = tags,
                onValueChange = { tags = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("标签") },
                placeholder = { Text("添加标签，用逗号分隔") },
                leadingIcon = {
                    Icon(Icons.Default.Tag, contentDescription = null)
                },
                singleLine = true
            )

            Divider()

            // 可见性选择
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "可见性",
                    style = MaterialTheme.typography.titleSmall
                )

                VisibilityOption(
                    icon = Icons.Default.Public,
                    title = "公开",
                    description = "所有人可见",
                    selected = visibility == PostVisibility.PUBLIC,
                    onClick = { visibility = PostVisibility.PUBLIC }
                )

                VisibilityOption(
                    icon = Icons.Default.Group,
                    title = "仅好友",
                    description = "只有好友可见",
                    selected = visibility == PostVisibility.FRIENDS_ONLY,
                    onClick = { visibility = PostVisibility.FRIENDS_ONLY }
                )

                VisibilityOption(
                    icon = Icons.Default.Lock,
                    title = "私密",
                    description = "仅自己可见",
                    selected = visibility == PostVisibility.PRIVATE,
                    onClick = { visibility = PostVisibility.PRIVATE }
                )
            }

            Divider()

            // 功能按钮（图片、链接等 - 未实现）
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { /* TODO: 添加图片 */ },
                    enabled = false
                ) {
                    Icon(
                        imageVector = Icons.Default.Image,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("图片")
                }

                OutlinedButton(
                    onClick = { /* TODO: 添加链接 */ },
                    enabled = false
                ) {
                    Icon(
                        imageVector = Icons.Default.Link,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("链接")
                }
            }

            // 字数统计
            Text(
                text = "${content.length} 字",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 可见性选项组件
 */
@Composable
private fun VisibilityOption(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.medium,
        border = if (selected) {
            androidx.compose.foundation.BorderStroke(
                2.dp,
                MaterialTheme.colorScheme.primary
            )
        } else {
            null
        },
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (selected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "已选中",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}
