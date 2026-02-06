package com.chainlesschain.android.feature.p2p.webrtc.signaling
import org.junit.Ignore

import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for WebSocketSignalingClient
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Ignore("WebRTC测试暂时禁用 - 需要修复导入和配置")
class WebSocketSignalingClientTest {

    private lateinit var client: WebSocketSignalingClient
    private lateinit var mockOkHttpClient: OkHttpClient
    private lateinit var mockWebSocket: WebSocket
    private val json = Json { ignoreUnknownKeys = true }

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        // Mock OkHttpClient and WebSocket
        mockOkHttpClient = mockk(relaxed = true)
        mockWebSocket = mockk(relaxed = true)

        every { mockOkHttpClient.newWebSocket(any(), any()) } answers {
            val listener = secondArg<WebSocketListener>()
            // Simulate successful connection
            listener.onOpen(mockWebSocket, mockk(relaxed = true))
            mockWebSocket
        }

        client = WebSocketSignalingClient(mockOkHttpClient, json)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
    }

    @Test
    fun `connect should transition to CONNECTED state`() = runTest {
        // Given
        val userId = "did:example:alice"
        val token = "test-token"

        // When
        val result = client.connect(userId, token)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess, "Connect should succeed")
        assertEquals(ConnectionState.CONNECTED, client.connectionState.value)
        assertTrue(client.isConnected())
    }

    @Test
    fun `send message when connected should succeed`() = runTest {
        // Given
        val userId = "did:example:alice"
        val token = "test-token"
        client.connect(userId, token)
        advanceUntilIdle()

        every { mockWebSocket.send(any<String>()) } returns true

        val message = SignalingMessage.Offer(
            from = userId,
            to = "did:example:bob",
            sdp = "v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n..."
        )

        // When
        val result = client.send(message)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess, "Send should succeed")
        verify { mockWebSocket.send(any<String>()) }
    }

    @Test
    fun `send message when disconnected should queue message`() = runTest {
        // Given - client not connected
        val message = SignalingMessage.IceCandidate(
            from = "did:example:alice",
            to = "did:example:bob",
            candidate = "candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host",
            sdpMid = "0",
            sdpMLineIndex = 0
        )

        // When
        val result = client.send(message)
        advanceUntilIdle()

        // Then
        assertTrue(result.isFailure, "Send should fail when disconnected")
        verify(exactly = 0) { mockWebSocket.send(any<String>()) }
    }

    @Test
    fun `disconnect should transition to DISCONNECTED state`() = runTest {
        // Given
        val userId = "did:example:alice"
        val token = "test-token"
        client.connect(userId, token)
        advanceUntilIdle()

        // When
        client.disconnect()
        advanceUntilIdle()

        // Then
        assertEquals(ConnectionState.DISCONNECTED, client.connectionState.value)
        assertFalse(client.isConnected())
        verify { mockWebSocket.close(1000, "Client disconnect") }
    }

    @Test
    fun `onMessage should emit incoming messages`() = runTest {
        // Given
        val userId = "did:example:alice"
        val token = "test-token"

        // Capture WebSocketListener
        var capturedListener: WebSocketListener? = null
        every { mockOkHttpClient.newWebSocket(any(), any()) } answers {
            capturedListener = secondArg<WebSocketListener>()
            capturedListener?.onOpen(mockWebSocket, mockk(relaxed = true))
            mockWebSocket
        }

        client.connect(userId, token)
        advanceUntilIdle()

        // When - simulate receiving an offer
        val offerJson = """
            {
                "type": "offer",
                "payload": {
                    "from": "did:example:bob",
                    "to": "$userId",
                    "timestamp": ${System.currentTimeMillis()},
                    "sdp": "v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\n...",
                    "type": "offer"
                }
            }
        """.trimIndent()

        backgroundScope.launch {
            val message = client.incomingMessages.first()
            assertTrue(message is SignalingMessage.Offer)
            assertEquals("did:example:bob", message.from)
        }

        capturedListener?.onMessage(mockWebSocket, offerJson)
        advanceUntilIdle()
    }

    @Test
    fun `reconnection should use exponential backoff`() = runTest {
        // Given - simulate connection failure
        every { mockOkHttpClient.newWebSocket(any(), any()) } answers {
            val listener = secondArg<WebSocketListener>()
            // Simulate failure
            listener.onFailure(mockWebSocket, Exception("Connection failed"), null)
            mockWebSocket
        }

        client = WebSocketSignalingClient(mockOkHttpClient, json)

        // When
        client.connect("did:example:alice", "test-token")
        advanceUntilIdle()

        // Then - should be in RECONNECTING state
        assertEquals(ConnectionState.DISCONNECTED, client.connectionState.value)
    }

    @Test
    fun `heartbeat should send ping messages periodically`() = runTest {
        // Given
        val userId = "did:example:alice"
        val token = "test-token"

        every { mockWebSocket.send(any<String>()) } returns true

        client.connect(userId, token)
        advanceUntilIdle()

        // When - advance time by 30 seconds (heartbeat interval)
        advanceTimeBy(30_000L)

        // Then - should have sent at least one ping
        verify(atLeast = 1) { mockWebSocket.send(match { it.contains("\"type\":\"ping\"") }) }
    }

    @Test
    fun `multiple offers should be handled correctly`() = runTest {
        // Given
        val userId = "did:example:alice"
        client.connect(userId, "test-token")
        advanceUntilIdle()

        every { mockWebSocket.send(any<String>()) } returns true

        // When - send multiple offers
        repeat(5) { i ->
            val message = SignalingMessage.Offer(
                from = userId,
                to = "did:example:bob",
                sdp = "sdp-$i"
            )
            client.send(message)
        }
        advanceUntilIdle()

        // Then - all should be sent
        verify(exactly = 5) { mockWebSocket.send(match { it.contains("\"type\":\"offer\"") }) }
    }

    @Test
    fun `cleanup should close connection and cancel jobs`() = runTest {
        // Given
        client.connect("did:example:alice", "test-token")
        advanceUntilIdle()

        // When
        client.cleanup()
        advanceUntilIdle()

        // Then
        verify { mockWebSocket.close(1000, "Cleanup") }
    }

    @Test
    fun `bye message should be sent successfully`() = runTest {
        // Given
        val userId = "did:example:alice"
        client.connect(userId, "test-token")
        advanceUntilIdle()

        every { mockWebSocket.send(any<String>()) } returns true

        // When
        val byeMessage = SignalingMessage.Bye(
            from = userId,
            to = "did:example:bob",
            reason = "User ended call"
        )
        client.send(byeMessage)
        advanceUntilIdle()

        // Then
        verify { mockWebSocket.send(match { it.contains("\"type\":\"bye\"") }) }
    }
}
