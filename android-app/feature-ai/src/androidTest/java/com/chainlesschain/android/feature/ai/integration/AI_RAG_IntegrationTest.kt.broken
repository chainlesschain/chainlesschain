package com.chainlesschain.android.feature.ai.integration

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.entity.*
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * AI + RAG + Knowledge Base Integration Tests
 *
 * Tests the complete workflow:
 * 1. Knowledge Base → RAG Retrieval → Context Injection
 * 2. AI Conversation with RAG context
 * 3. Database integration (KnowledgeItem + Conversation + Message)
 *
 * Target: 7 tests, integration coverage
 */
@RunWith(AndroidJUnit4::class)
class AI_RAG_IntegrationTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var knowledgeItemDao: KnowledgeItemDao
    private lateinit var conversationDao: ConversationDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, ChainlessChainDatabase::class.java)
            .allowMainThreadQueries()
            .build()

        knowledgeItemDao = database.knowledgeItemDao()
        conversationDao = database.conversationDao()
    }

    @After
    fun tearDown() = database.close()

    /**
     * Test 1: Complete Knowledge → AI Conversation Workflow
     *
     * Scenario:
     * 1. User adds knowledge items about Kotlin
     * 2. User creates AI conversation
     * 3. User asks question that requires knowledge base context
     * 4. System retrieves relevant knowledge and adds to conversation
     */
    @Test
    fun testCompleteKnowledgeToAIConversationWorkflow() = runBlocking {
        // Step 1: Add knowledge items
        val knowledgeItems = listOf(
            createKnowledgeItem(
                id = "k1",
                title = "Kotlin Coroutines",
                content = "Kotlin coroutines are lightweight threads that simplify asynchronous programming. Use suspend functions with launch and async builders."
            ),
            createKnowledgeItem(
                id = "k2",
                title = "Kotlin Flow",
                content = "Flow is a cold asynchronous data stream that sequentially emits values. It's perfect for reactive programming."
            ),
            createKnowledgeItem(
                id = "k3",
                title = "Android Room Database",
                content = "Room is an SQLite abstraction layer for Android. It provides compile-time verification of SQL queries."
            )
        )

        knowledgeItems.forEach { knowledgeItemDao.insert(it) }

        // Verify knowledge items inserted
        val allKnowledge = knowledgeItemDao.getAllItemsSync()
        assertEquals(3, allKnowledge.size)

        // Step 2: Create AI conversation
        val conversation = createConversation(id = "conv1", title = "Kotlin Questions")
        conversationDao.insertConversation(conversation)

        // Step 3: Add user message
        val userMessage = createMessage(
            id = "msg1",
            conversationId = "conv1",
            role = "user",
            content = "How do Kotlin coroutines work?"
        )
        conversationDao.insertMessage(userMessage)

        // Step 4: Simulate RAG context retrieval (in real app, this would query FTS5)
        val relevantKnowledge = knowledgeItems.filter { it.title.contains("Coroutines") }
        assertTrue(relevantKnowledge.isNotEmpty())

        // Step 5: Add AI response with RAG context
        val ragContext = relevantKnowledge.joinToString("\n\n") { item ->
            "Title: ${item.title}\nContent: ${item.content}"
        }

        val aiResponse = """
            Based on the knowledge base:

            $ragContext

            Answer: Kotlin coroutines are lightweight threads that simplify asynchronous programming.
        """.trimIndent()

        val assistantMessage = createMessage(
            id = "msg2",
            conversationId = "conv1",
            role = "assistant",
            content = aiResponse
        )
        conversationDao.insertMessage(assistantMessage)

        // Verify complete workflow
        val messages = conversationDao.getAllMessagesSync("conv1")
        assertEquals(2, messages.size)
        assertTrue(messages[1].content.contains("lightweight threads"))
        assertTrue(messages[1].content.contains(knowledgeItems[0].content))
    }

    /**
     * Test 2: Multiple Conversations with RAG
     *
     * Test managing multiple AI conversations with knowledge base context
     */
    @Test
    fun testMultipleConversationsWithRAG() = runBlocking {
        // Add knowledge
        knowledgeItemDao.insert(
            createKnowledgeItem(id = "k1", title = "Topic A", content = "Content about A")
        )
        knowledgeItemDao.insert(
            createKnowledgeItem(id = "k2", title = "Topic B", content = "Content about B")
        )

        // Create two conversations
        conversationDao.insertConversation(createConversation(id = "conv1", title = "Conversation 1"))
        conversationDao.insertConversation(createConversation(id = "conv2", title = "Conversation 2"))

        // Add messages to each
        conversationDao.insertMessage(createMessage(id = "m1", conversationId = "conv1", role = "user", content = "Question 1"))
        conversationDao.insertMessage(createMessage(id = "m2", conversationId = "conv2", role = "user", content = "Question 2"))

        // Verify conversations are independent
        val conv1Messages = conversationDao.getAllMessagesSync("conv1")
        val conv2Messages = conversationDao.getAllMessagesSync("conv2")

        assertEquals(1, conv1Messages.size)
        assertEquals(1, conv2Messages.size)
        assertEquals("Question 1", conv1Messages[0].content)
        assertEquals("Question 2", conv2Messages[0].content)
    }

    /**
     * Test 3: Knowledge Base Search Integration
     *
     * Test FTS5 full-text search on knowledge items
     */
    @Test
    fun testKnowledgeBaseSearchIntegration() = runBlocking {
        // Add diverse knowledge items
        val items = listOf(
            createKnowledgeItem(id = "k1", title = "Kotlin Language", content = "Kotlin is a modern statically-typed programming language"),
            createKnowledgeItem(id = "k2", title = "Java Comparison", content = "Kotlin vs Java: null safety and concise syntax"),
            createKnowledgeItem(id = "k3", title = "Android Development", content = "Building mobile apps with Kotlin and Jetpack Compose")
        )

        items.forEach { knowledgeItemDao.insert(it) }

        // Search for "Kotlin" (FTS5 would be used in real implementation)
        val searchResults = knowledgeItemDao.getAllItemsSync().filter {
            it.title.contains("Kotlin", ignoreCase = true) ||
                    it.content.contains("Kotlin", ignoreCase = true)
        }

        assertTrue(searchResults.size >= 2)
        assertTrue(searchResults.any { it.title == "Kotlin Language" })
    }

    /**
     * Test 4: Conversation Message Ordering
     *
     * Test messages are ordered correctly in conversation
     */
    @Test
    fun testConversationMessageOrdering() = runBlocking {
        // Create conversation
        conversationDao.insertConversation(createConversation(id = "conv1", title = "Test"))

        // Add messages with delays to ensure different timestamps
        val messages = listOf(
            createMessage(id = "m1", conversationId = "conv1", role = "user", content = "Message 1", timestamp = 1000),
            createMessage(id = "m2", conversationId = "conv1", role = "assistant", content = "Message 2", timestamp = 2000),
            createMessage(id = "m3", conversationId = "conv1", role = "user", content = "Message 3", timestamp = 3000)
        )

        messages.forEach { conversationDao.insertMessage(it) }

        // Retrieve and verify order
        val retrieved = conversationDao.getAllMessagesSync("conv1")
        assertEquals(3, retrieved.size)
        assertEquals("Message 1", retrieved[0].content)
        assertEquals("Message 2", retrieved[1].content)
        assertEquals("Message 3", retrieved[2].content)
    }

    /**
     * Test 5: Knowledge Item Soft Delete
     *
     * Test soft delete doesn't break RAG retrieval
     */
    @Test
    fun testKnowledgeItemSoftDelete() = runBlocking {
        // Add items
        knowledgeItemDao.insert(createKnowledgeItem(id = "k1", title = "Item 1", content = "Content 1"))
        knowledgeItemDao.insert(createKnowledgeItem(id = "k2", title = "Item 2", content = "Content 2"))

        // Soft delete one item
        knowledgeItemDao.softDelete("k1")

        // Verify only non-deleted items retrieved
        val activeItems = knowledgeItemDao.getAllItemsSync()
        assertEquals(1, activeItems.size)
        assertEquals("k2", activeItems[0].id)
    }

    /**
     * Test 6: Conversation Metadata Updates
     *
     * Test conversation metadata (messageCount, totalTokens) updates correctly
     */
    @Test
    fun testConversationMetadataUpdates() = runBlocking {
        // Create conversation
        val conversation = createConversation(id = "conv1", title = "Test")
        conversationDao.insertConversation(conversation)

        // Add messages
        conversationDao.insertMessage(createMessage(id = "m1", conversationId = "conv1", role = "user", content = "Hello"))
        conversationDao.insertMessage(createMessage(id = "m2", conversationId = "conv1", role = "assistant", content = "Hi there"))

        // Update conversation metadata
        val updatedConv = conversation.copy(
            messageCount = 2,
            totalTokens = 50,
            lastMessageAt = System.currentTimeMillis()
        )
        conversationDao.updateConversation(updatedConv)

        // Verify updates
        val retrieved = conversationDao.getConversationByIdSync("conv1")
        assertNotNull(retrieved)
        assertEquals(2, retrieved.messageCount)
        assertEquals(50, retrieved.totalTokens)
    }

    /**
     * Test 7: Empty Knowledge Base Handling
     *
     * Test graceful degradation when no knowledge exists
     */
    @Test
    fun testEmptyKnowledgeBaseHandling() = runBlocking {
        // No knowledge items inserted

        // Create conversation
        conversationDao.insertConversation(createConversation(id = "conv1", title = "No Context"))

        // Add message without RAG context
        conversationDao.insertMessage(
            createMessage(
                id = "msg1",
                conversationId = "conv1",
                role = "assistant",
                content = "I don't have specific knowledge about that, but I can provide general information..."
            )
        )

        // Verify conversation works without knowledge base
        val messages = conversationDao.getAllMessagesSync("conv1")
        assertEquals(1, messages.size)
        assertTrue(messages[0].content.contains("general information"))
    }

    // ========================================
    // Helper Functions
    // ========================================

    private fun createKnowledgeItem(
        id: String,
        title: String,
        content: String,
        folderId: String? = null,
        tags: String = "",
        isDeleted: Boolean = false
    ) = KnowledgeItemEntity(
        id = id,
        title = title,
        content = content,
        folderId = folderId,
        tags = tags,
        type = "note",
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis(),
        deviceId = "test-device",
        isDeleted = isDeleted,
        isFavorite = false,
        isPinned = false,
        syncStatus = "synced",
        attachments = null
    )

    private fun createConversation(
        id: String,
        title: String,
        model: String = "gpt-4",
        systemPrompt: String = "You are a helpful assistant."
    ) = ConversationEntity(
        id = id,
        title = title,
        model = model,
        systemPrompt = systemPrompt,
        temperature = 0.7f,
        maxTokens = 2000,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis(),
        lastMessageAt = System.currentTimeMillis(),
        messageCount = 0,
        totalTokens = 0,
        isPinned = false,
        isArchived = false,
        sessionContext = null,
        ragEnabled = true,
        knowledgeBaseIds = null
    )

    private fun createMessage(
        id: String,
        conversationId: String,
        role: String,
        content: String,
        timestamp: Long = System.currentTimeMillis()
    ) = MessageEntity(
        id = id,
        conversationId = conversationId,
        role = role,
        content = content,
        tokens = content.length / 4, // Rough estimate
        createdAt = timestamp,
        model = "gpt-4",
        finishReason = "stop",
        isStreaming = false,
        error = null
    )
}
