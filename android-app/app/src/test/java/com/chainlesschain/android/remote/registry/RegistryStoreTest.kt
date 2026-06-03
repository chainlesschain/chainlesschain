package com.chainlesschain.android.remote.registry

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class RegistryStoreTest {

    private lateinit var tempDir: File
    private lateinit var mockContext: Context
    private lateinit var store: RegistryStore

    @Before
    fun setup() {
        tempDir = File.createTempFile("registry_test", "").apply {
            delete()
            mkdir()
            deleteOnExit()
        }
        mockContext = mockk(relaxed = true)
        every { mockContext.filesDir } returns tempDir
        store = RegistryStore(mockContext)
    }

    private fun sample(ns: String = "test", count: Int = 5) = SkillMetadata(
        namespace = ns,
        displayName = "$ns display",
        description = "desc",
        category = "test",
        risk = SkillRiskTag.Mutating,
        androidSourceFile = "${ns}Commands.kt",
        methodCount = count,
    )

    @Test
    fun `load returns empty list when file does not exist`() {
        assertTrue(store.load().isEmpty())
    }

    @Test
    fun `save then load roundtrip`() {
        val skills = listOf(sample("a"), sample("b", count = 10))

        store.save(skills)
        val loaded = store.load()

        assertEquals(2, loaded.size)
        assertEquals("a", loaded[0].namespace)
        assertEquals(10, loaded[1].methodCount)
    }

    @Test
    fun `save overwrites previous content`() {
        store.save(listOf(sample("a")))
        store.save(listOf(sample("b"), sample("c")))

        val loaded = store.load()

        assertEquals(2, loaded.size)
        assertEquals(setOf("b", "c"), loaded.map { it.namespace }.toSet())
    }

    @Test
    fun `load returns empty when file content is corrupted`() {
        File(tempDir, RegistryStore.FILE_NAME).writeText("not valid json {")

        val loaded = store.load()

        assertTrue(loaded.isEmpty())
        // 损坏的文件应被清理
        assertFalse(File(tempDir, RegistryStore.FILE_NAME).exists())
    }

    @Test
    fun `clear removes the file`() {
        store.save(listOf(sample("a")))
        assertTrue(File(tempDir, RegistryStore.FILE_NAME).exists())

        store.clear()

        assertFalse(File(tempDir, RegistryStore.FILE_NAME).exists())
    }

    @Test
    fun `version mismatch discards the file`() {
        // 写一个 version 错的 wrapper
        File(tempDir, RegistryStore.FILE_NAME).writeText(
            """{"version": 999, "skills": []}""",
        )

        val loaded = store.load()

        assertTrue(loaded.isEmpty())
        assertFalse(File(tempDir, RegistryStore.FILE_NAME).exists())
    }
}
