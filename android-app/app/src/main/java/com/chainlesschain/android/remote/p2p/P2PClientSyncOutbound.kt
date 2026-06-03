package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncOutbound
import com.chainlesschain.android.core.p2p.sync.SyncPullResponse
import com.chainlesschain.android.core.p2p.sync.SyncPushResponse
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * SyncOutbound impl that wraps P2PClient.sendCommand (Phase 3d M3 step D.5).
 *
 * 把 SyncManager 的出向 RPC 调用映射成 chainlesschain:command:request
 * 走 WebRTC DataChannel 发到 PC 桌面。Result 由 P2PClient.sendCommand 通过
 * pendingRequests + COMMAND_RESPONSE 自动等待并 Gson 转回强类型。
 *
 * 错误传播：
 *   - 连接断开 → P2PClient.sendCommand 返 Result.failure("Not connected")
 *     → 包成 SyncPushResponse(status="failed", error="Not connected")
 *   - 对端报 -32601 method-not-found → 同上
 *   - 超时 → 同上
 *   - 对端业务返 status="conflict" — 直接回传给 SyncManager 不当 error 处理
 */
@Singleton
class P2PClientSyncOutbound @Inject constructor(
    private val p2pClient: P2PClient
) : SyncOutbound {

    private val gson = Gson()

    override suspend fun pushItem(deviceId: String, item: SyncItem): SyncPushResponse {
        val params = mapOf<String, Any>(
            "item" to mapOf(
                "resourceId" to item.resourceId,
                "resourceType" to item.resourceType.name,
                "operation" to item.operation.name,
                "data" to item.data,
                "timestamp" to item.timestamp,
                "version" to item.version
            ),
            "deviceId" to deviceId
        )
        val res = p2pClient.sendCommand<SyncPushResponse>(
            method = "sync.push",
            params = params,
            typeOf = object : TypeToken<SyncPushResponse>() {}.type
        )
        return res.fold(
            onSuccess = { it ?: SyncPushResponse(status = "failed", error = "null response") },
            onFailure = { err ->
                Timber.w(err, "[SyncOutbound] sync.push 失败 ${item.resourceId}")
                SyncPushResponse(
                    status = "failed",
                    error = err.message ?: err.javaClass.simpleName
                )
            }
        )
    }

    override suspend fun pullFromDevice(
        deviceId: String,
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int
    ): SyncPullResponse {
        val params = mutableMapOf<String, Any>(
            "cursor" to mapOf(
                "ts" to cursor.ts,
                "id" to (cursor.id ?: "")
            ),
            "limit" to limit
        )
        if (resourceTypes != null) {
            params["resourceTypes"] = resourceTypes.map { it.name }
        }
        val res = p2pClient.sendCommand<SyncPullResponse>(
            method = "sync.pull",
            params = params,
            typeOf = object : TypeToken<SyncPullResponse>() {}.type
        )
        return res.fold(
            onSuccess = { it ?: SyncPullResponse(items = emptyList(), nextCursor = cursor, hasMore = false) },
            onFailure = { err ->
                Timber.w(err, "[SyncOutbound] sync.pull 失败")
                SyncPullResponse(items = emptyList(), nextCursor = cursor, hasMore = false)
            }
        )
    }
}
