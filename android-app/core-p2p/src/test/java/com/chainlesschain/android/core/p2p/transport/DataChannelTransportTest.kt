package com.chainlesschain.android.core.p2p.transport

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * DataChannelTransport 流控制功能单元测试
 */
class DataChannelTransportTest {

    // ===== FlowControlState 测试 =====

    @Test
    fun `FlowControlState Normal should be singleton`() {
        val state1: FlowControlState = FlowControlState.Normal
        val state2: FlowControlState = FlowControlState.Normal
        assertTrue(state1 === state2)
    }

    @Test
    fun `FlowControlState Paused should contain buffered amount and threshold`() {
        val state = FlowControlState.Paused(1500000L, 1000000L)
        assertEquals(1500000L, state.bufferedAmount)
        assertEquals(1000000L, state.threshold)
    }

    @Test
    fun `FlowControlState Resumed should contain buffered amount`() {
        val state = FlowControlState.Resumed(200000L)
        assertEquals(200000L, state.bufferedAmount)
    }

    // ===== SendResult 测试 =====

    @Test
    fun `SendResult Sent should be singleton`() {
        val result1: SendResult = SendResult.Sent
        val result2: SendResult = SendResult.Sent
        assertTrue(result1 === result2)
    }

    @Test
    fun `SendResult Queued should contain queue position`() {
        val result = SendResult.Queued(5)
        assertEquals(5, result.queuePosition)
    }

    @Test
    fun `SendResult QueueFull should be singleton`() {
        val result1: SendResult = SendResult.QueueFull
        val result2: SendResult = SendResult.QueueFull
        assertTrue(result1 === result2)
    }

    @Test
    fun `SendResult Failed should contain reason`() {
        val result = SendResult.Failed("Buffer overflow")
        assertEquals("Buffer overflow", result.reason)
    }

    // ===== QueuedMessage 测试 =====

    @Test
    fun `QueuedMessage should contain message and enqueue time`() {
        val message = createTestP2PMessage("msg_1")
        val enqueuedAt = System.currentTimeMillis()
        val queued = QueuedMessage(message, enqueuedAt)

        assertEquals(message, queued.message)
        assertEquals(enqueuedAt, queued.enqueuedAt)
    }

    // ===== FlowControlStats 测试 =====

    @Test
    fun `FlowControlStats should contain all required fields`() {
        val stats = FlowControlStats(
            isPaused = true,
            bufferedAmount = 500000L,
            queueSize = 10,
            highWaterMark = 1000000L,
            lowWaterMark = 250000L
        )

        assertTrue(stats.isPaused)
        assertEquals(500000L, stats.bufferedAmount)
        assertEquals(10, stats.queueSize)
        assertEquals(1000000L, stats.highWaterMark)
        assertEquals(250000L, stats.lowWaterMark)
    }

    @Test
    fun `FlowControlStats should have correct default state`() {
        val stats = FlowControlStats(
            isPaused = false,
            bufferedAmount = 0L,
            queueSize = 0,
            highWaterMark = 1048576L,  // 1MB
            lowWaterMark = 262144L     // 256KB
        )

        assertFalse(stats.isPaused)
        assertEquals(0L, stats.bufferedAmount)
        assertEquals(0, stats.queueSize)
    }

    // ===== MessageFragment 测试 =====

    @Test
    fun `MessageFragment should contain all required fields`() {
        val fragment = MessageFragment(
            messageId = "msg_1",
            fragmentIndex = 2,
            totalFragments = 5,
            data = "fragment data"
        )

        assertEquals("msg_1", fragment.messageId)
        assertEquals(2, fragment.fragmentIndex)
        assertEquals(5, fragment.totalFragments)
        assertEquals("fragment data", fragment.data)
    }

    @Test
    fun `MessageFragment index should be zero-based`() {
        val firstFragment = MessageFragment("msg_1", 0, 3, "data")
        val lastFragment = MessageFragment("msg_1", 2, 3, "data")

        assertEquals(0, firstFragment.fragmentIndex)
        assertEquals(2, lastFragment.fragmentIndex)
        assertEquals(3, firstFragment.totalFragments)
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
