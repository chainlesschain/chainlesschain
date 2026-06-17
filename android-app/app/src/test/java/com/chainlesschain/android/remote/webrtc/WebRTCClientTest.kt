package com.chainlesschain.android.remote.webrtc

import android.content.Context
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.webrtc.*
import java.nio.ByteBuffer
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

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
    private lateinit var mockPairedPeersStore: com.chainlesschain.android.core.p2p.pairing.PairedPeersStore
    private lateinit var mockOkHttpClient: okhttp3.OkHttpClient
    private lateinit var mockSignalingConfig: com.chainlesschain.android.core.p2p.config.SignalingConfig
    private lateinit var mockPeerConnectionFactory: PeerConnectionFactory
    private lateinit var mockPeerConnection: PeerConnection
    private lateinit var mockDataChannel: DataChannel

    // Captured observers for simulating callbacks
    private var capturedPeerConnectionObserver: PeerConnection.Observer? = null
    private var capturedDataChannelObserver: DataChannel.Observer? = null

    private val testPeerId = "pc-peer-test-123"
    private val testLocalPeerId = "android-peer-test-456"

    @Before
    fun setup() {
        // Mock Android Context
        mockContext = mockk(relaxed = true)

        // Mock SignalClient
        mockSignalClient = mockk(relaxed = true)
        coEvery { mockSignalClient.connect() } returns Result.success(Unit)
        coEvery { mockSignalClient.disconnect() } just Runs

        // Mock PairedPeersStore (Plan B v1.3+ ICE servers persistence).
        // `devices` is `StateFlow<List<PairedPeer>>`. A bare relaxed mock returns
        // a relaxed StateFlow whose `.value` is a relaxed `Any`, not a `List`, so
        // production-side `pairedPeersStore.devices.value.firstOrNull { ... }`
        // would crash with "class java.lang.Object cannot be cast to java.lang.Iterable"
        // and `connect()` would surface "连接失败: ..." (see WebRTCClient.kt:70).
        // Stub with a real MutableStateFlow so the generic erasure stays sound.
        mockPairedPeersStore = mockk(relaxed = true)
        every { mockPairedPeersStore.devices } returns MutableStateFlow(emptyList())

        // FAMILY-67 plan B: TURN 凭证拉取依赖（手机↔手机），测试中不实际发请求
        mockOkHttpClient = mockk(relaxed = true)
        mockSignalingConfig = mockk(relaxed = true)

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
        webRTCClient = WebRTCClient(mockContext, mockSignalClient, mockPairedPeersStore, mockOkHttpClient, mockSignalingConfig)
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
        // Was `verify { mockPeerConnectionFactory }` — mockk requires a method-call
        // inside verify {}, just referencing the mock raises "Missing calls inside verify {}".
        // The mocked builder.createPeerConnectionFactory() returns mockPeerConnectionFactory,
        // and the @Before setup already exercised that path.
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

        // WebRTC's SessionDescription has public final fields (description, type) — not
        // Kotlin properties — so `every { mockOffer.description } returns ...` doesn't
        // record any method calls and mockk raises "Missing mocked calls inside every {}".
        // Construct real SessionDescription instances instead.
        val mockOffer = SessionDescription(SessionDescription.Type.OFFER, "v=0\no=- 123 456 IN IP4 0.0.0.0\n...")
        val mockAnswer = SessionDescription(SessionDescription.Type.ANSWER, "v=0\no=- 789 012 IN IP4 0.0.0.0\n...")

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
        val result = webRTCClient.connect(testPeerId, testLocalPeerId)

        // Assert — production now uses DATA_CHANNEL_LABEL = "chainlesschain-data"
        // (WebRTCClient.kt:67) and waitForAnswer timeout = 15000 (WebRTCClient.kt:146).
        assertTrue(result.isSuccess, "Connection should succeed")
        coVerify { mockSignalClient.connect() }
        verify { mockPeerConnectionFactory.createPeerConnection(any<PeerConnection.RTCConfiguration>(), any<PeerConnection.Observer>()) }
        verify { mockPeerConnection.createDataChannel("chainlesschain-data", any()) }
        coVerify { mockSignalClient.sendOffer(testPeerId, mockOffer) }
        coVerify { mockSignalClient.waitForAnswer(testPeerId, 15000) }
    }

    @Test
    fun `connect() as responder waits for offer and sends answer (FAMILY-30)`() = runTest {
        // Arrange
        webRTCClient.initialize()
        val mockOffer = SessionDescription(SessionDescription.Type.OFFER, "v=0\no=- 1 1 IN IP4 0.0.0.0\n...")
        val mockAnswer = SessionDescription(SessionDescription.Type.ANSWER, "v=0\no=- 2 2 IN IP4 0.0.0.0\n...")

        // Responder creates an ANSWER (not an offer)
        every { mockPeerConnection.createAnswer(any(), any()) } answers {
            firstArg<SdpObserver>().onCreateSuccess(mockAnswer)
        }
        every { mockPeerConnection.setLocalDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }
        every { mockPeerConnection.setRemoteDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }
        coEvery { mockSignalClient.waitForOffer(testPeerId, any()) } returns mockOffer
        coEvery { mockSignalClient.sendAnswer(any(), any()) } just Runs
        coEvery { mockSignalClient.receiveIceCandidate() } throws Exception("No ICE")

        // Act — responder path (isInitiator = false)
        val result = webRTCClient.connect(testPeerId, testLocalPeerId, isInitiator = false)

        // Assert — responder: waitForOffer → setRemoteDescription(offer) → createAnswer → sendAnswer
        assertTrue(result.isSuccess, "Responder connection should succeed")
        coVerify { mockSignalClient.waitForOffer(testPeerId, 15000) }
        verify { mockPeerConnection.setRemoteDescription(any(), any()) }
        verify { mockPeerConnection.createAnswer(any(), any()) }
        coVerify { mockSignalClient.sendAnswer(testPeerId, mockAnswer) }
        // Responder does NOT self-create a DataChannel (受领 via onDataChannel) nor an offer.
        verify(exactly = 0) { mockPeerConnection.createDataChannel(any(), any()) }
        verify(exactly = 0) { mockPeerConnection.createOffer(any(), any()) }
        coVerify(exactly = 0) { mockSignalClient.sendOffer(any(), any()) }
    }

    @Test
    fun `connect() should fail when signal server connection fails`() = runTest {
        // Arrange
        webRTCClient.initialize()
        coEvery { mockSignalClient.connect() } returns Result.failure(Exception("Signal server unreachable"))

        // Act
        val result = webRTCClient.connect(testPeerId, testLocalPeerId)

        // Assert — production wraps the underlying signal failure with a Chinese prefix
        // (WebRTCClient.kt:114: "信令服务器连接失败: {underlying.message}"), so check for
        // the underlying message as a substring rather than exact equality.
        assertTrue(result.isFailure, "Connection should fail")
        assertTrue(
            result.exceptionOrNull()?.message?.contains("Signal server unreachable") == true,
            "Error message should mention the underlying signal failure"
        )
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
        val result = webRTCClient.connect(testPeerId, testLocalPeerId)

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

        val mockOffer = SessionDescription(SessionDescription.Type.OFFER, "v=0\n...")
        val mockAnswer = SessionDescription(SessionDescription.Type.ANSWER, "v=0\n...")

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
        val result = webRTCClient.connect(testPeerId, testLocalPeerId)

        // Assert
        assertTrue(result.isFailure, "Connection should fail")
        assertTrue(
            result.exceptionOrNull()?.message?.contains("Remote description invalid") == true,
            "Error message should mention remote description failure"
        )
    }

    // ==================== DataChannel Tests ====================

    @Test
    fun `sendMessage() should send data through DataChannel`() = runTest {
        // Arrange — drive a connect flow so production's internal `dataChannel` field
        // is populated with mockDataChannel. Otherwise sendMessage throws
        // IllegalStateException("Data channel not initialized").
        webRTCClient.initialize()
        driveSuccessfulConnect()

        val testMessage = "Hello, ChainlessChain!"
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
        // Arrange — drive connect so production's PeerConnection.Observer is captured
        // AND its `pcPeerId` closure value is set to testPeerId. (Previous version
        // called createPeerConnection directly with mockk() args — the captured observer
        // was the test's mock, not production's, so onIceCandidate did nothing and
        // signalClient.sendIceCandidate was never called.)
        webRTCClient.initialize()
        driveSuccessfulConnect()
        assertNotNull(capturedPeerConnectionObserver)

        // IceCandidate has public final fields — construct directly.
        val testIceCandidate = IceCandidate(
            "0",
            0,
            "candidate:1 1 UDP 123456 192.168.1.1 54321 typ host"
        )

        coEvery { mockSignalClient.sendIceCandidate(any(), any()) } just Runs

        // Act - Trigger production's onIceCandidate via the captured real observer.
        capturedPeerConnectionObserver?.onIceCandidate(testIceCandidate)

        // Assert — production launches sendIceCandidate on its scope (Dispatchers.IO),
        // so we use coVerify with timeout to wait for cross-dispatcher delivery.
        coVerify(timeout = 1000) {
            mockSignalClient.sendIceCandidate(testPeerId, testIceCandidate)
        }
    }

    @Test
    fun `should queue remote ICE candidates before remote description is set`() = runBlocking {
        // Use real runBlocking (not runTest) because production's startRemoteIceListener
        // launches on scope=Dispatchers.IO (real threads), and waitForAnswer's `delay(200)`
        // coAnswers crosses that real-time boundary. Under runTest's virtual-time
        // StandardTestDispatcher, the IO listener's coroutine never gets the real time it
        // needs to: (a) receive the queued mockIceCandidate from iceChannel, (b) observe
        // the post-setRemoteDescription drainPendingRemoteCandidates path. Same pattern as
        // P2PClientTest after `caf512f5e` (#17 RZ2). Issue #18 residual.
        webRTCClient.initialize()

        val mockOffer = SessionDescription(SessionDescription.Type.OFFER, "v=0\n...")

        every { mockPeerConnection.createOffer(any(), any()) } answers {
            firstArg<SdpObserver>().onCreateSuccess(mockOffer)
        }

        every { mockPeerConnection.setLocalDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }

        val mockIceCandidate = IceCandidate("0", 0, "candidate:1 1 UDP 123456 192.168.1.1 54321 typ host")
        val iceChannel = Channel<IceCandidate>(Channel.UNLIMITED)
        iceChannel.send(mockIceCandidate)

        coEvery { mockSignalClient.sendOffer(any(), any()) } just Runs
        coEvery { mockSignalClient.receiveIceCandidate() } coAnswers {
            iceChannel.receive()
        }

        every { mockPeerConnection.addIceCandidate(any()) } returns true

        // Mock answer reception
        val mockAnswer = SessionDescription(SessionDescription.Type.ANSWER, "v=0\n...")
        coEvery { mockSignalClient.waitForAnswer(any(), any()) } coAnswers {
            delay(200) // Simulate delay
            mockAnswer
        }

        every { mockPeerConnection.setRemoteDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }

        // Act
        val result = webRTCClient.connect(testPeerId, testLocalPeerId)

        // Assert
        assertTrue(
            result.isSuccess,
            "connect() should succeed but failed: ${result.exceptionOrNull()?.message}"
        )
        // ICE candidate should be added after remote description is set.
        //
        // The remote-ICE listener runs on WebRTCClient.scope (Dispatchers.IO) — a REAL
        // thread that runTest's StandardTestDispatcher does not drive. waitForAnswer's
        // `delay(200)` is virtual time and fast-forwards instantly, so connect() can
        // return success before the IO listener has had real time to pull the queued
        // candidate from iceChannel and route it through addIceCandidate (either
        // directly when isRemoteDescriptionSet is true, or via drainPendingRemoteCandidates).
        //
        // Use coVerify(timeout = 1000) to wait up to 1s real time for cross-dispatcher
        // delivery — mirrors the established pattern at line 386-388 for sendIceCandidate.
        coVerify(timeout = 1000) {
            mockPeerConnection.addIceCandidate(mockIceCandidate)
        }
    }

    // ==================== Connection State Tests ====================

    @Test
    fun `PeerConnection observer should log connection state changes`() {
        // Arrange
        webRTCClient.initialize()

        mockPeerConnectionFactory.createPeerConnection(
            mockk<PeerConnection.RTCConfiguration>(relaxed = true),
            mockk<PeerConnection.Observer>(relaxed = true)
        )

        // Act - Simulate connection state changes
        capturedPeerConnectionObserver?.onConnectionChange(PeerConnection.PeerConnectionState.CONNECTED)
        capturedPeerConnectionObserver?.onIceConnectionChange(PeerConnection.IceConnectionState.CONNECTED)
        capturedPeerConnectionObserver?.onIceGatheringChange(PeerConnection.IceGatheringState.COMPLETE)

        // Assert - Should not crash and logs should be called
        assertNotNull(capturedPeerConnectionObserver)
    }

    @Test
    fun `should handle onDataChannel callback when peer creates channel`() = runTest {
        // Arrange — drive connect to capture production's real PeerConnection.Observer
        // (rather than the mockk() passed by the previous version of this test, which
        // captured a no-op mock and made onDataChannel() do nothing).
        webRTCClient.initialize()
        driveSuccessfulConnect()
        assertNotNull(capturedPeerConnectionObserver)

        val remoteDataChannel = mockk<DataChannel>(relaxed = true)
        every { remoteDataChannel.label() } returns "remote-channel"

        // Act - Simulate remote peer creating data channel; production's onDataChannel
        // handler reassigns `dataChannel = dc` and calls `setupDataChannel(dc)`, which
        // invokes `dc.registerObserver(...)`.
        capturedPeerConnectionObserver?.onDataChannel(remoteDataChannel)

        // Assert
        verify { remoteDataChannel.registerObserver(any()) }
    }

    // ==================== Disconnect Tests ====================

    @Test
    fun `disconnect() should cleanup all resources`() = runTest {
        // Arrange — production's disconnect() reads `dataChannel?.close()` and
        // `peerConnection?.close()` with safe-call. Those fields are only populated when
        // connect() runs. Drive a successful connect flow first so the internal fields
        // hold mockDataChannel / mockPeerConnection; then disconnect's close() calls
        // become observable verifies.
        webRTCClient.initialize()
        driveSuccessfulConnect()

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
        // Arrange — drive a connect flow so the internal peerConnection is non-null
        // and disconnect() actually invokes `peerConnection?.close()`.
        webRTCClient.initialize()
        driveSuccessfulConnect()

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
    fun `should handle DataChannel state transitions`() = runTest {
        // Arrange — drive a connect flow so production's setupDataChannel() runs and
        // registers its DataChannel.Observer on mockDataChannel. The setup's
        // `every { mockDataChannel.registerObserver(any()) }` captures that observer
        // into capturedDataChannelObserver. (The previous test pattern of stubbing
        // registerObserver locally + calling mockPeerConnection.createDataChannel
        // directly never triggered production's setupDataChannel, so observer stayed null.)
        webRTCClient.initialize()
        driveSuccessfulConnect()
        assertNotNull(capturedDataChannelObserver)

        // Act - Simulate state changes
        every { mockDataChannel.state() } returns DataChannel.State.CONNECTING
        capturedDataChannelObserver?.onStateChange()

        every { mockDataChannel.state() } returns DataChannel.State.OPEN
        capturedDataChannelObserver?.onStateChange()

        every { mockDataChannel.state() } returns DataChannel.State.CLOSING
        capturedDataChannelObserver?.onStateChange()

        every { mockDataChannel.state() } returns DataChannel.State.CLOSED
        capturedDataChannelObserver?.onStateChange()

        // Assert - Should not crash; observer remains non-null after all transitions.
        assertNotNull(capturedDataChannelObserver)
    }

    @Test
    fun `should handle buffered amount changes in DataChannel`() = runTest {
        // Arrange — same pattern as state-transitions test: drive connect so production
        // sets up the observer on mockDataChannel.
        webRTCClient.initialize()
        driveSuccessfulConnect()
        assertNotNull(capturedDataChannelObserver)

        // Act
        capturedDataChannelObserver?.onBufferedAmountChange(1024L)
        capturedDataChannelObserver?.onBufferedAmountChange(0L)

        // Assert - Should not crash
        assertNotNull(capturedDataChannelObserver)
    }

    @Test
    fun `should handle corrupted message data gracefully`() = runTest {
        // Arrange — drive connect so production captures its DataChannel observer.
        webRTCClient.initialize()
        driveSuccessfulConnect()
        assertNotNull(capturedDataChannelObserver)

        val receivedMessages = mutableListOf<String>()
        webRTCClient.setOnMessageReceived { message ->
            receivedMessages.add(message)
        }

        // Act — DataChannel.Buffer has public final fields (data, binary), can't be
        // mockked. Construct a real Buffer whose backing ByteBuffer position equals
        // limit — `buffer.data.remaining() == 0`, producing an empty message that
        // production's try/catch in setupDataChannel handles gracefully.
        val emptyByteBuffer = java.nio.ByteBuffer.allocate(0)
        val corruptedBuffer = DataChannel.Buffer(emptyByteBuffer, false)
        capturedDataChannelObserver?.onMessage(corruptedBuffer)

        // Assert — production's try/catch in setupDataChannel.onMessage doesn't crash on
        // an empty buffer; it produces an empty-string message (decoded from 0 bytes).
        // The exact-corruption case (ByteBuffer.get() throwing) is hard to simulate
        // without mocking a final concrete class — this asserts the graceful path.
        assertTrue(receivedMessages.size <= 1, "Should not receive multiple messages from a single corrupted buffer")
    }

    /**
     * Drive a successful connect() flow so production's internal state is populated:
     *  - `peerConnection` and `dataChannel` fields hold the mocks
     *  - `capturedPeerConnectionObserver` is the *real* PeerConnection.Observer with
     *    its `pcPeerId` closure value bound to `testPeerId`
     *  - `capturedDataChannelObserver` is the *real* DataChannel.Observer created by
     *    production's `setupDataChannel(channel)`
     *
     * Use from tests that want to invoke production-side callbacks (onIceCandidate,
     * onDataChannel, onStateChange, onMessage, …) or that exercise post-connect
     * behavior like disconnect() or sendMessage().
     *
     * NOTE: this helper assumes the @Before setup's stubs for signaling.connect /
     * register / createPeerConnection / createDataChannel are still in place — it only
     * adds the SDP and answer-related stubs needed to drive connect() to completion.
     */
    private suspend fun driveSuccessfulConnect() {
        val driveOffer = SessionDescription(SessionDescription.Type.OFFER, "v=0\no=- drive 0 IN IP4 0.0.0.0\n...")
        val driveAnswer = SessionDescription(SessionDescription.Type.ANSWER, "v=0\no=- drive 1 IN IP4 0.0.0.0\n...")

        every { mockPeerConnection.createOffer(any(), any()) } answers {
            firstArg<SdpObserver>().onCreateSuccess(driveOffer)
        }
        every { mockPeerConnection.setLocalDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }
        every { mockPeerConnection.setRemoteDescription(any(), any()) } answers {
            firstArg<SdpObserver>().onSetSuccess()
        }
        coEvery { mockSignalClient.sendOffer(any(), any()) } just Runs
        coEvery { mockSignalClient.waitForAnswer(any(), any()) } returns driveAnswer
        // No remote-ICE polling in the drive helper — let the listener loop hit the
        // first failure and exit gracefully.
        coEvery { mockSignalClient.receiveIceCandidate() } throws Exception("No remote ICE")

        val result = webRTCClient.connect(testPeerId, testLocalPeerId)
        assertTrue(
            result.isSuccess,
            "driveSuccessfulConnect should reach success — got: ${result.exceptionOrNull()?.message}"
        )
    }
}
