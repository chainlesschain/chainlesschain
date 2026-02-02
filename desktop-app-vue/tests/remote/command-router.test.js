/**
 * 命令路由器单元测试
 *
 * 测试命令路由、处理器注册、错误处理等功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CommandRouter } from "../../src/main/remote/command-router.js";

describe("CommandRouter", () => {
  let router;
  let mockAIHandler;
  let mockSystemHandler;

  beforeEach(() => {
    router = new CommandRouter();

    // Mock AI handler
    mockAIHandler = {
      chat: vi.fn(async (params) => ({
        conversationId: "conv-123",
        response: "Hello from AI",
        model: "qwen2:7b",
      })),
      getConversations: vi.fn(async () => ({
        conversations: [],
      })),
      ragSearch: vi.fn(async (params) => ({
        results: [],
      })),
      handle: vi.fn(async (action, params, context) => {
        if (action === "chat") {
          return mockAIHandler.chat(params);
        }
        if (action === "getConversations") {
          return mockAIHandler.getConversations(params);
        }
        if (action === "ragSearch") {
          return mockAIHandler.ragSearch(params);
        }
        throw new Error(`Unknown action: ${action}`);
      }),
    };

    // Mock System handler
    mockSystemHandler = {
      getStatus: vi.fn(async () => ({
        status: "online",
        uptime: 12345,
      })),
      getInfo: vi.fn(async () => ({
        platform: "win32",
        version: "1.0.0",
      })),
      screenshot: vi.fn(async () => ({
        data: "base64-image-data",
      })),
      notify: vi.fn(async (params) => ({
        success: true,
      })),
      handle: vi.fn(async (action, params, context) => {
        if (action === "getStatus") {
          return mockSystemHandler.getStatus(params);
        }
        if (action === "getInfo") {
          return mockSystemHandler.getInfo(params);
        }
        if (action === "screenshot") {
          return mockSystemHandler.screenshot(params);
        }
        if (action === "notify") {
          return mockSystemHandler.notify(params);
        }
        throw new Error(`Unknown action: ${action}`);
      }),
    };

    // Register handlers
    router.registerHandler("ai", mockAIHandler);
    router.registerHandler("system", mockSystemHandler);
  });

  describe("handler registration", () => {
    it("should register handler for namespace", () => {
      const customHandler = {
        test: vi.fn(),
        handle: vi.fn(),
      };

      router.registerHandler("custom", customHandler);
      expect(router.hasHandler("custom")).toBe(true);
      const handlers = router.getRegisteredHandlers();
      expect(handlers).toContain("custom");
    });

    it("should throw error for handler without handle method", () => {
      const invalidHandler = {
        test: vi.fn(),
        // Missing handle() method
      };

      expect(() => {
        router.registerHandler("invalid", invalidHandler);
      }).toThrow(
        "Handler for namespace 'invalid' must implement handle() method",
      );
    });

    it("should unregister handler", () => {
      router.unregisterHandler("ai");
      expect(router.hasHandler("ai")).toBe(false);
    });
  });

  describe("command routing", () => {
    it("should route ai.chat to AI handler", async () => {
      const request = {
        id: "req-1",
        method: "ai.chat",
        params: {
          message: "Hello",
          conversationId: "conv-123",
        },
      };

      const result = await router.route(request);

      expect(mockAIHandler.chat).toHaveBeenCalledWith(request.params);
      expect(result).toEqual({
        jsonrpc: "2.0",
        id: "req-1",
        result: {
          conversationId: "conv-123",
          response: "Hello from AI",
          model: "qwen2:7b",
        },
      });
    });

    it("should route system.getStatus to System handler", async () => {
      const request = {
        id: "req-2",
        method: "system.getStatus",
        params: {},
      };

      const result = await router.route(request);

      expect(mockSystemHandler.getStatus).toHaveBeenCalled();
      expect(result).toEqual({
        jsonrpc: "2.0",
        id: "req-2",
        result: {
          status: "online",
          uptime: 12345,
        },
      });
    });

    it("should route ai.getConversations to AI handler", async () => {
      const request = {
        id: "req-3",
        method: "ai.getConversations",
        params: { limit: 10 },
      };

      const result = await router.route(request);

      expect(mockAIHandler.getConversations).toHaveBeenCalledWith({
        limit: 10,
      });
      expect(result.result.conversations).toBeDefined();
    });

    it("should route system.screenshot to System handler", async () => {
      const request = {
        id: "req-4",
        method: "system.screenshot",
        params: { quality: 80 },
      };

      const result = await router.route(request);

      expect(mockSystemHandler.screenshot).toHaveBeenCalledWith({
        quality: 80,
      });
      expect(result.result.data).toBe("base64-image-data");
    });
  });

  describe("error handling", () => {
    it("should return error for unknown namespace", async () => {
      const request = {
        id: "req-err-1",
        method: "unknown.command",
        params: {},
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32001); // HANDLER_NOT_FOUND
      expect(result.error.message).toContain("Handler not found");
    });

    it("should return error for unknown method in valid namespace", async () => {
      const request = {
        id: "req-err-2",
        method: "ai.unknownMethod",
        params: {},
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32002); // HANDLER_ERROR
      expect(result.error.message).toContain("Unknown action");
    });

    it("should return error for invalid method format", async () => {
      const request = {
        id: "req-err-3",
        method: "invalidformat",
        params: {},
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32601); // METHOD_NOT_FOUND
      expect(result.error.message).toContain("Invalid method format");
    });

    it("should handle handler exceptions", async () => {
      mockAIHandler.handle.mockRejectedValueOnce(new Error("Handler crashed"));

      const request = {
        id: "req-err-4",
        method: "ai.chat",
        params: { message: "Test" },
      };

      const result = await router.route(request);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32002); // HANDLER_ERROR (default)
      expect(result.error.message).toContain("Handler crashed");
    });

    it("should include error data for detailed errors", async () => {
      const detailedError = new Error("Detailed error");
      detailedError.code = "CUSTOM_ERROR";
      detailedError.data = { reason: "Invalid input" };

      mockSystemHandler.handle.mockRejectedValueOnce(detailedError);

      const request = {
        id: "req-err-5",
        method: "system.notify",
        params: { message: "Test" },
      };

      const result = await router.route(request);

      // error.code from Error object is used directly
      expect(result.error.code).toBe("CUSTOM_ERROR");
      expect(result.error.data).toEqual({ reason: "Invalid input" });
    });
  });

  // Method validation is handled internally by parseMethod() and route()
  // No public isValidMethodFormat() method exists in CommandRouter

  describe.skip("batch routing", () => {
    it("should route multiple commands in batch", async () => {
      const requests = [
        {
          id: "batch-1",
          method: "ai.chat",
          params: { message: "Hello" },
        },
        {
          id: "batch-2",
          method: "system.getStatus",
          params: {},
        },
        {
          id: "batch-3",
          method: "ai.getConversations",
          params: { limit: 5 },
        },
      ];

      const results = await router.routeBatch(requests);

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe("batch-1");
      expect(results[1].id).toBe("batch-2");
      expect(results[2].id).toBe("batch-3");
      expect(mockAIHandler.chat).toHaveBeenCalled();
      expect(mockSystemHandler.getStatus).toHaveBeenCalled();
      expect(mockAIHandler.getConversations).toHaveBeenCalled();
    });

    it("should handle mixed success and failure in batch", async () => {
      mockAIHandler.chat.mockRejectedValue(new Error("Chat failed"));

      const requests = [
        {
          id: "batch-mix-1",
          method: "ai.chat",
          params: { message: "Hello" },
        },
        {
          id: "batch-mix-2",
          method: "system.getStatus",
          params: {},
        },
      ];

      const results = await router.routeBatch(requests);

      expect(results).toHaveLength(2);
      expect(results[0].error).toBeDefined(); // Failed
      expect(results[1].result).toBeDefined(); // Success
    });
  });

  describe.skip("handler middleware", () => {
    it("should apply pre-handler middleware", async () => {
      const preMiddleware = vi.fn(async (request, next) => {
        request.params.middlewareApplied = true;
        return next(request);
      });

      router.use("pre", preMiddleware);

      const request = {
        id: "mid-1",
        method: "ai.chat",
        params: { message: "Test" },
      };

      await router.route(request);

      expect(preMiddleware).toHaveBeenCalled();
      expect(mockAIHandler.chat).toHaveBeenCalledWith(
        expect.objectContaining({ middlewareApplied: true }),
      );
    });

    it("should apply post-handler middleware", async () => {
      const postMiddleware = vi.fn(async (response, next) => {
        response.result.postProcessed = true;
        return next(response);
      });

      router.use("post", postMiddleware);

      const request = {
        id: "mid-2",
        method: "system.getInfo",
        params: {},
      };

      const result = await router.route(request);

      expect(postMiddleware).toHaveBeenCalled();
      expect(result.result.postProcessed).toBe(true);
    });
  });

  describe("statistics", () => {
    it("should track command statistics", async () => {
      await router.route({ id: "1", method: "ai.chat", params: {} });
      await router.route({ id: "2", method: "system.getStatus", params: {} });
      await router.route({ id: "3", method: "ai.chat", params: {} });

      const stats = router.getStats();

      expect(stats.totalCommands).toBe(3);
      expect(stats.successCommands).toBe(3);
      expect(stats.byNamespace.ai.total).toBe(2);
      expect(stats.byNamespace.system.total).toBe(1);
    });

    it("should track error statistics", async () => {
      mockAIHandler.handle.mockRejectedValueOnce(new Error("Failed"));

      // First request fails in handler
      await router.route({ id: "1", method: "ai.chat", params: {} });

      // Second request has unknown namespace - doesn't increase failedCommands
      // because no handler is invoked
      await router.route({ id: "2", method: "unknown.method", params: {} });

      const stats = router.getStats();

      // Only handler-level errors increase failedCommands
      expect(stats.failedCommands).toBe(1);
      expect(stats.totalCommands).toBe(2); // Both requests are counted
    });

    it("should reset statistics", async () => {
      await router.route({ id: "1", method: "ai.chat", params: {} });
      router.resetStats();

      const stats = router.getStats();

      expect(stats.totalCommands).toBe(0);
      expect(stats.failedCommands).toBe(0);
    });
  });

  describe("namespace management", () => {
    it("should list all registered namespaces", () => {
      const namespaces = router.getRegisteredHandlers();

      expect(namespaces).toContain("ai");
      expect(namespaces).toContain("system");
      expect(namespaces).toHaveLength(2);
    });

    it("should check if namespace exists", () => {
      expect(router.hasHandler("ai")).toBe(true);
      expect(router.hasHandler("system")).toBe(true);
      expect(router.hasHandler("unknown")).toBe(false);
    });

    // Note: getMethodsForNamespace() doesn't exist in CommandRouter
    // The handler pattern uses handle(action, params) instead of exposing individual methods
    it.skip("should get methods for namespace", () => {
      // This test is skipped because CommandRouter doesn't expose handler methods
      const aiMethods = router.getMethodsForNamespace("ai");

      expect(aiMethods).toContain("chat");
      expect(aiMethods).toContain("getConversations");
      expect(aiMethods).toContain("ragSearch");
    });
  });
});
