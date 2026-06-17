package com.chainlesschain.android.sync

import com.chainlesschain.android.capture.share.SharePayloadFlusher
import com.chainlesschain.android.core.p2p.sync.RpcSyncResult
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncStatistics
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * SyncCoordinator 单元测试。
 *
 * 用注入的 TestDispatcher 驱动内部周期 push 循环（生产 = Dispatchers.IO，见 DispatchersModule）。
 * 注意：周期 push 是 `while(isActive){ … ; withTimeoutOrNull(30s){ changeSignal.receive() } }` 的
 * 无限循环——不能用 advanceUntilIdle（会无限推进虚拟时间）；改用 runCurrent() 跑到首个挂起点、
 * 再用 changeSignal/advanceTimeBy 精确驱动，最后 stop() 取消，advanceUntilIdle 收尾保证调度器干净。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SyncCoordinatorTest {

    private fun newFixture(
        pendingChanges: Int,
        connectedPeers: MutableStateFlow<Map<String, PeerInfo>>,
        changeSignal: Channel<Unit>,
    ): Triple<P2PClient, SyncManager, SharePayloadFlusher> {
        val p2pClient = mockk<P2PClient>(relaxed = true)
        every { p2pClient.connectedPeers } returns connectedPeers

        val syncManager = mockk<SyncManager>(relaxed = true)
        every { syncManager.getSyncStatistics() } returns
            SyncStatistics(pendingChanges = pendingChanges, lastSyncTimestamps = emptyMap())
        every { syncManager.changeSignal } returns changeSignal
        coEvery { syncManager.pushPendingToDesktopRpc(any()) } returns
            RpcSyncResult(pushed = pendingChanges, conflicts = 0, failed = 0)

        val flusher = mockk<SharePayloadFlusher>(relaxed = true)
        coEvery { flusher.flushAll() } returns SharePayloadFlusher.FlushSummary(pushed = 0, failed = 0, total = 0)

        return Triple(p2pClient, syncManager, flusher)
    }

    @Test
    fun `connected peer with pending changes pushes to that peer`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val peers = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        val changeSignal = Channel<Unit>(Channel.CONFLATED)
        val (p2p, sync, flusher) = newFixture(pendingChanges = 3, connectedPeers = peers, changeSignal = changeSignal)

        val coordinator = SyncCoordinator(p2p, sync, flusher, dispatcher)
        coordinator.start()
        peers.value = mapOf("peer1" to mockk(relaxed = true)) // 模拟桌面连上
        runCurrent() // 跑 watcher collect → 首轮 push，停在 withTimeoutOrNull 挂起点

        coVerify(exactly = 1) { sync.pushPendingToDesktopRpc("peer1") }

        coordinator.stop()
        advanceUntilIdle()
    }

    @Test
    fun `no pending changes skips push but still flushes share inbox`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val peers = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        val changeSignal = Channel<Unit>(Channel.CONFLATED)
        val (p2p, sync, flusher) = newFixture(pendingChanges = 0, connectedPeers = peers, changeSignal = changeSignal)

        val coordinator = SyncCoordinator(p2p, sync, flusher, dispatcher)
        coordinator.start()
        peers.value = mapOf("peer1" to mockk(relaxed = true))
        runCurrent()

        coVerify(exactly = 0) { sync.pushPendingToDesktopRpc(any()) }
        coVerify(exactly = 1) { flusher.flushAll() } // share flush 与 pending 解耦，始终跑

        coordinator.stop()
        advanceUntilIdle()
    }

    @Test
    fun `changeSignal wakes an immediate extra push without waiting the 30s interval`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val peers = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        val changeSignal = Channel<Unit>(Channel.CONFLATED)
        val (p2p, sync, flusher) = newFixture(pendingChanges = 2, connectedPeers = peers, changeSignal = changeSignal)

        val coordinator = SyncCoordinator(p2p, sync, flusher, dispatcher)
        coordinator.start()
        peers.value = mapOf("peer1" to mockk(relaxed = true))
        runCurrent() // 首轮 push

        // FAMILY-67: 本地新变更发 changeSignal → 立刻唤醒第二轮 push（不等满 30s）
        changeSignal.trySend(Unit)
        runCurrent()

        coVerify(exactly = 2) { sync.pushPendingToDesktopRpc("peer1") }

        coordinator.stop()
        advanceUntilIdle()
    }

    @Test
    fun `disconnect stops the periodic push loop`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val peers = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        val changeSignal = Channel<Unit>(Channel.CONFLATED)
        val (p2p, sync, flusher) = newFixture(pendingChanges = 1, connectedPeers = peers, changeSignal = changeSignal)

        val coordinator = SyncCoordinator(p2p, sync, flusher, dispatcher)
        coordinator.start()
        peers.value = mapOf("peer1" to mockk(relaxed = true))
        runCurrent() // 首轮 push

        // 断开：push 循环应被取消，后续即使过了多个 30s 周期也不再 push
        peers.value = emptyMap()
        advanceTimeBy(120_000)
        advanceUntilIdle() // 循环已取消，不会无限推进

        coVerify(exactly = 1) { sync.pushPendingToDesktopRpc(any()) }

        coordinator.stop()
        advanceUntilIdle()
    }

    @Test
    fun `start is idempotent - second start does not double the push loop`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val peers = MutableStateFlow<Map<String, PeerInfo>>(emptyMap())
        val changeSignal = Channel<Unit>(Channel.CONFLATED)
        val (p2p, sync, flusher) = newFixture(pendingChanges = 1, connectedPeers = peers, changeSignal = changeSignal)

        val coordinator = SyncCoordinator(p2p, sync, flusher, dispatcher)
        coordinator.start()
        coordinator.start() // 第二次应早返（watcher 已 active），不再起第二个 watcher
        peers.value = mapOf("peer1" to mockk(relaxed = true))
        runCurrent()

        // 若起了两个 watcher，会有两条 push 循环 → 首轮就会 push 两次
        coVerify(exactly = 1) { sync.pushPendingToDesktopRpc("peer1") }

        coordinator.stop()
        advanceUntilIdle()
    }
}
