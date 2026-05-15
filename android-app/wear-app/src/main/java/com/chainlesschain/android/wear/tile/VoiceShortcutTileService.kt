package com.chainlesschain.android.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders
import androidx.wear.protolayout.DimensionBuilders
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
import com.chainlesschain.android.wear.VoiceForwardActivity
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * #21 C.1 PR3 — full-page Wear tile that forwards a voice trigger to the
 * phone on tap. Sits next to [PendingApprovalsTileService] in the tile
 * carousel; users add it via the watch face tile editor.
 *
 * Layout (single column, centered, A.2 §3.1 compliant):
 *   - Top: "语音" (Typography TITLE1)
 *   - Center: "对话" (large tap target, Typography DISPLAY1 if available)
 *
 * Whole-tile clickable area → launches [VoiceForwardActivity] (which sends
 * via WearVoiceSender then exits). No internal state; tile is static.
 *
 * Freshness interval = 1 day — the tile content never changes, so we don't
 * need to ask the OS to re-render frequently. Setting a long interval saves
 * battery vs the 5-min default used by data-driven tiles.
 *
 * Pairs with [VoiceComplicationService] for users who prefer a complication
 * slot over a tile page.
 */
class VoiceShortcutTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        return Futures.immediateFuture(buildTile(requestParams.deviceConfiguration))
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> {
        return Futures.immediateFuture(
            ResourceBuilders.Resources.Builder()
                .setVersion(RESOURCE_VERSION)
                .build(),
        )
    }

    internal fun buildTile(
        deviceParameters: DeviceParametersBuilders.DeviceParameters,
    ): TileBuilders.Tile {
        val launchAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(packageName)
                    .setClassName(VoiceForwardActivity::class.java.name)
                    .build(),
            )
            .build()

        val column = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(
                Text.Builder(this, "语音")
                    .setTypography(Typography.TYPOGRAPHY_TITLE2)
                    .setColor(argb(Colors.DEFAULT.onPrimary))
                    .build(),
            )
            .addContent(
                Text.Builder(this, "对话")
                    .setTypography(Typography.TYPOGRAPHY_TITLE1)
                    .setColor(argb(Colors.DEFAULT.primary))
                    .build(),
            )
            .addContent(
                Text.Builder(this, "tap → 手机")
                    .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                    .setColor(argb(Colors.DEFAULT.onSurface))
                    .build(),
            )
            .build()

        val rootBox = LayoutElementBuilders.Box.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("voice-forward")
                            .setOnClick(launchAction)
                            .build(),
                    )
                    .build(),
            )
            .addContent(column)
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
        /** Tile content is static — refresh once a day is plenty. */
        const val FRESHNESS_INTERVAL_MS = 24 * 60 * 60 * 1000L
    }
}
