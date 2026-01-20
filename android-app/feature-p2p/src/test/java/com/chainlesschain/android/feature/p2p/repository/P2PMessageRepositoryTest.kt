package com.chainlesschain.android.feature.p2p.repository

import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * P2PMessageRepository 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class P2PMessageRepositoryTest {

    private lateinit var repository: P2PMessageRepository
    private lateinit var p2pMessageDao: P2PMessageDao
    private lateinit var sessionManager: PersistentSessionManager
    private lateinit var connectionManager: P2PConnectionManager

    private val testDispatcher = StandardTestDispatcher()

    private val testPeerId = "did:key:test-peer-123"
    private val testLocalDeviceId = "did:key:local-device-456"
    private val receivedMessagesFlow = MutableSharedFlow<P2PMessage>()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        p2pMessageDao = mockk(relaxed = true)
        sessionManager = mockk(relaxed = true)
        connectionManager = mockk(relaxed = true)

        every { connectionManager.receivedMessages } returns receivedMessagesFlow

        repository = P2PMessageRepository(
            p2pMessageDao = p2pMessageDao,
            sessionManager = sessionManager,
            connectionManager = connectionManager
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ===== 发送消息测试 =====

    @Test
    fun `sendMessage should encrypt and save message`() = runTest {
        // Given
        val content = "Hello, World!"
        val encryptedMessage = mockk<RatchetMessage>()

        every { sessionManager.hasSession(testPeerId) } returns true
        coEvery { sessionManager.encrypt(testPeerId, content) } returns encryptedMessage

        // When
        val result = repository.sendMessage(testPeerId, testLocalDeviceId, content)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess)
        coVerify {
            p2pMessageDao.insertMessage(match {
                it.peerId == testPeerId &&
                it.content == content &&
                it.isOutgoing == true &&
                it.sendStatus == MessageSendStatus.PENDING
            })
        }
        coVerify { connectionManager.sendMessage(testPeerId, any()) }
        coVerify { p2pMessageDao.updateSendStatus(any(), MessageSendStatus.SENT) }
    }

    @Test
    fun `sendMessage without session should fail`() = runTest {
        // Given
        every { sessionManager.hasSession(testPeerId) } returns false

        // When
        val result = repository.sendMessage(testPeerId, testLocalDeviceId, "Hello")

        // Then
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("No E2EE session") == true)
        coVerify(exactly = 0) { p2pMessageDao.insertMessage(any()) }
    }

    @Test
    fun `sendMessage encryption failure should fail`() = runTest {
        // Given
        every { sessionManager.hasSession(testPeerId) } returns true
        coEvery { sessionManager.encrypt(any<String>(), any<String>()) } throws Exception("Encryption failed")

        // When
        val result = repository.sendMessage(testPeerId, testLocalDeviceId, "Hello")

        // Then
        assertTrue(result.isFailure)
    }

    // ===== 接收消息测试 =====

    @Test
    fun `receiveMessage should decrypt and save message`() = runTest {
        // Given
        val encryptedPayload = """{"ciphertext":"abc123"}"""
        val decryptedContent = "Hello from peer"

        val p2pMessage = P2PMessage(
            id = "msg-123",
            fromDeviceId = testPeerId,
            toDeviceId = testLocalDeviceId,
            type = MessageType.TEXT,
            payload = encryptedPayload,
            timestamp = System.currentTimeMillis(),
            requiresAck = true,
            isAcknowledged = false
        )

        every { sessionManager.hasSession(testPeerId) } returns true
        coEvery { sessionManager.decryptToString(testPeerId, any()) } returns decryptedContent

        // When
        val result = repository.receiveMessage(p2pMessage, testLocalDeviceId)
        advanceUntilIdle()

        // Then
        assertTrue(result.isSuccess)
        coVerify {
            p2pMessageDao.insertMessage(match {
                it.peerId == testPeerId &&
                it.content == decryptedContent &&
                it.isOutgoing == false
            })
        }
    }

    @Test
    fun `receiveMessage should send ACK when required`() = runTest {
        // Given
        val p2pMessage = P2PMessage(
            id = "msg-123",
            fromDeviceId = testPeerId,
            toDeviceId = testLocalDeviceId,
            type = MessageType.TEXT,
            payload = "{}",
            timestamp = System.currentTimeMillis(),
            requiresAck = true,
            isAcknowledged = false
        )

        every { sessionManager.hasSession(testPeerId) } returns true
        coEvery { sessionManager.decryptToString(any(), any()) } returns "Hello"

        // When
        repository.receiveMessage(p2pMessage, testLocalDeviceId)
        advanceUntilIdle()

        // Then
        coVerify {
            connectionManager.sendMessage(testPeerId, match {
                it.type == MessageType.ACK && it.payload == "msg-123"
            })
        }
    }

    @Test
    fun `receiveMessage without session should fail`() = runTest {
        // Given
        val p2pMessage = createTestP2PMessage("msg-123")
        every { sessionManager.hasSession(testPeerId) } returns false

        // When
        val result = repository.receiveMessage(p2pMessage, testLocalDeviceId)

        // Then
        assertTrue(result.isFailure)
        coVerify(exactly = 0) { p2pMessageDao.insertMessage(any()) }
    }

    // ===== ACK处理测试 =====

    @Test
    fun `handleAck should mark message as acknowledged`() = runTest {
        // Given
        val messageId = "msg-123"

        // When
        repository.handleAck(messageId)
        advanceUntilIdle()

        // Then
        coVerify { p2pMessageDao.markAsAcknowledged(messageId) }
    }

    // ===== 消息查询测试 =====

    @Test
    fun `getMessages should return flow from dao`() = runTest {
        // Given
        val messages = listOf(
            createTestEntity("msg1", "Hello"),
            createTestEntity("msg2", "World")
        )
        every { p2pMessageDao.getMessagesByPeer(testPeerId) } returns flowOf(messages)

        // When
        val result = repository.getMessages(testPeerId).first()

        // Then
        assertEquals(2, result.size)
        assertEquals("Hello", result[0].content)
    }

    @Test
    fun `getRecentMessages should return limited messages`() = runTest {
        // Given
        val messages = listOf(
            createTestEntity("msg1", "Recent 1"),
            createTestEntity("msg2", "Recent 2")
        )
        coEvery { p2pMessageDao.getRecentMessages(testPeerId, 50) } returns messages

        // When
        val result = repository.getRecentMessages(testPeerId)

        // Then
        assertEquals(2, result.size)
    }

    @Test
    fun `getUnreadCount should return flow from dao`() = runTest {
        // Given
        every { p2pMessageDao.getUnreadCount(testPeerId) } returns flowOf(5)

        // When
        val result = repository.getUnreadCount(testPeerId).first()

        // Then
        assertEquals(5, result)
    }

    // ===== 消息状态管理测试 =====

    @Test
    fun `markAsRead should update all unread messages`() = runTest {
        // When
        repository.markAsRead(testPeerId)

        // Then
        coVerify { p2pMessageDao.markAllAsRead(testPeerId) }
    }

    @Test
    fun `deleteMessages should delete all messages for peer`() = runTest {
        // When
        repository.deleteMessages(testPeerId)

        // Then
        coVerify { p2pMessageDao.deleteMessagesByPeer(testPeerId) }
    }

    // ===== 重试消息测试 =====

    @Test
    fun `getPendingMessages should return undelivered messages`() = runTest {
        // Given
        val pendingMessages = listOf(
            createTestEntity("msg1", "Pending 1", sendStatus = MessageSendStatus.PENDING),
            createTestEntity("msg2", "Pending 2", sendStatus = MessageSendStatus.SENT)
        )
        coEvery { p2pMessageDao.getPendingMessages(testPeerId) } returns pendingMessages

        // When
        val result = repository.getPendingMessages(testPeerId)

        // Then
        assertEquals(2, result.size)
    }

    @Test
    fun `retryFailedMessages should resend pending messages`() = runTest {
        // Given
        val pendingMessages = listOf(
            createTestEntity("msg1", "Pending", sendStatus = MessageSendStatus.PENDING)
        )
        coEvery { p2pMessageDao.getPendingMessages(testPeerId) } returns pendingMessages

        // When
        repository.retryFailedMessages(testPeerId, testLocalDeviceId)
        advanceUntilIdle()

        // Then
        coVerify { connectionManager.sendMessage(testPeerId, any()) }
        coVerify { p2pMessageDao.updateSendStatus("msg1", MessageSendStatus.SENT) }
    }

    // ===== 搜索测试 =====

    @Test
    fun `searchMessages should return matching messages`() = runTest {
        // Given
        val searchResults = listOf(
            createTestEntity("msg1", "Hello world")
        )
        coEvery { p2pMessageDao.searchMessages(testPeerId, "Hello") } returns searchResults

        // When
        val result = repository.searchMessages(testPeerId, "Hello")

        // Then
        assertEquals(1, result.size)
        assertTrue(result[0].content.contains("Hello"))
    }

    // ===== 设备列表测试 =====

    @Test
    fun `getAllPeerIds should return all peer ids`() = runTest {
        // Given
        val peerIds = listOf("peer1", "peer2", "peer3")
        every { p2pMessageDao.getAllPeerIds() } returns flowOf(peerIds)

        // When
        val result = repository.getAllPeerIds().first()

        // Then
        assertEquals(3, result.size)
        assertTrue(result.contains("peer1"))
    }

    @Test
    fun `getLastMessagePerPeer should return last messages`() = runTest {
        // Given
        val lastMessages = listOf(
            createTestEntity("msg1", "Last from peer1", peerId = "peer1"),
            createTestEntity("msg2", "Last from peer2", peerId = "peer2")
        )
        every { p2pMessageDao.getLastMessagePerPeer() } returns flowOf(lastMessages)

        // When
        val result = repository.getLastMessagePerPeer().first()

        // Then
        assertEquals(2, result.size)
    }

    // ===== Helper Functions =====

    private fun createTestEntity(
        id: String,
        content: String,
        peerId: String = testPeerId,
        isOutgoing: Boolean = true,
        sendStatus: String = MessageSendStatus.SENT
    ) = P2PMessageEntity(
        id = id,
        peerId = peerId,
        fromDeviceId = if (isOutgoing) testLocalDeviceId else peerId,
        toDeviceId = if (isOutgoing) peerId else testLocalDeviceId,
        type = "TEXT",
        content = content,
        timestamp = System.currentTimeMillis(),
        isOutgoing = isOutgoing,
        requiresAck = true,
        isAcknowledged = false,
        sendStatus = sendStatus
    )

    private fun createTestP2PMessage(
        id: String,
        content: String = "Test message"
    ) = P2PMessage(
        id = id,
        fromDeviceId = testPeerId,
        toDeviceId = testLocalDeviceId,
        type = MessageType.TEXT,
        payload = """{"content":"$content"}""",
        timestamp = System.currentTimeMillis(),
        requiresAck = true,
        isAcknowledged = false
    )
}
