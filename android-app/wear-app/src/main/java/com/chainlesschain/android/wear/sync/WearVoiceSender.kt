package com.chainlesschain.android.wear.sync

import android.content.Context
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID

/**
 * #21 C.1 PR3 — wear → phone voice forward sender.
 *
 * Pairs with phone-side `CcPhoneVoiceListener` (PR2). Mirrors the
 * [WearDecisionSender] pattern:
 *   - encode payload as utf-8 JSON
 *   - look up connected phone node(s) via NodeClient
 *   - sendMessage on path [PATH_VOICE_START]
 *   - phone listener parses → builds Intent → startActivity(VoiceMode)
 *
 * Trigger surfaces (PR3 UI):
 *   - [com.chainlesschain.android.wear.tile.VoiceComplicationService]
 *   - [com.chainlesschain.android.wear.tile.VoiceShortcutTileService]
 *
 * Failure modes (returned by [Result] codes for caller toasts):
 *   - NO_PHONE — connectedNodes lookup failed or empty (phone offline)
 *   - SEND_FAIL — message dispatch failed on every node
 *   - OK — at least one node accepted the message
 *
 * Cross-ref:
 *   - Phone-side path: app/src/main/.../wear/CcPhoneVoiceListener.kt PATH_VOICE_START
 *   - Intent surface: app/src/main/.../voice/VoiceLaunchActions.kt
 *   - Spike doc: docs/design/C1_WatchFace_VoiceMode_spike.md §5 (PR3 design)
 */
class WearVoiceSender(private val context: Context) {

    private val json = Json { encodeDefaults = false }

    /**
     * Send a voice-start forward to all connected phone nodes.
     *
     * @param clientRequestId optional — caller can omit to let sender generate
     *   a "voice-<ts>-<rand>" id matching the spike doc §5 payload shape.
     * @return [VoiceForwardResult] with status code for caller-side UX
     *   (vibration / toast / haptic).
     */
    suspend fun send(clientRequestId: String? = null): VoiceForwardResult {
        val nodeClient = Wearable.getNodeClient(context)
        val nodes = runCatching { nodeClient.connectedNodes.await() }
            .getOrElse {
                Timber.w(it, "WearVoiceSender: connectedNodes lookup failed")
                return VoiceForwardResult(VoiceForwardStatus.NO_PHONE, null, null)
            }
        if (nodes.isEmpty()) {
            Timber.w("WearVoiceSender: no connected phone node — voice forward dropped")
            return VoiceForwardResult(VoiceForwardStatus.NO_PHONE, null, null)
        }
        val now = System.currentTimeMillis()
        val firstNodeId = nodes.first().id
        val payload = VoiceForwardPayload(
            trigger_source = "wear_forward",
            wear_node_id = firstNodeId,
            client_request_id = clientRequestId ?: "voice-$now-${UUID.randomUUID().toString().take(8)}",
            issued_at_ms = now,
        )
        val bytes = json.encodeToString(VoiceForwardPayload.serializer(), payload)
            .toByteArray(Charsets.UTF_8)
        val client = Wearable.getMessageClient(context)
        var ok = false
        for (node in nodes) {
            val result = runCatching {
                client.sendMessage(node.id, PATH_VOICE_START, bytes).await()
            }
            result.onSuccess {
                ok = true
                Timber.i("WearVoiceSender → ${node.id} OK reqId=${payload.client_request_id}")
            }
            result.onFailure {
                Timber.w(it, "WearVoiceSender → ${node.id} FAIL")
            }
        }
        return if (ok) {
            VoiceForwardResult(VoiceForwardStatus.OK, payload.client_request_id, firstNodeId)
        } else {
            VoiceForwardResult(VoiceForwardStatus.SEND_FAIL, payload.client_request_id, firstNodeId)
        }
    }

    companion object {
        /** Mirror of `CcPhoneVoiceListener.PATH_VOICE_START`. */
        const val PATH_VOICE_START = "/cc/voice/start"
    }
}

/**
 * Status enum for [WearVoiceSender.send]. UI callers map to vibration +
 * toast per A.2 §3.1 (wear vibration replaces warning color):
 *   OK         → 50ms vibration + brief "已发送" toast
 *   NO_PHONE   → 100ms vibration + "请打开手机 ChainlessChain"
 *   SEND_FAIL  → 100ms vibration + "发送失败"
 */
enum class VoiceForwardStatus { OK, NO_PHONE, SEND_FAIL }

/**
 * Result wrapper so caller can correlate logs with client_request_id and
 * know which node received the forward.
 */
data class VoiceForwardResult(
    val status: VoiceForwardStatus,
    val clientRequestId: String?,
    val targetNodeId: String?,
)

/**
 * Wire-format mirror of phone-side `VoiceForwardWire`. snake_case names
 * match the phone serializer; nullable so partial payloads are tolerated.
 *
 * Kept local (not shared with :app) per WearDecisionSender pattern — wear
 * and phone ship as separate APKs, sync via Data Layer protocol only.
 */
@Serializable
data class VoiceForwardPayload(
    val trigger_source: String,
    val wear_node_id: String,
    val client_request_id: String,
    val issued_at_ms: Long,
)
