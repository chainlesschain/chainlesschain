package com.chainlesschain.android.capture.share

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber
import javax.inject.Inject

/**
 * 处理来自其它 app 的 Intent.ACTION_SEND / ACTION_SEND_MULTIPLE 分享。
 *
 * 设计：Activity 仅做"提取 + 入队 + 立即 finish"，不显示 UI。用户从其它 app 选
 * ChainlessChain → 这个 Activity 启动 → 解析 Intent → enqueue 到 [SharedInboxRepository]
 * → finish。后续 SyncCoordinator 在下个 30s 循环把队列 push 到桌面 KB。
 *
 * 必要时（如用户首次启动需要先解锁 DID）才弹 BiometricGate。M3 D-share 范围内不做。
 *
 * 见 AndroidManifest.xml 中的 `<intent-filter>`。
 */
@AndroidEntryPoint
class ShareReceiverActivity : ComponentActivity() {

    @Inject lateinit var inbox: SharedInboxRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val payload = parseIncoming(intent)
        if (payload != null) {
            val size = inbox.enqueue(payload)
            Timber.i("Share enqueued: %s (inbox size=%d)", payload.javaClass.simpleName, size)
        } else {
            Timber.w("Share intent had no parseable payload: action=%s type=%s", intent.action, intent.type)
        }
        finish()
    }

    private fun parseIncoming(intent: Intent?): SharePayload? {
        if (intent == null) return null
        return IntentPayloadParser.parse(extractFromIntent(intent))
    }

    /** Convert a real Intent to the Android-free [IntentPayloadParser.IntentExtracts]. */
    private fun extractFromIntent(intent: Intent): IntentPayloadParser.IntentExtracts {
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()
        val streamUris = when (intent.action) {
            Intent.ACTION_SEND_MULTIPLE -> {
                @Suppress("DEPRECATION")
                (intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList())
                    .map { it.toString() }
            }
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val uri: Uri? = intent.getParcelableExtra(Intent.EXTRA_STREAM)
                listOfNotNull(uri?.toString())
            }
            else -> emptyList()
        }
        return IntentPayloadParser.IntentExtracts(
            action = intent.action,
            mimeType = intent.type,
            text = text,
            subject = subject,
            streamUris = streamUris,
            timestampMs = System.currentTimeMillis(),
        )
    }
}
