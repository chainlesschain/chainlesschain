package com.chainlesschain.android.feature.p2p.viewmodel

import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.session.E2EESession
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * P2PChatViewModel 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class P2PChatViewModelTest {

    private lateinit var viewModel: P2PChatViewModel
    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var verificationManager: VerificationManager
    private lateinit var connectionManager: P2PConnectionManager
    private lateinit var didManager: DIDManager
    private lateinit var messageRepository: P2PMessageRepository

    private val testDispatcher = StandardTestDispatcher()

    private val messagesFlow = MutableStateFlow<List<P2PMessageEntity>>(emptyList())
    private val incomingMessagesFlow = MutableSharedFlow<P2PMessageEntity>()
    private val receivedMessagesFlow = MutableSharedFlow<P2PMessage>()

    private val testPeerId = "did:key:test-peer-123"
    private val testLocalDeviceId = "did:key:local-device-456"

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        sessionManager = mockk(relaxed = true)
        verificationManager = mockk(relaxed = true)
        connectionManager = mockk(relaxed = true)
        didManager = mockk(relaxed = true)
        messageRepository = mockk(relaxed = true)

        every { messageRepository.getMessages(any()) } returns messagesFlow
        every { messageRepository.incomingMessages } returns incomingMessagesFlow
        every { connectionManager.receivedMessages } returns receivedMessagesFlow
        every { didManager.getCurrentDID() } returns testLocalDeviceId

        viewModel = P2PChatViewModel(
            sessionManager = sessionManager,
            verificationManager = verificationManager,
            connectionManager = connectionManager,
            didManager = didManager,
            messageRepository = messageRepository
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loadChat should load messages and check session status`() = runTest {
        // Given
        val testSession = mockk<E2EESession>()
        every { sessionManager.getSession(testPeerId) } returns testSession
        every { verificationManager.isVerified(testPeerId) } returns true

        val testMessages = listOf(
            createTestMessage("msg1", "Hello", isOutgoing = true),
            createTestMessage("msg2", "Hi there", isOutgoing = false)
        )
        messagesFlow.value = testMessages

        // When
        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // Then
        assertEquals(testMessages, viewModel.messages.value)
        assertEquals(ConnectionStatus.CONNECTED, viewModel.connectionStatus.value)
        assertTrue(viewModel.isDeviceVerified.value)
    }

    @Test
    fun `loadChat without session should set disconnected status`() = runTest {
        // Given
        every { sessionManager.getSession(testPeerId) } returns null
        every { verificationManager.isVerified(testPeerId) } returns false

        // When
        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // Then
        assertEquals(ConnectionStatus.DISCONNECTED, viewModel.connectionStatus.value)
        assertFalse(viewModel.isDeviceVerified.value)
    }

    @Test
    fun `sendMessage should call repository and handle success`() = runTest {
        // Given
        val testSession = mockk<E2EESession>()
        every { sessionManager.getSession(testPeerId) } returns testSession

        val sentMessage = createTestMessage("msg1", "Hello", isOutgoing = true)
        coEvery { messageRepository.sendMessage(testPeerId, testLocalDeviceId, "Hello") } returns Result.success(sentMessage)

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.sendMessage(testPeerId, "Hello")
        advanceUntilIdle()

        // Then
        coVerify { messageRepository.sendMessage(testPeerId, testLocalDeviceId, "Hello") }
        assertFalse(viewModel.uiState.value.isSending)
    }

    @Test
    fun `sendMessage without session should show error`() = runTest {
        // Given
        every { sessionManager.getSession(testPeerId) } returns null

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.sendMessage(testPeerId, "Hello")
        advanceUntilIdle()

        // Then
        assertEquals("设备未连接，请先建立安全连接", viewModel.uiState.value.error)
        coVerify(exactly = 0) { messageRepository.sendMessage(any(), any(), any()) }
    }

    @Test
    fun `sendMessage failure should show error`() = runTest {
        // Given
        val testSession = mockk<E2EESession>()
        every { sessionManager.getSession(testPeerId) } returns testSession

        coEvery { messageRepository.sendMessage(any(), any(), any()) } returns Result.failure(Exception("Network error"))

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.sendMessage(testPeerId, "Hello")
        advanceUntilIdle()

        // Then
        assertTrue(viewModel.uiState.value.error?.contains("发送失败") == true)
    }

    @Test
    fun `markAsRead should call repository`() = runTest {
        // Given
        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.markAsRead()
        advanceUntilIdle()

        // Then
        coVerify { messageRepository.markAsRead(testPeerId) }
    }

    @Test
    fun `clearError should reset error state`() = runTest {
        // Given
        every { sessionManager.getSession(testPeerId) } returns null
        viewModel.loadChat(testPeerId)
        advanceUntilIdle()
        viewModel.sendMessage(testPeerId, "Hello")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.error != null)

        // When
        viewModel.clearError()

        // Then
        assertEquals(null, viewModel.uiState.value.error)
    }

    @Test
    fun `reconnect should retry failed messages when session exists`() = runTest {
        // Given
        val testSession = mockk<E2EESession>()
        every { sessionManager.getSession(testPeerId) } returns testSession
        every { sessionManager.hasSession(testPeerId) } returns true

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.reconnect()
        advanceUntilIdle()

        // Then
        coVerify { messageRepository.retryFailedMessages(testPeerId, testLocalDeviceId) }
        assertEquals(ConnectionStatus.CONNECTED, viewModel.connectionStatus.value)
    }

    @Test
    fun `reconnect without session should show error`() = runTest {
        // Given
        every { sessionManager.hasSession(testPeerId) } returns false

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.reconnect()
        advanceUntilIdle()

        // Then
        assertEquals(ConnectionStatus.DISCONNECTED, viewModel.connectionStatus.value)
        assertTrue(viewModel.uiState.value.error?.contains("重新建立安全连接") == true)
    }

    @Test
    fun `deleteAllMessages should call repository`() = runTest {
        // Given
        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.deleteAllMessages()
        advanceUntilIdle()

        // Then
        coVerify { messageRepository.deleteMessages(testPeerId) }
    }

    @Test
    fun `searchMessages should update messages with search results`() = runTest {
        // Given
        val searchResults = listOf(
            createTestMessage("msg1", "Hello world", isOutgoing = true)
        )
        coEvery { messageRepository.searchMessages(testPeerId, "Hello") } returns searchResults

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.searchMessages("Hello")
        advanceUntilIdle()

        // Then
        assertEquals(searchResults, viewModel.messages.value)
    }

    @Test
    fun `retryFailedMessages should call repository`() = runTest {
        // Given
        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.retryFailedMessages()
        advanceUntilIdle()

        // Then
        coVerify { messageRepository.retryFailedMessages(testPeerId, testLocalDeviceId) }
    }

    @Test
    fun `blank message should not be sent`() = runTest {
        // Given
        val testSession = mockk<E2EESession>()
        every { sessionManager.getSession(testPeerId) } returns testSession

        viewModel.loadChat(testPeerId)
        advanceUntilIdle()

        // When
        viewModel.sendMessage(testPeerId, "   ")
        advanceUntilIdle()

        // Then
        coVerify(exactly = 0) { messageRepository.sendMessage(any(), any(), any()) }
    }

    private fun createTestMessage(
        id: String,
        content: String,
        isOutgoing: Boolean
    ) = P2PMessageEntity(
        id = id,
        peerId = testPeerId,
        fromDeviceId = if (isOutgoing) testLocalDeviceId else testPeerId,
        toDeviceId = if (isOutgoing) testPeerId else testLocalDeviceId,
        type = "TEXT",
        content = content,
        timestamp = System.currentTimeMillis(),
        isOutgoing = isOutgoing,
        requiresAck = true,
        isAcknowledged = false,
        sendStatus = MessageSendStatus.SENT
    )
}
