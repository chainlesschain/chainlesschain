package com.chainlesschain.android.initializer

import android.app.Application
import com.chainlesschain.android.config.TurnEphemeralRefresher
import com.chainlesschain.android.config.TurnServerPreferences
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.ice.IceServerConfig
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.remote.offline.OfflineCommandQueue
import com.chainlesschain.android.sync.FamilyGuardSyncConnector
import com.chainlesschain.android.sync.SyncCoordinator
import com.chainlesschain.android.wear.WearPushForwarder
import dagger.Lazy
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.Test

/**
 * [AppInitializer] 单元测试。
 *
 * initializeAsynchronously() 在内部 CoroutineScope(Dispatchers.Default) 上 launch 多个组件启动，
 * 各自 try/catch 包裹（非致命隔离）。这里用真实 dispatcher + coVerify/verify(timeout=…) 等待后台
 * launch 落地——同 WebRTCClientTest 对跨 dispatcher 调用的处理；不改生产代码（AppInitializer 是
 * 启动热路径，构造器 10 依赖，避免为可测性动它）。
 */
class AppInitializerTest {

    private inline fun <reified T : Any> lazyMock(value: T): Lazy<T> =
        mockk<Lazy<T>> { every { get() } returns value }

    private fun newInitializer(
        sessionMgr: PersistentSessionManager,
        syncCoordinator: SyncCoordinator,
        familyConnector: FamilyGuardSyncConnector,
    ): AppInitializer = AppInitializer(
        application = mockk(relaxed = true),
        llmAdapter = mockk<Lazy<LLMAdapter>>(relaxed = true),
        syncCoordinator = lazyMock(syncCoordinator),
        persistentSessionManager = lazyMock(sessionMgr),
        familyGuardSyncConnector = lazyMock(familyConnector),
        offlineCommandQueue = mockk<Lazy<OfflineCommandQueue>>(relaxed = true),
        turnServerPreferences = mockk<Lazy<TurnServerPreferences>>(relaxed = true),
        iceServerConfig = mockk<Lazy<IceServerConfig>>(relaxed = true),
        turnEphemeralRefresher = mockk<Lazy<TurnEphemeralRefresher>>(relaxed = true),
        wearPushForwarder = mockk<Lazy<WearPushForwarder>>(relaxed = true),
        callManager = mockk<Lazy<com.chainlesschain.android.call.CallManager>>(relaxed = true),
        callMediaController = mockk<Lazy<com.chainlesschain.android.call.WebRtcCallMediaController>>(relaxed = true),
        callServiceLauncher = mockk<Lazy<com.chainlesschain.android.call.AndroidCallServiceLauncher>>(relaxed = true),
        pushVendorRegistry =
            mockk<Lazy<com.chainlesschain.android.push.vendor.PushVendorRegistry>>(relaxed = true),
    )

    @Test
    fun `initializeAsynchronously restores E2EE sessions and starts sync components`() {
        val sessionMgr = mockk<PersistentSessionManager>(relaxed = true)
        val syncCoordinator = mockk<SyncCoordinator>(relaxed = true)
        val familyConnector = mockk<FamilyGuardSyncConnector>(relaxed = true)

        newInitializer(sessionMgr, syncCoordinator, familyConnector).initializeAsynchronously()

        // 后台 launch 跑在 Dispatchers.Default（真线程）→ timeout 等其落地
        // FAMILY-67: 启动时 autoRestore 持久化 E2EE 会话（重启后好友聊天即刻可用）
        coVerify(timeout = 3000) { sessionMgr.initialize(autoRestore = true, enableRotation = any()) }
        verify(timeout = 3000) { syncCoordinator.start() }
        verify(timeout = 3000) { familyConnector.ensureConnected() }
    }

    @Test
    fun `a failing component does not abort the others (non-fatal isolation)`() {
        val sessionMgr = mockk<PersistentSessionManager>(relaxed = true)
        // E2EE 会话恢复抛错（如解密失败）→ 应被该 launch 自己的 try/catch 吞掉，不拖垮其他启动项
        coEvery { sessionMgr.initialize(any(), any()) } throws RuntimeException("restore boom")
        val syncCoordinator = mockk<SyncCoordinator>(relaxed = true)
        val familyConnector = mockk<FamilyGuardSyncConnector>(relaxed = true)

        newInitializer(sessionMgr, syncCoordinator, familyConnector).initializeAsynchronously()

        // 其他组件仍被启动（SupervisorJob + 各自 try/catch 的非致命隔离）
        verify(timeout = 3000) { syncCoordinator.start() }
        verify(timeout = 3000) { familyConnector.ensureConnected() }
    }
}
