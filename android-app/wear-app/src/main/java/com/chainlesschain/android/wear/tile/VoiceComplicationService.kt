package com.chainlesschain.android.wear.tile

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.chainlesschain.android.wear.VoiceForwardActivity

/**
 * #21 C.1 PR3 — Wear OS complication exposing the "Voice" shortcut on any
 * watch face complication slot. Tap fires [VoiceForwardActivity] which
 * dispatches `/cc/voice/start` to the phone (PR2 listener).
 *
 * Pairs with [VoiceShortcutTileService] (tile carousel surface) so users
 * can pick whichever wear surface they prefer:
 *   - Complication: always-visible icon on watch face
 *   - Tile: swipe-accessible big-button page
 *
 * Mirrors [PendingApprovalsComplicationService] structure (SHORT_TEXT;
 * tap launches an activity via PendingIntent). Single canonical text
 * "对话" keeps Wear A.2 §3.1 large-button + ≤4 字符 rule.
 *
 * No async data — this complication has no state; render returns the
 * same content every time. OS-driven refresh cadence is fine; no need to
 * call ComplicationDataSourceUpdateRequester.
 */
class VoiceComplicationService : SuspendingComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        if (type != ComplicationType.SHORT_TEXT) return null
        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("对话").build(),
            contentDescription = PlainComplicationText.Builder(
                "ChainlessChain voice mode shortcut",
            ).build(),
        )
            .setTitle(PlainComplicationText.Builder("语音").build())
            .build()
    }

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("对话").build(),
            contentDescription = PlainComplicationText.Builder(
                "Tap to start voice mode on phone",
            ).build(),
        )
            .setTitle(PlainComplicationText.Builder("语音").build())
            .setTapAction(buildTapIntent())
            .build()
    }

    private fun buildTapIntent(): PendingIntent {
        val intent = Intent(this, VoiceForwardActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    companion object {
        fun componentName(packageName: String) =
            ComponentName(packageName, VoiceComplicationService::class.java.name)
    }
}
