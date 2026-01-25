package com.chainlesschain.android.feature.filebrowser.ui.components

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * PDF预览组件
 *
 * 功能:
 * - 使用Android PdfRenderer渲染PDF
 * - 支持页面导航 (上一页/下一页)
 * - 支持缩放 (双指缩放和缩放按钮)
 * - 显示页码信息
 * - 自动适应屏幕大小
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfPreviewScreen(
    uri: String,
    contentResolver: ContentResolver
) {
    var pdfState by remember { mutableStateOf<PdfState>(PdfState.Loading) }
    var currentPage by remember { mutableIntStateOf(0) }
    var totalPages by remember { mutableIntStateOf(0) }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    val context = LocalContext.current

    // Load PDF
    LaunchedEffect(uri) {
        pdfState = PdfState.Loading
        try {
            val result = loadPdfPage(
                contentResolver = contentResolver,
                uri = Uri.parse(uri),
                pageIndex = 0,
                context = context
            )

            if (result != null) {
                totalPages = result.totalPages
                pdfState = PdfState.Success(result.bitmap)
            } else {
                pdfState = PdfState.Error("无法加载PDF文件")
            }
        } catch (e: Exception) {
            pdfState = PdfState.Error("PDF加载失败: ${e.message}")
        }
    }

    // Load page when currentPage changes
    LaunchedEffect(currentPage) {
        if (currentPage > 0 || totalPages > 0) {
            pdfState = PdfState.Loading
            try {
                val result = loadPdfPage(
                    contentResolver = contentResolver,
                    uri = Uri.parse(uri),
                    pageIndex = currentPage,
                    context = context
                )

                if (result != null) {
                    pdfState = PdfState.Success(result.bitmap)
                } else {
                    pdfState = PdfState.Error("无法加载第${currentPage + 1}页")
                }
            } catch (e: Exception) {
                pdfState = PdfState.Error("页面加载失败: ${e.message}")
            }
        }
    }

    // Reset zoom and offset when page changes
    LaunchedEffect(currentPage) {
        scale = 1f
        offset = Offset.Zero
    }

    // Transformable state for pinch-to-zoom
    val transformableState = rememberTransformableState { zoomChange, offsetChange, _ ->
        scale = (scale * zoomChange).coerceIn(0.5f, 5f)
        offset += offsetChange
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
    ) {
        // Content area
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            when (val state = pdfState) {
                is PdfState.Loading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }

                is PdfState.Success -> {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .transformable(state = transformableState),
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            bitmap = state.bitmap.asImageBitmap(),
                            contentDescription = "PDF页面 ${currentPage + 1}",
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer(
                                    scaleX = scale,
                                    scaleY = scale,
                                    translationX = offset.x,
                                    translationY = offset.y
                                )
                        )
                    }
                }

                is PdfState.Error -> {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = Icons.Default.Error,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = state.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            // Zoom controls (bottom-right corner)
            if (pdfState is PdfState.Success) {
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Zoom info
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)
                    ) {
                        Text(
                            text = "${(scale * 100).toInt()}%",
                            modifier = Modifier.padding(8.dp),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }

                    // Zoom in button
                    SmallFloatingActionButton(
                        onClick = { scale = (scale * 1.2f).coerceAtMost(5f) },
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)
                    ) {
                        Icon(Icons.Default.ZoomIn, contentDescription = "放大")
                    }

                    // Zoom out button
                    SmallFloatingActionButton(
                        onClick = { scale = (scale / 1.2f).coerceAtLeast(0.5f) },
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)
                    ) {
                        Icon(Icons.Default.ZoomOut, contentDescription = "缩小")
                    }

                    // Reset zoom button
                    SmallFloatingActionButton(
                        onClick = {
                            scale = 1f
                            offset = Offset.Zero
                        },
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)
                    ) {
                        Icon(Icons.Default.CenterFocusWeak, contentDescription = "重置缩放")
                    }
                }
            }
        }

        // Navigation bar
        if (totalPages > 1) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Previous page button
                    IconButton(
                        onClick = { if (currentPage > 0) currentPage-- },
                        enabled = currentPage > 0
                    ) {
                        Icon(
                            imageVector = Icons.Default.NavigateBefore,
                            contentDescription = "上一页"
                        )
                    }

                    // Page indicator
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "第 ${currentPage + 1} / $totalPages 页",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )

                        // Jump to page button
                        IconButton(
                            onClick = {
                                // TODO: Show page jump dialog
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "更多选项",
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }

                    // Next page button
                    IconButton(
                        onClick = { if (currentPage < totalPages - 1) currentPage++ },
                        enabled = currentPage < totalPages - 1
                    ) {
                        Icon(
                            imageVector = Icons.Default.NavigateNext,
                            contentDescription = "下一页"
                        )
                    }
                }
            }
        }
    }
}

/**
 * PDF状态
 */
sealed class PdfState {
    object Loading : PdfState()
    data class Success(val bitmap: Bitmap) : PdfState()
    data class Error(val message: String) : PdfState()
}

/**
 * PDF页面加载结果
 */
data class PdfPageResult(
    val bitmap: Bitmap,
    val totalPages: Int
)

/**
 * 加载PDF页面
 *
 * @param contentResolver ContentResolver实例
 * @param uri PDF文件URI
 * @param pageIndex 页面索引（从0开始）
 * @param context Android Context
 * @return PDF页面结果或null
 */
private suspend fun loadPdfPage(
    contentResolver: ContentResolver,
    uri: Uri,
    pageIndex: Int,
    context: android.content.Context
): PdfPageResult? = withContext(Dispatchers.IO) {
    var parcelFileDescriptor: ParcelFileDescriptor? = null
    var pdfRenderer: PdfRenderer? = null
    var tempFile: File? = null

    try {
        // Copy URI content to temp file (PdfRenderer requires a seekable file)
        tempFile = File(context.cacheDir, "temp_pdf_${System.currentTimeMillis()}.pdf")
        contentResolver.openInputStream(uri)?.use { inputStream ->
            FileOutputStream(tempFile).use { outputStream ->
                inputStream.copyTo(outputStream)
            }
        }

        // Open PDF
        parcelFileDescriptor = ParcelFileDescriptor.open(
            tempFile,
            ParcelFileDescriptor.MODE_READ_ONLY
        )
        pdfRenderer = PdfRenderer(parcelFileDescriptor)

        val totalPages = pdfRenderer.pageCount

        if (pageIndex >= totalPages) {
            return@withContext null
        }

        // Open page
        val page = pdfRenderer.openPage(pageIndex)

        // Create bitmap with appropriate size
        val width = page.width * 2 // 2x resolution for better quality
        val height = page.height * 2
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)

        // Render page to bitmap
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

        // Close page
        page.close()

        PdfPageResult(bitmap, totalPages)
    } catch (e: Exception) {
        android.util.Log.e("PdfPreview", "Error loading PDF page", e)
        null
    } finally {
        pdfRenderer?.close()
        parcelFileDescriptor?.close()
        tempFile?.delete() // Clean up temp file
    }
}
