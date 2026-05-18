package com.chainlesschain.android.feature.ai.data.ocr

/**
 * OCR + KB 写入跨模块通道。feature-ai 不依赖 app，实装在 app 模块包装
 * RemoteCommandClient（ai.ocrImage / knowledge.createNote）。同款套路 VoiceMode。
 */
interface OcrBridge {
    suspend fun recognize(imageBytes: ByteArray, language: String = "auto"): Result<OcrText>
    suspend fun saveNote(
        title: String,
        content: String,
        tags: List<String>? = null,
    ): Result<SavedNote>
}

data class OcrText(val text: String, val language: String, val confidence: Float)

data class SavedNote(val noteId: String)
