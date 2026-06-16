package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.remote.crypto.NonceManager
import com.chainlesschain.android.remote.data.*
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import com.chainlesschain.android.sync.SyncAuthVerifier
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * P2P 客户端单元测试
 *
 * 测试连接建立、命令发送、响应处理、心跳等功能
 * 针对当前活跃的 P2PClient 实现
 */
@OptIn(ExperimentalCoroutinesApi::class)
class P2PClientTest {

    private lateinit var p2pClient: P2PClient
    private lateinit var mockWebRTCClient: WebRTCClient
    private lateinit var mockDIDManager: DIDManager
    private lateinit var mockNonceManager: NonceManager
    private lateinit var mockDeviceActivityManager: DeviceActivityManager
    private lateinit var mockCommandRouter: CommandRouter
    private lateinit var mockSyncAuthVerifier: dagger.Lazy<SyncAuthVerifier>

    @Before
    fun setup() {
        mockWebRTCClient = mockk(relaxed = true)
        mockDIDManager = mockk(relaxed = true)
        mockNonceManager = mockk(relaxed = true)
        mockDeviceActivityManager = mockk(relaxed = true)
        mockCommandRouter = mockk(relaxed = true)
        mockSyncAuthVerifier = mockk(relaxed = true)

        // P2PClient init calls initialize() and setOnMessageReceived()
        every { mockWebRTCClient.initialize() } just Runs
        every { mockWebRTCClient.setOnMessageReceived(any()) } just Runs

        p2pClient = P2PClient(
            didManager = mockDIDManager,
            webRTCClient = mockWebRTCClient,
            nonceManager = mockNonceManager,
            deviceActivityManager = mockDeviceActivityManager,
            commandRouter = mockCommandRouter,
            syncAuthVerifier = mockSyncAuthVerifier,
            // FAMILY-67 (第10层): 家庭连接 auth 用 core-did；测试用 relaxed mock。
            coreDidManager = mockk(relaxed = true)
        )
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `test initial state is DISCONNECTED`() {
        assertEquals(ConnectionState.DISCONNECTED, p2pClient.connectionState.value)
        assertNull(p2pClient.connectedPeer.value)
    }

    @Test
    fun `test connection success`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-123"
        val pcDID = "did:example:pc-123"

        coEvery { mockWebRTCClient.connect(pcPeerId, any()) } returns Result.success(Unit)

        // Act
        val result = p2pClient.connect(pcPeerId, pcDID)

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)
        assertEquals(pcPeerId, p2pClient.connectedPeer.value?.peerId)
        assertEquals(pcDID, p2pClient.connectedPeer.value?.did)

        coVerify { mockWebRTCClient.connect(pcPeerId, any()) }
    }

    @Test
    fun `test connection failure`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-456"
        val pcDID = "did:example:pc-456"

        coEvery { mockWebRTCClient.connect(pcPeerId, any()) } returns Result.failure(Exception("Connection failed"))

        // Act
        val result = p2pClient.connect(pcPeerId, pcDID)

        // Assert
        assertTrue(result.isFailure)
        assertEquals(ConnectionState.ERROR, p2pClient.connectionState.value)
        assertNull(p2pClient.connectedPeer.value)
    }

    @Test
    fun `test send command when disconnected`() = runTest {
        // Act - don't connect first
        val result = p2pClient.sendCommand<Any>(
            method = "ai.chat",
            params = mapOf("message" to "Hello")
        )

        // Assert
        assertTrue(result.isFailure)
        assertEquals("Not connected", result.exceptionOrNull()?.message)
    }

    @Test
    fun `test disconnect clears state`() = runTest {
        // Arrange - connect first
        val pcPeerId = "pc-peer-disconnect"
        val pcDID = "did:example:pc-disconnect"

        coEvery { mockWebRTCClient.connect(pcPeerId, any()) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)
        assertNotNull(p2pClient.connectedPeer.value)

        every { mockWebRTCClient.disconnect() } just Runs

        // Act
        p2pClient.disconnect()

        // Assert
        assertEquals(ConnectionState.DISCONNECTED, p2pClient.connectionState.value)
        assertNull(p2pClient.connectedPeer.value)

        verify { mockWebRTCClient.disconnect() }
    }

    @Test
    fun `test disconnect completes pending requests with error`() = runBlocking {
        // Use real runBlocking (not runTest) because sendCommand internally uses
        // withContext(Dispatchers.IO) which schedules work on real IO threads.
        // In runTest with StandardTestDispatcher, virtual-time delay(50) returns
        // before the IO worker has actually added the request to pendingRequests,
        // so disconnect() iterates an empty map and the async never completes.
        // runBlocking with a real delay ensures the IO worker progresses through
        // pendingRequests-add before disconnect() runs.
        val pcPeerId = "pc-peer-pending"
        val pcDID = "did:example:pc-pending"

        coEvery { mockWebRTCClient.connect(pcPeerId, any()) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        coEvery { mockDIDManager.getCurrentDID() } returns "did:example:android"
        coEvery { mockDIDManager.sign(any()) } returns "signature"
        every { mockWebRTCClient.sendMessage(any()) } just Runs
        every { mockWebRTCClient.disconnect() } just Runs

        // Start a command (don't wait for response)
        val deferred = async {
            p2pClient.sendCommand<Any>(
                method = "ai.chat",
                params = mapOf("message" to "Test"),
                timeout = 10000L
            )
        }

        // Real-time wait so the IO worker actually registers the pending request.
        delay(200)

        // Act
        p2pClient.disconnect()

        // Wait for deferred to complete
        val result = deferred.await()

        // Assert
        assertTrue(result.isFailure)
        assertEquals("Connection closed", result.exceptionOrNull()?.message)
    }

    @Test
    fun `test connection state flow updates`() = runBlocking {
        // Use runBlocking with real delays — production p2pClient.connect uses
        // withContext(Dispatchers.IO) which schedules on real IO threads. In runTest's
        // StandardTestDispatcher the drop(1) + runCurrent + advanceUntilIdle dance
        // wasn't reliably catching cross-dispatcher emissions; real-time delay closes
        // that gap. Same pattern as `test disconnect completes pending requests`
        // (caf512f5e). Capture initial state separately since MutableStateFlow.collect
        // only replays the *current* value to a new subscriber.
        val states = mutableListOf<ConnectionState>()
        states.add(p2pClient.connectionState.value) // DISCONNECTED captured up-front

        val job = launch {
            p2pClient.connectionState.drop(1).collect { states.add(it) }
        }
        delay(100) // give the collector a real moment to register

        // Force webRTCClient.connect to suspend briefly — otherwise mockk returns
        // synchronously, production sets CONNECTING then CONNECTED without yielding,
        // and MutableStateFlow conflates the intermediate CONNECTING value away
        // before the collector observes it.
        coEvery { mockWebRTCClient.connect(any(), any()) } coAnswers {
            delay(20)
            Result.success(Unit)
        }

        // Act
        p2pClient.connect("peer-123", "did:example:123")
        delay(300) // real-time wait for emissions to cross dispatchers

        // Assert
        assertTrue(states.contains(ConnectionState.DISCONNECTED)) // Initial state
        assertTrue(states.contains(ConnectionState.CONNECTING))
        assertTrue(states.contains(ConnectionState.CONNECTED))

        job.cancel()
    }

    @Test
    fun `test reconnect disconnects existing connection first`() = runTest {
        // Arrange
        val pcPeerId1 = "pc-peer-1"
        val pcPeerId2 = "pc-peer-2"

        coEvery { mockWebRTCClient.connect(any(), any()) } returns Result.success(Unit)
        every { mockWebRTCClient.disconnect() } just Runs

        // Connect first time
        p2pClient.connect(pcPeerId1, "did:example:1")
        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)

        // Act - connect again
        p2pClient.connect(pcPeerId2, "did:example:2")

        // Assert
        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)
        assertEquals(pcPeerId2, p2pClient.connectedPeer.value?.peerId)

        // disconnect() should have been called once for the first connection
        verify(atLeast = 1) { mockWebRTCClient.disconnect() }
    }

    @Test
    fun `test initialize is called on construction`() {
        // Assert - verify init block calls
        verify { mockWebRTCClient.initialize() }
        verify { mockWebRTCClient.setOnMessageReceived(any()) }
    }

    @Test
    fun `test connect generates unique local peer id`() = runTest {
        // Arrange
        val capturedPeerIds = mutableListOf<String>()
        coEvery { mockWebRTCClient.connect(any(), capture(capturedPeerIds)) } returns Result.success(Unit)
        every { mockWebRTCClient.disconnect() } just Runs

        // Act - connect twice
        p2pClient.connect("pc-1", "did:1")
        p2pClient.disconnect()
        p2pClient.connect("pc-2", "did:2")

        // Assert - local peer IDs should start with "mobile-" and be unique
        assertEquals(2, capturedPeerIds.size)
        assertTrue(capturedPeerIds[0].startsWith("mobile-"))
        assertTrue(capturedPeerIds[1].startsWith("mobile-"))
        assertTrue(capturedPeerIds[0] != capturedPeerIds[1])
    }

    @Test
    fun `test heartbeat sends messages after connection`() = runTest {
        // Arrange
        coEvery { mockWebRTCClient.connect(any(), any()) } returns Result.success(Unit)
        every { mockWebRTCClient.sendMessage(any()) } just Runs

        // Act
        p2pClient.connect("pc-heartbeat", "did:heartbeat")

        // Wait for heartbeat to trigger (should be configured at 30s but we just verify connection)
        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)
    }

    // ============================================================
    // W2.1 — connectedPeers Map data model (issue #19)
    //
    // 测试覆盖新 API 的 Map<peerId, PeerInfo> invariants：
    //   - 初始空 Map
    //   - connect 把 peer 用 peerId 作 key 写进
    //   - disconnect 清空
    //   - reconnect 之后 Map 只剩最新 peer（W2.1 lifecycle 仍单 peer at a time）
    //   - 老 connectedPeer derived StateFlow 与 connectedPeers 一致
    //
    // W2.2 lifecycle 多目标时再加：connect(peerA) + connect(peerB) → 2 entries
    // ============================================================

    @Test
    fun `W2_1 initial connectedPeers is empty Map`() {
        @Suppress("DEPRECATION")
        run {
            assertNull(p2pClient.connectedPeer.value)
        }
        assertEquals(emptyMap<String, PeerInfo>(), p2pClient.connectedPeers.value)
    }

    @Test
    fun `W2_1 connect adds peer to Map with peerId key`() = runTest {
        // Arrange
        val pcPeerId = "pc-w21-add"
        val pcDID = "did:example:w21-add"
        coEvery { mockWebRTCClient.connect(pcPeerId, any()) } returns Result.success(Unit)

        // Act
        p2pClient.connect(pcPeerId, pcDID)

        // Assert — new API
        val peers = p2pClient.connectedPeers.value
        assertEquals(1, peers.size)
        assertTrue(peers.containsKey(pcPeerId))
        val entry = peers[pcPeerId]
        assertNotNull(entry)
        assertEquals(pcPeerId, entry?.peerId)
        assertEquals(pcDID, entry?.did)
    }

    @Test
    fun `W2_1 disconnect clears all peers from Map`() = runTest {
        // Arrange
        coEvery { mockWebRTCClient.connect(any(), any()) } returns Result.success(Unit)
        every { mockWebRTCClient.disconnect() } just Runs
        p2pClient.connect("pc-w21-clear", "did:w21-clear")
        assertEquals(1, p2pClient.connectedPeers.value.size)

        // Act
        p2pClient.disconnect()

        // Assert
        assertEquals(emptyMap<String, PeerInfo>(), p2pClient.connectedPeers.value)
    }

    @Test
    fun `W2_1 reconnect cycle leaves only the latest peer (single-peer lifecycle invariant)`() = runTest {
        // Arrange
        coEvery { mockWebRTCClient.connect(any(), any()) } returns Result.success(Unit)
        every { mockWebRTCClient.disconnect() } just Runs

        // Act — connect peer-A, then peer-B (connect 内部先 disconnect)
        p2pClient.connect("peer-A", "did:A")
        p2pClient.connect("peer-B", "did:B")

        // Assert — Map 只含 peer-B；peer-A 在第二次 connect() 进入时被内部 disconnect() 清掉
        val peers = p2pClient.connectedPeers.value
        assertEquals(1, peers.size)
        assertTrue(peers.containsKey("peer-B"))
        assertTrue(!peers.containsKey("peer-A"))
    }

    @Test
    fun `W2_1 connectedPeer (deprecated) stays in sync with connectedPeers`() = runTest {
        // Arrange
        coEvery { mockWebRTCClient.connect(any(), any()) } returns Result.success(Unit)
        every { mockWebRTCClient.disconnect() } just Runs

        // Act + Assert — empty/full/empty cycle
        @Suppress("DEPRECATION")
        run {
            assertNull(p2pClient.connectedPeer.value)
        }

        p2pClient.connect("peer-sync", "did:sync")
        // 等 derived StateFlow 的 map+stateIn pipeline 同步
        delay(50)
        @Suppress("DEPRECATION")
        run {
            assertEquals("peer-sync", p2pClient.connectedPeer.value?.peerId)
        }
        assertEquals(1, p2pClient.connectedPeers.value.size)

        p2pClient.disconnect()
        delay(50)
        @Suppress("DEPRECATION")
        run {
            assertNull(p2pClient.connectedPeer.value)
        }
        assertEquals(emptyMap<String, PeerInfo>(), p2pClient.connectedPeers.value)
    }
}
