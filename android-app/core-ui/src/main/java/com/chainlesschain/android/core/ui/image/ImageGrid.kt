package com.chainlesschain.android.core.ui.image

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

/**
 * 图片网格布局
 *
 * 自动根据图片数量调整布局：
 * - 1 张：单图，宽高比 16:9
 * - 2 张：横向两列
 * - 3 张：左1右2
 * - 4 张：2x2 网格
 * - 5-9 张：3x3 网格（多余图片显示 +N）
 *
 * @param images 图片 URL 列表
 * @param modifier Modifier
 * @param spacing 图片间距
 * @param cornerRadius 圆角半径
 * @param onImageClick 点击图片回调（index, url）
 */
@Composable
fun ImageGrid(
    images: List<String>,
    modifier: Modifier = Modifier,
    spacing: Dp = 4.dp,
    cornerRadius: Dp = 8.dp,
    onImageClick: (Int, String) -> Unit = { _, _ -> }
) {
    when (images.size) {
        0 -> { /* 无图片 */ }
        1 -> SingleImageLayout(images[0], modifier, cornerRadius, onImageClick)
        2 -> TwoImagesLayout(images, modifier, spacing, cornerRadius, onImageClick)
        3 -> ThreeImagesLayout(images, modifier, spacing, cornerRadius, onImageClick)
        4 -> FourImagesLayout(images, modifier, spacing, cornerRadius, onImageClick)
        else -> MultiImagesLayout(images, modifier, spacing, cornerRadius, onImageClick)
    }
}

/**
 * 单图布局
 */
@Composable
private fun SingleImageLayout(
    imageUrl: String,
    modifier: Modifier,
    cornerRadius: Dp,
    onImageClick: (Int, String) -> Unit
) {
    AsyncImage(
        model = imageUrl,
        contentDescription = null,
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(cornerRadius))
            .clickable { onImageClick(0, imageUrl) },
        contentScale = ContentScale.Crop
    )
}

/**
 * 双图布局
 */
@Composable
private fun TwoImagesLayout(
    images: List<String>,
    modifier: Modifier,
    spacing: Dp,
    cornerRadius: Dp,
    onImageClick: (Int, String) -> Unit
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(spacing)
    ) {
        images.forEachIndexed { index, url ->
            AsyncImage(
                model = url,
                contentDescription = null,
                modifier = Modifier
                    .weight(1f)
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(cornerRadius))
                    .clickable { onImageClick(index, url) },
                contentScale = ContentScale.Crop
            )
        }
    }
}

/**
 * 三图布局（左1右2）
 */
@Composable
private fun ThreeImagesLayout(
    images: List<String>,
    modifier: Modifier,
    spacing: Dp,
    cornerRadius: Dp,
    onImageClick: (Int, String) -> Unit
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(spacing)
    ) {
        // 左侧大图
        AsyncImage(
            model = images[0],
            contentDescription = null,
            modifier = Modifier
                .weight(1f)
                .aspectRatio(1f)
                .clip(RoundedCornerShape(cornerRadius))
                .clickable { onImageClick(0, images[0]) },
            contentScale = ContentScale.Crop
        )
        // 右侧两小图
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(spacing)
        ) {
            images.drop(1).forEachIndexed { index, url ->
                AsyncImage(
                    model = url,
                    contentDescription = null,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(2f)
                        .clip(RoundedCornerShape(cornerRadius))
                        .clickable { onImageClick(index + 1, url) },
                    contentScale = ContentScale.Crop
                )
            }
        }
    }
}

/**
 * 四图布局（2x2）
 */
@Composable
private fun FourImagesLayout(
    images: List<String>,
    modifier: Modifier,
    spacing: Dp,
    cornerRadius: Dp,
    onImageClick: (Int, String) -> Unit
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(spacing)
    ) {
        for (row in 0..1) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(spacing)
            ) {
                for (col in 0..1) {
                    val index = row * 2 + col
                    val url = images[index]
                    AsyncImage(
                        model = url,
                        contentDescription = null,
                        modifier = Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(cornerRadius))
                            .clickable { onImageClick(index, url) },
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
    }
}

/**
 * 多图布局（3x3，最多显示 9 张）
 */
@Composable
private fun MultiImagesLayout(
    images: List<String>,
    modifier: Modifier,
    spacing: Dp,
    cornerRadius: Dp,
    onImageClick: (Int, String) -> Unit
) {
    val displayImages = images.take(9)
    val remainingCount = images.size - 9

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(spacing)
    ) {
        for (row in 0..2) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(spacing)
            ) {
                for (col in 0..2) {
                    val index = row * 3 + col
                    if (index < displayImages.size) {
                        val url = displayImages[index]
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .aspectRatio(1f)
                        ) {
                            AsyncImage(
                                model = url,
                                contentDescription = null,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .clip(RoundedCornerShape(cornerRadius))
                                    .clickable { onImageClick(index, url) },
                                contentScale = ContentScale.Crop
                            )
                            // 最后一张显示剩余数量
                            if (index == 8 && remainingCount > 0) {
                                Surface(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .clip(RoundedCornerShape(cornerRadius)),
                                    color = MaterialTheme.colorScheme.scrim.copy(alpha = 0.6f)
                                ) {
                                    Box(
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(
                                            text = "+$remainingCount",
                                            style = MaterialTheme.typography.headlineMedium,
                                            color = MaterialTheme.colorScheme.onPrimary
                                        )
                                    }
                                }
                            }
                        }
                    } else {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}
