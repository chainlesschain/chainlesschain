package com.chainlesschain.android.feature.p2p.viewmodel

import com.chainlesschain.android.core.database.entity.MessagePriority
import com.chainlesschain.android.core.database.entity.OfflineQueueEntity
import com.chainlesschain.android.core.database.entity.QueueStatus
import com.chainlesschain.android.feature.p2p.queue.MessageStatusEvent
import com.chainlesschain.android.feature.p2p.queue.OfflineMessageQueue
import com.chainlesschain.android.feature.p2p.ui.MessageStatus
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * MessageQueueViewModel 单元测试
 *
 * 基于当前架构重写：使用 OfflineMessageQueue + OfflineQueueEntity
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MessageQueueViewModelTest {

    private lateinit var viewModel: MessageQueueViewModel
    private lateinit var offlineMessageQueue: OfflineMessageQueue

    private val testDispatcher = StandardTestDispatcher()

    private val pendingMessagesFlow = MutableStateFlow<List<OfflineQueueEntity>>(emptyList())
    private val pendingCountFlow = MutableStateFlow(0)
    private val messageStatusChanged = MutableSharedFlow<MessageStatusEvent>()
    private val retryReadyMessages = MutableSharedFlow<OfflineQueueEntity>()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        offlineMessageQueue = mockk(relaxed = true)

        every { offlineMessageQueue.getAllPendingMessages() } returns pendingMessagesFlow
        every { offlineMessageQueue.getTotalPendingCount() } returns pendingCountFlow
        every { offlineMessageQueue.messageStatusChanged } returns messageStatusChanged
        every { offlineMessageQueue.retryReadyMessages } returns retryReadyMessages

        viewModel = MessageQueueViewModel(offlineMessageQueue)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /**
     * Helper: subscribe to outgoingMessages to activate WhileSubscribed stateIn,
     * then set the flow value and advance the dispatcher.
     */
    private fun TestScope.collectOutgoingAndSet(entities: List<OfflineQueueEntity>) {
        // Start a collector to activate WhileSubscribed
        backgroundScope.launch {
            viewModel.outgoingMessages.collect { }
        }
        advanceUntilIdle()

        // Set the flow value
        pendingMessagesFlow.value = entities
        advanceUntilIdle()
    }

    @Test
    fun `outgoing messages should be collected from offline queue`() = runTest {
        // Given
        val entity = createTestEntity(
            id = "msg1",
            peerId = "peer1",
            status = QueueStatus.PENDING,
            priority = MessagePriority.NORMAL
        )

        // When
        collectOutgoingAndSet(listOf(entity))

        // Then
        val messages = viewModel.outgoingMessages.value
        assertEquals(1, messages.size)
        assertEquals("msg1", messages[0].id)
        assertEquals("peer1", messages[0].peerId)
        assertEquals(MessageStatus.PENDING, messages[0].status)
    }

    @Test
    fun `retryMessage should call markAsFailed with shouldRetry true`() = runTest {
        // Given
        val messageId = "msg1"
        coEvery { offlineMessageQueue.markAsFailed(messageId, shouldRetry = true) } just Runs

        // When
        viewModel.retryMessage(messageId)
        advanceUntilIdle()

        // Then
        coVerify { offlineMessageQueue.markAsFailed(messageId, shouldRetry = true) }
    }

    @Test
    fun `cancelMessage should call markAsFailed with shouldRetry false`() = runTest {
        // Given
        val messageId = "msg1"
        coEvery { offlineMessageQueue.markAsFailed(messageId, shouldRetry = false) } just Runs

        // When
        viewModel.cancelMessage(messageId)
        advanceUntilIdle()

        // Then
        coVerify { offlineMessageQueue.markAsFailed(messageId, shouldRetry = false) }
    }

    @Test
    fun `clearCompleted should call cleanupOldMessages`() = runTest {
        // Given
        coEvery { offlineMessageQueue.cleanupOldMessages() } just Runs

        // When
        viewModel.clearCompleted()
        advanceUntilIdle()

        // Then
        coVerify { offlineMessageQueue.cleanupOldMessages() }
    }

    @Test
    fun `getQueueStats should return correct statistics`() = runTest {
        // Given
        val pendingEntity = createTestEntity(
            id = "msg1",
            peerId = "peer1",
            status = QueueStatus.PENDING
        )
        val failedEntity = createTestEntity(
            id = "msg2",
            peerId = "peer1",
            status = QueueStatus.FAILED,
            retryCount = 3
        )

        collectOutgoingAndSet(listOf(pendingEntity, failedEntity))

        // When
        val stats = viewModel.getQueueStats()

        // Then
        assertEquals(2, stats.totalOutgoing)
        assertEquals(1, stats.pendingOutgoing)
        assertEquals(1, stats.failedOutgoing)
    }

    @Test
    fun `high priority messages should be mapped correctly`() = runTest {
        // Given
        val entity = createTestEntity(
            id = "msg1",
            peerId = "peer1",
            priority = MessagePriority.HIGH
        )

        // When
        collectOutgoingAndSet(listOf(entity))

        // Then
        val messages = viewModel.outgoingMessages.value
        assertEquals(1, messages.size)
        assertEquals(
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.HIGH,
            messages[0].priority
        )
    }

    @Test
    fun `failed messages should have FAILED status`() = runTest {
        // Given
        val entity = createTestEntity(
            id = "msg1",
            peerId = "peer1",
            status = QueueStatus.FAILED,
            retryCount = 3
        )

        // When
        collectOutgoingAndSet(listOf(entity))

        // Then
        val messages = viewModel.outgoingMessages.value
        assertEquals(1, messages.size)
        assertEquals(MessageStatus.FAILED, messages[0].status)
        assertTrue(messages[0].error?.contains("3 retries") == true)
    }

    @Test
    fun `messages should be mapped with correct preview`() = runTest {
        // Given
        val entity = createTestEntity(
            id = "msg1",
            peerId = "peer1",
            messageType = "TEXT",
            payload = "Hello World"
        )

        // When
        collectOutgoingAndSet(listOf(entity))

        // Then
        val messages = viewModel.outgoingMessages.value
        assertEquals(1, messages.size)
        assertTrue(messages[0].preview.contains("TEXT"))
        assertTrue(messages[0].preview.contains("Hello World"))
    }

    @Test
    fun `incoming messages should be empty by default`() = runTest {
        // Given/When
        advanceUntilIdle()

        // Then - incomingMessages is an empty MutableStateFlow in current implementation
        assertTrue(viewModel.incomingMessages.value.isEmpty())
    }

    @Test
    fun `clearAll should call clearAllQueues`() = runTest {
        // Given
        coEvery { offlineMessageQueue.clearAllQueues() } just Runs

        // When
        viewModel.clearAll()
        advanceUntilIdle()

        // Then
        coVerify { offlineMessageQueue.clearAllQueues() }
    }

    // ===== Helper Methods =====

    private fun createTestEntity(
        id: String = "test-${System.currentTimeMillis()}",
        peerId: String = "peer1",
        messageType: String = "TEXT",
        payload: String = """{"content":"test message"}""",
        priority: String = MessagePriority.NORMAL,
        status: String = QueueStatus.PENDING,
        retryCount: Int = 0
    ): OfflineQueueEntity {
        return OfflineQueueEntity(
            id = id,
            peerId = peerId,
            messageType = messageType,
            payload = payload,
            priority = priority,
            status = status,
            retryCount = retryCount,
            createdAt = System.currentTimeMillis()
        )
    }
}
