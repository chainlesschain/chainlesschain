package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §8.3 备份记录编解码测试:key/version/content 往返、UTF-8 与二进制内容(含换行/'.'/0xFF)
 * 经 base64 单行保真、空值、坏编码抛错。
 */
class PdhRecordCodecTest {

    private fun rec(key: String, version: Long, content: String) =
        PdhBackupCoordinator.Record(key, version, content.toByteArray())

    @Test
    fun round_trips_key_version_content() {
        val r = rec("妈妈", 7, "alpha=β · 外卖")
        val d = PdhRecordCodec.decode(PdhRecordCodec.encode(r))
        assertEquals("妈妈", d.key)
        assertEquals(7L, d.version)
        assertTrue("alpha=β · 外卖".toByteArray().contentEquals(d.content))
    }

    @Test
    fun binary_and_delimiter_chars_in_content_survive_single_line() {
        val content = byteArrayOf(0, 10, 13, -1, 46) // NUL, \n, \r, 0xFF, '.'
        val enc = PdhRecordCodec.encode(PdhBackupCoordinator.Record("k.with.dots", 0, content))
        assertFalse(String(enc).contains("\n")) // base64 → 单行,换行不会破坏逐行存储
        val d = PdhRecordCodec.decode(enc)
        assertEquals("k.with.dots", d.key) // key 里的 '.' 不与分隔符冲突(已 base64)
        assertTrue(content.contentEquals(d.content))
    }

    @Test
    fun empty_key_and_content_round_trip() {
        val d = PdhRecordCodec.decode(PdhRecordCodec.encode(rec("", 0, "")))
        assertEquals("", d.key)
        assertEquals(0, d.content.size)
    }

    @Test
    fun malformed_encoding_throws() {
        assertFailsWith<IllegalArgumentException> {
            PdhRecordCodec.decode("garbage-no-delimiters".toByteArray())
        }
    }
}
