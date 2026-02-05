package com.chainlesschain.android.feature.p2p.webrtc.channel

import com.chainlesschain.android.feature.p2p.webrtc.connection.WebRTCConnectionManager
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.webrtc.DataChannel
import org.webrtc.PeerConnection
import java.nio.ByteBuffer
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for DataChannelManager
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DataChannelManagerTest {

    private lateinit var dataChannelManager: DataChannelManager
    private lateinit var mockConnectionManager: WebRTCConnectionManager
    private lateinit var mockPeerConnection: PeerConnection
    private lateinit var mockReliableChannel: DataChannel
    private lateinit var mockUnreliableChannel: DataChannel

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        mockConnectionManager = mockk(relaxed = true)
        mockPeerConnection = mockk(relaxed = true)
        mockReliableChannel = mockk(relaxed = true)
        mockUnreliableChannel = mockk(relaxed = true)

        every { mockConnectionManager.getPeerConnection(any()) } returns mockPeerConnection
        every { mockPeerConnection.createDataChannel(match { it.startsWith("reliable-") }, any()) } returns mockReliableChannel
        every { mockPeerConnection.createDataChannel(match { it.startsWith("unreliable-") }, any()) } returns mockUnreliableChannel

        every { mockReliableChannel.state() } returns DataChannel.State.OPEN
        every { mockUnreliableChannel.state() } returns DataChannel.State.OPEN
        every { mockReliableChannel.registerObserver(any()) } just Runs
        every { mockUnreliableChannel.registerObserver(any()) } just Runs

        dataChannelManager = DataChannelManager(mockConnectionManager)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
    }

    @Test
    fun `createDataChannels should create both channels`() = runTest {
        // Given
        val peerId = "did:example:bob"

        // When
        val result = dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess, "Should successfully create channels")
        verify { mockPeerConnection.createDataChannel(match { it.startsWith("reliable-") }, any()) }
        verify { mockPeerConnection.createDataChannel(match { it.startsWith("unreliable-") }, any()) }
    }

    @Test
    fun `sendReliable should send data successfully`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        every { mockReliableChannel.send(any()) } returns true

        val testData = "Hello, World!".toByteArray()

        // When
        val result = dataChannelManager.sendReliable(peerId, testData, binary = false)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess, "Should successfully send data")
        verify { mockReliableChannel.send(any()) }
    }

    @Test
    fun `sendReliable should fail when channel buffer is full`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        every { mockReliableChannel.send(any()) } returns false

        val testData = "Test".toByteArray()

        // When
        val result = dataChannelManager.sendReliable(peerId, testData)
        advanceUntilIdle()

        // Then
        assertTrue(result.isFailure, "Should fail when buffer is full")
    }

    @Test
    fun `sendUnreliable should send data successfully`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        every { mockUnreliableChannel.send(any()) } returns true

        val testData = "Realtime message".toByteArray()

        // When
        val result = dataChannelManager.sendUnreliable(peerId, testData)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess, "Should successfully send unreliable data")
        verify { mockUnreliableChannel.send(any()) }
    }

    @Test
    fun `sendText should send text message`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        every { mockReliableChannel.send(any()) } returns true

        // When
        val result = dataChannelManager.sendText(peerId, "Hello, Bob!")
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess, "Should successfully send text")
        verify { mockReliableChannel.send(any()) }
    }

    @Test
    fun `isReady should return true when both channels are open`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        // When
        val isReady = dataChannelManager.isReady(peerId)

        // Then
        assertTrue(isReady, "Should be ready when both channels are open")
    }

    @Test
    fun `isReady should return false when channels not created`() = runTest {
        // Given
        val peerId = "did:example:bob"

        // When
        val isReady = dataChannelManager.isReady(peerId)

        // Then
        assertFalse(isReady, "Should not be ready when channels don't exist")
    }

    @Test
    fun `closeDataChannels should close both channels`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        // When
        dataChannelManager.closeDataChannels(peerId)
        advanceUntilIdle()

        // Then
        verify { mockReliableChannel.close() }
        verify { mockUnreliableChannel.close() }
        assertFalse(dataChannelManager.isReady(peerId))
    }

    @Test
    fun `getChannelState should return current state`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        // When
        val state = dataChannelManager.getChannelState(peerId)

        // Then
        assertEquals(DataChannel.State.OPEN, state?.reliableState)
        assertEquals(DataChannel.State.OPEN, state?.unreliableState)
    }

    @Test
    fun `onMessage should emit incoming messages`() = runTest {
        // Given
        val peerId = "did:example:bob"

        var capturedObserver: DataChannel.Observer? = null
        every { mockReliableChannel.registerObserver(any()) } answers {
            capturedObserver = firstArg()
        }

        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        // When - simulate receiving a message
        val testData = "Test message".toByteArray()
        val buffer = mockk<DataChannel.Buffer>(relaxed = true)
        every { buffer.data } returns ByteBuffer.wrap(testData)
        every { buffer.binary } returns false
        every { buffer.data.remaining() } returns testData.size

        backgroundScope.launch {
            val message = dataChannelManager.incomingMessages.first()
            assertEquals(peerId, message.peerId)
            assertEquals("Test message", String(message.data, Charsets.UTF_8))
            assertFalse(message.binary)
        }

        capturedObserver?.onMessage(buffer)
        advanceUntilIdle()
    }

    @Test
    fun `multiple sends should work correctly`() = runTest {
        // Given
        val peerId = "did:example:bob"
        dataChannelManager.createDataChannels(peerId)
        advanceUntilIdle()

        every { mockReliableChannel.send(any()) } returns true

        // When - send multiple messages
        repeat(10) { i ->
            dataChannelManager.sendText(peerId, "Message $i")
        }
        advanceUntilIdle()

        // Then
        verify(exactly = 10) { mockReliableChannel.send(any()) }
    }
}
