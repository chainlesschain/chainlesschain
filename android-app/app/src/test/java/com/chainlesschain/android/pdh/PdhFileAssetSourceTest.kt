package com.chainlesschain.android.pdh

import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §8.3 文件型资产源测试:写后读往返(含换行/UTF-8 内容)、文件缺失=空、写为覆盖非追加、
 * 读跳过空行/坏行。纯 JVM 临时文件。
 */
class PdhFileAssetSourceTest {

    private fun rec(key: String, version: Long, content: String) =
        PdhBackupCoordinator.Record(key, version, content.toByteArray())

    private fun tempFile(): File =
        File.createTempFile("pdh-src", ".dat").also { it.deleteOnExit() }

    @Test
    fun write_then_read_round_trips_including_newline_content() {
        val f = tempFile()
        val src = PdhFileAssetSource(AssetKind.SKILLS, f)
        src.write(listOf(rec("s1", 1, "A"), rec("s2", 2, "多行\n内容 with newline")))
        val read = src.read()
        assertEquals(2, read.size)
        assertEquals(setOf("s1", "s2"), read.map { it.key }.toSet())
        assertTrue(read.any { String(it.content) == "多行\n内容 with newline" }) // 换行未破坏行存储
    }

    @Test
    fun missing_file_reads_empty() {
        val f = tempFile().also { it.delete() } // 不存在
        assertTrue(PdhFileAssetSource(AssetKind.MEMORY, f).read().isEmpty())
    }

    @Test
    fun write_overwrites_not_appends() {
        val f = tempFile()
        val src = PdhFileAssetSource(AssetKind.MEMORY, f)
        src.write(listOf(rec("a", 0, "x")))
        src.write(listOf(rec("b", 0, "y")))
        assertEquals(listOf("b"), src.read().map { it.key })
    }

    @Test
    fun read_skips_blank_and_malformed_lines() {
        val f = tempFile()
        val validLine = String(PdhRecordCodec.encode(rec("ok", 0, "v")))
        f.writeText("\n!!!no-delimiters!!!\n$validLine\n")
        val read = PdhFileAssetSource(AssetKind.SKILLS, f).read()
        assertEquals(listOf("ok"), read.map { it.key }) // 坏行/空行跳过,只留有效记录
    }
}
