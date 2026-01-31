package com.chainlesschain.android.remote.ui.system

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.SystemCommands
import com.chainlesschain.android.remote.commands.ScreenshotResponse
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.IOException
import javax.inject.Inject

/**
 * 远程截图 ViewModel
 *
 * 功能：
 * - 截取 PC 端屏幕
 * - 显示截图
 * - 保存截图到本地
 * - 截图历史记录
 */
@HiltViewModel
class RemoteScreenshotViewModel @Inject constructor(
    private val systemCommands: SystemCommands,
    private val p2pClient: P2PClient,
    @ApplicationContext private val context: Context
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(RemoteScreenshotUiState())
    val uiState: StateFlow<RemoteScreenshotUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 截图历史
    private val _screenshots = MutableStateFlow<List<ScreenshotItem>>(emptyList())
    val screenshots: StateFlow<List<ScreenshotItem>> = _screenshots.asStateFlow()

    /**
     * 截图
     */
    fun takeScreenshot(display: Int = 0, format: String = "png", quality: Int = 80) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTakingScreenshot = true, error = null) }

            val result = systemCommands.screenshot(display, format, quality)

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    // 解析 Base64 图片
                    val bitmap = decodeBase64ToBitmap(response.data)

                    if (bitmap != null) {
                        // 创建截图项
                        val screenshotItem = ScreenshotItem(
                            id = System.currentTimeMillis().toString(),
                            bitmap = bitmap,
                            timestamp = response.timestamp,
                            width = response.width,
                            height = response.height,
                            display = response.display,
                            format = response.format
                        )

                        // 添加到历史
                        _screenshots.update { list ->
                            (listOf(screenshotItem) + list).take(10) // 保留最近 10 张
                        }

                        // 设置为当前截图
                        _uiState.update { it.copy(
                            currentScreenshot = screenshotItem,
                            isTakingScreenshot = false
                        )}

                        Timber.d("截图成功: ${response.width}x${response.height}")
                    } else {
                        _uiState.update { it.copy(
                            isTakingScreenshot = false,
                            error = "图片解码失败"
                        )}
                    }
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "截图失败"
                Timber.e(result.exceptionOrNull(), "截图失败")
                _uiState.update { it.copy(
                    isTakingScreenshot = false,
                    error = error
                )}
            }
        }
    }

    /**
     * 保存截图到相册
     */
    fun saveScreenshot(screenshot: ScreenshotItem) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }

            try {
                val saved = saveImageToGallery(screenshot.bitmap, screenshot.format)

                _uiState.update { it.copy(
                    isSaving = false,
                    saveSuccess = saved
                )}

                if (saved) {
                    Timber.d("截图已保存到相册")
                }
            } catch (e: Exception) {
                Timber.e(e, "保存截图失败")
                _uiState.update { it.copy(
                    isSaving = false,
                    error = "保存失败: ${e.message}"
                )}
            }
        }
    }

    /**
     * 解码 Base64 为 Bitmap
     */
    private fun decodeBase64ToBitmap(base64String: String): Bitmap? {
        return try {
            val decodedBytes = Base64.decode(base64String, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
        } catch (e: Exception) {
            Timber.e(e, "Base64 解码失败")
            null
        }
    }

    /**
     * 保存图片到相册
     */
    private fun saveImageToGallery(bitmap: Bitmap, format: String): Boolean {
        return try {
            val filename = "Screenshot_${System.currentTimeMillis()}.$format"
            val mimeType = when (format) {
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                else -> "image/png"
            }
            val compressFormat = when (format) {
                "jpg", "jpeg" -> Bitmap.CompressFormat.JPEG
                else -> Bitmap.CompressFormat.PNG
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ 使用 MediaStore
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ChainlessChain")
                }

                val uri = context.contentResolver.insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    contentValues
                )

                uri?.let {
                    context.contentResolver.openOutputStream(it)?.use { outputStream ->
                        bitmap.compress(compressFormat, 100, outputStream)
                    }
                    true
                } ?: false
            } else {
                // Android 9 及以下使用传统方式
                val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                val appDir = java.io.File(picturesDir, "ChainlessChain")
                if (!appDir.exists()) {
                    appDir.mkdirs()
                }

                val file = java.io.File(appDir, filename)
                java.io.FileOutputStream(file).use { outputStream ->
                    bitmap.compress(compressFormat, 100, outputStream)
                }

                // 通知媒体扫描器
                val contentValues = ContentValues().apply {
                    put(MediaStore.Images.Media.DATA, file.absolutePath)
                }
                context.contentResolver.insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    contentValues
                )

                true
            }
        } catch (e: IOException) {
            Timber.e(e, "保存图片失败")
            false
        }
    }

    /**
     * 选择截图
     */
    fun selectScreenshot(screenshot: ScreenshotItem) {
        _uiState.update { it.copy(currentScreenshot = screenshot) }
    }

    /**
     * 设置显示器
     */
    fun setDisplay(display: Int) {
        _uiState.update { it.copy(selectedDisplay = display) }
    }

    /**
     * 设置质量
     */
    fun setQuality(quality: Int) {
        _uiState.update { it.copy(quality = quality) }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 清除保存成功状态
     */
    fun clearSaveSuccess() {
        _uiState.update { it.copy(saveSuccess = false) }
    }
}

/**
 * UI 状态
 */
data class RemoteScreenshotUiState(
    val isTakingScreenshot: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val currentScreenshot: ScreenshotItem? = null,
    val selectedDisplay: Int = 0,
    val quality: Int = 80,
    val saveSuccess: Boolean = false
)

/**
 * 截图项
 */
data class ScreenshotItem(
    val id: String,
    val bitmap: Bitmap,
    val timestamp: Long,
    val width: Int,
    val height: Int,
    val display: Int,
    val format: String
)
