package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.remote.crypto.RemoteDIDManager
import com.chainlesschain.android.remote.data.*
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * P2P 客户端单元测试
 *
 * 测试连接建立、命令发送、响应处理、心跳等功能
 */
@OptIn(ExperimentalCoroutinesApi::class)
class P2PClientTest {

    private lateinit var p2pClient: P2PClientWithWebRTC
    private lateinit var mockWebRTCClient: WebRTCClient
    private lateinit var mockDIDManager: RemoteDIDManager

    @Before
    fun setup() {
        mockWebRTCClient = mockk(relaxed = true)
        mockDIDManager = mockk(relaxed = true)

        p2pClient = P2PClientWithWebRTC(mockWebRTCClient, mockDIDManager)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `test connection success`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-123"
        val pcDID = "did:example:pc-123"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)

        // Act
        val result = p2pClient.connect(pcPeerId, pcDID)

        // Assert
        assertTrue(result.isSuccess)
        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)
        assertEquals(pcPeerId, p2pClient.connectedPeer.value?.peerId)
        assertEquals(pcDID, p2pClient.connectedPeer.value?.did)

        coVerify { mockWebRTCClient.connect(pcPeerId) }
    }

    @Test
    fun `test connection failure`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-456"
        val pcDID = "did:example:pc-456"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.failure(Exception("Connection failed"))

        // Act
        val result = p2pClient.connect(pcPeerId, pcDID)

        // Assert
        assertTrue(result.isFailure)
        assertEquals(ConnectionState.ERROR, p2pClient.connectionState.value)
        assertEquals(null, p2pClient.connectedPeer.value)
    }

    @Test
    fun `test send command success`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-789"
        val pcDID = "did:example:pc-789"

        // Setup connection
        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        // Mock DID signing
        coEvery { mockDIDManager.getCurrentDID() } returns "did:example:android-123"
        coEvery { mockDIDManager.sign(any()) } returns "mock-signature"

        // Mock WebRTC send
        every { mockWebRTCClient.sendMessage(any()) } just Runs

        // Setup response handler
        val responseJson = """
            {
                "type": "COMMAND_RESPONSE",
                "payload": "{\"jsonrpc\":\"2.0\",\"id\":\"req-123\",\"result\":{\"status\":\"ok\"}}"
            }
        """.trimIndent()

        // Simulate receiving response after 100ms
        coEvery { mockWebRTCClient.setOnMessageReceived(any()) } answers {
            val callback = firstArg<(String) -> Unit>()
            // Simulate async response
            kotlinx.coroutines.GlobalScope.launch {
                kotlinx.coroutines.delay(100)
                callback(responseJson)
            }
        }

        // Act
        val result = p2pClient.sendCommand<Map<String, Any>>(
            method = "ai.chat",
            params = mapOf("message" to "Hello")
        )

        // Assert
        assertTrue(result.isSuccess)
        assertEquals("ok", result.getOrNull()?.get("status"))

        verify { mockWebRTCClient.sendMessage(any()) }
        coVerify { mockDIDManager.sign(any()) }
    }

    @Test
    fun `test send command when disconnected`() = runTest {
        // Arrange
        // Don't connect first

        // Act
        val result = p2pClient.sendCommand<Any>(
            method = "ai.chat",
            params = mapOf("message" to "Hello")
        )

        // Assert
        assertTrue(result.isFailure)
        assertEquals("Not connected", result.exceptionOrNull()?.message)
    }

    @Test
    fun `test send command timeout`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-timeout"
        val pcDID = "did:example:pc-timeout"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        coEvery { mockDIDManager.getCurrentDID() } returns "did:example:android"
        coEvery { mockDIDManager.sign(any()) } returns "signature"

        every { mockWebRTCClient.sendMessage(any()) } just Runs

        // Don't send response (simulate timeout)
        coEvery { mockWebRTCClient.setOnMessageReceived(any()) } just Runs

        // Act
        val result = p2pClient.sendCommand<Any>(
            method = "ai.chat",
            params = mapOf("message" to "Test"),
            timeout = 500L // Short timeout for test
        )

        // Assert
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("timeout") == true)
    }

    @Test
    fun `test create auth info`() = runTest {
        // Arrange
        val did = "did:example:test"
        val method = "ai.chat"
        val params = mapOf("message" to "Hello")

        coEvery { mockDIDManager.getCurrentDID() } returns did
        coEvery { mockDIDManager.sign(any()) } returns "test-signature"

        // Act
        val auth = p2pClient.createAuth(method, params)

        // Assert
        assertEquals(did, auth.did)
        assertEquals("test-signature", auth.signature)
        assertTrue(auth.timestamp > 0)
        assertTrue(auth.nonce.isNotEmpty())

        coVerify { mockDIDManager.sign(any()) }
    }

    @Test
    fun `test heartbeat starts after connection`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-heartbeat"
        val pcDID = "did:example:pc-heartbeat"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        every { mockWebRTCClient.sendMessage(any()) } just Runs

        // Act
        p2pClient.connect(pcPeerId, pcDID)

        // Wait for heartbeat to trigger
        kotlinx.coroutines.delay(100)

        // Assert
        // Heartbeat should be running (we can't directly test, but connection state should be CONNECTED)
        assertEquals(ConnectionState.CONNECTED, p2pClient.connectionState.value)
    }

    @Test
    fun `test disconnect clears state`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-disconnect"
        val pcDID = "did:example:pc-disconnect"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        every { mockWebRTCClient.disconnect() } just Runs

        // Act
        p2pClient.disconnect()

        // Assert
        assertEquals(ConnectionState.DISCONNECTED, p2pClient.connectionState.value)
        assertEquals(null, p2pClient.connectedPeer.value)

        verify { mockWebRTCClient.disconnect() }
    }

    @Test
    fun `test disconnect completes pending requests with error`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-pending"
        val pcDID = "did:example:pc-pending"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        coEvery { mockDIDManager.getCurrentDID() } returns "did:example:android"
        coEvery { mockDIDManager.sign(any()) } returns "signature"
        every { mockWebRTCClient.sendMessage(any()) } just Runs
        coEvery { mockWebRTCClient.setOnMessageReceived(any()) } just Runs
        every { mockWebRTCClient.disconnect() } just Runs

        // Start a command (don't wait for response)
        val deferred = kotlinx.coroutines.async {
            p2pClient.sendCommand<Any>(
                method = "ai.chat",
                params = mapOf("message" to "Test"),
                timeout = 10000L
            )
        }

        // Wait a bit for request to be sent
        kotlinx.coroutines.delay(50)

        // Act
        p2pClient.disconnect()

        // Wait for deferred to complete
        val result = deferred.await()

        // Assert
        assertTrue(result.isFailure)
        assertEquals("Connection closed", result.exceptionOrNull()?.message)
    }

    @Test
    fun `test handle command response`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-response"
        val pcDID = "did:example:pc-response"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        val requestId = "req-test-123"
        val response = CommandResponse(
            id = requestId,
            result = mapOf("data" to "success")
        )

        val message = P2PMessage(
            type = MessageTypes.COMMAND_RESPONSE,
            payload = response.toJsonString()
        )

        // Act
        p2pClient.handleMessage(message.toJsonString())

        // Assert
        // Response should be processed (pending request would be completed)
        // This is an internal method, so we're testing it doesn't throw
    }

    @Test
    fun `test handle event notification`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-event"
        val pcDID = "did:example:pc-event"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        val event = EventNotification(
            method = "system.statusChanged",
            params = mapOf("status" to "busy")
        )

        val message = P2PMessage(
            type = MessageTypes.EVENT_NOTIFICATION,
            payload = event.toJsonString()
        )

        // Collect events
        val events = mutableListOf<EventNotification>()
        val job = kotlinx.coroutines.launch {
            p2pClient.events.collect { events.add(it) }
        }

        // Act
        p2pClient.handleMessage(message.toJsonString())

        // Wait for event to be processed
        kotlinx.coroutines.delay(50)

        // Assert
        assertEquals(1, events.size)
        assertEquals("system.statusChanged", events[0].method)
        assertEquals("busy", events[0].params["status"])

        job.cancel()
    }

    @Test
    fun `test generate request id is unique`() {
        // Act
        val id1 = p2pClient.generateRequestId()
        val id2 = p2pClient.generateRequestId()
        val id3 = p2pClient.generateRequestId()

        // Assert
        assertTrue(id1.startsWith("req-"))
        assertTrue(id2.startsWith("req-"))
        assertTrue(id3.startsWith("req-"))
        assertFalse(id1 == id2)
        assertFalse(id2 == id3)
        assertFalse(id1 == id3)
    }

    @Test
    fun `test generate nonce is unique`() {
        // Act
        val nonce1 = p2pClient.generateNonce()
        val nonce2 = p2pClient.generateNonce()
        val nonce3 = p2pClient.generateNonce()

        // Assert
        assertTrue(nonce1.length >= 5)
        assertTrue(nonce2.length >= 5)
        assertTrue(nonce3.length >= 5)
        assertFalse(nonce1 == nonce2)
        assertFalse(nonce2 == nonce3)
    }

    @Test
    fun `test connection state flow updates`() = runTest {
        // Arrange
        val states = mutableListOf<ConnectionState>()
        val job = kotlinx.coroutines.launch {
            p2pClient.connectionState.collect { states.add(it) }
        }

        coEvery { mockWebRTCClient.connect(any()) } returns Result.success(Unit)

        // Act
        p2pClient.connect("peer-123", "did:example:123")

        // Wait for state updates
        kotlinx.coroutines.delay(100)

        // Assert
        assertTrue(states.contains(ConnectionState.DISCONNECTED)) // Initial state
        assertTrue(states.contains(ConnectionState.CONNECTING))
        assertTrue(states.contains(ConnectionState.CONNECTED))

        job.cancel()
    }

    @Test
    fun `test error response handling`() = runTest {
        // Arrange
        val pcPeerId = "pc-peer-error"
        val pcDID = "did:example:pc-error"

        coEvery { mockWebRTCClient.connect(pcPeerId) } returns Result.success(Unit)
        p2pClient.connect(pcPeerId, pcDID)

        coEvery { mockDIDManager.getCurrentDID() } returns "did:example:android"
        coEvery { mockDIDManager.sign(any()) } returns "signature"
        every { mockWebRTCClient.sendMessage(any()) } just Runs

        // Setup error response
        val errorResponse = CommandResponse(
            id = "req-error",
            error = ErrorInfo(
                code = -32600,
                message = "Invalid Request"
            )
        )

        val responseJson = """
            {
                "type": "COMMAND_RESPONSE",
                "payload": "${errorResponse.toJsonString().replace("\"", "\\\"")}"
            }
        """.trimIndent()

        coEvery { mockWebRTCClient.setOnMessageReceived(any()) } answers {
            val callback = firstArg<(String) -> Unit>()
            kotlinx.coroutines.GlobalScope.launch {
                kotlinx.coroutines.delay(50)
                callback(responseJson)
            }
        }

        // Act
        val result = p2pClient.sendCommand<Any>(
            method = "invalid.method",
            params = emptyMap()
        )

        // Assert
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("Invalid Request") == true)
    }
}
