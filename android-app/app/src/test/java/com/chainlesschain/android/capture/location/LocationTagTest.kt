package com.chainlesschain.android.capture.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** LocationTag 数据类不变量测试。 */
class LocationTagTest {

    @Test
    fun `valid tag is accepted`() {
        val tag = LocationTag(
            latitude = 39.9042, longitude = 116.4074,
            accuracyMeters = 5f, timestampMs = 1700000000000L,
            altitude = 50.0, provider = "fused",
        )

        assertEquals(39.9042, tag.latitude, 1e-9)
        assertEquals("fused", tag.provider)
    }

    @Test
    fun `latitude out of range rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(91.0, 0.0, 5f, 1L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(-91.0, 0.0, 5f, 1L)
        }
    }

    @Test
    fun `longitude out of range rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(0.0, 181.0, 5f, 1L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(0.0, -181.0, 5f, 1L)
        }
    }

    @Test
    fun `negative accuracy rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(0.0, 0.0, -1f, 1L)
        }
    }

    @Test
    fun `non-positive timestamp rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(0.0, 0.0, 5f, 0L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocationTag(0.0, 0.0, 5f, -1L)
        }
    }

    @Test
    fun `isPrecise is true for sub-100m accuracy`() {
        assertTrue(LocationTag(0.0, 0.0, 5f, 1L).isPrecise())
        assertTrue(LocationTag(0.0, 0.0, 99.9f, 1L).isPrecise())
        assertFalse(LocationTag(0.0, 0.0, 100.01f, 1L).isPrecise())
        // 0 表示精度未知，不算 precise
        assertFalse(LocationTag(0.0, 0.0, 0f, 1L).isPrecise())
    }
}
