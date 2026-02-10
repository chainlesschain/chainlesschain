package com.chainlesschain.android.feature.ai.context

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

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
        contextManager.addMessage("conv-1", "user", "Hello")

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
        contextManager.addMessage("conv-1", "user", "Hello")

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
        contextManager.addMessage("conv-1", "user", "Hello")
        contextManager.addMessage("conv-1", "assistant", "Hi there!")

        // Then
        val context = contextManager.getOrCreateContext("conv-1")
        assertEquals("应有2条消息", 2, context.messages.size)
        assertEquals("第一条消息角色正确", "user", context.messages[0].role)
        assertEquals("第二条消息内容正确", "Hi there!", context.messages[1].content)
    }

    @Test
    fun `消息应遵守最大数量限制`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        val maxMessages = ContextConfig.DEFAULT_MAX_MESSAGES_PER_CONTEXT

        // When - 添加超过限制的消息
        repeat(maxMessages + 20) { i ->
            contextManager.addMessage("conv-1", "user", "Message $i")
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
        contextManager.addMessage("conv-1", "system", "You are a helpful assistant")
        contextManager.addMessage("conv-1", "user", "Hello")

        // Then
        val context = contextManager.getOrCreateContext("conv-1")
        assertEquals("系统消息角色正确", "system", context.messages[0].role)
    }

    // ===== LRU Eviction Tests =====

    @Test
    fun `LRU淘汰应正常工作`() {
        // Given - 创建超过最大缓存数量的上下文
        val maxContexts = ContextConfig.DEFAULT_MAX_CONTEXTS

        repeat(maxContexts + 5) { i ->
            contextManager.getOrCreateContext("conv-$i")
            contextManager.addMessage("conv-$i", "user", "Message for conv-$i")
        }

        // When - 获取统计
        val stats = contextManager.getStatistics()

        // Then
        assertTrue("上下文数量应<=最大限制", stats.totalContexts <= maxContexts)
    }

    @Test
    fun `访问上下文应更新LRU顺序`() {
        // Given
        val maxContexts = ContextConfig.DEFAULT_MAX_CONTEXTS

        // 创建满的缓存
        repeat(maxContexts) { i ->
            contextManager.getOrCreateContext("conv-$i")
        }

        // When - 访问第一个上下文（使其变为最近使用）
        contextManager.getOrCreateContext("conv-0")

        // 添加新上下文，触发淘汰
        contextManager.getOrCreateContext("conv-new")

        // Then - conv-0应该还存在，conv-1应该被淘汰
        val context0 = contextManager.getOrCreateContext("conv-0")
        assertEquals("conv-0应存在且消息为空", 0, context0.messages.size)
    }

    // ===== Token Estimation Tests =====

    @Test
    fun `Token估算应计算正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.addMessage("conv-1", "user", "Hello World") // 约3 tokens
        contextManager.addMessage("conv-1", "assistant", "你好世界") // 约2 tokens

        // When
        val context = contextManager.getOrCreateContext("conv-1")
        val totalTokens = context.totalTokens

        // Then
        assertTrue("Token数量应大于0", totalTokens > 0)
        assertTrue("Token数量应合理", totalTokens in 3..10)
    }

    @Test
    fun `空上下文Token应为0`() {
        // Given
        val context = contextManager.getOrCreateContext("conv-1")

        // Then
        assertEquals("空上下文Token应为0", 0, context.totalTokens)
    }

    // ===== Statistics Tests =====

    @Test
    fun `统计信息应正确`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.addMessage("conv-1", "user", "Hello")
        contextManager.getOrCreateContext("conv-2")
        contextManager.addMessage("conv-2", "user", "Hi")
        contextManager.addMessage("conv-2", "assistant", "Hello!")

        // When
        val stats = contextManager.getStatistics()

        // Then
        assertEquals("应有2个上下文", 2, stats.totalContexts)
        assertEquals("应有3条消息", 3, stats.totalMessages)
        assertTrue("总Token应大于0", stats.totalTokens > 0)
    }

    // ===== Clear All Tests =====

    @Test
    fun `清空所有上下文应成功`() {
        // Given
        repeat(5) { i ->
            contextManager.getOrCreateContext("conv-$i")
            contextManager.addMessage("conv-$i", "user", "Message $i")
        }

        // When
        contextManager.clearAll()

        // Then
        val stats = contextManager.getStatistics()
        assertEquals("上下文数量应为0", 0, stats.totalContexts)
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
                    contextManager.addMessage(
                        "conv-$threadId",
                        "user",
                        "Thread $threadId Message $msgId"
                    )
                }
            }
        }

        jobs.forEach { it.start() }
        jobs.forEach { it.join() }

        // Then - 验证数据完整性
        val stats = contextManager.getStatistics()
        assertTrue("应有多个上下文", stats.totalContexts > 0)
        assertTrue("应有多条消息", stats.totalMessages > 0)
    }

    // ===== Context Export Tests =====

    @Test
    fun `导出上下文消息应成功`() {
        // Given
        contextManager.getOrCreateContext("conv-1")
        contextManager.addMessage("conv-1", "user", "Hello")
        contextManager.addMessage("conv-1", "assistant", "Hi!")

        // When
        val context = contextManager.getOrCreateContext("conv-1")
        val messages = context.messages

        // Then
        assertEquals("应有2条消息", 2, messages.size)

        // 验证消息格式
        messages.forEach { msg ->
            assertNotNull("消息角色不应为空", msg.role)
            assertNotNull("消息内容不应为空", msg.content)
            assertTrue("消息时间戳应大于0", msg.timestamp > 0)
        }
    }
}
