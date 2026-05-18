package com.chainlesschain.android.capture.share

/**
 * 来自其它 app 通过 Intent.ACTION_SEND 分享过来的内容载荷。
 *
 * 设计文档 v0.2 §5.3 L2 ShareReceiver：跨 app 分享文本 / 图片 / 链接到 KB Inbox。
 *
 * 由 [IntentPayloadParser.parse] 从 [IntentExtracts] 解析得到，再由
 * [SharedInboxRepository] 暂存等待 SyncCoordinator 30s 推送上桌面 KB。
 */
sealed interface SharePayload {
    val timestampMs: Long
    val subject: String?

    /** 纯文本（含可能的剪贴板内容、社交媒体复制的文字段落等）。 */
    data class Text(
        val text: String,
        override val subject: String?,
        override val timestampMs: Long,
    ) : SharePayload {
        init {
            require(text.isNotEmpty()) { "Text payload must not be empty" }
        }
    }

    /** 看起来像 URL 的文本（http/https/ipfs/did/ftp/file），用于书签 / 链接收藏。 */
    data class Url(
        val url: String,
        override val subject: String?,
        override val timestampMs: Long,
    ) : SharePayload {
        init {
            require(url.isNotBlank()) { "URL must not be blank" }
        }
    }

    /** 单图（来自相册 / 截图）。`uri` 为 ContentResolver Uri 的字符串表示。 */
    data class SingleImage(
        val uri: String,
        val mimeType: String,
        override val subject: String?,
        override val timestampMs: Long,
    ) : SharePayload {
        init {
            require(uri.isNotBlank()) { "Image URI must not be blank" }
            require(mimeType.startsWith("image/")) { "MIME type must start with image/: $mimeType" }
        }
    }

    /** 多图（ACTION_SEND_MULTIPLE）。 */
    data class MultiImage(
        val uris: List<String>,
        val mimeType: String,
        override val subject: String?,
        override val timestampMs: Long,
    ) : SharePayload {
        init {
            require(uris.isNotEmpty()) { "MultiImage must have at least one URI" }
            require(uris.all { it.isNotBlank() }) { "All URIs must be non-blank" }
            require(mimeType.startsWith("image/")) { "MIME type must start with image/: $mimeType" }
        }
    }

    /** 通用文件（非 image）：ACTION_SEND 带任意 mimeType 的二进制流。 */
    data class GenericFile(
        val uri: String,
        val mimeType: String,
        override val subject: String?,
        override val timestampMs: Long,
    ) : SharePayload {
        init {
            require(uri.isNotBlank()) { "File URI must not be blank" }
            require(mimeType.isNotBlank()) { "MIME type must not be blank" }
        }
    }
}
