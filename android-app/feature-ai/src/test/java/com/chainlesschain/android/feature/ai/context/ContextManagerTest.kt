package com.chainlesschain.android.feature.ai.context

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.UUID

/**
 * ContextManager 单元测试
 *
 * 验证LRU缓存、消息管理、Token估算等功能
 */
class ContextManagerTest {

    private lateinit var contextManager: ContextManager

    @Before
    fun setup() {
        contextManager = ContextManager()
    }

    // Helper function to create a message
    private fun createMessage(
        conversationId: String,
        role: MessageRole,
        content: String
    ): Message {
        return Message(
            id = UUID.randomUUID().toString(),
            conversationId = conversationId,
            role = role,
            content = content,
            createdAt = System.currentTimeMillis()
        )
    }

    // ===== Context Lifecycle Tests =====

    @Test
    fun `创建上下文应成功`() {
        // When
        val context = contextManager.getOrCreateContext("conv-1")

        // Then
        assertNotNull("上下文不应为空", context)
        assertEquals("会话ID应匹配", "conv-1", context.conversationId)
        assertTrue("消息应为空", context.messages.isEmpty())
    }

    @Test
    fun `获取已存在的上下文应返回相同实例`() {
        // Given
        val context1 = contextManager.getOrCreateContext("conv-1")
        val message = createMessage("conv-1", MessageRole.USER, "Hello")
        contextManager.addMessage("conv-1", message)

        // When
        val context2 = contextManager.getOrCreateContext("conv-1")

        // Then
        assertEquals("应返回相同上下文", context1.conversationId, context2.conversationId)
        assertEquals("消息应保持", 1, context2.messages.size)
    }

    @Test
    fun `删除上下文应成功`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        val message = createMessage("conv-1", MessageRole.USER, "Hello")
        contextManager.addMessage("conv-1", message)

        // When
        contextManager.clearContext("conv-1")
        val context = contextManager.getOrCreateContext("conv-1")

        // Then
        assertTrue("新上下文消息应为空", context.messages.isEmpty())
    }

    // ===== Message Management Tests =====

    @Test
    fun `添加消息应成功`() {
        // Given
        contextManager.getOrCreateContext("conv-1")

        // When
        val msg1 = createMessage("conv-1", MessageRole.USER, "Hello")
        val msg2 = createMessage("conv-1", MessageRole.ASSISTANT, "Hi there!")
        contextManager.addMessage("conv-1", msg1)
        contextManager.addMessage("conv-1", msg2)

        // Then
        val context = contextManager.getOrCreateContext("conv-1")
        assertEquals("应有2条消息", 2, context.messages.size)
        assertEquals("第一条消息角色正确", MessageRole.USER, context.messages[0].role)
        assertEquals("第二条消息内容正确", "Hi there!", context.messages[1].content)
    }

    @Test
    fun `消息应遵守最大数量限制`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        val maxMessages = ContextConfig.DEFAULT_MAX_MESSAGES_PER_CONTEXT

        // When - 添加超过限制的消息
        repeat(maxMessages + 20) { i ->
            val msg = createMessage("conv-1", MessageRole.USER, "Message $i")
            contextManager.addMessage("conv-1", msg)
        }

        // Then
        val context = contextManager.getOrCreateContext("conv-1")
        assertTrue("消息数量应<=最大限制", context.messages.size <= maxMessages)
    }

    @Test
    fun `添加系统消息应成功`() {
        // Given
        contextManager.getOrCreateContext("conv-1")

        // When
        contextManager.setSystemPrompt("conv-1", "You are a helpful assistant")
        val userMsg = createMessage("conv-1", MessageRole.USER, "Hello")
        contextManager.addMessage("conv-1", userMsg)

        // Then
        val context = contextManager.getOrCreateContext("conv-1")
        assertEquals("系统消息角色正确", MessageRole.SYSTEM, context.messages[0].role)
    }

    // ===== Token Estimation Tests =====

    @Test
    fun `Token估算应计算正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        val msg1 = createMessage("conv-1", MessageRole.USER, "Hello World")
        val msg2 = createMessage("conv-1", MessageRole.ASSISTANT, "你好世界")
        contextManager.addMessage("conv-1", msg1)
        contextManager.addMessage("conv-1", msg2)

        // When
        val context = contextManager.getOrCreateContext("conv-1")
        val totalTokens = context.estimatedTokens

        // Then
        assertTrue("Token数量应大于0", totalTokens > 0)
        assertTrue("Token数量应合理", totalTokens in 3..15)
    }

    @Test
    fun `空上下文Token应为0`() {
        // Given
        val context = contextManager.getOrCreateContext("conv-1")

        // Then
        assertEquals("空上下文Token应为0", 0, context.estimatedTokens)
    }

    // ===== Context Operations Tests =====

    @Test
    fun `检查上下文存在应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")

        // Then
        assertTrue("已创建的上下文应存在", contextManager.hasContext("conv-1"))
        assertFalse("未创建的上下文不应存在", contextManager.hasContext("conv-2"))
    }

    @Test
    fun `获取所有上下文ID应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.getOrCreateContext("conv-2")
        contextManager.getOrCreateContext("conv-3")

        // When
        val ids = contextManager.getAllContextIds()

        // Then
        assertEquals("应有3个上下文", 3, ids.size)
        assertTrue("应包含conv-1", ids.contains("conv-1"))
        assertTrue("应包含conv-2", ids.contains("conv-2"))
        assertTrue("应包含conv-3", ids.contains("conv-3"))
    }

    // ===== Clear All Tests =====

    @Test
    fun `清空所有上下文应成功`() {
        // Given
        repeat(5) { i ->
            contextManager.getOrCreateContext("conv-$i")
            val msg = createMessage("conv-$i", MessageRole.USER, "Message $i")
            contextManager.addMessage("conv-$i", msg)
        }

        // When
        contextManager.clearAllContexts()

        // Then
        assertFalse("上下文应被清除", contextManager.hasContext("conv-0"))
        assertFalse("上下文应被清除", contextManager.hasContext("conv-4"))
    }

    // ===== Current Context Tests =====

    @Test
    fun `设置当前上下文应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.getOrCreateContext("conv-2")

        // When
        contextManager.setCurrentContext("conv-1")

        // Then
        assertEquals("当前上下文应正确", "conv-1", contextManager.currentContextId.value)
    }

    @Test
    fun `清除后当前上下文应为null`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.setCurrentContext("conv-1")

        // When
        contextManager.clearContext("conv-1")

        // Then
        assertNull("当前上下文应为null", contextManager.currentContextId.value)
    }

    // ===== LRU Eviction Tests =====

    @Test
    fun `LRU淘汰应正常工作`() {
        // Given - 创建超过最大缓存数量的上下文
        val maxContexts = ContextConfig.DEFAULT_MAX_CONTEXTS

        repeat(maxContexts + 5) { i ->
            contextManager.getOrCreateContext("conv-$i")
            val msg = createMessage("conv-$i", MessageRole.USER, "Message for conv-$i")
            contextManager.addMessage("conv-$i", msg)
        }

        // Then
        val ids = contextManager.getAllContextIds()
        assertTrue("上下文数量应<=最大限制", ids.size <= maxContexts)
    }

    // ===== Metadata Tests =====

    @Test
    fun `设置和获取元数据应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")

        // When
        contextManager.setContextMetadata("conv-1", "key1", "value1")
        contextManager.setContextMetadata("conv-1", "key2", 123)

        // Then
        assertEquals("字符串元数据应正确", "value1", contextManager.getContextMetadata("conv-1", "key1"))
        assertEquals("数字元数据应正确", 123, contextManager.getContextMetadata("conv-1", "key2"))
    }

    // ===== Compression Tests =====

    @Test
    fun `标记压缩应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")

        // When
        contextManager.markCompressed("conv-1", "This is the summary")

        // Then
        val context = contextManager.getContext("conv-1")
        assertNotNull("上下文不应为空", context)
        assertTrue("应标记为已压缩", context!!.isCompressed)
        assertEquals("压缩摘要应正确", "This is the summary", context.compressionSummary)
    }

    // ===== Thread Safety Tests =====

    @Test
    fun `并发操作应线程安全`() {
        // Given
        val threads = 10
        val messagesPerThread = 50

        // When - 多线程并发添加消息
        val jobs = List(threads) { threadId ->
            Thread {
                repeat(messagesPerThread) { msgId ->
                    val msg = createMessage(
                        "conv-$threadId",
                        MessageRole.USER,
                        "Thread $threadId Message $msgId"
                    )
                    contextManager.addMessage("conv-$threadId", msg)
                }
            }
        }

        jobs.forEach { it.start() }
        jobs.forEach { it.join() }

        // Then - 验证数据完整性
        val ids = contextManager.getAllContextIds()
        assertTrue("应有多个上下文", ids.isNotEmpty())
    }

    // ===== Message Export Tests =====

    @Test
    fun `导出上下文消息应成功`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        val msg1 = createMessage("conv-1", MessageRole.USER, "Hello")
        val msg2 = createMessage("conv-1", MessageRole.ASSISTANT, "Hi!")
        contextManager.addMessage("conv-1", msg1)
        contextManager.addMessage("conv-1", msg2)

        // When
        val context = contextManager.getOrCreateContext("conv-1")
        val messages = context.messages

        // Then
        assertEquals("应有2条消息", 2, messages.size)

        // 验证消息格式
        messages.forEach { msg ->
            assertNotNull("消息角色不应为空", msg.role)
            assertNotNull("消息内容不应为空", msg.content)
            assertTrue("消息时间戳应大于0", msg.createdAt > 0)
        }
    }

    // ===== Get Messages For LLM Tests =====

    @Test
    fun `获取LLM消息应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.setSystemPrompt("conv-1", "You are an assistant")
        val msg1 = createMessage("conv-1", MessageRole.USER, "Hello")
        val msg2 = createMessage("conv-1", MessageRole.ASSISTANT, "Hi!")
        contextManager.addMessage("conv-1", msg1)
        contextManager.addMessage("conv-1", msg2)

        // When
        val messages = contextManager.getMessagesForLLM("conv-1")

        // Then
        assertTrue("应有消息", messages.isNotEmpty())
        assertEquals("第一条应是系统消息", MessageRole.SYSTEM, messages.first().role)
    }
}
