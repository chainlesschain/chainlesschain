package com.chainlesschain.android.wear

import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.ComponentActivity
import com.chainlesschain.android.wear.sync.VoiceForwardStatus
import com.chainlesschain.android.wear.sync.WearVoiceSender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * #21 C.1 PR3 — invisible trampoline activity that sends a wear→phone
 * voice forward and exits immediately. Both [VoiceComplicationService]'s
 * tap PendingIntent and [VoiceShortcutTileService]'s LaunchAction target
 * this activity.
 *
 * UX (per A.2 §3.1 — Wear vibration replaces warning color):
 *   - On launch: 50ms vibration (entry haptic, same as
 *     [WearApprovalActivity.vibrate])
 *   - On send success: no extra vibration (entry tap was enough; phone
 *     will buzz when VoiceMode opens)
 *   - On send failure: 100ms double-vibration (longer entry signals "fail")
 *
 * No UI is shown — `setContent` is skipped and `finish()` is called from
 * `onCreate` after async dispatch starts. Wear UI staying minimal aligns
 * with §3.1 single-column / large-button principle (no full-screen modal
 * needed for a fire-and-forget action).
 *
 * If the send takes > 2s the activity will still have exited; the callback
 * just logs the result. Phone-side will receive on its own timeline.
 */
class VoiceForwardActivity : ComponentActivity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Timber.i("VoiceForwardActivity: tapped, dispatching wear→phone forward")
        vibrate(durationMs = 50)
        val sender = WearVoiceSender(this)
        scope.launch {
            val result = sender.send()
            when (result.status) {
                VoiceForwardStatus.OK -> {
                    Timber.i(
                        "VoiceForwardActivity: forward OK reqId=${result.clientRequestId} node=${result.targetNodeId}",
                    )
                }
                VoiceForwardStatus.NO_PHONE -> {
                    Timber.w("VoiceForwardActivity: NO_PHONE — phone disconnected")
                    vibrate(durationMs = 100)
                }
                VoiceForwardStatus.SEND_FAIL -> {
                    Timber.w("VoiceForwardActivity: SEND_FAIL — message dispatch failed")
                    vibrate(durationMs = 100)
                }
            }
        }
        // Exit immediately — the async send completes (or fails) regardless.
        finish()
    }

    @Suppress("DEPRECATION")
    private fun vibrate(durationMs: Long) {
        val effect = VibrationEffect.createOneShot(
            durationMs, VibrationEffect.DEFAULT_AMPLITUDE,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator.vibrate(effect)
        } else {
            val v = getSystemService(VIBRATOR_SERVICE) as Vibrator
            v.vibrate(effect)
        }
    }
}
