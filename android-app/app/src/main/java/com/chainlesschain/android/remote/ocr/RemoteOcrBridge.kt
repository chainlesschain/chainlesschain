package com.chainlesschain.android.remote.ocr

import android.util.Base64
import com.chainlesschain.android.feature.ai.data.ocr.OcrBridge
import com.chainlesschain.android.feature.ai.data.ocr.OcrText
import com.chainlesschain.android.feature.ai.data.ocr.SavedNote
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.KnowledgeCommands
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * CameraOCR REMOTE 桥实装。包 [AICommands.ocrImage]（base64 编码）+
 * [KnowledgeCommands.createNote]，让 feature-ai 不直接依赖 app 模块。
 */
@Singleton
class RemoteOcrBridge @Inject constructor(
    private val aiCommands: AICommands,
    private val knowledgeCommands: KnowledgeCommands,
) : OcrBridge {

    override suspend fun recognize(imageBytes: ByteArray, language: String): Result<OcrText> {
        if (imageBytes.isEmpty()) {
            return Result.failure(IllegalArgumentException("空字节数组无法识别"))
        }
        val base64 = try {
            Base64.encodeToString(imageBytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            Timber.e(e, "RemoteOcrBridge.recognize: base64 encode failed")
            return Result.failure(e)
        }
        val r = aiCommands.ocrImage(imageData = base64, language = language)
        return r.mapCatching { resp ->
            if (!resp.success) {
                throw IllegalStateException("桌面 OCR 返回 success=false")
            }
            // confidence 字段在 OCRResponse 声明为 Float 但 compile-site 推断为 Double，
            // 触发 "Type mismatch: inferred type is Double but Float was expected"。原因
            // 不明（OCRResponse 全仓只一处定义，无 stub 覆盖）。`as Number` + toFloat() 强制
            // 收敛，运行期两种 numeric 都安全。
            OcrText(
                text = resp.text,
                language = resp.language,
                confidence = (resp.confidence as Number).toFloat(),
            )
        }
    }

    override suspend fun saveNote(
        title: String,
        content: String,
        tags: List<String>?,
    ): Result<SavedNote> {
        val r = knowledgeCommands.createNote(
            title = title,
            content = content,
            tags = tags,
        )
        return r.mapCatching { resp ->
            if (!resp.success) {
                throw IllegalStateException("KB createNote 返回 success=false: ${resp.message}")
            }
            SavedNote(noteId = resp.noteId)
        }
    }
}
