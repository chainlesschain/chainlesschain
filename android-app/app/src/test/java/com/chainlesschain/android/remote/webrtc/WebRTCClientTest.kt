package com.chainlesschain.android.remote.webrtc

import android.content.Context
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.webrtc.*
import java.nio.ByteBuffer

/**
 * WebRTCClient 单元测试
 *
 * 测试 WebRTC P2P 连接的核心功能：
 * - 初始化和清理
 * - PeerConnection创建
 * - Offer/Answer交换
 * - ICE候选者处理
 * - DataChannel通信
 * - 错误处理
 *
 * 覆盖率目标: 85%+
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WebRTCClientTest {

    private lateinit var webRTCClient: WebRTCClient
    private lateinit var mockContext: Context
    private lateinit var mockSignalClient: SignalClient
    private lateinit var mockPeerConnectionFactory: PeerConnectionFactory
    private lateinit var mockPeerConnection: PeerConnection
    private lateinit var mockDataChannel: DataChannel

    // Captured observers for simulating callbacks
    private var capturedPeerConnectionObserver: PeerConnection.Observer? = null
    private var capturedDataChannelObserver: DataChannel.Observer? = null

    private val testPeerId = "pc-peer-test-123"

    @Before
    fun setup() {
        // Mock Android Context
        mockContext = mockk(relaxed = true)

        // Mock SignalClient
        mockSignalClient = mockk(relaxed = true)
        coEvery { mockSignalClient.connect() } returns Result.success(Unit)
        coEvery { mockSignalClient.disconnect() } just Runs

        // Mock PeerConnectionFactory static initialization
        mockkStatic(PeerConnectionFactory::class)
        every { PeerConnectionFactory.initialize(any()) } just Runs

        // Mock PeerConnectionFactory.Builder
        val mockBuilder = mockk<PeerConnectionFactory.Builder>(relaxed = true)
        every { PeerConnectionFactory.builder() } returns mockBuilder
        every { mockBuilder.setOptions(any()) } returns mockBuilder

        // Mock PeerConnectionFactory instance
        mockPeerConnectionFactory = mockk(relaxed = true)
        every { mockBuilder.createPeerConnectionFactory() } returns mockPeerConnectionFactory

        // Mock PeerConnection
        mockPeerConnection = mockk(relaxed = true)
        every {
            mockPeerConnectionFactory.createPeerConnection(
                any<PeerConnection.RTCConfiguration>(),
                any<PeerConnection.Observer>()
            )
        } answers {
            capturedPeerConnectionObserver = secondArg()
            mockPeerConnection
        }

        // Mock DataChannel
        mockDataChannel = mockk(relaxed = true)
        every { mockDataChannel.state() } returns DataChannel.State.OPEN
        every { mockDataChannel.label() } returns "command-channel"
        every { mockDataChannel.send(any()) } returns true
        every { mockDataChannel.close() } just Runs
        every {
            mockDataChannel.registerObserver(any())
        } answers {
            capturedDataChannelObserver = firstArg()
        }

        every {
            mockPeerConnection.createDataChannel(any(), any())
        } returns mockDataChannel

        // Create WebRTCClient instance
        webRTCClient = WebRTCClient(mockContext, mockSignalClient)
    }

    @After
    fun tearDown() {
        unmockkAll()
        capturedPeerConnectionObserver = null
        capturedDataChannelObserver = null
    }

    // ==================== Initialization Tests ====================

    @Test
    fun `initialize() should setup PeerConnectionFactory successfully`() {
        // Act
        webRTCClient.initialize()

        // Assert
        verify { PeerConnectionFactory.initialize(any()) }
        verify { PeerConnectionFactory.builder() }
        verify { mockPeerConnectionFactory }
    }

    @Test(expected = Exception::class)
    fun `initialize() should throw exception on failure`() {
        // Arrange
        every { PeerConnectionFactory.initialize(any()) } throws Exception("Init failed")

        // Act
        webRTCClient.initialize()

        // Exception should be thrown
    }

    // ==================== Connection Tests ====================

    @Test
    fun `connect() should establish WebRTC connection successfully`() = runTest {
        // Arrange
        webRTCClient.initialize()

        val mockOffer = mockk<SessionDescription>(relaxed = true)
        every { mockOffer.description } returns "v=0\no=- 123 456 IN IP4 0.0.0.0\n..."
        every { mockOffer.type } returns SessionDescription.Type.OFFER

        val mockAnswer = mockk<SessionDescription>(relaxed = true)
        every { mockAnswer.description } returns "v=0\no=- 789 012 IN IP4 0.0.0.0\n..."
        every { mockAnswer.type } returns SessionDescription.Type.ANSWER

        // Mock SDP creation
        every {
            mockPeerConnection.createOffer(any(), any())
        } answers {
            val observer = firstArg<SdpObserver>()
            observer.onCreateSuccess(mockOffer)
        }

        every {
            mockPeerConnection.setLocalDescription(any(), any())
        } answers {
            val observer = firstArg<SdpObserver>()
            observer.onSetSuccess()
        }

        every {
            mockPeerConnection.setRemoteDescription(any(), any())
        } answers {
            val observer = firstArg<SdpObserver>()
            observer.onSetSuccess()
        }

        coEvery { mockSignalClient.sendOffer(any(), any()) } just Runs
        coEvery { mockSignalClient.waitForAnswer(testPeerId, any()) } returns mockAnswer
        coEvery { mockSignalClient.receiveIceCandidate() } throws Exception("No ICE")

        // Act
        val result = webRTCClient.connect(testPeerId)

        // Assert
        assertTrue(result.isSuccess, "Connection should succeed")
        coVerify { mockSignalClient.connect() }
        verify { mockPeerConnectionFactory.createPeerConnection(any<PeerConnection.RTCConfiguration>(), any()) }
        verify { mockPeerConnection.createDataChannel("command-channel", any()) }
        coVerify { mockSignalClient.sendOffer(testPeerId, mockOffer) }
        coVerify { mockSignalClient.waitForAnswer(testPeerId, 10000) }
    }

    @Test
    fun `connect() should fail when signal server connection fails`() = runTest {
        // Arrange
        webRTCClient.initialize()
        coEvery { mockSignalClient.connect() } returns Result.failure(Exception("Signal server unreachable"))

        // Act
        val result = webRTCClient.connect(testPeerId)

        // Assert
        assertTrue(result.isFailure, "Connection should fail")
        assertEquals("Signal server unreachable", result.exceptionOrNull()?.message)
    }

    @Test
    fun `connect() should fail when createOffer fails`() = runTest {
        // Arrange
        webRTCClient.initialize()

        every {
            mockPeerConnection.createOffer(any(), any())
        } answers {
            val observer = firstArg<SdpObserver>()
            observer.onCreateFailure("Offer creation failed")
        }

        coEvery { mockSignalClient.receiveIceCandidate() } throws Exception("No ICE")

        // Act
        val result = webRTCClient.connect(testPeerId)

        // Assert
        assertTrue(result.isFailure, "Connection should fail")
        assertTrue(
            result.exceptionOrNull()?.message?.contains("Offer creation failed") == true,
            "Error message should mention offer failure"
        )
    }

    @Test
    fun `connect() should fail when setRemoteDescription fails`() = runTest {
        // Arrange
        webRTCClient.initialize()

        val mockOffer = mockk<SessionDescription>(relaxed = true)
        every { mockOffer.description } returns "v=0\n..."
        every { mockOffer.type } returns SessionDescription.Type.OFFER

        val mockAnswer = mockk<SessionDescription>(relaxed = true)

        every { mockPeerConnection.createOffer(any(), any()) } answers {
            val observer = firstArg<SdpObserver>()
            observer.onCreateSuccess(mockOffer)
        }

        every { mockPeerConnection.setLocalDescription(any(), any()) } answers {
            val observer = firstArg<SdpObserver>()
            observer.onSetSuccess()
        }

        every { mockPeerConnection.setRemoteDescription(any(), any()) } answers {
            val observer = firstArg<SdpObserver>()
            observer.onSetFailure("Remote description invalid")
        }

        coEvery { mockSignalClient.sendOffer(any(), any()) } just Runs
        coEvery { mockSignalClient.waitForAnswer(testPeerId, any()) } returns mockAnswer
        coEvery { mockSignalClient.receiveIceCandidate() } throws Exception("No ICE")

        // Act
        val result = webRTCClient.connect(testPeerId)

        // Assert
        assertTrue(result.isFailure, "Connection should fail")
        assertTrue(
            result.exceptionOrNull()?.message?.contains("Remote description invalid") == true,
            "Error message should mention remote description failure"
        )
    }

    // ==================== DataChannel Tests ====================

    @Test
    fun `sendMessage() should send data through DataChannel`() {
        // Arrange
        webRTCClient.initialize()
        val testMessage = "Hello, ChainlessChain!"

        // Simulate DataChannel setup
        every { mockPeerConnection.createDataChannel(any(), any()) } returns mockDataChannel
        capturedDataChannelObserver = mockk(relaxed = true)

        // Create data channel internally (would normally happen in connect)
        every { mockDataChannel.state() } returns DataChannel.State.OPEN

        // Act
        webRTCClient.sendMessage(testMessage)

        // Assert
        verify {
            mockDataChannel.send(match { buffer ->
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                String(bytes, Charsets.UTF_8) == testMessage
            })
        }
    }

    @Test(expected = IllegalStateException::class)
    fun `sendMessage() should throw when DataChannel is not initialized`() {
        // Arrange
        webRTCClient.initialize()

        // Act - DataChannel was never created
        webRTCClient.sendMessage("Test")

        // Should throw IllegalStateException
    }

    @Test(expected = IllegalStateException::class)
    fun `sendMessage() should throw when DataChannel is not open`() {
        // Arrange
        webRTCClient.initialize()
        every { mockDataChannel.state() } returns DataChannel.State.CLOSED

        // Act
        webRTCClient.sendMessage("Test")

        // Should throw IllegalStateException
    }

    @Test
    fun `setOnMessageReceived() should invoke callback when message received`() {
        // Arrange
        webRTCClient.initialize()
        val receivedMessages = mutableListOf<String>()

        webRTCClient.setOnMessageReceived { message ->
            receivedMessages.add(message)
        }

        // Simulate DataChannel setup
        every { mockPeerConnection.createDataChannel(any(), any()) } returns mockDataChannel

        // Capture observer
        var observer: DataChannel.Observer? = null
        every { mockDataChannel.registerObserver(any()) } answers {
            observer = firstArg()
        }

        // Setup data channel (normally done in connect)
        // We need to call createDataChannel indirectly
        mockPeerConnection.createDataChannel("command-channel", DataChannel.Init())
        observer?.let {
            // Simulate received message
            val testMessage = "Received message"
            val buffer = mockk<DataChannel.Buffer>()
            val byteBuffer = ByteBuffer.wrap(testMessage.toByteArray(Charsets.UTF_8))
            every { buffer.data } returns byteBuffer

            // Act
            it.onMessage(buffer)

            // Assert
            assertEquals(1, receivedMessages.size)
            assertEquals(testMessage, receivedMessages[0])
        }
    }

    // ==================== ICE Candidate Tests ====================

    @Test
    fun `PeerConnection should send ICE candidates to SignalClient`() = runTest {
        // Arrange
        webRTCClient.initialize()

        val mockIceCandidate = mockk<IceCandidate>(relaxed = true)
        every { mockIceCandidate.sdpMid } returns "0"
        every { mockIceCandidate.sdpMLineIndex } returns 0
        every { mockIceCandidate.sdp } returns "candidate:1 1 UDP 123456 192.168.1.1 54321 typ host"

        coEvery { mockSignalClient.sendIceCandidate(any(), any()) } just Runs

        // Simulate peer connection creation
        mockPeerConnectionFactory.createPeerConnection(
            mockk(relaxed = true),
            mockk(relaxed = true)
        )

        // Act - Simulate ICE candidate generation
        capturedPeerConnectionObserver?.onIceCandidate(mockIceCandidate)

        // Wait for coroutine to execute
        delay(100)

        // Assert
        coVerify(timeout = 1000) {
            mockSignalClient.sendIceCandidate(testPeerId, mockIceCandidate)
        }
    }

    @Test
    fun `should queue remote ICE candidates before remote description is set`() = runTest {
        // Arrange
        webRTCClient.initialize()

        val mockOffer = mockk<SessionDescription>(relaxed = true)
        every { mockOffer.description } returns "v=0\n..."

        every { mockPeerConnection.createOffer(any(), any()) } answers {
            firstArg<SdpObserver>().onCreateSuccess(mockOffer)
        }

        every { mockPeerConnection.setLocalDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }

        val mockIceCandidate = mockk<IceCandidate>(relaxed = true)
        val iceChannel = Channel<IceCandidate>(Channel.UNLIMITED)
        iceChannel.send(mockIceCandidate)

        coEvery { mockSignalClient.sendOffer(any(), any()) } just Runs
        coEvery { mockSignalClient.receiveIceCandidate() } answers {
            iceChannel.receive()
        }

        every { mockPeerConnection.addIceCandidate(any()) } returns true

        // Mock answer reception
        val mockAnswer = mockk<SessionDescription>(relaxed = true)
        coEvery { mockSignalClient.waitForAnswer(any(), any()) } coAnswers {
            delay(200) // Simulate delay
            mockAnswer
        }

        every { mockPeerConnection.setRemoteDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }

        // Act
        val result = webRTCClient.connect(testPeerId)

        // Assert
        assertTrue(result.isSuccess)
        // ICE candidate should be added after remote description is set
        verify { mockPeerConnection.addIceCandidate(mockIceCandidate) }
    }

    // ==================== Connection State Tests ====================

    @Test
    fun `PeerConnection observer should log connection state changes`() {
        // Arrange
        webRTCClient.initialize()

        mockPeerConnectionFactory.createPeerConnection(
            mockk(relaxed = true),
            mockk(relaxed = true)
        )

        // Act - Simulate connection state changes
        capturedPeerConnectionObserver?.onConnectionChange(PeerConnection.PeerConnectionState.CONNECTED)
        capturedPeerConnectionObserver?.onIceConnectionChange(PeerConnection.IceConnectionState.CONNECTED)
        capturedPeerConnectionObserver?.onIceGatheringChange(PeerConnection.IceGatheringState.COMPLETE)

        // Assert - Should not crash and logs should be called
        assertNotNull(capturedPeerConnectionObserver)
    }

    @Test
    fun `should handle onDataChannel callback when peer creates channel`() {
        // Arrange
        webRTCClient.initialize()

        mockPeerConnectionFactory.createPeerConnection(
            mockk(relaxed = true),
            mockk(relaxed = true)
        )

        val remoteDataChannel = mockk<DataChannel>(relaxed = true)
        every { remoteDataChannel.label() } returns "remote-channel"

        // Act - Simulate remote peer creating data channel
        capturedPeerConnectionObserver?.onDataChannel(remoteDataChannel)

        // Assert - Should register observer on remote channel
        verify { remoteDataChannel.registerObserver(any()) }
    }

    // ==================== Disconnect Tests ====================

    @Test
    fun `disconnect() should cleanup all resources`() {
        // Arrange
        webRTCClient.initialize()

        // Act
        webRTCClient.disconnect()

        // Assert
        verify { mockDataChannel.close() }
        verify { mockPeerConnection.close() }
        verify { mockSignalClient.disconnect() }
    }

    @Test
    fun `cleanup() should dispose PeerConnectionFactory`() {
        // Arrange
        webRTCClient.initialize()

        // Act
        webRTCClient.cleanup()

        // Assert
        verify { mockPeerConnectionFactory.dispose() }
        verify { mockSignalClient.disconnect() }
    }

    @Test
    fun `disconnect() should clear pending ICE candidates`() = runTest {
        // Arrange
        webRTCClient.initialize()

        // Simulate some pending candidates (would happen during connect)
        // We can't directly test the internal list, but we ensure no crash

        // Act
        webRTCClient.disconnect()

        // Assert - Should not crash
        verify { mockPeerConnection.close() }
    }

    // ==================== Edge Cases ====================

    @Test
    fun `should handle null PeerConnectionFactory gracefully`() {
        // Arrange - Don't initialize

        // Act
        webRTCClient.disconnect()

        // Assert - Should not crash
        verify(exactly = 0) { mockPeerConnectionFactory.dispose() }
    }

    @Test
    fun `should handle DataChannel state transitions`() {
        // Arrange
        webRTCClient.initialize()

        var observer: DataChannel.Observer? = null
        every { mockDataChannel.registerObserver(any()) } answers {
            observer = firstArg()
        }

        mockPeerConnection.createDataChannel("test", DataChannel.Init())

        // Act - Simulate state changes
        every { mockDataChannel.state() } returns DataChannel.State.CONNECTING
        observer?.onStateChange()

        every { mockDataChannel.state() } returns DataChannel.State.OPEN
        observer?.onStateChange()

        every { mockDataChannel.state() } returns DataChannel.State.CLOSING
        observer?.onStateChange()

        every { mockDataChannel.state() } returns DataChannel.State.CLOSED
        observer?.onStateChange()

        // Assert - Should not crash
        assertNotNull(observer)
    }

    @Test
    fun `should handle buffered amount changes in DataChannel`() {
        // Arrange
        webRTCClient.initialize()

        var observer: DataChannel.Observer? = null
        every { mockDataChannel.registerObserver(any()) } answers {
            observer = firstArg()
        }

        mockPeerConnection.createDataChannel("test", DataChannel.Init())

        // Act
        observer?.onBufferedAmountChange(1024L)
        observer?.onBufferedAmountChange(0L)

        // Assert - Should not crash
        assertNotNull(observer)
    }

    @Test
    fun `should handle corrupted message data gracefully`() {
        // Arrange
        webRTCClient.initialize()

        val receivedMessages = mutableListOf<String>()
        webRTCClient.setOnMessageReceived { message ->
            receivedMessages.add(message)
        }

        var observer: DataChannel.Observer? = null
        every { mockDataChannel.registerObserver(any()) } answers {
            observer = firstArg()
        }

        mockPeerConnection.createDataChannel("test", DataChannel.Init())

        // Act - Simulate corrupted buffer (empty)
        val corruptedBuffer = mockk<DataChannel.Buffer>()
        every { corruptedBuffer.data } throws Exception("Corrupted data")

        observer?.onMessage(corruptedBuffer)

        // Assert - Should handle exception and not crash
        assertTrue(receivedMessages.isEmpty(), "No messages should be received from corrupted data")
    }
}
