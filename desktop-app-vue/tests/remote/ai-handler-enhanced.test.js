/**
 * AI Handler Enhanced 单元测试
 *
 * 测试 AI 命令处理器的完整功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import AICommandHandlerEnhanced from "../../src/main/remote/handlers/ai-handler-enhanced.js";

describe("AICommandHandlerEnhanced", () => {
  let handler;
  let mockLLMManager;
  let mockRAGManager;
  let mockDatabase;
  let mockAIEngineManager;
  let mockContext;

  beforeEach(() => {
    // Mock LLMManager
    mockLLMManager = {
      isInitialized: true,
      config: {
        model: "qwen2:7b",
        temperature: 0.7,
        maxTokens: 2048,
      },
      provider: "ollama",
      initialize: vi.fn(() => Promise.resolve()),
      chat: vi.fn((messages, options) =>
        Promise.resolve({
          content: "Mock AI response",
          model: "qwen2:7b",
          usage: {
            prompt_tokens: 50,
            completion_tokens: 100,
            total_tokens: 150,
          },
        }),
      ),
      client: {
        listModels: vi.fn(() =>
          Promise.resolve([
            { name: "qwen2:7b", size: 4200000000, modified_at: Date.now() },
            { name: "llama2", size: 3800000000, modified_at: Date.now() },
          ]),
        ),
      },
    };

    // Mock RAGManager
    mockRAGManager = {
      search: vi.fn((query, options) =>
        Promise.resolve([
          {
            id: "note-1",
            title: "Test Note 1",
            content: `Content related to "${query}"`,
            score: 0.95,
            noteId: "note-1",
            projectId: "project-1",
            created_at: Date.now(),
            tags: ["test"],
          },
          {
            id: "note-2",
            title: "Test Note 2",
            content: `Another content about "${query}"`,
            score: 0.87,
            noteId: "note-2",
            projectId: "project-1",
            created_at: Date.now(),
            tags: ["test", "search"],
          },
        ]),
      ),
    };

    // Mock Database
    mockDatabase = {
      createConversation: vi.fn((data) => ({
        id: `conv-${Date.now()}`,
        ...data,
        created_at: Date.now(),
        updated_at: Date.now(),
      })),
      getConversation: vi.fn((id) => ({
        id,
        title: "Test Conversation",
        model: "qwen2:7b",
        created_at: Date.now(),
        updated_at: Date.now(),
      })),
      addMessageToConversation: vi.fn(),
      getConversationMessages: vi.fn(() => [
        {
          role: "user",
          content: "Previous message",
          created_at: Date.now() - 1000,
        },
        {
          role: "assistant",
          content: "Previous response",
          created_at: Date.now() - 500,
        },
      ]),
      getConversations: vi.fn((options) => [
        {
          id: "conv-1",
          title: "Conversation 1",
          model: "qwen2:7b",
          message_count: 10,
          created_at: Date.now() - 86400000,
          updated_at: Date.now() - 3600000,
          metadata: '{"source":"remote"}',
        },
        {
          id: "conv-2",
          title: "Conversation 2",
          model: "gpt-4",
          message_count: 5,
          created_at: Date.now() - 172800000,
          updated_at: Date.now() - 7200000,
          metadata: '{"source":"local"}',
        },
      ]),
      prepare: vi.fn((sql) => ({
        run: vi.fn(),
        get: vi.fn(() => ({ count: 10 })),
        all: vi.fn(() => []),
      })),
    };

    // Mock AI Engine Manager
    mockAIEngineManager = {
      startAgent: vi.fn(),
      stopAgent: vi.fn(),
      getAgentStatus: vi.fn(),
    };

    // Mock context
    mockContext = {
      did: "did:example:test-123",
      channel: "p2p",
    };

    // Create handler instance
    handler = new AICommandHandlerEnhanced({
      llmManager: mockLLMManager,
      ragManager: mockRAGManager,
      database: mockDatabase,
      aiEngineManager: mockAIEngineManager,
      config: {
        maxMessageLength: 10000,
        defaultTopK: 5,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("chat", () => {
    it("should handle chat request successfully", async () => {
      const params = {
        message: "Hello, AI!",
        model: "qwen2:7b",
      };

      const result = await handler.chat(params, mockContext);

      expect(result).toHaveProperty("conversationId");
      expect(result).toHaveProperty("response", "Mock AI response");
      expect(result).toHaveProperty("model", "qwen2:7b");
      expect(result.usage.totalTokens).toBe(150);
      expect(result.metadata.did).toBe("did:example:test-123");

      expect(mockDatabase.createConversation).toHaveBeenCalled();
      expect(mockDatabase.addMessageToConversation).toHaveBeenCalledTimes(2); // user + assistant
      expect(mockLLMManager.chat).toHaveBeenCalled();
    });

    it("should use existing conversation if conversationId provided", async () => {
      const params = {
        message: "Follow-up question",
        conversationId: "conv-existing",
      };

      await handler.chat(params, mockContext);

      expect(mockDatabase.getConversation).toHaveBeenCalledWith(
        "conv-existing",
      );
      expect(mockDatabase.createConversation).not.toHaveBeenCalled();
    });

    it("should include conversation history in messages", async () => {
      const params = {
        message: "New question",
        conversationId: "conv-with-history",
      };

      await handler.chat(params, mockContext);

      expect(mockDatabase.getConversationMessages).toHaveBeenCalledWith(
        "conv-with-history",
        10,
      );
      expect(mockLLMManager.chat).toHaveBeenCalled();

      // Check that messages include history
      const messages = mockLLMManager.chat.mock.calls[0][0];
      expect(messages.length).toBeGreaterThan(1); // Should include history + current message
    });

    it("should reject message that is too long", async () => {
      const longMessage = "a".repeat(11000);
      const params = {
        message: longMessage,
      };

      await expect(handler.chat(params, mockContext)).rejects.toThrow(
        "Message too long",
      );
    });

    it("should reject missing message parameter", async () => {
      const params = {};

      await expect(handler.chat(params, mockContext)).rejects.toThrow(
        'Parameter "message" is required',
      );
    });

    it("should initialize LLM manager if not initialized", async () => {
      mockLLMManager.isInitialized = false;

      const params = {
        message: "Test message",
      };

      await handler.chat(params, mockContext);

      expect(mockLLMManager.initialize).toHaveBeenCalled();
    });

    it("should handle LLM service unavailable", async () => {
      handler.llmManager = null;

      const params = {
        message: "Test message",
      };

      await expect(handler.chat(params, mockContext)).rejects.toThrow(
        "LLM service not available",
      );
    });

    it("should include system prompt if provided", async () => {
      const params = {
        message: "User message",
        systemPrompt: "You are a helpful assistant",
      };

      await handler.chat(params, mockContext);

      const messages = mockLLMManager.chat.mock.calls[0][0];
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("You are a helpful assistant");
    });

    it("should pass custom temperature and maxTokens", async () => {
      const params = {
        message: "Test message",
        temperature: 0.9,
        maxTokens: 4096,
      };

      await handler.chat(params, mockContext);

      const options = mockLLMManager.chat.mock.calls[0][1];
      expect(options.temperature).toBe(0.9);
      expect(options.maxTokens).toBe(4096);
    });
  });

  describe("getConversations", () => {
    it("should retrieve conversations successfully", async () => {
      const params = {
        limit: 10,
        offset: 0,
      };

      const result = await handler.getConversations(params, mockContext);

      expect(result.conversations).toHaveLength(2);
      expect(result.total).toBe(10);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      // hasMore = offset + limit < total => 0 + 10 < 10 => false
      expect(result.hasMore).toBe(false);

      expect(mockDatabase.getConversations).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        search: undefined,
      });
    });

    it("should support search parameter", async () => {
      const params = {
        search: "test query",
        limit: 20,
        offset: 0,
      };

      await handler.getConversations(params, mockContext);

      expect(mockDatabase.getConversations).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        search: "test query",
      });
    });

    it("should parse metadata JSON", async () => {
      const result = await handler.getConversations({}, mockContext);

      expect(result.conversations[0].metadata).toEqual({ source: "remote" });
      expect(result.conversations[1].metadata).toEqual({ source: "local" });
    });

    it("should handle database unavailable", async () => {
      handler.database = null;

      await expect(handler.getConversations({}, mockContext)).rejects.toThrow(
        "Database not available",
      );
    });

    it("should calculate hasMore correctly", async () => {
      const result1 = await handler.getConversations(
        { limit: 5, offset: 0 },
        mockContext,
      );
      expect(result1.hasMore).toBe(true); // 0 + 5 < 10

      const result2 = await handler.getConversations(
        { limit: 5, offset: 5 },
        mockContext,
      );
      expect(result2.hasMore).toBe(false); // 5 + 5 = 10
    });
  });

  describe("ragSearch", () => {
    it("should perform RAG search successfully", async () => {
      const params = {
        query: "test query",
        topK: 5,
        threshold: 0.7,
      };

      const result = await handler.ragSearch(params, mockContext);

      expect(result.query).toBe("test query");
      expect(result.results).toHaveLength(2);
      expect(result.topK).toBe(5);
      expect(result.threshold).toBe(0.7);
      expect(result.results[0]).toHaveProperty("id");
      expect(result.results[0]).toHaveProperty("title");
      expect(result.results[0]).toHaveProperty("content");
      expect(result.results[0]).toHaveProperty("score");

      expect(mockRAGManager.search).toHaveBeenCalledWith("test query", {
        limit: 5,
        scoreThreshold: 0.7,
        useHybridSearch: true,
        useReranker: true,
        filter: null,
      });
    });

    it("should use default topK", async () => {
      const params = {
        query: "test query",
      };

      const result = await handler.ragSearch(params, mockContext);

      expect(result.topK).toBe(5); // Default from config
    });

    it("should reject missing query parameter", async () => {
      const params = {};

      await expect(handler.ragSearch(params, mockContext)).rejects.toThrow(
        'Parameter "query" is required',
      );
    });

    it("should handle RAG service unavailable", async () => {
      handler.ragManager = null;

      const params = {
        query: "test query",
      };

      await expect(handler.ragSearch(params, mockContext)).rejects.toThrow(
        "RAG service not available",
      );
    });

    it("should support custom hybrid search and reranker options", async () => {
      const params = {
        query: "test query",
        useHybridSearch: false,
        useReranker: false,
      };

      await handler.ragSearch(params, mockContext);

      expect(mockRAGManager.search).toHaveBeenCalledWith(
        "test query",
        expect.objectContaining({
          useHybridSearch: false,
          useReranker: false,
        }),
      );
    });

    it("should format results correctly", async () => {
      const params = {
        query: "test query",
      };

      const result = await handler.ragSearch(params, mockContext);

      expect(result.results[0].id).toBe("note-1");
      expect(result.results[0].title).toBe("Test Note 1");
      expect(result.results[0].score).toBe(0.95);
      expect(result.results[0].metadata).toHaveProperty("noteId", "note-1");
      expect(result.results[0].metadata).toHaveProperty("tags");
    });
  });

  describe("controlAgent", () => {
    it("should start agent successfully", async () => {
      const params = {
        action: "start",
        agentId: "test-agent",
        taskConfig: { task: "test" },
      };

      const result = await handler.controlAgent(params, mockContext);

      expect(result.success).toBe(true);
      expect(result.action).toBe("start");
      expect(result.agentId).toBe("test-agent");
      expect(result).toHaveProperty("status");
    });

    it("should stop agent successfully", async () => {
      const params = {
        action: "stop",
        agentId: "test-agent",
      };

      const result = await handler.controlAgent(params, mockContext);

      expect(result.success).toBe(true);
      expect(result.action).toBe("stop");
      expect(result.status).toBe("stopped");
    });

    it("should get agent status successfully", async () => {
      const params = {
        action: "status",
        agentId: "test-agent",
      };

      const result = await handler.controlAgent(params, mockContext);

      expect(result.success).toBe(true);
      expect(result).toHaveProperty("status");
    });

    it("should list agents successfully", async () => {
      const params = {
        action: "list",
      };

      const result = await handler.controlAgent(params, mockContext);

      expect(result.success).toBe(true);
      expect(result).toHaveProperty("agents");
      expect(Array.isArray(result.agents)).toBe(true);
    });

    it("should reject invalid action", async () => {
      const params = {
        action: "invalid",
        agentId: "test-agent",
      };

      await expect(handler.controlAgent(params, mockContext)).rejects.toThrow(
        'Parameter "action" must be one of',
      );
    });

    it("should reject missing agentId for non-list actions", async () => {
      const params = {
        action: "start",
      };

      await expect(handler.controlAgent(params, mockContext)).rejects.toThrow(
        'Parameter "agentId" is required',
      );
    });

    it("should return mock response when aiEngineManager not available", async () => {
      handler.aiEngineManager = null;

      const params = {
        action: "start",
        agentId: "test-agent",
      };

      const result = await handler.controlAgent(params, mockContext);

      expect(result.success).toBe(true);
      expect(result.note).toContain("mock response");
    });
  });

  describe("getModels", () => {
    it("should get all models successfully", async () => {
      const params = {
        provider: "all",
      };

      const result = await handler.getModels(params, mockContext);

      expect(result.models).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.provider).toBe("all");
    });

    it("should get Ollama models only", async () => {
      const params = {
        provider: "ollama",
      };

      const result = await handler.getModels(params, mockContext);

      const ollamaModels = result.models.filter((m) => m.provider === "ollama");
      expect(ollamaModels.length).toBeGreaterThan(0);
      expect(mockLLMManager.client.listModels).toHaveBeenCalled();
    });

    it("should get OpenAI models", async () => {
      const params = {
        provider: "openai",
      };

      const result = await handler.getModels(params, mockContext);

      const openaiModels = result.models.filter((m) => m.provider === "openai");
      expect(openaiModels.length).toBeGreaterThan(0);
      expect(openaiModels.some((m) => m.id.includes("gpt"))).toBe(true);
    });

    it("should get Anthropic models", async () => {
      const params = {
        provider: "anthropic",
      };

      const result = await handler.getModels(params, mockContext);

      const anthropicModels = result.models.filter(
        (m) => m.provider === "anthropic",
      );
      expect(anthropicModels.length).toBeGreaterThan(0);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    });

    it("should include model capabilities", async () => {
      const result = await handler.getModels({ provider: "all" }, mockContext);

      result.models.forEach((model) => {
        expect(model).toHaveProperty("capabilities");
        expect(Array.isArray(model.capabilities)).toBe(true);
      });
    });

    it("should handle Ollama models fetch error gracefully", async () => {
      mockLLMManager.client.listModels.mockRejectedValue(
        new Error("Ollama not available"),
      );

      const params = {
        provider: "all",
      };

      const result = await handler.getModels(params, mockContext);

      // Should still return cloud models
      expect(result.models.length).toBeGreaterThan(0);
    });
  });

  describe("metrics", () => {
    it("should track metrics correctly", async () => {
      const params = {
        message: "Test message",
      };

      // Execute multiple requests through handle() to update metrics
      await handler.handle("chat", params, mockContext);
      await handler.handle("chat", params, mockContext);

      const metrics = handler.getMetrics();

      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.avgResponseTime).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBe("100.00%");
    });

    it("should track failures correctly", async () => {
      mockLLMManager.chat.mockRejectedValue(new Error("LLM error"));

      const params = {
        message: "Test message",
      };

      try {
        await handler.handle("chat", params, mockContext);
      } catch (error) {
        // Expected
      }

      const metrics = handler.getMetrics();

      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(1);
      expect(metrics.successRate).toBe("0.00%");
    });
  });

  describe("events", () => {
    it("should emit command-success event", async () => {
      const successHandler = vi.fn();
      handler.on("command-success", successHandler);

      const params = {
        message: "Test message",
      };

      await handler.handle("chat", params, mockContext);

      expect(successHandler).toHaveBeenCalled();
      expect(successHandler.mock.calls[0][0]).toMatchObject({
        action: "chat",
        did: mockContext.did,
      });
    });

    it("should emit command-failure event", async () => {
      const failureHandler = vi.fn();
      handler.on("command-failure", failureHandler);

      mockLLMManager.chat.mockRejectedValue(new Error("Test error"));

      const params = {
        message: "Test message",
      };

      try {
        await handler.handle("chat", params, mockContext);
      } catch (error) {
        // Expected
      }

      expect(failureHandler).toHaveBeenCalled();
      expect(failureHandler.mock.calls[0][0]).toMatchObject({
        action: "chat",
        did: mockContext.did,
        error: "AI chat failed: Test error", // Error message is wrapped
      });
    });
  });
});
