package com.chainlesschain.android.feature.filebrowser.ui.components

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * 文件预览对话框
 *
 * 支持预览类型:
 * - 图片 (使用Coil加载)
 * - PDF (使用PdfRenderer，支持页面导航和缩放)
 * - 视频/音频 (使用ExoPlayer，支持播放控制)
 * - 文本文件 (显示前1000行)
 * - 其他文件 (仅显示元数据)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilePreviewDialog(
    file: ExternalFileEntity,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val contentResolver = context.contentResolver

    var previewState by remember { mutableStateOf<PreviewState>(PreviewState.Loading) }
    val coroutineScope = rememberCoroutineScope()

    // Load preview content
    LaunchedEffect(file.id) {
        previewState = PreviewState.Loading

        // Check if file is PDF
        val isPdf = file.mimeType?.equals("application/pdf", ignoreCase = true) == true ||
                    file.displayName.endsWith(".pdf", ignoreCase = true)

        // Check if file is playable media
        val isPlayableMedia = file.category == FileCategory.VIDEO ||
                              file.category == FileCategory.AUDIO

        previewState = when {
            isPdf -> PreviewState.Pdf(file.uri)
            file.category == FileCategory.IMAGE -> PreviewState.Image(file.uri)
            isPlayableMedia -> PreviewState.Media(file, file.uri)
            file.category == FileCategory.DOCUMENT || file.category == FileCategory.CODE -> {
                val content = loadTextContent(contentResolver, file.uri, maxLines = 1000)
                if (content != null) {
                    PreviewState.Text(content)
                } else {
                    PreviewState.Error("无法读取文件内容")
                }
            }
            else -> PreviewState.Info(file)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.85f),
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Top bar
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = file.displayName,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1
                            )
                            Text(
                                text = "${file.getReadableSize()} • ${file.getCategoryDisplayName()}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Default.Close, contentDescription = "关闭")
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = {
                                // TODO: 打开文件所在位置
                            }
                        ) {
                            Icon(Icons.Default.FolderOpen, contentDescription = "打开所在文件夹")
                        }

                        IconButton(
                            onClick = {
                                // TODO: 分享文件
                            }
                        ) {
                            Icon(Icons.Default.Share, contentDescription = "分享")
                        }
                    }
                )

                // Content area
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
                ) {
                    when (val state = previewState) {
                        is PreviewState.Loading -> {
                            CircularProgressIndicator(
                                modifier = Modifier.align(Alignment.Center)
                            )
                        }

                        is PreviewState.Image -> {
                            ImagePreview(uri = state.uri)
                        }

                        is PreviewState.Text -> {
                            TextPreview(content = state.content)
                        }

                        is PreviewState.Pdf -> {
                            PdfPreviewScreen(
                                uri = state.uri,
                                contentResolver = contentResolver
                            )
                        }

                        is PreviewState.Media -> {
                            MediaPlayerScreen(
                                file = state.file,
                                uri = state.uri
                            )
                        }

                        is PreviewState.MediaInfo -> {
                            MediaInfoPreview(file = state.file)
                        }

                        is PreviewState.Info -> {
                            FileInfoPreview(file = state.file)
                        }

                        is PreviewState.Error -> {
                            ErrorPreview(message = state.message)
                        }
                    }
                }
            }
        }
    }
}

/**
 * 预览状态
 */
sealed class PreviewState {
    object Loading : PreviewState()
    data class Image(val uri: String) : PreviewState()
    data class Text(val content: String) : PreviewState()
    data class Pdf(val uri: String) : PreviewState()
    data class Media(val file: ExternalFileEntity, val uri: String) : PreviewState()
    data class MediaInfo(val file: ExternalFileEntity) : PreviewState()
    data class Info(val file: ExternalFileEntity) : PreviewState()
    data class Error(val message: String) : PreviewState()
}

/**
 * 图片预览
 */
@Composable
private fun ImagePreview(uri: String) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(Uri.parse(uri))
                .crossfade(true)
                .build(),
            contentDescription = "图片预览",
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Fit
        )
    }
}

/**
 * 文本预览
 */
@Composable
private fun TextPreview(content: String) {
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.surface,
            shape = MaterialTheme.shapes.medium
        ) {
            Text(
                text = content,
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(16.dp),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace
                ),
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

/**
 * 媒体文件信息预览
 */
@Composable
private fun MediaInfoPreview(file: ExternalFileEntity) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = when (file.category) {
                FileCategory.VIDEO -> Icons.Default.VideoLibrary
                FileCategory.AUDIO -> Icons.Default.AudioFile
                else -> Icons.Default.InsertDriveFile
            },
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "预览暂不支持",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = when (file.category) {
                FileCategory.VIDEO -> "视频文件需要使用外部播放器打开"
                FileCategory.AUDIO -> "音频文件需要使用外部播放器打开"
                else -> "此类型文件无法预览"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(32.dp))

        FileInfoSection(file)
    }
}

/**
 * 通用文件信息预览
 */
@Composable
private fun FileInfoPreview(file: ExternalFileEntity) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.InsertDriveFile,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "无法预览此文件",
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(32.dp))

        FileInfoSection(file)
    }
}

/**
 * 文件信息区域
 */
@Composable
private fun FileInfoSection(file: ExternalFileEntity) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        shape = MaterialTheme.shapes.medium
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            InfoRow(label = "文件名", value = file.displayName)
            InfoRow(label = "大小", value = file.getReadableSize())
            InfoRow(label = "类型", value = file.mimeType)
            InfoRow(label = "分类", value = file.getCategoryDisplayName())
            file.extension?.let {
                InfoRow(label = "扩展名", value = it)
            }
            file.parentFolder?.let {
                InfoRow(label = "文件夹", value = it)
            }
            InfoRow(
                label = "修改时间",
                value = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault())
                    .format(java.util.Date(file.lastModified))
            )
        }
    }
}

/**
 * 信息行
 */
@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

/**
 * 错误预览
 */
@Composable
private fun ErrorPreview(message: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Error,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.error
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error
        )
    }
}

/**
 * 加载文本文件内容
 */
private suspend fun loadTextContent(
    contentResolver: ContentResolver,
    uri: String,
    maxLines: Int = 1000
): String? = withContext(Dispatchers.IO) {
    try {
        contentResolver.openInputStream(Uri.parse(uri))?.use { inputStream ->
            val reader = BufferedReader(InputStreamReader(inputStream))
            val content = StringBuilder()
            var lineCount = 0

            reader.forEachLine { line ->
                if (lineCount < maxLines) {
                    content.appendLine(line)
                    lineCount++
                } else {
                    return@forEachLine
                }
            }

            if (lineCount >= maxLines) {
                content.appendLine("\n... (文件太大，仅显示前 $maxLines 行)")
            }

            content.toString()
        }
    } catch (e: Exception) {
        null
    }
}
