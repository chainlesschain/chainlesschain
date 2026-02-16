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
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import androidx.compose.runtime.Immutable
import javax.inject.Inject

@HiltViewModel
class RemoteScreenshotViewModel @Inject constructor(
    private val systemCommands: SystemCommands,
    private val p2pClient: P2PClient,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteScreenshotUiState())
    val uiState: StateFlow<RemoteScreenshotUiState> = _uiState.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    private val _screenshots = MutableStateFlow<List<ScreenshotItem>>(emptyList())
    val screenshots: StateFlow<List<ScreenshotItem>> = _screenshots.asStateFlow()

    fun takeScreenshot(display: Int = 0, format: String = "png", quality: Int = 80) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTakingScreenshot = true, error = null) }

            val result = systemCommands.screenshot(display, format, quality)
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isTakingScreenshot = false,
                        error = result.exceptionOrNull()?.message ?: "Screenshot failed"
                    )
                }
                return@launch
            }

            val response = result.getOrNull()
            if (response == null) {
                _uiState.update { it.copy(isTakingScreenshot = false, error = "Empty response") }
                return@launch
            }

            val bitmap = decodeBase64ToBitmap(response.data)
            if (bitmap == null) {
                _uiState.update { it.copy(isTakingScreenshot = false, error = "Image decode failed") }
                return@launch
            }

            val item = ScreenshotItem(
                id = System.currentTimeMillis().toString(),
                bitmap = bitmap,
                timestamp = response.timestamp,
                width = response.width,
                height = response.height,
                display = response.display,
                format = response.format
            )

            _screenshots.update { old ->
                // Recycle bitmaps that will be dropped from history
                if (old.size >= 5) {
                    old.drop(4).forEach { it.bitmap.recycle() }
                }
                listOf(item) + old.take(4)
            }
            _uiState.update {
                it.copy(
                    isTakingScreenshot = false,
                    currentScreenshot = item,
                    selectedDisplay = display,
                    format = normalizeFormat(format),
                    quality = quality
                )
            }
        }
    }

    fun saveScreenshot(screenshot: ScreenshotItem) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null, saveSuccess = false) }
            try {
                val saved = saveImageToGallery(screenshot.bitmap, screenshot.format)
                _uiState.update { it.copy(isSaving = false, saveSuccess = saved) }
                if (!saved) {
                    _uiState.update { it.copy(error = "Save failed") }
                }
            } catch (e: Exception) {
                Timber.e(e, "Save screenshot failed")
                _uiState.update { it.copy(isSaving = false, error = e.message ?: "Save failed") }
            }
        }
    }

    private fun decodeBase64ToBitmap(base64String: String): Bitmap? {
        return try {
            val decodedBytes = Base64.decode(base64String, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
        } catch (e: Exception) {
            Timber.e(e, "Decode screenshot failed")
            null
        }
    }

    private fun saveImageToGallery(bitmap: Bitmap, format: String): Boolean {
        val safeFormat = normalizeFormat(format)
        val extension = if (safeFormat == "jpeg") "jpg" else "png"
        val mimeType = if (safeFormat == "jpeg") "image/jpeg" else "image/png"
        val compressFormat = if (safeFormat == "jpeg") Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG
        val filename = "Screenshot_${System.currentTimeMillis()}.$extension"

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val contentValues = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ChainlessChain")
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
            if (uri != null) {
                context.contentResolver.openOutputStream(uri)?.use { outputStream ->
                    bitmap.compress(compressFormat, 100, outputStream)
                }
                true
            } else {
                false
            }
        } else {
            val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
            val appDir = File(picturesDir, "ChainlessChain")
            if (!appDir.exists()) appDir.mkdirs()

            val file = File(appDir, filename)
            FileOutputStream(file).use { outputStream ->
                if (!bitmap.compress(compressFormat, 100, outputStream)) {
                    throw IOException("Bitmap compress failed")
                }
            }

            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DATA, file.absolutePath)
            }
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            true
        }
    }

    fun selectScreenshot(screenshot: ScreenshotItem) {
        _uiState.update { it.copy(currentScreenshot = screenshot) }
    }

    fun setDisplay(display: Int) {
        _uiState.update { it.copy(selectedDisplay = display) }
    }

    fun setFormat(format: String) {
        _uiState.update { it.copy(format = normalizeFormat(format)) }
    }

    fun setQuality(quality: Int) {
        _uiState.update { it.copy(quality = quality.coerceIn(50, 100)) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearSaveSuccess() {
        _uiState.update { it.copy(saveSuccess = false) }
    }

    override fun onCleared() {
        super.onCleared()
        // Recycle all bitmaps to prevent memory leaks
        _screenshots.value.forEach { it.bitmap.recycle() }
    }

    private fun normalizeFormat(format: String): String {
        val normalized = format.lowercase()
        return if (normalized == "jpg" || normalized == "jpeg") "jpeg" else "png"
    }
}

@Immutable
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

data class ScreenshotItem(
    val id: String,
    val bitmap: Bitmap,
    val timestamp: Long,
    val width: Int,
    val height: Int,
    val display: Int,
    val format: String
)
