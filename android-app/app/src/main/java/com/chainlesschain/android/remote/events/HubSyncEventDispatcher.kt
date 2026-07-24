package com.chainlesschain.android.remote.events

import com.chainlesschain.android.remote.commands.SyncReport
import com.chainlesschain.android.remote.data.EventNotification
import com.chainlesschain.android.remote.p2p.P2PClient
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 14.3 — Personal Data Hub 同步进度事件分发器。
 *
 * 订 `p2pClient.events` 流并 filter `personal-data-hub.sync.progress` method，
 * 转 typed [HubSyncEvent] 推到 [events] SharedFlow，由 [HubAdaptersViewModel] 订阅
 * 在 sync 流程中实时更新 UI 进度文字。
 *
 * 与 [RemoteEventDispatcher] 同层、独立订阅同一个 hot SharedFlow（fan-out），互不
 * 干扰。设计稿 §7 trap T9 说明 event method 用 full-qualified
 * `personal-data-hub.sync.progress` 名 避免与 `terminal.output` / `ai.chat.delta`
 * / `notification.received` 等同名碰撞。
 *
 * 桌面 push 5 种 kind（per design §5.4 + §G8）：
 *  - `connecting` — 连接 Adapter 中（IMAP login / file open 等）
 *  - `fetching`   — 拉远端数据中（含 partition + detail.uidsScanned 或类似计数）
 *  - `normalizing`— 入 vault 前归一化（含 detail.eventsBuilt）
 *  - `done`       — 完成（含 SyncReport：ingested / kgTriples / ragDocs / durationMs）
 *  - `error`      — 失败（含 message）
 *
 * 桌面 push 实际接通在 Phase 14.3.2（route-mobile.js stream stub 现仍 throw "Phase
 * 14.3 will add HubSyncEventDispatcher"）；本类是 Android 侧准备好的接收端。
 */
@Singleton
class HubSyncEventDispatcher @Inject constructor(
    private val p2pClient: P2PClient,
) {
    /** 与 design §7 T9 + WS 主题对齐的 fully-qualified event method 名。 */
    companion object {
        const val EVENT_METHOD = "personal-data-hub.sync.progress"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val gson = Gson()

    private val _events = MutableSharedFlow<HubSyncEvent>(
        replay = 0,
        extraBufferCapacity = 32,
    )

    /** Hot stream — 多 ViewModel 可订阅，互不干扰。 */
    val events: SharedFlow<HubSyncEvent> = _events.asSharedFlow()

    private var subscription: Job? = null

    init {
        start()
    }

    /**
     * 启动订阅（idempotent — 重复调用复用既有 job）。
     */
    fun start() {
        if (subscription?.isActive == true) {
            return
        }
        subscription = scope.launch {
            p2pClient.events.collect { event ->
                if (event.method != EVENT_METHOD) {
                    return@collect
                }
                try {
                    val parsed = parseEvent(event)
                    if (parsed != null) {
                        _events.emit(parsed)
                        Timber.d("[HubSyncEventDispatcher] ${parsed.kind} ${parsed.adapter}")
                    }
                } catch (e: Exception) {
                    Timber.e(e, "[HubSyncEventDispatcher] dispatch failed")
                }
            }
        }
    }

    /**
     * Test-only：手动注入一个 EventNotification 走完整 parse 路径。
     * Production 不调用 — 真路径走 [p2pClient.events] collect。
     */
    internal suspend fun emitForTest(notification: EventNotification) {
        val parsed = parseEvent(notification) ?: return
        _events.emit(parsed)
    }

    private fun parseEvent(event: EventNotification): HubSyncEvent? {
        return try {
            val json = gson.toJson(event.params)
            val parsed = gson.fromJson(json, HubSyncEvent::class.java)
            // kind / adapter 是必填字段；缺一律视为 malformed。
            if (parsed.kind.isBlank() || parsed.adapter.isBlank()) {
                Timber.w("[HubSyncEventDispatcher] malformed: kind=%s adapter=%s",
                    parsed.kind, parsed.adapter)
                return null
            }
            parsed
        } catch (e: Exception) {
            Timber.e(e, "[HubSyncEventDispatcher] parse failed for %s", event.params)
            null
        }
    }
}

/**
 * Sync progress event payload, mirroring desktop emit shape per design §5.4.
 *
 * - `connecting` / `fetching` / `normalizing` / `done` / `error` 五种 kind 共用此结构
 * - 字段都 nullable 因为不同 kind 用不同子集（done 用 report；fetching/normalizing 用
 *   detail；error 用 message；connecting 仅 kind+adapter）
 */
@Serializable
data class HubSyncEvent(
    val kind: String,
    val adapter: String,
    val partition: String? = null,
    val detail: Map<String, Long>? = null,
    val report: SyncReport? = null,
    val reports: List<SyncReport>? = null,
    val message: String? = null,
    val error: String? = null,
    val attemptCount: Long? = null,
    val nextAttempt: Long? = null,
    val retryCount: Long? = null,
    val delayMs: Long? = null,
    val retryAfterMs: Long? = null,
    val reason: String? = null,
    val sourceRequestCount: Long? = null,
    val operation: String? = null,
    val page: Long? = null,
)
