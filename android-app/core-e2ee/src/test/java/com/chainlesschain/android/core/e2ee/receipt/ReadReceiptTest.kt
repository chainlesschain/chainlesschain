package com.chainlesschain.android.core.e2ee.receipt

import org.junit.Test
import org.junit.Assert.*

/**
 * ReadReceipt 测试
 */
class ReadReceiptTest {

    @Test
    fun `test create read receipt for single message`() {
        // When
        val receipt = ReadReceipt.forMessage("msg1", ReceiptType.READ)

        // Then
        assertEquals(1, receipt.messageIds.size)
        assertEquals("msg1", receipt.messageIds[0])
        assertEquals(ReceiptType.READ, receipt.type)
        assertTrue(receipt.timestamp > 0)
    }

    @Test
    fun `test create read receipt for multiple messages`() {
        // Given
        val messageIds = listOf("msg1", "msg2", "msg3")

        // When
        val receipt = ReadReceipt.forMessages(messageIds, ReceiptType.DELIVERED)

        // Then
        assertEquals(3, receipt.messageIds.size)
        assertEquals(messageIds, receipt.messageIds)
        assertEquals(ReceiptType.DELIVERED, receipt.type)
    }

    @Test
    fun `test message receipt status update with delivered`() {
        // Given
        val status = MessageReceiptStatus("msg1")
        val receipt = ReadReceipt.forMessage("msg1", ReceiptType.DELIVERED)

        // When
        status.update(receipt)

        // Then
        assertTrue(status.delivered)
        assertNotNull(status.deliveredAt)
        assertFalse(status.read)
    }

    @Test
    fun `test message receipt status update with read`() {
        // Given
        val status = MessageReceiptStatus("msg1")
        val receipt = ReadReceipt.forMessage("msg1", ReceiptType.READ)

        // When
        status.update(receipt)

        // Then
        assertTrue(status.delivered) // 已读意味着已送达
        assertTrue(status.read)
        assertNotNull(status.readAt)
    }

    @Test
    fun `test message receipt status update with played`() {
        // Given
        val status = MessageReceiptStatus("msg1")
        val receipt = ReadReceipt.forMessage("msg1", ReceiptType.PLAYED)

        // When
        status.update(receipt)

        // Then
        assertTrue(status.played)
        assertNotNull(status.playedAt)
    }

    @Test
    fun `test message receipt status update with screenshot`() {
        // Given
        val status = MessageReceiptStatus("msg1")
        val receipt = ReadReceipt.forMessage("msg1", ReceiptType.SCREENSHOT)

        // When
        status.update(receipt)

        // Then
        assertTrue(status.screenshot)
        assertNotNull(status.screenshotAt)
    }

    @Test
    fun `test get status text`() {
        // Given
        val status = MessageReceiptStatus("msg1")

        // When/Then
        assertEquals("发送中", status.getStatusText())

        status.delivered = true
        assertEquals("已送达", status.getStatusText())

        status.read = true
        assertEquals("已读", status.getStatusText())
    }

    @Test
    fun `test receipt with metadata`() {
        // Given
        val metadata = mapOf("key1" to "value1", "key2" to "value2")

        // When
        val receipt = ReadReceipt(
            messageIds = listOf("msg1"),
            timestamp = System.currentTimeMillis(),
            type = ReceiptType.READ,
            metadata = metadata
        )

        // Then
        assertEquals(2, receipt.metadata.size)
        assertEquals("value1", receipt.metadata["key1"])
        assertEquals("value2", receipt.metadata["key2"])
    }

    @Test
    fun `test multiple status updates`() {
        // Given
        val status = MessageReceiptStatus("msg1")

        // When - 先送达，后已读
        val deliveredReceipt = ReadReceipt.forMessage("msg1", ReceiptType.DELIVERED)
        status.update(deliveredReceipt)

        val readReceipt = ReadReceipt.forMessage("msg1", ReceiptType.READ)
        status.update(readReceipt)

        // Then
        assertTrue(status.delivered)
        assertTrue(status.read)
        assertNotNull(status.deliveredAt)
        assertNotNull(status.readAt)
        assertTrue(status.readAt!! >= status.deliveredAt!!)
    }
}
