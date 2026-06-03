package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.chainlesschain.android.core.ui.markdown.RichTextEditor
import com.chainlesschain.android.core.ui.markdown.EditorMode
import com.chainlesschain.android.feature.p2p.util.EditPermission
import com.chainlesschain.android.feature.p2p.util.EditWarning
import com.chainlesschain.android.feature.p2p.util.PostEditPolicy
import com.chainlesschain.android.feature.p2p.viewmodel.social.EditPostViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.social.EditPostEvent

/**
 * 编辑动态页面
 *
 * 功能：
 * - 编辑动态内容
 * - 编辑图片（删除/添加）
 * - 显示编辑时间倒计时
 * - 显示互动警告
 * - 保存修改
 *
 * @param postId 动态ID
 * @param onNavigateBack 返回上一页
 * @param onPostUpdated 更新成功回调
 * @param viewModel ViewModel
 *
 * @since v0.31.0
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditPostScreen(
    postId: String,
    onNavigateBack: () -> Unit,
    onPostUpdated: () -> Unit = {},
    viewModel: EditPostViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 加载动态
    LaunchedEffect(postId) {
        viewModel.loadPost(postId)
    }

    // 监听事件
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is EditPostEvent.SaveSuccess -> {
                    snackbarHostState.showSnackbar("动态已更新")
                    onPostUpdated()
                    onNavigateBack()
                }
                is EditPostEvent.SaveError -> {
                    snackbarHostState.showSnackbar("保存失败：${event.message}")
                }
                is EditPostEvent.LoadError -> {
                    snackbarHostState.showSnackbar("加载失败：${event.message}")
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("编辑动态") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.Close, contentDescription = "取消")
                    }
                },
                actions = {
                    TextButton(
                        onClick = { viewModel.saveChanges() },
                        enabled = uiState.hasChanges && !uiState.isSaving
                    ) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("保存")
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        if (uiState.isLoading) {
            // 加载状态
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else if (uiState.errorMessage != null) {
            // 错误状态
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "⚠️",
                        style = MaterialTheme.typography.displayMedium
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = uiState.errorMessage ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = { viewModel.loadPost(postId) }) {
                        Text("重试")
                    }
                }
            }
        } else {
            // 编辑内容
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .verticalScroll(rememberScrollState())
            ) {
                // 编辑时间倒计时
                uiState.editPermission?.let { permission ->
                    if (permission is EditPermission.Allowed) {
                        EditTimeCountdown(permission)
                    }
                }

                // 警告提示
                uiState.warning?.let { warning ->
                    if (warning is EditWarning.HasInteractions) {
                        InteractionWarning(warning)
                    }
                }

                // 富文本Markdown编辑器
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                ) {
                    RichTextEditor(
                        value = uiState.content,
                        onValueChange = { viewModel.updateContent(it) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 250.dp, max = 500.dp),
                        placeholder = "分享你的想法... 支持Markdown格式",
                        initialMode = EditorMode.EDIT
                    )
                }

                // 图片编辑区域
                if (uiState.images.isNotEmpty() || uiState.canAddImages) {
                    ImageEditSection(
                        images = uiState.images,
                        canAddImages = uiState.canAddImages,
                        onRemoveImage = { viewModel.removeImage(it) },
                        onAddImages = { /* Image picker requires ActivityResultLauncher integration */ }
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                // 编辑说明
                EditGuide()
            }
        }
    }
}

/**
 * 编辑时间倒计时组件
 */
@Composable
private fun EditTimeCountdown(permission: EditPermission.Allowed) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.AccessTime,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(16.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "剩余编辑时间: ${PostEditPolicy.formatRemainingTime(permission.remainingTime)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

/**
 * 互动警告组件
 */
@Composable
private fun InteractionWarning(warning: EditWarning.HasInteractions) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = warning.message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onErrorContainer
            )
        }
    }
}

/**
 * 图片编辑区域
 */
@Composable
private fun ImageEditSection(
    images: List<String>,
    canAddImages: Boolean,
    onRemoveImage: (String) -> Unit,
    onAddImages: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        Text(
            text = "图片 (${images.size}/9)",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 现有图片
            items(images) { imageUrl ->
                Box {
                    AsyncImage(
                        model = imageUrl,
                        contentDescription = null,
                        modifier = Modifier
                            .size(80.dp)
                            .clip(RoundedCornerShape(8.dp))
                    )

                    // 删除按钮
                    IconButton(
                        onClick = { onRemoveImage(imageUrl) },
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(24.dp)
                            .background(
                                Color.Black.copy(alpha = 0.6f),
                                CircleShape
                            )
                    ) {
                        Icon(
                            Icons.Default.Cancel,
                            contentDescription = "删除",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

            // 添加图片按钮
            if (canAddImages) {
                item {
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .clickable(onClick = onAddImages),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "添加图片",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/**
 * 编辑说明
 */
@Composable
private fun EditGuide() {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.3f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "编辑说明",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "• 动态发布后24小时内可以编辑\n" +
                        "• 编辑后会显示「已编辑」标签\n" +
                        "• 编辑历史会被保存",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.8f)
            )
        }
    }
}
