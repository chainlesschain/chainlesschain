package com.chainlesschain.android.presentation.screens.ocr

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.ai.data.ocr.CameraOcrManager
import com.chainlesschain.android.feature.ai.data.ocr.CameraOcrState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

/**
 * M3 D1 CameraOCR 演示 ViewModel。CameraX in-app preview 留 follow-up；当前用
 * Activity Result `TakePicture()` 拉系统相机走 JPEG → manager pipeline。
 */
@HiltViewModel
class CameraOcrViewModel @Inject constructor(
    private val manager: CameraOcrManager,
) : ViewModel() {

    val state: StateFlow<CameraOcrState> = manager.state

    fun processImage(jpegFile: File, language: String = "auto") {
        viewModelScope.launch {
            manager.processImage(jpegFile, language)
        }
    }

    fun saveToKb(title: String, contentOverride: String? = null, tags: List<String>? = null) {
        viewModelScope.launch {
            manager.saveToKb(
                title = title,
                contentOverride = contentOverride,
                tags = tags ?: listOf("ocr", "mobile"),
            )
        }
    }

    fun reset() {
        manager.reset()
    }
}
