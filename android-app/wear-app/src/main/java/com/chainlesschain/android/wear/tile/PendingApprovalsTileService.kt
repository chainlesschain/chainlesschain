package com.chainlesschain.android.wear.tile

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Colors
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.chainlesschain.android.wear.WearMainActivity
import com.chainlesschain.android.wear.sync.WearApprovalStore
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import timber.log.Timber

/**
 * v1.2 #20 P0.2 Wear Phase 3 — Wear OS Tile 显示 pending approval 数 + 最新标题。
 *
 * 用户在表盘左划进 Tile carousel 即看到当前待审批数；tap tile 整体打开
 * [WearMainActivity]（不直接进 ApprovalActivity 因为 tile 内不知道用户要点的
 * 是哪一条）。
 *
 * 渲染：仅 protolayout primitives (Text)，避免依赖大 layout 框架。空状态显示
 * 占位字串，pending > 0 时显示数字 + 第一条 title 摘要 (≤20 字符)。
 *
 * 数据刷新：WearApprovalStore 变化时上层（Activity / Listener）需主动调
 * [TileService.getUpdater(context).requestUpdate(PendingApprovalsTileService::class.java)]。
 * 设计上 Tile 是 pull-pull (system 询问 tile 重渲染时序列化最新 timeline)，不像
 * Activity 是 push-push (state flow 触发 recompose)。
 */
class PendingApprovalsTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        return Futures.immediateFuture(buildTile(requestParams.deviceConfiguration))
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> {
        // No image / font resources used; return empty bundle keyed by client
        // version. Protolayout requires the resources future to resolve before
        // tile render, even if empty.
        return Futures.immediateFuture(
            ResourceBuilders.Resources.Builder()
                .setVersion(RESOURCE_VERSION)
                .build(),
        )
    }

    internal fun buildTile(
        deviceParameters: DeviceParametersBuilders.DeviceParameters,
    ): TileBuilders.Tile {
        val pendingCount = WearApprovalStore.pendingCount()
        val latest = WearApprovalStore.requests.value.firstOrNull()

        val titleText = if (pendingCount == 0) "无待审批" else "待审批 $pendingCount"
        val subtitleText = if (pendingCount == 0) {
            "手机推送将显示在此"
        } else {
            (latest?.title ?: "").take(20)
        }

        val titleColumn = LayoutElementBuilders.Column.Builder()
            .setWidth(androidx.wear.protolayout.DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(
                Text.Builder(this, titleText)
                    .setTypography(Typography.TYPOGRAPHY_TITLE2)
                    .setColor(argb(if (pendingCount > 0) Colors.DEFAULT.primary else Colors.DEFAULT.onPrimary))
                    .build(),
            )
            .addContent(
                Text.Builder(this, subtitleText)
                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                    .setColor(argb(Colors.DEFAULT.onPrimary))
                    .setMaxLines(2)
                    .build(),
            )
            .build()

        val launchAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(WearMainActivity::class.java.name)
                    .build(),
            )
            .build()

        val rootBox = LayoutElementBuilders.Box.Builder()
            .setWidth(androidx.wear.protolayout.DimensionBuilders.expand())
            .setHeight(androidx.wear.protolayout.DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("open-main")
                            .setOnClick(launchAction)
                            .build(),
                    )
                    .build(),
            )
            .addContent(titleColumn)
            .build()

        val timeline = TimelineBuilders.Timeline.Builder()
            .addTimelineEntry(
                TimelineBuilders.TimelineEntry.Builder()
                    .setLayout(LayoutElementBuilders.Layout.Builder().setRoot(rootBox).build())
                    .build(),
            )
            .build()

        return TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCE_VERSION)
            .setTileTimeline(timeline)
            .setFreshnessIntervalMillis(FRESHNESS_INTERVAL_MS)
            .build()
    }

    companion object {
        const val RESOURCE_VERSION = "1"
        /** Tile re-render hint to OS — Phase 3 用宽口子 5min；store 变更时
         *  显式 requestUpdate 让 UI 及时刷新，FreshnessInterval 仅兜底。 */
        const val FRESHNESS_INTERVAL_MS = 5 * 60 * 1000L
    }
}
