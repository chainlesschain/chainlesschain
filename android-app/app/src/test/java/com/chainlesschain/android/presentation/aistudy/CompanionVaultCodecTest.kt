package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionVaultCodecTest {

    @Test
    fun `round-trips empty list`() {
        assertTrue(CompanionVaultCodec.decode(CompanionVaultCodec.encode(emptyList())).isEmpty())
    }

    @Test
    fun `round-trips multiple records with unicode and newlines`() {
        val records = listOf(
            CompanionChatRecord(true, "今天有点累 😔\n第二行", 100L),
            CompanionChatRecord(false, "抱抱你，慢慢说", 200L),
            CompanionChatRecord(true, "", 300L),
        )
        val decoded = CompanionVaultCodec.decode(CompanionVaultCodec.encode(records))
        assertEquals(records, decoded)
    }

    @Test
    fun `decode rejects corrupted bytes`() {
        assertThrows(Exception::class.java) {
            CompanionVaultCodec.decode(byteArrayOf(9, 9, 9, 9, 9))
        }
    }
}
