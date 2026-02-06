package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * AICommands 单元测试
 *
 * 测试 AI 命令 API 的核心功能：
 * - chat() - AI 对话
 * - getConversations() - 查询对话历史
 * - ragSearch() - RAG 知识库搜索
 * - controlAgent() - 控制 AI Agent
 * - getModels() - 获取可用模型列表
 * - listAgents() - 获取远端 Agent 列表
 *
 * 测试用例数: 15
 * 覆盖率目标: 95%+
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AICommandsTest {

    private lateinit var aiCommands: AICommands
    private lateinit var mockClient: RemoteCommandClient

    @Before
    fun setup() {
        mockClient = mockk(relaxed = true)
        aiCommands = AICommands(mockClient)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    // ==================== chat() Tests ====================

    @Test
    fun `chat() should invoke client with correct method and params`() = runTest {
        // Given
        val message = "Hello, AI!"
        val mockResponse = ChatResponse(
            conversationId = "conv-123",
            reply = "Hi there!",
            model = "qwen2:7b"
        )

        coEvery {
            mockClient.invoke<ChatResponse>("ai.chat", any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.chat(message)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals("conv-123", result.getOrNull()?.conversationId)
        assertEquals("Hi there!", result.getOrNull()?.reply)

        coVerify {
            mockClient.invoke<ChatResponse>(
                "ai.chat",
                match { params ->
                    params["message"] == message
                },
                any()
            )
        }
    }

    @Test
    fun `chat() with all optional params should include them in request`() = runTest {
        // Given
        val message = "Test message"
        val conversationId = "conv-456"
        val model = "gpt-4"
        val systemPrompt = "You are a helpful assistant"
        val temperature = 0.8f

        val mockResponse = ChatResponse(
            conversationId = conversationId,
            reply = "Response",
            model = model
        )

        coEvery {
            mockClient.invoke<ChatResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.chat(
            message = message,
            conversationId = conversationId,
            model = model,
            systemPrompt = systemPrompt,
            temperature = temperature
        )

        // Then
        assertTrue("Result should be success", result.isSuccess)

        coVerify {
            mockClient.invoke<ChatResponse>(
                "ai.chat",
                match { params ->
                    params["message"] == message &&
                    params["conversationId"] == conversationId &&
                    params["model"] == model &&
                    params["systemPrompt"] == systemPrompt &&
                    params["temperature"] == temperature
                },
                any()
            )
        }
    }

    @Test
    fun `chat() should handle failure from client`() = runTest {
        // Given
        val message = "Test"
        val exception = Exception("Network error")

        coEvery {
            mockClient.invoke<ChatResponse>(any(), any(), any())
        } returns Result.failure(exception)

        // When
        val result = aiCommands.chat(message)

        // Then
        assertTrue("Result should be failure", result.isFailure)
        assertEquals("Network error", result.exceptionOrNull()?.message)
    }

    @Test
    fun `chat() with token usage should return complete response`() = runTest {
        // Given
        val message = "Test"
        val mockResponse = ChatResponse(
            conversationId = "conv-789",
            reply = "Response",
            model = "claude-3",
            tokens = TokenUsage(
                prompt = 10,
                completion = 20,
                total = 30
            )
        )

        coEvery {
            mockClient.invoke<ChatResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.chat(message)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        val response = result.getOrNull()
        assertNotNull("Response should not be null", response)
        assertNotNull("Token usage should not be null", response?.tokens)
        assertEquals(30, response?.tokens?.total)
    }

    // ==================== getConversations() Tests ====================

    @Test
    fun `getConversations() should use default limit and offset`() = runTest {
        // Given
        val mockResponse = ConversationsResponse(
            conversations = emptyList(),
            total = 0,
            limit = 20,
            offset = 0
        )

        coEvery {
            mockClient.invoke<ConversationsResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.getConversations()

        // Then
        assertTrue("Result should be success", result.isSuccess)

        coVerify {
            mockClient.invoke<ConversationsResponse>(
                "ai.getConversations",
                match { params ->
                    params["limit"] == 20 && params["offset"] == 0
                },
                any()
            )
        }
    }

    @Test
    fun `getConversations() with custom params should pass them to client`() = runTest {
        // Given
        val limit = 50
        val offset = 10
        val keyword = "test"

        val mockConversations = listOf(
            Conversation(
                id = "conv-1",
                title = "Test conversation",
                model = "qwen2:7b",
                created_at = 1000L,
                updated_at = 2000L
            )
        )

        val mockResponse = ConversationsResponse(
            conversations = mockConversations,
            total = 1,
            limit = limit,
            offset = offset
        )

        coEvery {
            mockClient.invoke<ConversationsResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.getConversations(limit, offset, keyword)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(1, result.getOrNull()?.conversations?.size)
        assertEquals("Test conversation", result.getOrNull()?.conversations?.get(0)?.title)

        coVerify {
            mockClient.invoke<ConversationsResponse>(
                "ai.getConversations",
                match { params ->
                    params["limit"] == limit &&
                    params["offset"] == offset &&
                    params["keyword"] == keyword
                },
                any()
            )
        }
    }

    // ==================== ragSearch() Tests ====================

    @Test
    fun `ragSearch() should use default topK parameter`() = runTest {
        // Given
        val query = "How to use RAG?"
        val mockResponse = RAGSearchResponse(
            query = query,
            results = emptyList(),
            total = 0,
            topK = 5
        )

        coEvery {
            mockClient.invoke<RAGSearchResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.ragSearch(query)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(5, result.getOrNull()?.topK)

        coVerify {
            mockClient.invoke<RAGSearchResponse>(
                "ai.ragSearch",
                match { params ->
                    params["query"] == query && params["topK"] == 5
                },
                any()
            )
        }
    }

    @Test
    fun `ragSearch() with filters should include them in request`() = runTest {
        // Given
        val query = "Search query"
        val topK = 10
        val filters = mapOf(
            "tag" to "important",
            "dateFrom" to "2024-01-01"
        )

        val mockResults = listOf(
            SearchResult(
                noteId = "note-1",
                title = "Test Note",
                content = "Test content",
                score = 0.95f
            )
        )

        val mockResponse = RAGSearchResponse(
            query = query,
            results = mockResults,
            total = 1,
            topK = topK
        )

        coEvery {
            mockClient.invoke<RAGSearchResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.ragSearch(query, topK, filters)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(1, result.getOrNull()?.results?.size)
        assertEquals("Test Note", result.getOrNull()?.results?.get(0)?.title)
        assertEquals(0.95f, result.getOrNull()?.results?.get(0)?.score)

        coVerify {
            mockClient.invoke<RAGSearchResponse>(
                "ai.ragSearch",
                match { params ->
                    params["query"] == query &&
                    params["topK"] == topK &&
                    params["filters"] == filters
                },
                any()
            )
        }
    }

    // ==================== controlAgent() Tests ====================

    @Test
    fun `controlAgent() with START action should send correct params`() = runTest {
        // Given
        val agentId = "agent-123"
        val action = AgentAction.START

        val mockResponse = AgentControlResponse(
            success = true,
            agentId = agentId,
            action = "start",
            status = "running",
            timestamp = System.currentTimeMillis()
        )

        coEvery {
            mockClient.invoke<AgentControlResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.controlAgent(action, agentId)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(true, result.getOrNull()?.success)
        assertEquals("running", result.getOrNull()?.status)

        coVerify {
            mockClient.invoke<AgentControlResponse>(
                "ai.controlAgent",
                match { params ->
                    params["action"] == "start" && params["agentId"] == agentId
                },
                any()
            )
        }
    }

    @Test
    fun `controlAgent() with STOP action should work correctly`() = runTest {
        // Given
        val agentId = "agent-456"
        val action = AgentAction.STOP

        val mockResponse = AgentControlResponse(
            success = true,
            agentId = agentId,
            action = "stop",
            status = "stopped",
            timestamp = System.currentTimeMillis()
        )

        coEvery {
            mockClient.invoke<AgentControlResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.controlAgent(action, agentId)

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals("stopped", result.getOrNull()?.status)

        coVerify {
            mockClient.invoke<AgentControlResponse>(
                "ai.controlAgent",
                match { params ->
                    params["action"] == "stop"
                },
                any()
            )
        }
    }

    @Test
    fun `controlAgent() should handle all AgentAction types`() = runTest {
        // Given
        val agentId = "agent-789"
        val mockResponse = AgentControlResponse(
            success = true,
            agentId = agentId,
            action = "",
            status = "ok",
            timestamp = System.currentTimeMillis()
        )

        coEvery {
            mockClient.invoke<AgentControlResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // Test all actions
        val actions = listOf(
            AgentAction.START to "start",
            AgentAction.STOP to "stop",
            AgentAction.RESTART to "restart",
            AgentAction.STATUS to "status"
        )

        for ((action, expectedValue) in actions) {
            // When
            aiCommands.controlAgent(action, agentId)

            // Then
            coVerify {
                mockClient.invoke<AgentControlResponse>(
                    "ai.controlAgent",
                    match { params ->
                        params["action"] == expectedValue
                    },
                    any()
                )
            }
        }
    }

    // ==================== getModels() Tests ====================

    @Test
    fun `getModels() should invoke client with empty params`() = runTest {
        // Given
        val mockModels = listOf(
            AIModel(
                id = "qwen2:7b",
                name = "Qwen2 7B",
                provider = "Ollama",
                capabilities = listOf("chat", "completion"),
                maxTokens = 4096
            ),
            AIModel(
                id = "gpt-4",
                name = "GPT-4",
                provider = "OpenAI",
                capabilities = listOf("chat", "completion", "vision"),
                maxTokens = 8192
            )
        )

        val mockResponse = ModelsResponse(
            models = mockModels,
            total = 2
        )

        coEvery {
            mockClient.invoke<ModelsResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.getModels()

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(2, result.getOrNull()?.models?.size)
        assertEquals("Qwen2 7B", result.getOrNull()?.models?.get(0)?.name)
        assertEquals("GPT-4", result.getOrNull()?.models?.get(1)?.name)

        coVerify {
            mockClient.invoke<ModelsResponse>(
                "ai.getModels",
                emptyMap(),
                any()
            )
        }
    }

    @Test
    fun `getModels() should handle empty model list`() = runTest {
        // Given
        val mockResponse = ModelsResponse(
            models = emptyList(),
            total = 0
        )

        coEvery {
            mockClient.invoke<ModelsResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.getModels()

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(0, result.getOrNull()?.total)
        assertTrue("Models list should be empty", result.getOrNull()?.models?.isEmpty() == true)
    }

    // ==================== listAgents() Tests ====================

    @Test
    fun `listAgents() should invoke client with empty params`() = runTest {
        // Given
        val mockAgents = listOf(
            RemoteAgentInfo(
                id = "agent-1",
                name = "Code Assistant",
                description = "Helps with coding tasks",
                status = "active",
                type = "coding"
            ),
            RemoteAgentInfo(
                id = "agent-2",
                name = "Research Agent",
                description = "Performs research",
                status = "idle",
                type = "research"
            )
        )

        val mockResponse = AgentsResponse(
            agents = mockAgents,
            total = 2
        )

        coEvery {
            mockClient.invoke<AgentsResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.listAgents()

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(2, result.getOrNull()?.agents?.size)
        assertEquals("Code Assistant", result.getOrNull()?.agents?.get(0)?.name)
        assertEquals("Research Agent", result.getOrNull()?.agents?.get(1)?.name)

        coVerify {
            mockClient.invoke<AgentsResponse>(
                "ai.listAgents",
                emptyMap(),
                any()
            )
        }
    }

    @Test
    fun `listAgents() should handle agent with minimal info`() = runTest {
        // Given
        val mockAgents = listOf(
            RemoteAgentInfo(
                id = "agent-minimal",
                name = "Minimal Agent"
                // description, status, type are optional
            )
        )

        val mockResponse = AgentsResponse(
            agents = mockAgents,
            total = 1
        )

        coEvery {
            mockClient.invoke<AgentsResponse>(any(), any(), any())
        } returns Result.success(mockResponse)

        // When
        val result = aiCommands.listAgents()

        // Then
        assertTrue("Result should be success", result.isSuccess)
        assertEquals(1, result.getOrNull()?.agents?.size)
        val agent = result.getOrNull()?.agents?.get(0)
        assertEquals("agent-minimal", agent?.id)
        assertEquals("Minimal Agent", agent?.name)
        assertNull("Description should be null", agent?.description)
        assertNull("Status should be null", agent?.status)
        assertNull("Type should be null", agent?.type)
    }
}
