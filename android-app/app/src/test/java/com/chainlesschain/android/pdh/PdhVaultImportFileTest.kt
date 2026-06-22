package com.chainlesschain.android.pdh

import org.junit.Test
import kotlin.test.assertEquals

/**
 * §8.3 vault 导入文件组装测试:空→[]、单条、多条逗号拼接、首尾空白去除。
 */
class PdhVaultImportFileTest {

    @Test
    fun empty_list_is_empty_array() {
        assertEquals("[]", PdhVaultImportFile.assemble(emptyList()))
    }

    @Test
    fun single_event() {
        assertEquals("""[{"id":"e1"}]""", PdhVaultImportFile.assemble(listOf("""{"id":"e1"}""")))
    }

    @Test
    fun multiple_events_comma_joined() {
        val out = PdhVaultImportFile.assemble(listOf("""{"id":"a"}""", """{"id":"b"}"""))
        assertEquals("""[{"id":"a"},{"id":"b"}]""", out)
    }

    @Test
    fun trims_surrounding_whitespace_per_event() {
        val out = PdhVaultImportFile.assemble(listOf("  {\"id\":\"a\"}\n", "\t{\"id\":\"b\"} "))
        assertEquals("""[{"id":"a"},{"id":"b"}]""", out)
    }
}
