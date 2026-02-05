package com.chainlesschain.android.feature.p2p.viewmodel

import org.junit.Ignore

/*
 * FIXME: 暂时禁用 - 等待P2P消息队列架构重构
 *
 * 问题: 此测试引用的类已不存在或已重构:
 *   - PersistentMessageQueueManager (包路径已变更)
 *   - QueuedOutgoingMessage (已移除)
 *   - QueuedIncomingMessage (已移除)
 *   - RatchetMessage (包路径已变更)
 *
 * 需要根据新的P2P消息队列架构重写此测试
 * 相关文件: core-e2ee/queue/, core-e2ee/protocol/
 *
 * TODO: 在Phase 2重构时重新启用并更新测试
 */

/*
import com.chainlesschain.android.core.e2ee.messaging.PersistentMessageQueueManager
import com.chainlesschain.android.core.e2ee.messaging.QueuedOutgoingMessage
import com.chainlesschain.android.core.e2ee.messaging.QueuedIncomingMessage
import com.chainlesschain.android.core.e2ee.ratchet.RatchetMessage
import com.chainlesschain.android.feature.p2p.ui.MessagePriority
import com.chainlesschain.android.feature.p2p.ui.MessageStatus
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * MessageQueueViewModel 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
@Ignore("等待P2P消息队列架构重构 - 引用的类已不存在")
class MessageQueueViewModelTest {
/*
    private lateinit var viewModel: MessageQueueViewModel
    private lateinit var queueManager: PersistentMessageQueueManager

    private val testDispatcher = StandardTestDispatcher()

    private val outgoingQueueFlow = MutableStateFlow<Map<String, List<QueuedOutgoingMessage>>>(emptyMap())
    private val incomingQueueFlow = MutableStateFlow<Map<String, List<QueuedIncomingMessage>>>(emptyMap())

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        queueManager = mockk(relaxed = true)

        every { queueManager.outgoingQueue } returns outgoingQueueFlow
        every { queueManager.incomingQueue } returns incomingQueueFlow

        viewModel = MessageQueueViewModel(queueManager)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `outgoing messages should be collected from queue manager`() = runTest {
        // Given
        val testMessage = QueuedOutgoingMessage(
            messageId = "msg1",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 50,
            retryCount = 0,
            lastError = null
        )

        // When
        outgoingQueueFlow.value = mapOf("peer1" to listOf(testMessage))
        advanceUntilIdle()

        // Then
        assertEquals(1, viewModel.outgoingMessages.value.size)
        assertEquals("msg1", viewModel.outgoingMessages.value[0].id)
        assertEquals("peer1", viewModel.outgoingMessages.value[0].peerId)
        assertEquals(MessagePriority.NORMAL, viewModel.outgoingMessages.value[0].priority)
    }

    @Test
    fun `incoming messages should be collected from queue manager`() = runTest {
        // Given
        val testMessage = QueuedIncomingMessage(
            messageId = "msg2",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            receivedAt = System.currentTimeMillis()
        )

        // When
        incomingQueueFlow.value = mapOf("peer2" to listOf(testMessage))
        advanceUntilIdle()

        // Then
        assertEquals(1, viewModel.incomingMessages.value.size)
        assertEquals("msg2", viewModel.incomingMessages.value[0].id)
        assertEquals("peer2", viewModel.incomingMessages.value[0].peerId)
        assertEquals(MessageStatus.PENDING, viewModel.incomingMessages.value[0].status)
    }

    @Test
    fun `retryMessage should call queue manager retry`() = runTest {
        // Given
        val messageId = "msg1"
        val testMessage = QueuedOutgoingMessage(
            messageId = messageId,
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 50,
            retryCount = 1,
            lastError = "Network error"
        )

        outgoingQueueFlow.value = mapOf("peer1" to listOf(testMessage))
        advanceUntilIdle()

        coEvery { queueManager.retryMessage("peer1", messageId) } just Runs

        // When
        viewModel.retryMessage(messageId)
        advanceUntilIdle()

        // Then
        coVerify { queueManager.retryMessage("peer1", messageId) }
    }

    @Test
    fun `cancelMessage should remove message from queue`() = runTest {
        // Given
        val messageId = "msg1"
        val testMessage = QueuedOutgoingMessage(
            messageId = messageId,
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 50,
            retryCount = 0,
            lastError = null
        )

        outgoingQueueFlow.value = mapOf("peer1" to listOf(testMessage))
        advanceUntilIdle()

        coEvery { queueManager.removeOutgoingMessage("peer1", messageId) } just Runs

        // When
        viewModel.cancelMessage(messageId)
        advanceUntilIdle()

        // Then
        coVerify { queueManager.removeOutgoingMessage("peer1", messageId) }
    }

    @Test
    fun `clearCompleted should remove completed messages`() = runTest {
        // Given
        coEvery { queueManager.removeOutgoingMessage(any(), any()) } just Runs
        coEvery { queueManager.removeIncomingMessage(any(), any()) } just Runs

        // When
        viewModel.clearCompleted()
        advanceUntilIdle()

        // Then
        // Verify that removal methods were attempted
        // (actual completed messages would need to be in the flow)
        assertTrue(true) // Test structure validation
    }

    @Test
    fun `getQueueStats should return correct statistics`() = runTest {
        // Given
        val outgoingMessage1 = QueuedOutgoingMessage(
            messageId = "msg1",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 50,
            retryCount = 0,
            lastError = null
        )

        val outgoingMessage2 = QueuedOutgoingMessage(
            messageId = "msg2",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 50,
            retryCount = 1,
            lastError = "Failed"
        )

        outgoingQueueFlow.value = mapOf("peer1" to listOf(outgoingMessage1, outgoingMessage2))
        advanceUntilIdle()

        // When
        val stats = viewModel.getQueueStats()

        // Then
        assertEquals(2, stats.totalOutgoing)
        assertEquals(1, stats.pendingOutgoing) // msg1 with retryCount=0
        assertEquals(1, stats.failedOutgoing) // msg2 with error
    }

    @Test
    fun `high priority messages should be mapped correctly`() = runTest {
        // Given
        val highPriorityMessage = QueuedOutgoingMessage(
            messageId = "msg1",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 100, // HIGH priority
            retryCount = 0,
            lastError = null
        )

        // When
        outgoingQueueFlow.value = mapOf("peer1" to listOf(highPriorityMessage))
        advanceUntilIdle()

        // Then
        assertEquals(MessagePriority.HIGH, viewModel.outgoingMessages.value[0].priority)
    }

    @Test
    fun `failed messages should have FAILED status`() = runTest {
        // Given
        val failedMessage = QueuedOutgoingMessage(
            messageId = "msg1",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = System.currentTimeMillis(),
            priority = 50,
            retryCount = 1,
            lastError = "Connection timeout"
        )

        // When
        outgoingQueueFlow.value = mapOf("peer1" to listOf(failedMessage))
        advanceUntilIdle()

        // Then
        assertEquals(MessageStatus.FAILED, viewModel.outgoingMessages.value[0].status)
        assertEquals("Connection timeout", viewModel.outgoingMessages.value[0].error)
    }

    @Test
    fun `messages should be sorted by timestamp descending`() = runTest {
        // Given
        val message1 = QueuedOutgoingMessage(
            messageId = "msg1",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = 1000L,
            priority = 50,
            retryCount = 0,
            lastError = null
        )

        val message2 = QueuedOutgoingMessage(
            messageId = "msg2",
            encryptedMessage = RatchetMessage(
                header = byteArrayOf(1, 2, 3),
                ciphertext = byteArrayOf(4, 5, 6)
            ),
            queuedAt = 2000L,
            priority = 50,
            retryCount = 0,
            lastError = null
        )

        // When
        outgoingQueueFlow.value = mapOf("peer1" to listOf(message1, message2))
        advanceUntilIdle()

        // Then
        assertEquals("msg2", viewModel.outgoingMessages.value[0].id) // Newer first
        assertEquals("msg1", viewModel.outgoingMessages.value[1].id)
    }
*/
}
