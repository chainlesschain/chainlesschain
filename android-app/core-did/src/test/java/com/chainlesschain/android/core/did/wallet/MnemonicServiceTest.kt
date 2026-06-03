package com.chainlesschain.android.core.did.wallet

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * MnemonicService 单元测试（10 用例）。
 *
 * 覆盖：词数控制 / 词表校验 / Ed25519 32-byte 派生 / 确定性 / passphrase 差异。
 */
class MnemonicServiceTest {

    private lateinit var service: MnemonicService

    @Before
    fun setup() {
        service = MnemonicService()
    }

    @Test
    fun `generate produces 24 words for 256-bit entropy by default`() {
        val words = service.generate()

        assertEquals(24, words.size)
        assertTrue(service.validate(words))
    }

    @Test
    fun `generate produces 12 words for 128-bit entropy`() {
        val words = service.generate(strength = 128)

        assertEquals(12, words.size)
        assertTrue(service.validate(words))
    }

    @Test
    fun `generate produces correct count for all valid strengths`() {
        val expectedCounts = mapOf(128 to 12, 160 to 15, 192 to 18, 224 to 21, 256 to 24)
        for ((strength, expectedCount) in expectedCounts) {
            val words = service.generate(strength)
            assertEquals("strength=$strength", expectedCount, words.size)
            assertTrue("strength=$strength validate", service.validate(words))
        }
    }

    @Test
    fun `generate rejects invalid strength`() {
        assertThrows(IllegalArgumentException::class.java) { service.generate(strength = 100) }
        assertThrows(IllegalArgumentException::class.java) { service.generate(strength = 0) }
        assertThrows(IllegalArgumentException::class.java) { service.generate(strength = 384) }
    }

    @Test
    fun `validate rejects empty word list`() {
        assertFalse(service.validate(emptyList()))
    }

    @Test
    fun `validate rejects unknown word`() {
        // Known-good 12-word mnemonic with one word swapped to garbage
        val tampered = listOf(
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "abandon", "abandon", "notaword",
        )
        assertFalse(service.validate(tampered))
    }

    @Test
    fun `validate rejects wrong word count`() {
        // 11 valid words (not a valid BIP-39 length)
        val wrongCount = List(11) { "abandon" }
        assertFalse(service.validate(wrongCount))
    }

    @Test
    fun `validate accepts canonical BIP-39 test vector`() {
        // BIP-39 spec test vector for entropy = all-zeros 16 bytes (128-bit)
        val canonical = listOf(
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "abandon", "abandon", "about",
        )
        assertTrue(service.validate(canonical))
    }

    @Test
    fun `toEd25519Seed produces 32 bytes`() {
        val words = service.generate()

        val seed = service.toEd25519Seed(words)

        assertEquals(32, seed.size)
    }

    @Test
    fun `toEd25519Seed is deterministic for same words and passphrase`() {
        val words = listOf(
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "abandon", "abandon", "about",
        )

        val seedA = service.toEd25519Seed(words, passphrase = "test-pass")
        val seedB = service.toEd25519Seed(words, passphrase = "test-pass")

        assertArrayEquals(seedA, seedB)
    }

    @Test
    fun `toEd25519Seed differs with different passphrase`() {
        val words = listOf(
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "abandon", "abandon", "about",
        )

        val seedA = service.toEd25519Seed(words, passphrase = "alpha")
        val seedB = service.toEd25519Seed(words, passphrase = "beta")

        assertNotEquals(
            "Different passphrases must produce different seeds",
            seedA.toHex(), seedB.toHex(),
        )
    }

    @Test
    fun `toEd25519Seed null passphrase equivalent to empty string`() {
        val words = listOf(
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "abandon", "abandon", "about",
        )

        val seedNull = service.toEd25519Seed(words, passphrase = null)
        val seedEmpty = service.toEd25519Seed(words, passphrase = "")

        assertArrayEquals(seedNull, seedEmpty)
    }

    @Test
    fun `toEd25519Seed throws on invalid mnemonic`() {
        val invalid = listOf("notaword", "notaword", "notaword")

        assertThrows(IllegalArgumentException::class.java) {
            service.toEd25519Seed(invalid)
        }
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
