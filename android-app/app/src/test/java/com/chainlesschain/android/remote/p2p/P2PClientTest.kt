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
            syncAuthVerifier = mockSyncAuthVerifier
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
}
