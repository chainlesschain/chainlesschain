package com.chainlesschain.android.feature.ai.data.ocr

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 编排器：JPEG 文件 → bytes → REMOTE OCR → 用户检视 → 可选写 KB。
 *
 * 设计文档 §5.3 M3 D1：CameraX 拍照 → 截图 → REMOTE LLM OCR → 写知识库。
 *
 * 取图：UI 端用 Activity Result API `TakePicture()` 拿到 JPEG 文件（系统相机），传给
 *      [processImage]。CameraX in-app 预览作为后续 follow-up（手机相机已能用就先用）。
 *
 * 多步流程：processImage 后停在 Recognized，**等 UI 显示 + 用户确认**再 saveToKb，
 *         给 false-positive OCR 留校正窗口。
 */
@Singleton
class CameraOcrManager @Inject constructor(
    private val bridge: OcrBridge,
) {
    private val _state = MutableStateFlow<CameraOcrState>(CameraOcrState.Idle)
    val state: StateFlow<CameraOcrState> = _state.asStateFlow()

    /** 最近一次成功 OCR 的文本；UI 编辑过后通过 saveToKb 的 contentOverride 提交修订版。 */
    private var lastOcrText: String? = null

    /**
     * 全 pipeline 入口：读 jpeg → base64 编 + REMOTE OCR。完成后停在 Recognized，
     * 等 UI 调 saveToKb 或 reset。
     */
    suspend fun processImage(jpegFile: File, language: String = "auto") {
        _state.value = CameraOcrState.Encoding
        val bytes = try {
            jpegFile.readBytes()
        } catch (e: Exception) {
            Timber.e(e, "CameraOcrManager: readBytes failed")
            _state.value = CameraOcrState.Failed(
                CameraOcrState.Failed.Stage.ENCODE,
                e.message ?: "读取图片失败",
            )
            return
        }
        if (bytes.isEmpty()) {
            _state.value = CameraOcrState.Failed(
                CameraOcrState.Failed.Stage.ENCODE,
                "图片为空",
            )
            return
        }

        _state.value = CameraOcrState.Recognizing
        val result = bridge.recognize(bytes, language)
        val ocr = result.getOrNull()
        if (ocr == null) {
            _state.value = CameraOcrState.Failed(
                CameraOcrState.Failed.Stage.RECOGNIZE,
                result.exceptionOrNull()?.message ?: "OCR 失败",
            )
            return
        }
        if (ocr.text.isBlank()) {
            _state.value = CameraOcrState.Failed(
                CameraOcrState.Failed.Stage.RECOGNIZE,
                "未识别到文字",
            )
            return
        }
        lastOcrText = ocr.text
        _state.value = CameraOcrState.Recognized(ocr.text, ocr.language, ocr.confidence)
    }

    /**
     * 保存当前 OCR 结果到 KB。仅在 Recognized 状态下生效。
     *
     * @param contentOverride 若用户编辑过文本，传修订后的版本；否则用 OCR 原文。
     * @param contentPrefix  可选 Markdown 前缀，写在正文上方。M3 D2 LocationTagger 用此
     *                       入口把 GPS 元数据（"📍 lat,lon ±Xm @ time"）附加到 note
     *                       开头，避免 feature-ai 反向依赖 app 模块的 LocationTag 类。
     */
    suspend fun saveToKb(
        title: String,
        contentOverride: String? = null,
        contentPrefix: String? = null,
        tags: List<String>? = listOf("ocr", "mobile"),
    ) {
        if (_state.value !is CameraOcrState.Recognized) {
            Timber.w("CameraOcrManager.saveToKb: ignored, state=${_state.value}")
            return
        }
        val baseContent = contentOverride ?: lastOcrText
        if (baseContent.isNullOrBlank()) {
            _state.value = CameraOcrState.Failed(
                CameraOcrState.Failed.Stage.SAVE,
                "无 OCR 文本可保存",
            )
            return
        }
        val finalContent = if (contentPrefix.isNullOrBlank()) baseContent
        else contentPrefix.trimEnd() + "\n\n" + baseContent
        _state.value = CameraOcrState.Saving(title)
        val result = bridge.saveNote(title, finalContent, tags)
        val saved = result.getOrNull()
        if (saved == null) {
            _state.value = CameraOcrState.Failed(
                CameraOcrState.Failed.Stage.SAVE,
                result.exceptionOrNull()?.message ?: "保存失败",
            )
            return
        }
        _state.value = CameraOcrState.Saved(saved.noteId, title)
    }

    /** 重置回 Idle，丢弃缓存的 OCR 文本。Discard / Retry / 用户取消都走这条。 */
    fun reset() {
        lastOcrText = null
        _state.value = CameraOcrState.Idle
    }
}
