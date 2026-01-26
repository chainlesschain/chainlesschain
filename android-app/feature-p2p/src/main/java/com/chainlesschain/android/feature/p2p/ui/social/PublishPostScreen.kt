package com.chainlesschain.android.feature.p2p.ui.social

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import com.chainlesschain.android.core.network.LinkPreview
import com.chainlesschain.android.core.network.LinkPreviewFetcher
import com.chainlesschain.android.core.ui.image.ImagePickerConfig
import com.chainlesschain.android.core.ui.image.rememberImagePickerLauncher
import com.chainlesschain.android.feature.p2p.service.ImageUploadService
import com.chainlesschain.android.feature.p2p.ui.social.components.ImagePreviewGrid
import com.chainlesschain.android.feature.p2p.ui.social.components.LinkPreviewCard
import com.chainlesschain.android.feature.p2p.ui.social.components.LinkPreviewSkeleton
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

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
    // 获取Services
    val context = androidx.compose.ui.platform.LocalContext.current
    val imageUploadService = remember { ImageUploadService(context) }
    val linkPreviewFetcher = remember { LinkPreviewFetcher() }

    var content by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf(PostVisibility.PUBLIC) }
    var tags by remember { mutableStateOf("") }
    var isPublishing by remember { mutableStateOf(false) }

    // 图片相关状态
    var selectedImages by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var uploadedImageUrls by remember { mutableStateOf<List<String>>(emptyList()) }
    var uploadProgress by remember { mutableStateOf<Map<Uri, Int>>(emptyMap()) }

    // 链接预览状态
    var linkPreview by remember { mutableStateOf<LinkPreview?>(null) }
    var isLoadingLinkPreview by remember { mutableStateOf(false) }
    var linkPreviewJob by remember { mutableStateOf<Job?>(null) }

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // 监听内容变化，自动检测链接
    LaunchedEffect(content) {
        linkPreviewJob?.cancel()
        linkPreviewJob = scope.launch {
            delay(500) // 防抖
            val urls = linkPreviewFetcher.extractUrls(content)
            if (urls.isNotEmpty() && linkPreview == null) {
                isLoadingLinkPreview = true
                val preview = linkPreviewFetcher.fetchPreview(urls.first())
                linkPreview = preview
                isLoadingLinkPreview = false
            } else if (urls.isEmpty()) {
                linkPreview = null
            }
        }
    }

    // 图片选择器
    val imagePickerLauncher = rememberImagePickerLauncher(
        config = ImagePickerConfig(allowMultiple = true, maxSelectionCount = 9)
    ) { uris ->
        selectedImages = selectedImages + uris
        // 开始上传
        scope.launch {
            imageUploadService.uploadImages(uris).collect { result ->
                when (result) {
                    is ImageUploadService.UploadResult.Progress -> {
                        uploadProgress = uploadProgress + (result.uri to result.progress)
                    }
                    is ImageUploadService.UploadResult.Success -> {
                        uploadProgress = uploadProgress + (result.uri to 100)
                        uploadedImageUrls = uploadedImageUrls + result.url
                    }
                    is ImageUploadService.UploadResult.Error -> {
                        snackbarHostState.showSnackbar("图片上传失败: ${result.message}")
                        selectedImages = selectedImages - result.uri
                        uploadProgress = uploadProgress - result.uri
                    }
                }
            }
        }
    }

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
            // 检查是否有图片正在上传
            val hasUploadingImages = selectedImages.any { uri ->
                val progress = uploadProgress[uri] ?: 0
                progress < 100
            }

            if (hasUploadingImages) {
                scope.launch {
                    snackbarHostState.showSnackbar("请等待图片上传完成")
                }
            } else {
                isPublishing = true

                // 解析标签
                val tagList = tags
                    .split(",", "，", " ")
                    .map { it.trim().removePrefix("#") }
                    .filter { it.isNotBlank() }

                // 序列化链接预览为 JSON
                val linkPreviewJson = linkPreview?.let { preview ->
                    """
                    {
                        "url": "${preview.url}",
                        "title": "${preview.title ?: ""}",
                        "description": "${preview.description ?: ""}",
                        "imageUrl": "${preview.imageUrl ?: ""}",
                        "siteName": "${preview.siteName ?: ""}"
                    }
                    """.trimIndent()
                }

                viewModel.publishPost(
                    content = content.trim(),
                    images = uploadedImageUrls,
                    tags = tagList,
                    visibility = visibility,
                    linkUrl = linkPreview?.url,
                    linkPreview = linkPreviewJson
                )
            }
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
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 内容输入框
            OutlinedTextField(
                value = content,
                onValueChange = { content = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("分享新鲜事...") },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences
                ),
                minLines = 5,
                maxLines = 15
            )

            // 图片预览网格
            if (selectedImages.isNotEmpty()) {
                ImagePreviewGrid(
                    images = selectedImages,
                    uploadProgress = uploadProgress,
                    onRemoveImage = { uri ->
                        selectedImages = selectedImages - uri
                        uploadProgress = uploadProgress - uri
                        // 从已上传列表中移除对应的URL
                        val index = selectedImages.indexOf(uri)
                        if (index >= 0 && index < uploadedImageUrls.size) {
                            uploadedImageUrls = uploadedImageUrls.toMutableList().apply {
                                removeAt(index)
                            }
                        }
                    }
                )
            }

            // 链接预览
            when {
                isLoadingLinkPreview -> {
                    LinkPreviewSkeleton()
                }
                linkPreview != null -> {
                    LinkPreviewCard(
                        preview = linkPreview!!,
                        onRemove = { linkPreview = null }
                    )
                }
            }

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

            // 功能按钮
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = imagePickerLauncher,
                    enabled = selectedImages.size < 9
                ) {
                    Icon(
                        imageVector = Icons.Default.Image,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("图片 (${selectedImages.size}/9)")
                }

                OutlinedButton(
                    onClick = {
                        scope.launch {
                            snackbarHostState.showSnackbar("在文本中粘贴链接，系统会自动检测并生成预览")
                        }
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Link,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(if (linkPreview != null) "已添加" else "链接")
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
