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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.filebrowser.R
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
    onDismiss: () -> Unit,
    textRecognizer: com.chainlesschain.android.feature.filebrowser.ml.TextRecognizer? = null,
    fileSummarizer: com.chainlesschain.android.feature.filebrowser.ai.FileSummarizer? = null
) {
    val context = LocalContext.current
    val contentResolver = context.contentResolver

    var previewState by remember { mutableStateOf<PreviewState>(PreviewState.Loading) }
    var ocrResult by remember { mutableStateOf<com.chainlesschain.android.feature.filebrowser.ml.TextRecognizer.RecognitionResult?>(null) }
    var isRecognizingText by remember { mutableStateOf(false) }
    var summaryResult by remember { mutableStateOf<com.chainlesschain.android.feature.filebrowser.ai.FileSummarizer.SummaryResult?>(null) }
    var isGeneratingSummary by remember { mutableStateOf(false) }
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
                val truncMsg = context.getString(R.string.preview_truncated, 1000)
                val content = loadTextContent(contentResolver, file.uri, maxLines = 1000, truncationMessage = truncMsg)
                if (content != null) {
                    PreviewState.Text(content)
                } else {
                    PreviewState.Error(context.getString(R.string.preview_cannot_read))
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
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.preview_close))
                        }
                    },
                    actions = {
                        // OCR button (only for images)
                        if (file.category == FileCategory.IMAGE && textRecognizer != null) {
                            IconButton(
                                onClick = {
                                    coroutineScope.launch {
                                        isRecognizingText = true
                                        val result = textRecognizer.recognizeText(
                                            contentResolver,
                                            file.uri
                                        )
                                        ocrResult = result
                                        isRecognizingText = false
                                    }
                                },
                                enabled = !isRecognizingText
                            ) {
                                if (isRecognizingText) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(20.dp),
                                        strokeWidth = 2.dp
                                    )
                                } else {
                                    Icon(Icons.Default.TextFields, contentDescription = stringResource(R.string.preview_ocr))
                                }
                            }
                        }

                        IconButton(
                            onClick = {
                                // Open file location in file manager
                                try {
                                    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                                        setDataAndType(android.net.Uri.parse(file.uri), "resource/folder")
                                        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                                    }
                                    context.startActivity(intent)
                                } catch (e: Exception) {
                                    android.util.Log.e("FilePreviewDialog", "Error opening file location", e)
                                }
                            }
                        ) {
                            Icon(Icons.Default.FolderOpen, contentDescription = stringResource(R.string.preview_open_folder))
                        }

                        IconButton(
                            onClick = {
                                // Share file using Android Share Sheet
                                try {
                                    val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                        type = file.mimeType ?: "*/*"
                                        putExtra(android.content.Intent.EXTRA_STREAM, android.net.Uri.parse(file.uri))
                                        addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    }
                                    context.startActivity(android.content.Intent.createChooser(intent, context.getString(R.string.preview_share_file)))
                                } catch (e: Exception) {
                                    android.util.Log.e("FilePreviewDialog", "Error sharing file", e)
                                }
                            }
                        ) {
                            Icon(Icons.Default.Share, contentDescription = stringResource(R.string.preview_share))
                        }
                    }
                )

                // Content area
                Column(modifier = Modifier.fillMaxSize()) {
                    // Main preview content
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
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

                    // File Summary Card (for text, code, document files)
                    if (fileSummarizer != null && shouldShowSummary(file.category)) {
                        FileSummaryCard(
                            summary = summaryResult,
                            isLoading = isGeneratingSummary,
                            onGenerate = {
                                coroutineScope.launch {
                                    isGeneratingSummary = true
                                    val result = fileSummarizer.summarizeFile(
                                        contentResolver = contentResolver,
                                        uri = file.uri,
                                        mimeType = file.mimeType,
                                        fileName = file.displayName,
                                        maxLength = com.chainlesschain.android.feature.filebrowser.ai.FileSummarizer.LENGTH_MEDIUM
                                    )
                                    summaryResult = result
                                    isGeneratingSummary = false
                                }
                            },
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }
        }
    }

    // OCR Result Dialog
    ocrResult?.let { result ->
        OCRResultDialog(
            result = result,
            fileName = file.displayName,
            onDismiss = { ocrResult = null },
            onSave = { editedText ->
                // Save edited OCR text as a new text file
                coroutineScope.launch {
                    try {
                        val fileName = "${file.displayName.substringBeforeLast(".")}_ocr_${System.currentTimeMillis()}.txt"

                        // Use MediaStore API (compatible with SDK 35+)
                        val contentValues = android.content.ContentValues().apply {
                            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                                android.os.Environment.DIRECTORY_DOCUMENTS + "/ChainlessChain")
                        }
                        val uri = context.contentResolver.insert(
                            android.provider.MediaStore.Files.getContentUri("external"),
                            contentValues
                        )
                        if (uri != null) {
                            context.contentResolver.openOutputStream(uri)?.use { outputStream ->
                                outputStream.write(editedText.toByteArray())
                            }
                            android.util.Log.i("FilePreviewDialog", "OCR text saved via MediaStore: $fileName")
                        } else {
                            android.util.Log.e("FilePreviewDialog", "Failed to create MediaStore entry")
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("FilePreviewDialog", "Error saving OCR text", e)
                    }
                }
            }
        )
    }
}

/**
 * Check if summary should be shown for this file category
 */
private fun shouldShowSummary(category: FileCategory): Boolean {
    return when (category) {
        FileCategory.DOCUMENT -> true
        FileCategory.CODE -> true
        FileCategory.OTHER -> true  // May contain text files
        else -> false  // Images, videos, audio don't need text summary
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
            contentDescription = stringResource(R.string.preview_image),
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
            text = stringResource(R.string.preview_not_supported),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = when (file.category) {
                FileCategory.VIDEO -> stringResource(R.string.preview_video_external)
                FileCategory.AUDIO -> stringResource(R.string.preview_audio_external)
                else -> stringResource(R.string.preview_cannot_preview)
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
            text = stringResource(R.string.preview_cannot_preview_file),
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
            InfoRow(label = stringResource(R.string.file_detail_name), value = file.displayName)
            InfoRow(label = stringResource(R.string.file_detail_size), value = file.getReadableSize())
            InfoRow(label = stringResource(R.string.file_detail_type), value = file.mimeType)
            InfoRow(label = stringResource(R.string.file_detail_category), value = file.getCategoryDisplayName())
            file.extension?.let {
                InfoRow(label = stringResource(R.string.file_detail_extension), value = it)
            }
            file.parentFolder?.let {
                InfoRow(label = stringResource(R.string.file_detail_folder), value = it)
            }
            InfoRow(
                label = stringResource(R.string.file_detail_modified),
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
    maxLines: Int = 1000,
    truncationMessage: String? = null
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

            if (lineCount >= maxLines && truncationMessage != null) {
                content.appendLine(truncationMessage)
            }

            content.toString()
        }
    } catch (e: Exception) {
        null
    }
}
