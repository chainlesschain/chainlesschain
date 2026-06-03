package com.chainlesschain.android.feature.ai.data.ocr

/**
 * CameraOCR 状态机。
 *
 * 转移：
 *   Idle → Encoding (processImage)
 *   Encoding → Recognizing | Failed(ENCODE)
 *   Recognizing → Recognized | Failed(RECOGNIZE)
 *   Recognized → Saving (saveToKb) | Idle (discard/reset)
 *   Saving → Saved | Failed(SAVE)
 *   Saved/Failed → Idle (reset)
 */
sealed class CameraOcrState {
    data object Idle : CameraOcrState()
    data object Encoding : CameraOcrState()
    data object Recognizing : CameraOcrState()
    data class Recognized(
        val text: String,
        val language: String,
        val confidence: Float,
    ) : CameraOcrState()

    data class Saving(val title: String) : CameraOcrState()
    data class Saved(val noteId: String, val title: String) : CameraOcrState()
    data class Failed(val stage: Stage, val message: String) : CameraOcrState() {
        enum class Stage { ENCODE, RECOGNIZE, SAVE }
    }
}
