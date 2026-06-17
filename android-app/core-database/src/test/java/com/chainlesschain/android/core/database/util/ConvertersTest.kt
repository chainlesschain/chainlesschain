package com.chainlesschain.android.core.database.util

import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.core.database.entity.ImportSource
import com.chainlesschain.android.core.database.entity.ImportType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [Converters] 单测：Room 类型转换器（JSON 往返 + 枚举名映射），此前零覆盖。
 * 重点钉住容错回落：损坏 JSON → 空集合、未知枚举名 → 默认值（DB 脏数据韧性，避免读崩）。
 */
class ConvertersTest {

    private val c = Converters()

    @Test
    fun `string list round-trips and handles null and malformed`() {
        val list = listOf("a", "b", "c")
        assertEquals(list, c.toStringList(c.fromStringList(list)))

        assertNull(c.fromStringList(null))
        assertNull(c.toStringList(null))

        // 损坏 JSON → 回落空列表（不抛，保读取不崩）
        assertEquals(emptyList<String>(), c.toStringList("[not valid json"))
    }

    @Test
    fun `string map round-trips and handles null and malformed`() {
        val map = mapOf("k1" to "v1", "k2" to "v2")
        assertEquals(map, c.toStringMap(c.fromStringMap(map)))

        assertNull(c.fromStringMap(null))
        assertNull(c.toStringMap(null))

        assertEquals(emptyMap<String, String>(), c.toStringMap("{not valid"))
    }

    @Test
    fun `FileCategory maps by name and falls back to OTHER on unknown`() {
        assertEquals("OTHER", c.fromFileCategory(FileCategory.OTHER))
        assertEquals(FileCategory.OTHER, c.toFileCategory("OTHER"))
        assertEquals(FileCategory.OTHER, c.toFileCategory("NOT_A_CATEGORY"))
    }

    @Test
    fun `ImportType maps by name and falls back to COPY on unknown`() {
        assertEquals("COPY", c.fromImportType(ImportType.COPY))
        assertEquals(ImportType.COPY, c.toImportType("COPY"))
        assertEquals(ImportType.COPY, c.toImportType("NOPE"))
    }

    @Test
    fun `ImportSource maps by name and falls back to FILE_BROWSER on unknown`() {
        assertEquals("FILE_BROWSER", c.fromImportSource(ImportSource.FILE_BROWSER))
        assertEquals(ImportSource.FILE_BROWSER, c.toImportSource("FILE_BROWSER"))
        assertEquals(ImportSource.FILE_BROWSER, c.toImportSource("???"))
    }
}
