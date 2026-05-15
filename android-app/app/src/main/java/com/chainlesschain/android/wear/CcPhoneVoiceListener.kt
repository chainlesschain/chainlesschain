package com.chainlesschain.android.wear

import android.content.Context
import android.content.Intent
import com.chainlesschain.android.voice.VoiceLaunchActions
import com.chainlesschain.android.voice.VoiceTriggerSource
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * #21 C.1 PR2 — phone-side Data Layer listener for wear → phone voice
 * forwarding. Mirrors [CcPhoneDecisionListener]'s `/cc/decision` pattern.
 *
 * Message path: `/cc/voice/start` (wear → phone via [MessageClient]).
 * Payload (UTF-8 JSON, [VoiceForwardWire]):
 *
 * ```json
 * {
 *   "trigger_source": "wear_forward",
 *   "wear_node_id": "<wear-device-node-id>",
 *   "client_request_id": "voice-<ts>-<rand>",
 *   "issued_at_ms": 1715750000000
 * }
 * ```
 *
 * Pipeline: parse → build Intent via [VoiceLaunchActions.buildIntent] →
 * `startActivity` with `FLAG_ACTIVITY_NEW_TASK` (required from
 * non-Activity context). MainActivity's `onCreate` / `onNewIntent` picks
 * up the action + extras and navigates to Screen.VoiceMode (PR1 work).
 *
 * Why exact path (not the `/cc/` prefix shared by CcPhoneDecisionListener):
 * Wear→phone services are looked up by intent-filter; we want this listener
 * to only fire for voice forwards. The decision listener already filters
 * out unknown paths internally, but exact match avoids unnecessary service
 * wakeups for /cc/decision traffic.
 *
 * Spike doc: docs/design/C1_WatchFace_VoiceMode_spike.md §5 (PR2 design)
 */
@AndroidEntryPoint
class CcPhoneVoiceListener : WearableListenerService() {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        if (messageEvent.path != PATH_VOICE_START) {
            // Manifest filter is exact-match for /cc/voice/start so this should
            // not normally fire, but be defensive in case future prefix-match
            // is added.
            return
        }
        val raw = runCatching { messageEvent.data.toString(Charsets.UTF_8) }
            .getOrElse {
                Timber.w(it, "CcPhoneVoiceListener: utf-8 decode failed")
                return
            }
        val wire = runCatching { json.decodeFromString<VoiceForwardWire>(raw) }
            .getOrElse {
                Timber.w(it, "CcPhoneVoiceListener: malformed payload: $raw")
                return
            }
        Timber.i(
            "CcPhoneVoiceListener: wear-forward voice trigger node=${wire.wear_node_id} reqId=${wire.client_request_id}",
        )
        startVoiceActivity(this, wire)
    }

    companion object {
        /** Mirror wear-app/sync/ApprovalRequest.PATH_DECISION naming convention. */
        const val PATH_VOICE_START = "/cc/voice/start"

        /**
         * Build the Intent + start the VoiceMode launch flow. Extracted so
         * tests can drive it without spinning up the full service lifecycle.
         */
        internal fun startVoiceActivity(context: Context, wire: VoiceForwardWire) {
            val intent = VoiceLaunchActions.buildIntent(
                // Wear-forward source is locked regardless of what payload claims —
                // an attacker on the wear-side cannot escalate to AUTO_BUTTON /
                // PHONE_SHORTCUT etc. via this listener.
                source = VoiceTriggerSource.WEAR_FORWARD,
                clientRequestId = wire.client_request_id,
            )
            intent.setPackage(context.packageName)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            // Android 12+: FLAG_ACTIVITY_RESET_TASK_IF_NEEDED + NEW_TASK avoid
            // landing on a stale back-stack when the user repeatedly forwards
            // voice from wear over a short window.
            intent.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            runCatching { context.startActivity(intent) }
                .onFailure {
                    Timber.w(
                        it,
                        "CcPhoneVoiceListener: startActivity failed (reqId=${wire.client_request_id})",
                    )
                }
        }
    }
}

/**
 * Phone-side wire-format mirror of the wear→phone voice forward payload.
 * Mirrors the [CcPhoneDecisionListener.ApprovalDecisionWire] pattern —
 * kept local so `:app` does not depend on `:wear-app` (separate APKs).
 *
 * Field names use snake_case to match the wear-side `WearVoiceSender`
 * serialization (PR3 will produce these on wear; PR2 just parses).
 *
 * Note: `trigger_source` is informational only — see
 * [CcPhoneVoiceListener.Companion.startVoiceActivity] for why we lock to
 * [VoiceTriggerSource.WEAR_FORWARD] regardless of payload contents.
 */
@Serializable
data class VoiceForwardWire(
    val trigger_source: String? = null,
    val wear_node_id: String? = null,
    val client_request_id: String? = null,
    val issued_at_ms: Long? = null,
)
