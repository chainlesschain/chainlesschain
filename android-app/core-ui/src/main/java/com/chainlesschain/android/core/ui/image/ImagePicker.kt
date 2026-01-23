package com.chainlesschain.android.core.ui.image

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/**
 * 图片选择器配置
 */
data class ImagePickerConfig(
    /** 是否允许多选 */
    val allowMultiple: Boolean = false,
    /** 最大选择数量（仅在 allowMultiple = true 时生效） */
    val maxSelectionCount: Int = 9,
    /** 是否只选择图片（false 则包括视频） */
    val imagesOnly: Boolean = true
)

/**
 * 记住图片选择器启动器
 *
 * @param config 图片选择器配置
 * @param onImagesSelected 选择图片后的回调
 * @return 启动器
 */
@Composable
fun rememberImagePickerLauncher(
    config: ImagePickerConfig = ImagePickerConfig(),
    onImagesSelected: (List<Uri>) -> Unit
): () -> Unit {
    val visualMediaType = if (config.imagesOnly) {
        ActivityResultContracts.PickVisualMedia.ImageOnly
    } else {
        ActivityResultContracts.PickVisualMedia.ImageAndVideo
    }

    // 单选启动器
    val singlePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        uri?.let { onImagesSelected(listOf(it)) }
    }

    // 多选启动器
    val multiplePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickMultipleVisualMedia(
            maxItems = config.maxSelectionCount
        )
    ) { uris ->
        if (uris.isNotEmpty()) {
            onImagesSelected(uris)
        }
    }

    return remember(config) {
        {
            val request = PickVisualMediaRequest(mediaType = visualMediaType)
            if (config.allowMultiple) {
                multiplePickerLauncher.launch(request)
            } else {
                singlePickerLauncher.launch(request)
            }
        }
    }
}

/**
 * 记住简单的单图片选择器
 *
 * @param onImageSelected 选择图片后的回调
 * @return 启动器
 */
@Composable
fun rememberSingleImagePicker(
    onImageSelected: (Uri) -> Unit
): () -> Unit {
    return rememberImagePickerLauncher(
        config = ImagePickerConfig(allowMultiple = false)
    ) { uris ->
        uris.firstOrNull()?.let { onImageSelected(it) }
    }
}
