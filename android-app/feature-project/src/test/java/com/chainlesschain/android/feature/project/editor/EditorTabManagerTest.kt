package com.chainlesschain.android.feature.project.editor

import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Unit tests for EditorTabManager
 *
 * Tests:
 * 1. Opening and closing tabs
 * 2. Tab limit (max 10 tabs)
 * 3. Tab switching
 * 4. Content updates and dirty tracking
 * 5. Tab reordering
 * 6. Cursor and scroll position tracking
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EditorTabManagerTest {

    private lateinit var tabManager: EditorTabManager

    @Before
    fun setup() {
        tabManager = EditorTabManager()
    }

    /**
     * Test 1: Open a new tab
     */
    @Test
    fun `openTab should create new tab and set as active`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        val content = "fun main() {}"

        // When
        val success = tabManager.openTab(file, content)

        // Then
        assertTrue(success)
        val tabs = tabManager.tabs.first()
        assertEquals(1, tabs.size)

        val activeTabId = tabManager.activeTabId.first()
        assertNotNull(activeTabId)

        val activeTab = tabManager.getActiveTab()
        assertEquals(file.id, activeTab?.file?.id)
        assertEquals(content, activeTab?.content)
        assertFalse(activeTab?.isDirty ?: true)
    }

    /**
     * Test 2: Open existing tab should activate it
     */
    @Test
    fun `openTab with already opened file should activate existing tab`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        tabManager.openTab(file, "content1")

        // When - Try to open same file again
        val success = tabManager.openTab(file, "content2")

        // Then
        assertTrue(success)
        val tabs = tabManager.tabs.first()
        assertEquals(1, tabs.size) // Still only 1 tab

        val activeTab = tabManager.getActiveTab()
        assertEquals("content1", activeTab?.content) // Original content preserved
    }

    /**
     * Test 3: Enforce max 10 tabs limit
     */
    @Test
    fun `openTab should fail when max tabs reached`() = runTest {
        // Given - Open 10 tabs
        repeat(10) { i ->
            val file = createTestFile("file$i.kt")
            tabManager.openTab(file, "content $i")
        }

        // When - Try to open 11th tab
        val file11 = createTestFile("file11.kt")
        val success = tabManager.openTab(file11, "content 11")

        // Then
        assertFalse(success)
        val tabs = tabManager.tabs.first()
        assertEquals(10, tabs.size) // Still max 10
    }

    /**
     * Test 4: Close a tab
     */
    @Test
    fun `closeTab should remove tab and switch to last tab`() = runTest {
        // Given - Open 3 tabs
        val file1 = createTestFile("file1.kt")
        val file2 = createTestFile("file2.kt")
        val file3 = createTestFile("file3.kt")

        tabManager.openTab(file1, "content 1")
        tabManager.openTab(file2, "content 2")
        tabManager.openTab(file3, "content 3")

        val tab2Id = tabManager.tabs.first()[1].id

        // When - Close middle tab (file2)
        val closedTab = tabManager.closeTab(tab2Id)

        // Then
        assertNotNull(closedTab)
        assertEquals(file2.id, closedTab.file.id)

        val tabs = tabManager.tabs.first()
        assertEquals(2, tabs.size)
        assertFalse(tabs.any { it.file.id == file2.id })
    }

    /**
     * Test 5: Close active tab should switch to last tab
     */
    @Test
    fun `closeTab on active tab should switch to last remaining tab`() = runTest {
        // Given
        val file1 = createTestFile("file1.kt")
        val file2 = createTestFile("file2.kt")

        tabManager.openTab(file1, "content 1")
        tabManager.openTab(file2, "content 2") // This is now active

        val activeTabId = tabManager.activeTabId.first()

        // When - Close active tab
        tabManager.closeTab(activeTabId!!)

        // Then
        val newActiveTab = tabManager.getActiveTab()
        assertEquals(file1.id, newActiveTab?.file?.id)
    }

    /**
     * Test 6: Switch between tabs
     */
    @Test
    fun `switchToTab should change active tab`() = runTest {
        // Given
        val file1 = createTestFile("file1.kt")
        val file2 = createTestFile("file2.kt")

        tabManager.openTab(file1, "content 1")
        tabManager.openTab(file2, "content 2")

        val tab1Id = tabManager.tabs.first()[0].id

        // When - Switch back to tab 1
        tabManager.switchToTab(tab1Id)

        // Then
        val activeTabId = tabManager.activeTabId.first()
        assertEquals(tab1Id, activeTabId)
    }

    /**
     * Test 7: Update tab content marks as dirty
     */
    @Test
    fun `updateTabContent should mark tab as dirty`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        tabManager.openTab(file, "original content")

        val tabId = tabManager.tabs.first()[0].id

        // When
        tabManager.updateTabContent(tabId, "modified content")

        // Then
        val tab = tabManager.getTab(tabId)
        assertEquals("modified content", tab?.content)
        assertTrue(tab?.isDirty ?: false)
    }

    /**
     * Test 8: Save tab clears dirty flag
     */
    @Test
    fun `saveTab should clear dirty flag`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        tabManager.openTab(file, "content")

        val tabId = tabManager.tabs.first()[0].id
        tabManager.updateTabContent(tabId, "modified")

        // Verify dirty
        assertTrue(tabManager.getTab(tabId)?.isDirty ?: false)

        // When
        tabManager.saveTab(tabId)

        // Then
        assertFalse(tabManager.getTab(tabId)?.isDirty ?: true)
    }

    /**
     * Test 9: Get all dirty tabs
     */
    @Test
    fun `getDirtyTabs should return only unsaved tabs`() = runTest {
        // Given
        val file1 = createTestFile("file1.kt")
        val file2 = createTestFile("file2.kt")
        val file3 = createTestFile("file3.kt")

        tabManager.openTab(file1, "content 1")
        tabManager.openTab(file2, "content 2")
        tabManager.openTab(file3, "content 3")

        val tabs = tabManager.tabs.first()
        tabManager.updateTabContent(tabs[0].id, "modified 1")
        tabManager.updateTabContent(tabs[2].id, "modified 3")

        // When
        val dirtyTabs = tabManager.getDirtyTabs()

        // Then
        assertEquals(2, dirtyTabs.size)
        assertTrue(dirtyTabs.all { it.isDirty })
    }

    /**
     * Test 10: Close all tabs
     */
    @Test
    fun `closeAllTabs should remove all tabs and clear active`() = runTest {
        // Given - Open 3 tabs
        repeat(3) { i ->
            val file = createTestFile("file$i.kt")
            tabManager.openTab(file, "content $i")
        }

        // When
        tabManager.closeAllTabs()

        // Then
        val tabs = tabManager.tabs.first()
        assertEquals(0, tabs.size)

        val activeTabId = tabManager.activeTabId.first()
        assertNull(activeTabId)
    }

    /**
     * Test 11: Close other tabs
     */
    @Test
    fun `closeOtherTabs should keep only specified tab`() = runTest {
        // Given - Open 3 tabs
        val file1 = createTestFile("file1.kt")
        val file2 = createTestFile("file2.kt")
        val file3 = createTestFile("file3.kt")

        tabManager.openTab(file1, "content 1")
        tabManager.openTab(file2, "content 2")
        tabManager.openTab(file3, "content 3")

        val keepTabId = tabManager.tabs.first()[1].id // Keep middle tab

        // When
        tabManager.closeOtherTabs(keepTabId)

        // Then
        val tabs = tabManager.tabs.first()
        assertEquals(1, tabs.size)
        assertEquals(keepTabId, tabs[0].id)

        val activeTabId = tabManager.activeTabId.first()
        assertEquals(keepTabId, activeTabId)
    }

    /**
     * Test 12: Move tab position
     */
    @Test
    fun `moveTab should reorder tabs`() = runTest {
        // Given
        val file1 = createTestFile("file1.kt")
        val file2 = createTestFile("file2.kt")
        val file3 = createTestFile("file3.kt")

        tabManager.openTab(file1, "content 1")
        tabManager.openTab(file2, "content 2")
        tabManager.openTab(file3, "content 3")

        // When - Move first tab to last position
        tabManager.moveTab(fromIndex = 0, toIndex = 2)

        // Then
        val tabs = tabManager.tabs.first()
        assertEquals(file2.id, tabs[0].file.id)
        assertEquals(file3.id, tabs[1].file.id)
        assertEquals(file1.id, tabs[2].file.id)
    }

    /**
     * Test 13: Update cursor position
     */
    @Test
    fun `updateCursorPosition should store cursor offset`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        tabManager.openTab(file, "fun main() {}")

        val tabId = tabManager.tabs.first()[0].id

        // When
        tabManager.updateCursorPosition(tabId, position = 5)

        // Then
        val tab = tabManager.getTab(tabId)
        assertEquals(5, tab?.cursorPosition)
    }

    /**
     * Test 14: Update scroll position
     */
    @Test
    fun `updateScrollPosition should store scroll offset`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        tabManager.openTab(file, "fun main() {}")

        val tabId = tabManager.tabs.first()[0].id

        // When
        tabManager.updateScrollPosition(tabId, position = 120)

        // Then
        val tab = tabManager.getTab(tabId)
        assertEquals(120, tab?.scrollPosition)
    }

    /**
     * Test 15: Get tab by ID
     */
    @Test
    fun `getTab should return tab or null`() = runTest {
        // Given
        val file = createTestFile("test.kt")
        tabManager.openTab(file, "content")

        val tabId = tabManager.tabs.first()[0].id

        // When
        val tab = tabManager.getTab(tabId)
        val nonExistent = tabManager.getTab("invalid_id")

        // Then
        assertNotNull(tab)
        assertEquals(file.id, tab.file.id)
        assertNull(nonExistent)
    }

    // Helper function
    private fun createTestFile(name: String): ProjectFileEntity {
        return ProjectFileEntity(
            id = UUID.randomUUID().toString(),
            projectId = "project_123",
            name = name,
            path = "/test/$name",
            type = "file",
            mimeType = "text/plain",
            extension = name.substringAfterLast('.', ""),
            size = 1024L,
            content = null,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
    }
}
