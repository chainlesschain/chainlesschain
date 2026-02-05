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
 * 杩滅▼鎴浘 ViewModel
 *
 * 鍔熻兘锛? * - 鎴彇 PC 绔睆骞? * - 鏄剧ず鎴浘
 * - 淇濆瓨鎴浘鍒版湰鍦? * - 鎴浘鍘嗗彶璁板綍
 */
@HiltViewModel
class RemoteScreenshotViewModel @Inject constructor(
    private val systemCommands: SystemCommands,
    private val p2pClient: P2PClient,
    @ApplicationContext private val context: Context
) : ViewModel() {

    // UI 鐘舵€?    private val _uiState = MutableStateFlow(RemoteScreenshotUiState())
    val uiState: StateFlow<RemoteScreenshotUiState> = _uiState.asStateFlow()

    // 杩炴帴鐘舵€?    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 鎴浘鍘嗗彶
    private val _screenshots = MutableStateFlow<List<ScreenshotItem>>(emptyList())
    val screenshots: StateFlow<List<ScreenshotItem>> = _screenshots.asStateFlow()

    /**
     * 鎴浘
     */
    fun takeScreenshot(display: Int = 0, format: String = "png", quality: Int = 80) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTakingScreenshot = true, error = null) }

            val result = systemCommands.screenshot(display, format, quality)

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    // 瑙ｆ瀽 Base64 鍥剧墖
                    val bitmap = decodeBase64ToBitmap(response.data)

                    if (bitmap != null) {
                        // 鍒涘缓鎴浘椤?                        val screenshotItem = ScreenshotItem(
                            id = System.currentTimeMillis().toString(),
                            bitmap = bitmap,
                            timestamp = response.timestamp,
                            width = response.width,
                            height = response.height,
                            display = response.display,
                            format = response.format
                        )

                        // 娣诲姞鍒板巻鍙?                        _screenshots.update { list ->
                            (listOf(screenshotItem) + list).take(10) // 淇濈暀鏈€杩?10 寮?                        }

                        // 璁剧疆涓哄綋鍓嶆埅鍥?                        _uiState.update { it.copy(
                            currentScreenshot = screenshotItem,
                            isTakingScreenshot = false
                        )}

                        Timber.d("鎴浘鎴愬姛: ${response.width}x${response.height}")
                    } else {
                        _uiState.update { it.copy(
                            isTakingScreenshot = false,
                            error = "鍥剧墖瑙ｇ爜澶辫触"
                        )}
                    }
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "鎴浘澶辫触"
                Timber.e(result.exceptionOrNull(), "鎴浘澶辫触")
                _uiState.update { it.copy(
                    isTakingScreenshot = false,
                    error = error
                )}
            }
        }
    }

    /**
     * 淇濆瓨鎴浘鍒扮浉鍐?     */
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
                    Timber.d("鎴浘宸蹭繚瀛樺埌鐩稿唽")
                }
            } catch (e: Exception) {
                Timber.e(e, "淇濆瓨鎴浘澶辫触")
                _uiState.update { it.copy(
                    isSaving = false,
                    error = "淇濆瓨澶辫触: ${e.message}"
                )}
            }
        }
    }

    /**
     * 瑙ｇ爜 Base64 涓?Bitmap
     */
    private fun decodeBase64ToBitmap(base64String: String): Bitmap? {
        return try {
            val decodedBytes = Base64.decode(base64String, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
        } catch (e: Exception) {
            Timber.e(e, "Base64 瑙ｇ爜澶辫触")
            null
        }
    }

    /**
     * 淇濆瓨鍥剧墖鍒扮浉鍐?     */
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
                // Android 10+ 浣跨敤 MediaStore
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
                // Android 9 鍙婁互涓嬩娇鐢ㄤ紶缁熸柟寮?                val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                val appDir = java.io.File(picturesDir, "ChainlessChain")
                if (!appDir.exists()) {
                    appDir.mkdirs()
                }

                val file = java.io.File(appDir, filename)
                java.io.FileOutputStream(file).use { outputStream ->
                    bitmap.compress(compressFormat, 100, outputStream)
                }

                // 閫氱煡濯掍綋鎵弿鍣?                val contentValues = ContentValues().apply {
                    put(MediaStore.Images.Media.DATA, file.absolutePath)
                }
                context.contentResolver.insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    contentValues
                )

                true
            }
        } catch (e: IOException) {
            Timber.e(e, "淇濆瓨鍥剧墖澶辫触")
            false
        }
    }

    /**
     * 閫夋嫨鎴浘
     */
    fun selectScreenshot(screenshot: ScreenshotItem) {
        _uiState.update { it.copy(currentScreenshot = screenshot) }
    }

    /**
     * 璁剧疆鏄剧ず鍣?     */
    fun setDisplay(display: Int) {
        _uiState.update { it.copy(selectedDisplay = display) }
    }

    fun setFormat(format: String) {
        val normalized = format.lowercase()
        _uiState.update {
            it.copy(format = if (normalized == "jpg" || normalized == "jpeg") "jpeg" else "png")
        }
    }

    /**
     * 璁剧疆璐ㄩ噺
     */
    fun setQuality(quality: Int) {
        _uiState.update { it.copy(quality = quality) }
    }

    /**
     * 娓呴櫎閿欒
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 娓呴櫎淇濆瓨鎴愬姛鐘舵€?     */
    fun clearSaveSuccess() {
        _uiState.update { it.copy(saveSuccess = false) }
    }
}

/**
 * UI 鐘舵€? */
data class RemoteScreenshotUiState(
    val isTakingScreenshot: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val currentScreenshot: ScreenshotItem? = null,
    val selectedDisplay: Int = 0,
    val format: String = "png",
    val quality: Int = 80,
    val saveSuccess: Boolean = false
)

/**
 * 鎴浘椤? */
data class ScreenshotItem(
    val id: String,
    val bitmap: Bitmap,
    val timestamp: Long,
    val width: Int,
    val height: Int,
    val display: Int,
    val format: String
)

