package com.chainlesschain.android.wear.sync

import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.chainlesschain.android.wear.tile.PendingApprovalsComplicationService
import com.chainlesschain.android.wear.tile.PendingApprovalsTileService
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * v1.2 #20 P0.2 Wear Phase 1 — 接收 phone → watch Wearable Data Layer message。
 *
 * 协议（[ApprovalRequest.PATH_PUSH]）：
 *   - phone 把 multisig propose / NotificationCenter 大额 push 序列化为
 *     [ApprovalRequest] JSON，通过 `MessageClient.sendMessage(nodeId, "/cc/push",
 *     bytes)` 发到所有已配对 watch 节点
 *   - 本 service onMessageReceived 解析 → upsert 到 [WearApprovalStore]
 *
 * Watch → phone 决策回传走 [WearApprovalSender]（Phase 2），不在本 service。
 *
 * Manifest 注册（Phase 1 commit）必须含 intent-filter "com.google.android.gms.wearable.MESSAGE_RECEIVED"
 * + pathPrefix "/cc/" — 否则 phone 端 sendMessage 后 watch 端不触发 onMessageReceived。
 */
class CcWearListenerService : WearableListenerService() {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        val path = messageEvent.path
        val raw = runCatching { messageEvent.data.toString(Charsets.UTF_8) }
            .getOrElse {
                Timber.w(it, "CcWearListenerService: data utf-8 decode failed (path=$path)")
                return
            }
        Timber.d("CcWearListenerService.onMessageReceived: path=$path len=${raw.length}")

        when (path) {
            ApprovalRequest.PATH_PUSH -> handlePush(raw)
            else -> Timber.w("CcWearListenerService: ignored unknown path $path")
        }
    }

    private fun handlePush(raw: String) {
        val req = runCatching { json.decodeFromString<ApprovalRequest>(raw) }
            .getOrElse {
                Timber.w(it, "CcWearListenerService.handlePush: malformed payload")
                return
            }
        WearApprovalStore.upsert(req)
        notifyTileAndComplication()
    }

    /**
     * Phase 3: store 变化时主动刷 Tile + Complication（system 不会自动 redraw
     * 直到下次 freshness interval 过；推送场景必须立即更）。失败吞并 — 通知
     * 链上 system 服务不可用，下次 system 主动询问时仍会读最新 store。
     */
    private fun notifyTileAndComplication() {
        runCatching {
            TileService.getUpdater(applicationContext)
                .requestUpdate(PendingApprovalsTileService::class.java)
        }.onFailure { Timber.w(it, "Tile update request failed") }

        runCatching {
            ComplicationDataSourceUpdateRequester.create(
                applicationContext,
                PendingApprovalsComplicationService.componentName(packageName),
            ).requestUpdateAll()
        }.onFailure { Timber.w(it, "Complication update request failed") }
    }
}
