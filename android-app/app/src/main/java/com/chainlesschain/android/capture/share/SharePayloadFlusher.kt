package com.chainlesschain.android.capture.share

import com.chainlesschain.android.remote.commands.KnowledgeCommands
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 把 [SharedInboxRepository] 暂存的 [SharePayload] 转成桌面 knowledge.createNote 调用。
 *
 * M3 D2 ShareReceiver 收尾：be6cb4974 落地 SharedInboxRepository + ShareReceiverActivity
 * 后，缺最后一公里 — 把 Inbox 推上桌面 KB。本类由 [com.chainlesschain.android.sync.SyncCoordinator]
 * 30s push 循环末尾调用，与既有 syncManager.pushPendingToDesktopRpc 并列。
 *
 * 失败策略：drain 后逐条尝试，失败的 payload 通过 [SharedInboxRepository.enqueue] re-enqueue
 * 等下轮。返回 [FlushSummary] 让调用方记录指标。
 */
@Singleton
class SharePayloadFlusher @Inject constructor(
    private val inbox: SharedInboxRepository,
    private val knowledgeCommands: KnowledgeCommands,
) {

    /**
     * 把所有 Inbox 项推上桌面 KB。每条独立 try/catch；失败的 re-enqueue 等下轮。
     */
    suspend fun flushAll(): FlushSummary {
        val drained = inbox.drain()
        if (drained.isEmpty()) return FlushSummary.EMPTY
        var pushed = 0
        val failed = mutableListOf<SharePayload>()

        for (payload in drained) {
            val req = toCreateNoteRequest(payload)
            try {
                val r = knowledgeCommands.createNote(
                    title = req.title,
                    content = req.content,
                    tags = req.tags,
                )
                if (r.isSuccess) {
                    pushed++
                } else {
                    Timber.w(
                        r.exceptionOrNull(),
                        "SharePayloadFlusher: createNote failed for %s",
                        payload::class.simpleName,
                    )
                    failed.add(payload)
                }
            } catch (e: Exception) {
                Timber.w(e, "SharePayloadFlusher: createNote threw for %s", payload::class.simpleName)
                failed.add(payload)
            }
        }
        // re-enqueue 失败项（保持 FIFO 大致顺序，超出 MAX_ENTRIES 时 SharedInboxRepository 自然滑窗）
        for (p in failed) inbox.enqueue(p)
        return FlushSummary(pushed = pushed, failed = failed.size, total = drained.size)
    }

    data class FlushSummary(val pushed: Int, val failed: Int, val total: Int) {
        companion object {
            val EMPTY = FlushSummary(0, 0, 0)
        }
    }

    /** payload → note 字段转换。可见以便单测。 */
    internal data class CreateNoteRequest(
        val title: String,
        val content: String,
        val tags: List<String>,
    )

    internal companion object {
        fun toCreateNoteRequest(payload: SharePayload): CreateNoteRequest = when (payload) {
            is SharePayload.Text -> CreateNoteRequest(
                title = payload.subject.orDefault("Shared text"),
                content = payload.text,
                tags = listOf("shared", "text"),
            )
            is SharePayload.Url -> CreateNoteRequest(
                title = payload.subject.orDefault(shortenForTitle(payload.url)),
                content = "[${payload.url}](${payload.url})",
                tags = listOf("shared", "url", "bookmark"),
            )
            is SharePayload.SingleImage -> CreateNoteRequest(
                title = payload.subject.orDefault("Shared image"),
                content = "![](${payload.uri})\n\n_mime: ${payload.mimeType}_",
                tags = listOf("shared", "image"),
            )
            is SharePayload.MultiImage -> CreateNoteRequest(
                title = payload.subject.orDefault("Shared ${payload.uris.size} images"),
                content = buildString {
                    for (u in payload.uris) appendLine("![]($u)")
                    appendLine()
                    append("_mime: ${payload.mimeType}_")
                },
                tags = listOf("shared", "image", "batch"),
            )
            is SharePayload.GenericFile -> CreateNoteRequest(
                title = payload.subject.orDefault(fileNameFromUri(payload.uri) ?: "Shared file"),
                content = "📎 [${fileNameFromUri(payload.uri) ?: payload.uri}](${payload.uri})\n\n_mime: ${payload.mimeType}_",
                tags = listOf("shared", "file"),
            )
        }

        private fun String?.orDefault(fallback: String): String =
            this?.takeIf { it.isNotBlank() } ?: fallback

        private fun shortenForTitle(url: String): String {
            // 取 host + path（最多 60 字符），剥协议
            val stripped = url.removePrefix("https://").removePrefix("http://").removePrefix("ipfs://")
            return if (stripped.length <= 60) stripped else stripped.take(57) + "..."
        }

        private fun fileNameFromUri(uri: String): String? {
            // 跳过 scheme://authority 部分；只取 path 的最后段
            val schemeIdx = uri.indexOf("://")
            val pathStart = if (schemeIdx >= 0) {
                val firstSlash = uri.indexOf('/', schemeIdx + 3)
                if (firstSlash < 0) return null  // authority-only, 无 path
                firstSlash + 1
            } else 0
            val rest = uri.substring(pathStart)
            if (rest.isBlank()) return null
            val lastSlash = rest.lastIndexOf('/')
            val tail = if (lastSlash < 0) rest else rest.substring(lastSlash + 1)
            // 去 query string
            val q = tail.indexOf('?')
            val cleaned = if (q < 0) tail else tail.substring(0, q)
            return cleaned.takeIf { it.isNotBlank() }
        }
    }
}
