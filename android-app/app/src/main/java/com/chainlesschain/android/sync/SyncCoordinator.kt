package com.chainlesschain.android.sync

import com.chainlesschain.android.capture.share.SharePayloadFlusher
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.di.IoDispatcher
import com.chainlesschain.android.remote.p2p.P2PClient
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 3d v1.1 #4: Android 端 sync auto-trigger 协调器。
 *
 * v1 痛点：Android 本地写入（friend / post / message）会进 SyncManager.
 * pendingChanges in-memory 队列，但**没人调** pushPendingToDesktopRpc，所以
 * desktop 必须主动 sync.pull 才能看到这些变更。这条路径对用户不友好。
 *
 * v1.1 #4 修法：监听 P2PClient.connectedPeer StateFlow，连上桌面后启动
 * 30s 周期 coroutine：
 *   - 若 SyncManager.pendingChanges 非空 → 调 pushPendingToDesktopRpc(peerId)
 *   - 桌面端 MobileBridgeSync.handlePushRpc 应用 + 回 ack
 *   - 失败留在 pendingChanges 等下一轮重试
 *
 * 断开 → cancel coroutine，重连 → 重新启动。所有状态都在 P2PClient
 * .connectedPeer 一处真源。
 *
 * 启动入口：AppInitializer.initializeAsynchronously() 调 start()。
 *
 * 限制（v1.1 → v1.2 优化）：
 *   - 只支持 1 个连接（P2PClient.connectedPeer 是单值 StateFlow，不是 list）。
 *     多设备配对场景需要 v1.2 改成 N-peer 支持。
 *   - 30s 间隔写死；可加 SharedPreferences 配置。
 */
@Singleton
class SyncCoordinator @Inject constructor(
    private val p2pClient: P2PClient,
    private val syncManager: SyncManager,
    private val sharePayloadFlusher: SharePayloadFlusher,
    // 注入便于单测用 TestDispatcher 驱动周期 push 循环（默认生产为 Dispatchers.IO，见 DispatchersModule）。
    // @Inject 构造不能写 Kotlin 默认值，故走 @IoDispatcher 限定符（memory android_inject_default_param_dual_ctor）。
    @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) {

    /**
     * 协调器生命周期 scope。每次 [start] 新建、[stop] 整体 cancel —— 让停止后所有子协程
     * （watcher + 周期 push）都确定性收尾（旧实现只 cancel 两个 job、scope 常驻，残留协程在
     * 测试 leak 检测下会偶发 UncompletedCoroutinesError）。重启即重建新 scope。
     */
    @Volatile private var scope: CoroutineScope? = null

    /** 监听 connectedPeer 的外层 job */
    @Volatile private var watcherJob: Job? = null

    /** 当前连接对应的周期 push job；连接切换时 cancel + 重启 */
    @Volatile private var periodicPushJob: Job? = null

    /** 周期 push 的兜底间隔（无新变更时）。有新变更时由 SyncManager.changeSignal 立即唤醒，不等满这 30s。 */
    private val pushIntervalMs = 30_000L

    /**
     * 启动协调器。Idempotent — 重复调不会启多个 watcher。
     * 由 AppInitializer.initializeAsynchronously() 调用。
     */
    fun start() {
        if (watcherJob?.isActive == true) {
            Timber.d("[SyncCoordinator] already started, skipping")
            return
        }
        Timber.i("[SyncCoordinator] starting connectedPeers watcher (v1.1 W2.3 multi-peer)")
        val s = CoroutineScope(ioDispatcher + SupervisorJob())
        scope = s
        watcherJob = s.launch {
            // v1.1 W2.3: 切到 connectedPeers Map (peerId → PeerInfo)
            // - lifecycle 仍 single-peer-at-a-time（W2.1 范围内 connect() 前先 disconnect 现连接），
            //   所以本 collect 在 v1.1 收到的 Map 实际只有 0 或 1 entry
            // - W2.2 放开 lifecycle 后 N 个 peer 并存，本 collect 自动适配（已迭代 Map.values）
            p2pClient.connectedPeers.collect { peers ->
                if (peers.isNotEmpty()) {
                    val peerIds = peers.keys.joinToString(",")
                    Timber.i("[SyncCoordinator] peers connected (${peers.size}): $peerIds, starting push loop")
                    startPeriodicPush(peers.keys.toList())
                } else {
                    Timber.i("[SyncCoordinator] all peers disconnected, cancelling push loop")
                    stopPeriodicPush()
                }
            }
        }
    }

    /**
     * 停止整个协调器。Application onTerminate / 测试 cleanup 用。
     */
    fun stop() {
        Timber.i("[SyncCoordinator] stop()")
        stopPeriodicPush()
        watcherJob?.cancel()
        watcherJob = null
        scope?.cancel()
        scope = null
    }

    private fun startPeriodicPush(peerIds: List<String>) {
        // Cancel any existing loop (peer set changed)
        stopPeriodicPush()

        val s = scope ?: return
        periodicPushJob = s.launch {
            // 进入循环：每 pushIntervalMs 检查 pendingChanges + Inbox
            while (isActive) {
                try {
                    val pending = syncManager.getSyncStatistics().pendingChanges
                    if (pending > 0) {
                        // v1.1 W2.3: 多 peer 时各自调 pushPendingToDesktopRpc(peerId)。
                        // pendingChanges 是设备级总数，每 peer 看到同一份 pending；
                        // pushPendingToDesktopRpc per-peer ack 后会 mark resource synced，
                        // 第二个 peer 看到的 pending 就少了。最终所有 peer 拿到相同状态。
                        for (peerId in peerIds) {
                            Timber.d("[SyncCoordinator] pushing $pending pending changes to $peerId")
                            val result = syncManager.pushPendingToDesktopRpc(peerId)
                            Timber.d(
                                "[SyncCoordinator] push to $peerId: pushed=${result.pushed} " +
                                    "conflicts=${result.conflicts} failed=${result.failed}"
                            )
                        }
                    }
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.w(e, "[SyncCoordinator] periodic push failed; will retry")
                }
                // M3 D2 ShareReceiver flush —— 与 syncManager.pushPendingToDesktopRpc 解耦的
                // 独立路径（Shared Inbox 走 knowledge.createNote 而非 sync RPC）。
                // 单调用即可（knowledge.createNote 不区分目标 peer，桌面侧 KB 写入是全局）
                try {
                    val flushed = sharePayloadFlusher.flushAll()
                    if (flushed.total > 0) {
                        Timber.d(
                            "[SyncCoordinator] share flush: pushed=${flushed.pushed} " +
                                "failed=${flushed.failed} (re-enqueued) total=${flushed.total}"
                        )
                    }
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.w(e, "[SyncCoordinator] share flush failed; entries left in inbox")
                }
                // 等待下一次推送时机：兜底 30s 周期 OR 有新本地变更（即时唤醒），取先到者。
                // 用户发消息 → SyncManager.recordChange 发 changeSignal → 这里立即醒来 push，
                // 好友聊天近实时投递（修「发了对方 30s 后才收到」的体验问题）。
                withTimeoutOrNull(pushIntervalMs) { syncManager.changeSignal.receive() }
            }
        }
    }

    private fun stopPeriodicPush() {
        periodicPushJob?.cancel()
        periodicPushJob = null
    }
}
