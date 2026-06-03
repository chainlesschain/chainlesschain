package com.chainlesschain.android.voice

import android.content.Intent

/**
 * #21 B.1 C.1 PR1 — Generic Android Intent surface for launching the phone
 * VoiceMode screen from external entry points (wear forward, phone shortcut,
 * Auto cross-over button, third-party apps).
 *
 * Why this exists: Phone `presentation/screens/voice/VoiceModeScreen.kt` is
 * an orphan composable (no NavGraph entry, no BottomNav). To wire it up
 * uniformly across surfaces, we define a single Intent action plus a typed
 * trigger source so the receiving side can attribute the entry (analytics +
 * eventual rate-limiting in PR2 wear-forward path).
 *
 * Spike doc: docs/design/C1_WatchFace_VoiceMode_spike.md
 */
object VoiceLaunchActions {

    /**
     * Reverse-DNS scoped to avoid collision with carrier/system voice actions
     * (Google Voice / Wearable Voice Search etc.). Used as
     * `<intent-filter><action android:name="..." /></intent-filter>` in
     * AndroidManifest.xml + as the action string on programmatic
     * `Intent(ACTION_START_VOICE_MODE)`.
     */
    const val ACTION_START_VOICE_MODE =
        "com.chainlesschain.android.action.START_VOICE_MODE"

    /**
     * String extra carrying the [VoiceTriggerSource.wireValue]. Receivers
     * parse via [extractTriggerSource].
     */
    const val EXTRA_TRIGGER_SOURCE = "cc.voice.trigger_source"

    /**
     * Optional opaque client request id (PR2 wear forward populates this so
     * phone listener can correlate logs).
     */
    const val EXTRA_CLIENT_REQUEST_ID = "cc.voice.client_request_id"

    /**
     * Build an Intent ready for startActivity. Caller still needs to add
     * `FLAG_ACTIVITY_NEW_TASK` when launching from non-Activity context
     * (e.g. WearableListenerService in PR2).
     */
    fun buildIntent(
        source: VoiceTriggerSource,
        clientRequestId: String? = null,
    ): Intent {
        val intent = Intent(ACTION_START_VOICE_MODE)
        intent.putExtra(EXTRA_TRIGGER_SOURCE, source.wireValue)
        if (clientRequestId != null) {
            intent.putExtra(EXTRA_CLIENT_REQUEST_ID, clientRequestId)
        }
        return intent
    }

    /**
     * Parse the trigger source from an arbitrary incoming intent. Returns
     * null when the intent action does not match [ACTION_START_VOICE_MODE]
     * (caller can ignore non-voice intents). Returns [VoiceTriggerSource]
     * (defaulting to EXTERNAL when no extra) when action matches.
     */
    fun extractTriggerSource(intent: Intent?): VoiceTriggerSource? {
        if (intent == null) return null
        if (intent.action != ACTION_START_VOICE_MODE) return null
        val wire = intent.getStringExtra(EXTRA_TRIGGER_SOURCE)
        return VoiceTriggerSource.fromWireValue(wire)
    }
}

/**
 * Where the voice-mode launch came from. Used for analytics and (eventual)
 * differentiated UX (e.g. wear forward could auto-start recording, phone
 * shortcut requires user tap on mic — see PR3 design note).
 */
enum class VoiceTriggerSource(val wireValue: String) {
    /** App icon long-press shortcut / Quick Settings tile (future). */
    PHONE_SHORTCUT("phone_shortcut"),

    /** Auto VoiceModeScreen "switch back to phone" button (future). */
    AUTO_BUTTON("auto_button"),

    /** Wear complication/tile/watch-face forwarded via Data Layer (PR2/PR3). */
    WEAR_FORWARD("wear_forward"),

    /** Third-party app (Tasker, Shortcuts, etc.) — default fallback. */
    EXTERNAL("external");

    companion object {
        /**
         * Parse a wireValue back to a source. Unknown / null values fall
         * back to EXTERNAL so an attacker-supplied bogus extra cannot e.g.
         * masquerade as WEAR_FORWARD to bypass any future privilege gates.
         */
        fun fromWireValue(wire: String?): VoiceTriggerSource {
            if (wire == null) return EXTERNAL
            return entries.firstOrNull { it.wireValue == wire } ?: EXTERNAL
        }
    }
}
