package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * ConversationDao Unit Tests
 *
 * Comprehensive tests for AI conversation DAO using Robolectric and Room in-memory database
 *
 * Coverage:
 * - CRUD operations (insert, update, delete, retrieve)
 * - Flow响应 (reactive updates)
 * - Message operations (insert, batch, cascade delete)
 * - Transaction atomicity (deleteConversationWithMessages)
 * - Sorting (pinned DESC, updatedAt DESC)
 * - Timestamp updates
 *
 * This serves as the template for other DAO tests
 *
 * Target: 90% code coverage for ConversationDao.kt
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28]) // Android 9.0
class ConversationDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var conversationDao: ConversationDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries() // For testing only
            .build()

        conversationDao = database.conversationDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    // ========================================
    // CRUD Tests (6 tests)
    // ========================================

    @Test
    fun `insert conversation and retrieve by id`() = runTest {
        // Given
        val conversation = createTestConversation(
            id = "conv-1",
            title = "Test Conversation",
            model = "gpt-4"
        )

        // When
        val insertId = conversationDao.insertConversation(conversation)
        val retrieved = conversationDao.getConversationByIdSync("conv-1")

        // Then
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("conv-1", retrieved.id)
        assertEquals("Test Conversation", retrieved.title)
        assertEquals("gpt-4", retrieved.model)
    }

    @Test
    fun `getAll conversations returns empty list initially`() = runTest {
        // When
        val conversations = conversationDao.getAllConversations().first()

        // Then
        assertTrue(conversations.isEmpty())
    }

    @Test
    fun `update conversation modifies existing record`() = runTest {
        // Given
        val original = createTestConversation(id = "conv-1", title = "Original Title")
        conversationDao.insertConversation(original)

        // When
        val updated = original.copy(title = "Updated Title", isPinned = true)
        conversationDao.updateConversation(updated)
        val retrieved = conversationDao.getConversationByIdSync("conv-1")

        // Then
        assertNotNull(retrieved)
        assertEquals("Updated Title", retrieved.title)
        assertTrue(retrieved.isPinned)
    }

    @Test
    fun `delete conversation removes record`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        // When
        conversationDao.deleteConversation(conversation)
        val retrieved = conversationDao.getConversationByIdSync("conv-1")

        // Then
        assertNull(retrieved)
    }

    @Test
    fun `deleteConversationById removes conversation by id`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        // When
        conversationDao.deleteConversationById("conv-1")
        val retrieved = conversationDao.getConversationByIdSync("conv-1")

        // Then
        assertNull(retrieved)
    }

    @Test
    fun `insert with REPLACE strategy updates existing conversation`() = runTest {
        // Given
        val original = createTestConversation(id = "conv-1", title = "Original")
        val updated = createTestConversation(id = "conv-1", title = "Updated")

        // When
        conversationDao.insertConversation(original)
        conversationDao.insertConversation(updated) // Should replace
        val retrieved = conversationDao.getConversationByIdSync("conv-1")

        // Then
        assertNotNull(retrieved)
        assertEquals("Updated", retrieved.title)
    }

    // ========================================
    // Flow Response Tests (2 tests)
    // ========================================

    @Test
    fun `getAllConversations Flow emits updates on insert`() = runTest {
        // Using Turbine for Flow testing
        conversationDao.getAllConversations().test {
            // Initial emission
            val initial = awaitItem()
            assertEquals(0, initial.size)

            // Insert conversation
            val conversation = createTestConversation(id = "conv-1", title = "Test")
            conversationDao.insertConversation(conversation)

            // Flow emits new list
            val updated = awaitItem()
            assertEquals(1, updated.size)
            assertEquals("conv-1", updated[0].id)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `getConversationById Flow emits null then conversation`() = runTest {
        // Using Turbine for Flow testing
        conversationDao.getConversationById("conv-1").test {
            // Initial emission (null)
            val initial = awaitItem()
            assertNull(initial)

            // Insert conversation
            val conversation = createTestConversation(id = "conv-1")
            conversationDao.insertConversation(conversation)

            // Flow emits conversation
            val updated = awaitItem()
            assertNotNull(updated)
            assertEquals("conv-1", updated.id)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Message Operations Tests (5 tests)
    // ========================================

    @Test
    fun `insertMessage adds message to conversation`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        val message = createTestMessage(
            id = "msg-1",
            conversationId = "conv-1",
            role = "user",
            content = "Hello AI"
        )

        // When
        val insertId = conversationDao.insertMessage(message)
        val messages = conversationDao.getMessagesByConversation("conv-1").first()

        // Then
        assertTrue(insertId > 0)
        assertEquals(1, messages.size)
        assertEquals("msg-1", messages[0].id)
        assertEquals("Hello AI", messages[0].content)
    }

    @Test
    fun `insertMessages batch inserts multiple messages`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        val messages = listOf(
            createTestMessage(id = "msg-1", conversationId = "conv-1", role = "user", content = "Question"),
            createTestMessage(id = "msg-2", conversationId = "conv-1", role = "assistant", content = "Answer"),
            createTestMessage(id = "msg-3", conversationId = "conv-1", role = "user", content = "Follow-up")
        )

        // When
        conversationDao.insertMessages(messages)
        val retrieved = conversationDao.getMessagesByConversation("conv-1").first()

        // Then
        assertEquals(3, retrieved.size)
        assertEquals("msg-1", retrieved[0].id)
        assertEquals("msg-2", retrieved[1].id)
        assertEquals("msg-3", retrieved[2].id)
    }

    @Test
    fun `getMessagesByConversation returns messages ordered by createdAt ASC`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        val now = System.currentTimeMillis()
        val messages = listOf(
            createTestMessage(id = "msg-1", conversationId = "conv-1", createdAt = now + 3000),
            createTestMessage(id = "msg-2", conversationId = "conv-1", createdAt = now + 1000),
            createTestMessage(id = "msg-3", conversationId = "conv-1", createdAt = now + 2000)
        )
        conversationDao.insertMessages(messages)

        // When
        val retrieved = conversationDao.getMessagesByConversation("conv-1").first()

        // Then
        assertEquals(3, retrieved.size)
        assertEquals("msg-2", retrieved[0].id) // Earliest first
        assertEquals("msg-3", retrieved[1].id)
        assertEquals("msg-1", retrieved[2].id) // Latest last
    }

    @Test
    fun `deleteMessagesByConversation removes all conversation messages`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        val messages = (1..5).map {
            createTestMessage(id = "msg-$it", conversationId = "conv-1")
        }
        conversationDao.insertMessages(messages)

        // When
        conversationDao.deleteMessagesByConversation("conv-1")
        val retrieved = conversationDao.getMessagesByConversation("conv-1").first()

        // Then
        assertTrue(retrieved.isEmpty())
    }

    @Test
    fun `getMessageCount returns correct count`() = runTest {
        // Given
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        val messages = (1..10).map {
            createTestMessage(id = "msg-$it", conversationId = "conv-1")
        }
        conversationDao.insertMessages(messages)

        // When
        val count = conversationDao.getMessageCount("conv-1")

        // Then
        assertEquals(10, count)
    }

    // ========================================
    // Transaction Atomicity Test (1 test)
    // ========================================

    @Test
    fun `deleteConversationWithMessages is atomic - all or nothing`() = runTest {
        // Given: Conversation with messages
        val conversation = createTestConversation(id = "conv-1")
        conversationDao.insertConversation(conversation)

        val messages = (1..3).map {
            createTestMessage(id = "msg-$it", conversationId = "conv-1")
        }
        conversationDao.insertMessages(messages)

        // When: Delete conversation with messages (transaction)
        conversationDao.deleteConversationWithMessages("conv-1")

        // Then: Both conversation and messages are deleted
        val retrievedConv = conversationDao.getConversationByIdSync("conv-1")
        val retrievedMsgs = conversationDao.getMessagesByConversation("conv-1").first()

        assertNull(retrievedConv)
        assertTrue(retrievedMsgs.isEmpty())
    }

    // ========================================
    // Sorting Tests (2 tests)
    // ========================================

    @Test
    fun `getAllConversations sorts by isPinned DESC then updatedAt DESC`() = runTest {
        // Given
        val now = System.currentTimeMillis()
        conversationDao.insertConversation(
            createTestConversation(id = "conv-1", title = "Normal Old", isPinned = false, updatedAt = now - 5000)
        )
        conversationDao.insertConversation(
            createTestConversation(id = "conv-2", title = "Pinned Old", isPinned = true, updatedAt = now - 3000)
        )
        conversationDao.insertConversation(
            createTestConversation(id = "conv-3", title = "Normal New", isPinned = false, updatedAt = now - 1000)
        )
        conversationDao.insertConversation(
            createTestConversation(id = "conv-4", title = "Pinned New", isPinned = true, updatedAt = now - 2000)
        )

        // When
        val conversations = conversationDao.getAllConversations().first()

        // Then: Pinned first (by updatedAt DESC), then normal (by updatedAt DESC)
        assertEquals(4, conversations.size)
        assertEquals("conv-4", conversations[0].id) // Pinned, most recent
        assertEquals("conv-2", conversations[1].id) // Pinned, older
        assertEquals("conv-3", conversations[2].id) // Normal, most recent
        assertEquals("conv-1", conversations[3].id) // Normal, oldest
    }

    @Test
    fun `updateConversationTimestamp increments messageCount and updates updatedAt`() = runTest {
        // Given
        val now = System.currentTimeMillis()
        val conversation = createTestConversation(
            id = "conv-1",
            messageCount = 5,
            updatedAt = now - 10000
        )
        conversationDao.insertConversation(conversation)

        // When
        val newTimestamp = now
        conversationDao.updateConversationTimestamp("conv-1", newTimestamp)
        val updated = conversationDao.getConversationByIdSync("conv-1")

        // Then
        assertNotNull(updated)
        assertEquals(6, updated.messageCount) // Incremented
        assertEquals(newTimestamp, updated.updatedAt) // Updated
    }

    // ========================================
    // Batch Operations Test (1 test)
    // ========================================

    @Test
    fun `insert and query 500+ conversations performs well`() = runTest {
        // Given: Large batch of conversations
        val conversations = (1..500).map { index ->
            createTestConversation(
                id = "conv-$index",
                title = "Conversation $index",
                model = if (index % 2 == 0) "gpt-4" else "deepseek-chat"
            )
        }

        // When
        conversations.forEach { conversationDao.insertConversation(it) }
        val retrieved = conversationDao.getAllConversations().first()

        // Then
        assertEquals(500, retrieved.size)
    }

    // ========================================
    // Helper Functions
    // ========================================

    private fun createTestConversation(
        id: String = "conv-${System.currentTimeMillis()}",
        title: String = "Test Conversation",
        model: String = "gpt-4",
        createdAt: Long = System.currentTimeMillis(),
        updatedAt: Long = System.currentTimeMillis(),
        messageCount: Int = 0,
        isPinned: Boolean = false
    ): ConversationEntity {
        return ConversationEntity(
            id = id,
            title = title,
            model = model,
            createdAt = createdAt,
            updatedAt = updatedAt,
            messageCount = messageCount,
            isPinned = isPinned
        )
    }

    private fun createTestMessage(
        id: String = "msg-${System.currentTimeMillis()}",
        conversationId: String,
        role: String = "user",
        content: String = "Test message content",
        createdAt: Long = System.currentTimeMillis(),
        tokenCount: Int? = null
    ): MessageEntity {
        return MessageEntity(
            id = id,
            conversationId = conversationId,
            role = role,
            content = content,
            createdAt = createdAt,
            tokenCount = tokenCount
        )
    }
}
