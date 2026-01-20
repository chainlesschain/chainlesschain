package com.chainlesschain.android.core.e2ee.queue

import com.chainlesschain.android.core.e2ee.protocol.MessageHeader
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

/**
 * MessageQueue 测试
 */
class MessageQueueTest {

    private lateinit var messageQueue: MessageQueue

    @Before
    fun setup() {
        messageQueue = MessageQueue()
    }

    private fun createDummyMessage(): RatchetMessage {
        return RatchetMessage(
            header = MessageHeader(
                ratchetKey = ByteArray(32) { it.toByte() },
                previousChainLength = 0,
                messageNumber = 0
            ),
            ciphertext = "encrypted".toByteArray()
        )
    }

    @Test
    fun `test enqueue and dequeue outgoing message`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()

        // When
        val messageId = messageQueue.enqueueOutgoing(peerId, message)
        val dequeued = messageQueue.dequeueOutgoing(peerId)

        // Then
        assertNotNull(dequeued)
        assertEquals(messageId, dequeued!!.id)
        assertEquals(peerId, dequeued.peerId)
        assertEquals(MessageStatus.SENDING, dequeued.status)
    }

    @Test
    fun `test priority ordering`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()

        // When - 添加不同优先级的消息
        messageQueue.enqueueOutgoing(peerId, message, MessagePriority.LOW)
        messageQueue.enqueueOutgoing(peerId, message, MessagePriority.HIGH)
        messageQueue.enqueueOutgoing(peerId, message, MessagePriority.NORMAL)

        // Then - 应该按优先级出队
        val dequeued1 = messageQueue.dequeueOutgoing(peerId)
        assertEquals(MessagePriority.HIGH, dequeued1!!.priority)

        val dequeued2 = messageQueue.dequeueOutgoing(peerId)
        assertEquals(MessagePriority.NORMAL, dequeued2!!.priority)

        val dequeued3 = messageQueue.dequeueOutgoing(peerId)
        assertEquals(MessagePriority.LOW, dequeued3!!.priority)
    }

    @Test
    fun `test mark outgoing sent`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()
        val messageId = messageQueue.enqueueOutgoing(peerId, message)

        // When
        messageQueue.dequeueOutgoing(peerId)
        messageQueue.markOutgoingSent(messageId)

        // Then - 消息应该被移除
        val count = messageQueue.getOutgoingCount(peerId)
        assertEquals(0, count)
    }

    @Test
    fun `test mark outgoing failed with retry`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()
        val messageId = messageQueue.enqueueOutgoing(peerId, message)

        // When
        messageQueue.dequeueOutgoing(peerId)
        messageQueue.markOutgoingFailed(messageId, retry = true)

        // Then - 消息应该重新排队
        val dequeued = messageQueue.dequeueOutgoing(peerId)
        assertNotNull(dequeued)
        assertEquals(1, dequeued!!.retryCount)
    }

    @Test
    fun `test mark outgoing failed without retry`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()
        val messageId = messageQueue.enqueueOutgoing(peerId, message)

        // When
        messageQueue.dequeueOutgoing(peerId)
        messageQueue.markOutgoingFailed(messageId, retry = false)

        // Then - 消息状态应该是失败
        val allMessages = messageQueue.getAllOutgoingMessages()
        val failedMessage = allMessages.find { it.id == messageId }
        assertNotNull(failedMessage)
        assertEquals(MessageStatus.FAILED, failedMessage!!.status)
    }

    @Test
    fun `test max retries`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()
        val messageId = messageQueue.enqueueOutgoing(peerId, message)

        // When - 重试超过最大次数
        repeat(4) {
            messageQueue.dequeueOutgoing(peerId)
            messageQueue.markOutgoingFailed(messageId, retry = true)
        }

        // Then - 消息状态应该是失败
        val allMessages = messageQueue.getAllOutgoingMessages()
        val failedMessage = allMessages.find { it.id == messageId }
        assertNotNull(failedMessage)
        assertEquals(MessageStatus.FAILED, failedMessage!!.status)
    }

    @Test
    fun `test enqueue and dequeue incoming message`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()

        // When
        val messageId = messageQueue.enqueueIncoming(peerId, message)
        val dequeued = messageQueue.dequeueIncoming(peerId)

        // Then
        assertNotNull(dequeued)
        assertEquals(messageId, dequeued!!.id)
        assertEquals(peerId, dequeued.peerId)
        assertEquals(MessageStatus.PROCESSING, dequeued.status)
    }

    @Test
    fun `test mark incoming processed`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()
        val messageId = messageQueue.enqueueIncoming(peerId, message)

        // When
        messageQueue.dequeueIncoming(peerId)
        messageQueue.markIncomingProcessed(messageId)

        // Then - 消息应该被移除
        val count = messageQueue.getIncomingCount(peerId)
        assertEquals(0, count)
    }

    @Test
    fun `test get outgoing count`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()

        // When
        messageQueue.enqueueOutgoing(peerId, message)
        messageQueue.enqueueOutgoing(peerId, message)
        messageQueue.enqueueOutgoing(peerId, message)

        // Then
        val count = messageQueue.getOutgoingCount(peerId)
        assertEquals(3, count)
    }

    @Test
    fun `test get incoming count`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()

        // When
        messageQueue.enqueueIncoming(peerId, message)
        messageQueue.enqueueIncoming(peerId, message)

        // Then
        val count = messageQueue.getIncomingCount(peerId)
        assertEquals(2, count)
    }

    @Test
    fun `test clear peer messages`() = runBlocking {
        // Given
        val peerId = "peer1"
        val message = createDummyMessage()
        messageQueue.enqueueOutgoing(peerId, message)
        messageQueue.enqueueIncoming(peerId, message)

        // When
        messageQueue.clearPeerMessages(peerId)

        // Then
        assertEquals(0, messageQueue.getOutgoingCount(peerId))
        assertEquals(0, messageQueue.getIncomingCount(peerId))
    }

    @Test
    fun `test queue statistics`() = runBlocking {
        // Given
        val message = createDummyMessage()
        messageQueue.enqueueOutgoing("peer1", message)
        messageQueue.enqueueOutgoing("peer2", message)
        messageQueue.enqueueIncoming("peer1", message)

        // When
        val stats = messageQueue.getStatistics()

        // Then
        assertEquals(2, stats.totalOutgoing)
        assertEquals(1, stats.totalIncoming)
        assertEquals(3, stats.totalMessages)
    }

    @Test
    fun `test dequeue returns null when empty`() = runBlocking {
        // When
        val dequeued = messageQueue.dequeueOutgoing("peer1")

        // Then
        assertNull(dequeued)
    }

    @Test
    fun `test multiple peers`() = runBlocking {
        // Given
        val message = createDummyMessage()
        messageQueue.enqueueOutgoing("peer1", message)
        messageQueue.enqueueOutgoing("peer2", message)
        messageQueue.enqueueOutgoing("peer1", message)

        // Then
        assertEquals(2, messageQueue.getOutgoingCount("peer1"))
        assertEquals(1, messageQueue.getOutgoingCount("peer2"))
    }

    @Test
    fun `test clear all`() = runBlocking {
        // Given
        val message = createDummyMessage()
        messageQueue.enqueueOutgoing("peer1", message)
        messageQueue.enqueueIncoming("peer2", message)

        // When
        messageQueue.clearAll()

        // Then
        val stats = messageQueue.getStatistics()
        assertEquals(0, stats.totalMessages)
    }
}
