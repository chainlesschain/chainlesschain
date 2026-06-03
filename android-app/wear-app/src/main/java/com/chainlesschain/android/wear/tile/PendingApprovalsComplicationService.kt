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
import com.chainlesschain.android.wear.WearMainActivity
import com.chainlesschain.android.wear.sync.WearApprovalStore

/**
 * v1.2 #20 P0.2 Wear Phase 3 — watch-face complication 显示当前 pending approval 数。
 *
 * 设计文档 §10 行 "complications: watch face 显示 LongTask running count"。Phase
 * 3 用 pending approval 数代替 LongTask running count（v1.2 后端尚未实现 LongTask
 * 状态推到 watch；以 pending approval 作为最高价值的可用信号）。
 *
 * supportedTypes: SHORT_TEXT（数字 + label 形）。
 * Tap：复用 Tile 的 launch intent 打开 [WearMainActivity]。
 *
 * 自动刷新：与 Tile 同，需要 main thread 主动调
 * `ComplicationDataSourceUpdateRequester.create(ctx, this).requestUpdateAll()`。
 */
class PendingApprovalsComplicationService : SuspendingComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        if (type != ComplicationType.SHORT_TEXT) return null
        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("3").build(),
            contentDescription = PlainComplicationText.Builder("Pending approvals preview").build(),
        )
            .setTitle(PlainComplicationText.Builder("待审批").build())
            .build()
    }

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        if (request.complicationType != ComplicationType.SHORT_TEXT) return null
        val count = WearApprovalStore.pendingCount()
        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(count.toString()).build(),
            contentDescription = PlainComplicationText.Builder(
                if (count == 0) "无待审批" else "$count 条待审批",
            ).build(),
        )
            .setTitle(PlainComplicationText.Builder("待审批").build())
            .setTapAction(buildTapIntent())
            .build()
    }

    private fun buildTapIntent(): PendingIntent {
        val intent = Intent(this, WearMainActivity::class.java).apply {
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
        /** complication target — used by ComplicationDataSourceUpdateRequester. */
        fun componentName(packageName: String) =
            ComponentName(packageName, PendingApprovalsComplicationService::class.java.name)
    }
}
