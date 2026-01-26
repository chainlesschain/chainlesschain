package com.chainlesschain.android.feature.p2p.ui.social.components

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

/**
 * 图片预览网格（编辑模式）
 *
 * 显示选中的图片，支持删除和显示上传进度
 *
 * @param images 图片 URI 列表
 * @param uploadProgress 上传进度 Map（URI -> 进度百分比）
 * @param onRemoveImage 删除图片回调
 * @param modifier Modifier
 * @param spacing 图片间距
 * @param cornerRadius 圆角半径
 */
@Composable
fun ImagePreviewGrid(
    images: List<Uri>,
    uploadProgress: Map<Uri, Int> = emptyMap(),
    onRemoveImage: (Uri) -> Unit,
    modifier: Modifier = Modifier,
    spacing: Dp = 8.dp,
    cornerRadius: Dp = 12.dp
) {
    if (images.isEmpty()) return

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(spacing)
    ) {
        // 每行最多3张图片
        images.chunked(3).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(spacing)
            ) {
                row.forEach { uri ->
                    ImagePreviewItem(
                        uri = uri,
                        progress = uploadProgress[uri],
                        onRemove = { onRemoveImage(uri) },
                        modifier = Modifier.weight(1f),
                        cornerRadius = cornerRadius
                    )
                }
                // 填充空白以保持对齐
                repeat(3 - row.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * 单个图片预览项
 */
@Composable
private fun ImagePreviewItem(
    uri: Uri,
    progress: Int?,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 12.dp
) {
    Box(
        modifier = modifier.aspectRatio(1f)
    ) {
        // 图片
        AsyncImage(
            model = uri,
            contentDescription = null,
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(cornerRadius)),
            contentScale = ContentScale.Crop
        )

        // 上传进度遮罩
        if (progress != null && progress < 100) {
            Surface(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(cornerRadius)),
                color = MaterialTheme.colorScheme.scrim.copy(alpha = 0.6f)
            ) {
                Box(
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        CircularProgressIndicator(
                            progress = { progress / 100f },
                            modifier = Modifier.size(48.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 4.dp
                        )
                        Text(
                            text = "$progress%",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            }
        }

        // 删除按钮
        Surface(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(4.dp)
                .size(28.dp)
                .clickable(onClick = onRemove),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.9f)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "删除",
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        // 上传成功标记
        if (progress == 100) {
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(4.dp)
                    .size(24.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = androidx.compose.material.icons.Icons.Default.CheckCircle,
                        contentDescription = "已上传",
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}
