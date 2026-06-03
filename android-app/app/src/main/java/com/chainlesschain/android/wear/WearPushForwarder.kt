package com.chainlesschain.android.wear

import android.content.Context
import com.chainlesschain.android.auto.AutoPushBus
import com.chainlesschain.android.auto.AutoPushEvent
import com.chainlesschain.android.push.NotificationPayload
import com.google.android.gms.wearable.Wearable
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * v1.2 #20 P0.2 Wear Phase 1 — phone → watch push forwarder。
 *
 * 复用 [AutoPushBus]（Auto Phase 2 已实现的 Marketplace / SystemAlert 路由），
 * 凡 emit 到 bus 的 [AutoPushEvent.Incoming] 同时序列化为 [WearApprovalPayload]
 * 发到所有 connected wear node 的 `/cc/push` path。
 *
 * 不重复路由判定：AutoPushBus 已经做了类别白名单（Marketplace + SystemAlert），
 * 这里 piggyback 即可。Cowork / ShareInbox 类不进 bus 自然也不到 watch。
 *
 * 双通道（Auto + Wear）同步亮 OK：手机口袋时 watch 提醒，戴着 Auto 时 head unit
 * 也亮 — 任一通道响应即认为审批已处理（消费侧确认）。
 *
 * 错误吞并：watch 没配对 / 协议 disconnected 是常见状态 (`getConnectedNodes`
 * 返空)，Timber log 然后静默继续。push 写入 phone NotificationCenter 是
 * fallback path —— 用户至少能从手机收到。
 */
@Singleton
class WearPushForwarder @Inject constructor(
    @ApplicationContext private val context: Context,
    private val autoPushBus: AutoPushBus,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var collectJob: Job? = null

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
    }

    /** AppInitializer 启动时调用一次；幂等。 */
    fun start() {
        if (collectJob?.isActive == true) return
        collectJob = scope.launch {
            autoPushBus.events.collect { event ->
                if (event is AutoPushEvent.Incoming) {
                    forward(event.payload)
                }
            }
        }
        Timber.i("WearPushForwarder.start: listening AutoPushBus.events")
    }

    fun stop() {
        collectJob?.cancel()
        collectJob = null
    }

    /** Convert NotificationPayload to wear-app's ApprovalRequest JSON shape. */
    private suspend fun forward(payload: NotificationPayload) {
        val message = renderForWatch(payload) ?: return
        val bytes = message.toByteArray(Charsets.UTF_8)
        val nodes = runCatching {
            Wearable.getNodeClient(context).connectedNodes.await()
        }.getOrElse {
            Timber.w(it, "WearPushForwarder.forward: connectedNodes 查询失败")
            return
        }
        if (nodes.isEmpty()) {
            Timber.d("WearPushForwarder.forward: no connected wear node, skip")
            return
        }
        val client = Wearable.getMessageClient(context)
        for (node in nodes) {
            runCatching { client.sendMessage(node.id, PATH_PUSH, bytes).await() }
                .onSuccess { Timber.i("WearPushForwarder → ${node.id} OK (${bytes.size}B)") }
                .onFailure { Timber.w(it, "WearPushForwarder → ${node.id} FAIL") }
        }
    }

    /** Render to JSON matching wear-app's ApprovalRequest schema (loose match —
     *  wear-app uses ignoreUnknownKeys, so extra fields safe). */
    internal fun renderForWatch(payload: NotificationPayload): String? = when (payload) {
        is NotificationPayload.MarketplacePurchaseApproval -> json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            kotlinx.serialization.json.buildJsonObject {
                put("id", kotlinx.serialization.json.JsonPrimitive("mp:${payload.orderId}"))
                put("kind", kotlinx.serialization.json.JsonPrimitive("multisig.purchase"))
                put("title", kotlinx.serialization.json.JsonPrimitive("Marketplace 审批"))
                put(
                    "summary",
                    kotlinx.serialization.json.JsonPrimitive(
                        payload.itemName ?: "订单 ${payload.orderId}",
                    ),
                )
                put(
                    "amountFen",
                    kotlinx.serialization.json.JsonPrimitive(_fenFromTotal(payload.total)),
                )
                put(
                    "createdAtMs",
                    kotlinx.serialization.json.JsonPrimitive(System.currentTimeMillis()),
                )
                put("needsBiometric", kotlinx.serialization.json.JsonPrimitive(true))
            },
        )
        is NotificationPayload.SystemAlertNotice -> json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            kotlinx.serialization.json.buildJsonObject {
                put("id", kotlinx.serialization.json.JsonPrimitive("sys:${payload.title.hashCode()}"))
                put("kind", kotlinx.serialization.json.JsonPrimitive("system.alert"))
                put("title", kotlinx.serialization.json.JsonPrimitive(payload.title))
                put("summary", kotlinx.serialization.json.JsonPrimitive(payload.body))
                put("severity", kotlinx.serialization.json.JsonPrimitive(payload.severity.name.lowercase()))
                put(
                    "createdAtMs",
                    kotlinx.serialization.json.JsonPrimitive(System.currentTimeMillis()),
                )
                put(
                    "needsBiometric",
                    kotlinx.serialization.json.JsonPrimitive(
                        payload.severity == NotificationPayload.SystemAlertNotice.Severity.Critical,
                    ),
                )
            },
        )
        // Cowork / ShareInbox 不路由（AutoPushBus 也已过滤），返 null 不发送
        else -> null
    }

    /** "1500" 或 "1500.00" → 150000 (fen)；解析失败返 0。 */
    private fun _fenFromTotal(total: String): Long = total.toDoubleOrNull()
        ?.let { (it * 100).toLong() } ?: 0L

    companion object {
        /** 与 wear-app sync.ApprovalRequest.PATH_PUSH 严格对齐。 */
        const val PATH_PUSH = "/cc/push"
    }
}
