package com.chainlesschain.android.core.e2ee.recall

import org.junit.Test
import org.junit.Assert.*

/**
 * MessageRecall 测试
 */
class MessageRecallTest {

    @Test
    fun `test create recall request`() {
        // When
        val request = MessageRecallRequest.create(
            messageId = "msg1",
            reason = RecallReason.USER_REQUEST
        )

        // Then
        assertEquals("msg1", request.messageId)
        assertEquals(RecallReason.USER_REQUEST, request.reason)
        assertTrue(request.timestamp > 0)
        assertNull(request.replacementText)
    }

    @Test
    fun `test create recall request with replacement text`() {
        // When
        val request = MessageRecallRequest.create(
            messageId = "msg1",
            reason = RecallReason.CONTENT_ERROR,
            replacementText = "消息已撤回"
        )

        // Then
        assertEquals("消息已撤回", request.replacementText)
    }

    @Test
    fun `test recall response success`() {
        // When
        val response = MessageRecallResponse.success("msg1")

        // Then
        assertTrue(response.success)
        assertEquals("msg1", response.messageId)
        assertNull(response.failureReason)
    }

    @Test
    fun `test recall response failure`() {
        // When
        val response = MessageRecallResponse.failure("msg1", "Message not found")

        // Then
        assertFalse(response.success)
        assertEquals("msg1", response.messageId)
        assertEquals("Message not found", response.failureReason)
    }

    @Test
    fun `test recall policy can recall within time limit`() {
        // Given
        val policy = RecallPolicy(maxRecallTime = 2 * 60 * 1000L) // 2 minutes
        val messageSentAt = System.currentTimeMillis() - 60 * 1000L // 1 minute ago

        // When
        val canRecall = policy.canRecall(messageSentAt, isRead = false)

        // Then
        assertTrue(canRecall)
    }

    @Test
    fun `test recall policy cannot recall after time limit`() {
        // Given
        val policy = RecallPolicy(maxRecallTime = 2 * 60 * 1000L) // 2 minutes
        val messageSentAt = System.currentTimeMillis() - 3 * 60 * 1000L // 3 minutes ago

        // When
        val canRecall = policy.canRecall(messageSentAt, isRead = false)

        // Then
        assertFalse(canRecall)
    }

    @Test
    fun `test recall policy cannot recall read message with strict policy`() {
        // Given
        val policy = RecallPolicy(allowRecallAfterRead = false)
        val messageSentAt = System.currentTimeMillis() - 30 * 1000L // 30 seconds ago

        // When
        val canRecall = policy.canRecall(messageSentAt, isRead = true)

        // Then
        assertFalse(canRecall)
    }

    @Test
    fun `test recall policy can recall read message with permissive policy`() {
        // Given
        val policy = RecallPolicy(allowRecallAfterRead = true)
        val messageSentAt = System.currentTimeMillis() - 30 * 1000L

        // When
        val canRecall = policy.canRecall(messageSentAt, isRead = true)

        // Then
        assertTrue(canRecall)
    }

    @Test
    fun `test recall status display text`() {
        // Given
        val pendingStatus = MessageRecallStatus(
            messageId = "msg1",
            status = RecallStatus.PENDING,
            requestedAt = System.currentTimeMillis(),
            reason = RecallReason.USER_REQUEST
        )

        val recalledStatus = MessageRecallStatus(
            messageId = "msg2",
            status = RecallStatus.RECALLED,
            requestedAt = System.currentTimeMillis(),
            reason = RecallReason.USER_REQUEST,
            replacementText = "消息已撤回"
        )

        val failedStatus = MessageRecallStatus(
            messageId = "msg3",
            status = RecallStatus.FAILED,
            requestedAt = System.currentTimeMillis(),
            reason = RecallReason.USER_REQUEST,
            failureReason = "超时"
        )

        // When/Then
        assertEquals("撤回中...", pendingStatus.getDisplayText())
        assertEquals("消息已撤回", recalledStatus.getDisplayText())
        assertTrue(failedStatus.getDisplayText().contains("撤回失败"))
    }

    @Test
    fun `test is recalled`() {
        // Given
        val status = MessageRecallStatus(
            messageId = "msg1",
            status = RecallStatus.RECALLED,
            requestedAt = System.currentTimeMillis(),
            reason = RecallReason.USER_REQUEST
        )

        // When/Then
        assertTrue(status.isRecalled)
    }

    @Test
    fun `test default recall policy`() {
        // Given
        val policy = RecallPolicy.DEFAULT

        // Then
        assertEquals(2 * 60 * 1000L, policy.maxRecallTime) // 2 minutes
        assertFalse(policy.allowRecallAfterRead)
        assertTrue(policy.keepRecallRecord)
    }

    @Test
    fun `test permissive recall policy`() {
        // Given
        val policy = RecallPolicy.PERMISSIVE

        // Then
        assertEquals(5 * 60 * 1000L, policy.maxRecallTime) // 5 minutes
        assertTrue(policy.allowRecallAfterRead)
    }

    @Test
    fun `test strict recall policy`() {
        // Given
        val policy = RecallPolicy.STRICT

        // Then
        assertEquals(1 * 60 * 1000L, policy.maxRecallTime) // 1 minute
        assertFalse(policy.allowRecallAfterRead)
    }

    @Test
    fun `test all recall reasons`() {
        // Given/When/Then
        val reasons = RecallReason.values()

        assertTrue(reasons.contains(RecallReason.USER_REQUEST))
        assertTrue(reasons.contains(RecallReason.CONTENT_VIOLATION))
        assertTrue(reasons.contains(RecallReason.WRONG_RECIPIENT))
        assertTrue(reasons.contains(RecallReason.CONTENT_ERROR))
        assertTrue(reasons.contains(RecallReason.OTHER))
    }
}
