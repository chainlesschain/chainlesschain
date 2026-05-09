package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.google.gson.Gson
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * sync.* 命名空间的 CommandRouter 实现（Phase 3d M3 step D.5）。
 *
 * 路由 desktop 发来的 chainlesschain:command:request {method: "sync.push" |
 * "sync.pull" | "sync.ack"} 到 SyncManager 对应的 RPC handler。
 *
 * params 以 Map<String, Any> 进来（JSON-RPC envelope 已解开但 nested object
 * 仍是 Map/List/primitive），通过 Gson roundtrip 转成强类型 SyncItem /
 * PullCursor 等再传入 handler。这跟 P2PClient.sendCommand 出向解 result
 * 用的 pattern 一致。
 *
 * v1 scope：仅 sync.* 命名空间。其他命名空间抛 IllegalArgumentException →
 * P2PClient 转 -32601 METHOD_NOT_FOUND。
 *
 * **认证**：JSON-RPC envelope 含 auth: AuthInfo (DID + signature)，但 v1
 * 跳过验证（已配对设备在 pairing 阶段做过 DID 互信）。v2 加 nonce + 签名
 * 校验拒绝伪造请求。
 */
@Singleton
class SyncCommandRouter @Inject constructor(
    private val syncManager: SyncManager
) : CommandRouter {

    private val gson = Gson()

    override suspend fun route(method: String, params: Map<String, Any>): Any? {
        return when (method) {
            "sync.push" -> handleSyncPush(params)
            "sync.pull" -> handleSyncPull(params)
            "sync.ack" -> handleSyncAck(params)
            else -> {
                if (method.startsWith("sync.")) {
                    throw IllegalArgumentException("Unknown sync method: $method")
                }
                // 不属于 sync.* 命名空间 — 让 P2PClient 报 method-not-found
                throw IllegalArgumentException("Method namespace not handled: $method")
            }
        }
    }

    private suspend fun handleSyncPush(params: Map<String, Any>): Any {
        val itemMap = params["item"]
            ?: throw IllegalArgumentException("sync.push: missing 'item' param")
        val deviceId = params["deviceId"] as? String
        val item = roundTrip<SyncItem>(itemMap)
        Timber.d("sync.push routed: ${item.resourceType}/${item.resourceId} from $deviceId")
        return syncManager.handlePushRpc(item, deviceId)
    }

    private fun handleSyncPull(params: Map<String, Any>): Any {
        val cursorMap = params["cursor"]
        val cursor = if (cursorMap != null) roundTrip<PullCursor>(cursorMap) else PullCursor()
        @Suppress("UNCHECKED_CAST")
        val typesRaw = params["resourceTypes"] as? List<String>
        val types = typesRaw?.mapNotNull { name ->
            try {
                ResourceType.valueOf(name)
            } catch (_: IllegalArgumentException) {
                Timber.w("sync.pull: unknown ResourceType '$name', skipped")
                null
            }
        }
        val limit = (params["limit"] as? Number)?.toInt() ?: 100
        Timber.d("sync.pull routed: cursor=(${cursor.ts},${cursor.id}) types=$types limit=$limit")
        return syncManager.handlePullRpc(cursor, types, limit)
    }

    private fun handleSyncAck(params: Map<String, Any>): Any {
        val requestId = params["requestId"] as? String
        val status = params["status"] as? String
        val error = params["error"] as? String
        syncManager.handleAckRpc(requestId, status, error)
        return mapOf("ok" to true)
    }

    /**
     * Gson JSON roundtrip — 把 Map/List/primitive 还原成 @Serializable data class。
     */
    private inline fun <reified T> roundTrip(raw: Any): T {
        val json = gson.toJson(raw)
        return gson.fromJson(json, T::class.java)
    }
}
