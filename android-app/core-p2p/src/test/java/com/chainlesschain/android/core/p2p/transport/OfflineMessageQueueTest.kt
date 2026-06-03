package com.chainlesschain.android.core.p2p.transport

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * OfflineMessageQueue 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OfflineMessageQueueTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var context: Context
    private lateinit var offlineQueue: OfflineMessageQueue
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        context = mockk(relaxed = true)
        every { context.filesDir } returns tempFolder.root

        offlineQueue = OfflineMessageQueue(context)
    }

    @After
    fun tearDown() {
        offlineQueue.release()
    }

    // ===== OfflineMessage 数据类测试 =====

    @Test
    fun `OfflineMessage should contain all required fields`() {
        val message = createTestP2PMessage("msg_1")
        val offlineMessage = OfflineMessage(
            id = "msg_1",
            deviceId = "device_1",
            message = message,
            enqueuedAt = 1000L,
            expiresAt = 2000L,
            retryCount = 0
        )

        assertEquals("msg_1", offlineMessage.id)
        assertEquals("device_1", offlineMessage.deviceId)
        assertEquals(message, offlineMessage.message)
        assertEquals(1000L, offlineMessage.enqueuedAt)
        assertEquals(2000L, offlineMessage.expiresAt)
        assertEquals(0, offlineMessage.retryCount)
    }

    // ===== OfflineQueueEvent 测试 =====

    @Test
    fun `MessageEnqueued event should contain deviceId and messageId`() {
        val event = OfflineQueueEvent.MessageEnqueued("device_1", "msg_1")
        assertEquals("device_1", event.deviceId)
        assertEquals("msg_1", event.messageId)
    }

    @Test
    fun `MessageSent event should contain deviceId and messageId`() {
        val event = OfflineQueueEvent.MessageSent("device_1", "msg_1")
        assertEquals("device_1", event.deviceId)
        assertEquals("msg_1", event.messageId)
    }

    @Test
    fun `MessageRetrying event should contain retry count`() {
        val event = OfflineQueueEvent.MessageRetrying("device_1", "msg_1", 2)
        assertEquals("device_1", event.deviceId)
        assertEquals("msg_1", event.messageId)
        assertEquals(2, event.retryCount)
    }

    @Test
    fun `MessageDropped event should contain reason`() {
        val event = OfflineQueueEvent.MessageDropped("device_1", "msg_1", "Max retries")
        assertEquals("device_1", event.deviceId)
        assertEquals("msg_1", event.messageId)
        assertEquals("Max retries", event.reason)
    }

    @Test
    fun `ConnectionRestored event should contain pending count`() {
        val event = OfflineQueueEvent.ConnectionRestored("device_1", 5)
        assertEquals("device_1", event.deviceId)
        assertEquals(5, event.pendingCount)
    }

    @Test
    fun `DeviceCleared event should contain message count`() {
        val event = OfflineQueueEvent.DeviceCleared("device_1", 10)
        assertEquals("device_1", event.deviceId)
        assertEquals(10, event.messageCount)
    }

    @Test
    fun `ExpiredMessagesCleared event should contain count`() {
        val event = OfflineQueueEvent.ExpiredMessagesCleared(15)
        assertEquals(15, event.count)
    }

    // ===== OfflineQueueStats 测试 =====

    @Test
    fun `OfflineQueueStats should contain all required fields`() {
        val stats = OfflineQueueStats(
            totalMessages = 100,
            totalDevices = 5,
            oldestMessageAgeMs = 3600000L
        )

        assertEquals(100, stats.totalMessages)
        assertEquals(5, stats.totalDevices)
        assertEquals(3600000L, stats.oldestMessageAgeMs)
    }

    @Test
    fun `getStats should return empty stats initially`() {
        val stats = offlineQueue.getStats()

        assertEquals(0, stats.totalMessages)
        assertEquals(0, stats.totalDevices)
        assertEquals(0L, stats.oldestMessageAgeMs)
    }

    // ===== getMessageCount 测试 =====

    @Test
    fun `getMessageCount should return 0 for unknown device`() {
        val count = offlineQueue.getMessageCount("unknown_device")
        assertEquals(0, count)
    }

    // ===== 辅助方法 =====

    private fun createTestP2PMessage(id: String): com.chainlesschain.android.core.p2p.model.P2PMessage {
        return com.chainlesschain.android.core.p2p.model.P2PMessage(
            id = id,
            fromDeviceId = "sender",
            toDeviceId = "receiver",
            type = com.chainlesschain.android.core.p2p.model.MessageType.TEXT,
            payload = "Test message content",
            timestamp = System.currentTimeMillis(),
            requiresAck = true
        )
    }
}
