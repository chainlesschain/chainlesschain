package com.chainlesschain.android.capture.share

/**
 * 从已抽取的 Intent 字段构建 [SharePayload]。
 *
 * 引入 [IntentExtracts] 中间结构的目的：让 parser 是纯函数，不依赖 Android
 * 框架类型（Intent / Uri / Bundle），可在 JVM 单测里直接验证逻辑。
 * Android 适配层（ShareReceiverActivity）负责把真实 Intent 拆成 IntentExtracts。
 *
 * 解析优先级（设计文档 §5.3 决策点）：
 *  1. 多图 ACTION_SEND_MULTIPLE -> [SharePayload.MultiImage]
 *  2. 有 streamUri + mimeType 以 image 开头 -> [SharePayload.SingleImage]
 *  3. 有 streamUri + 其它 mimeType -> [SharePayload.GenericFile]
 *  4. 文本看起来像 URL -> [SharePayload.Url]
 *  5. 普通文本 -> [SharePayload.Text]
 *  6. 都没有 -> null（不入 Inbox）
 *
 * 注意：subject（EXTRA_SUBJECT）在所有形态里都是可选的可携带字段，不影响优先级判定。
 */
object IntentPayloadParser {

    /** Android-free intent extracts; ShareReceiverActivity 负责从真实 Intent 抽出。 */
    data class IntentExtracts(
        val action: String?,
        val mimeType: String?,
        val text: String?,
        val subject: String?,
        val streamUris: List<String>,
        val timestampMs: Long,
    )

    /** 解析；不能解析为有效 payload 时返回 null。 */
    fun parse(extracts: IntentExtracts): SharePayload? {
        val action = extracts.action
        if (action != ACTION_SEND && action != ACTION_SEND_MULTIPLE) return null

        val mime = extracts.mimeType ?: ""

        // 多图优先
        if (action == ACTION_SEND_MULTIPLE && extracts.streamUris.size >= 2) {
            val effectiveMime = if (mime.startsWith("image/")) mime else FALLBACK_IMAGE_MIME
            return runCatching {
                SharePayload.MultiImage(
                    uris = extracts.streamUris,
                    mimeType = effectiveMime,
                    subject = extracts.subject,
                    timestampMs = extracts.timestampMs,
                )
            }.getOrNull()
        }

        // 单 stream
        val singleUri = extracts.streamUris.firstOrNull()
        if (singleUri != null && singleUri.isNotBlank()) {
            return if (mime.startsWith("image/")) {
                runCatching {
                    SharePayload.SingleImage(
                        uri = singleUri,
                        mimeType = mime,
                        subject = extracts.subject,
                        timestampMs = extracts.timestampMs,
                    )
                }.getOrNull()
            } else {
                runCatching {
                    SharePayload.GenericFile(
                        uri = singleUri,
                        mimeType = if (mime.isNotBlank()) mime else FALLBACK_FILE_MIME,
                        subject = extracts.subject,
                        timestampMs = extracts.timestampMs,
                    )
                }.getOrNull()
            }
        }

        // 纯文本路径
        val text = extracts.text?.trim().orEmpty()
        if (text.isEmpty()) return null

        return if (looksLikeUrl(text)) {
            runCatching {
                SharePayload.Url(text, extracts.subject, extracts.timestampMs)
            }.getOrNull()
        } else {
            runCatching {
                SharePayload.Text(text, extracts.subject, extracts.timestampMs)
            }.getOrNull()
        }
    }

    private fun looksLikeUrl(s: String): Boolean {
        if (s.contains(" ") || s.contains("\n")) return false
        return URL_PREFIXES.any { s.startsWith(it, ignoreCase = true) }
    }

    private const val ACTION_SEND = "android.intent.action.SEND"
    private const val ACTION_SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"
    private const val FALLBACK_IMAGE_MIME = "image/*"
    private const val FALLBACK_FILE_MIME = "application/octet-stream"
    private val URL_PREFIXES = listOf("http://", "https://", "ipfs://", "did:", "ftp://", "file://")
}
