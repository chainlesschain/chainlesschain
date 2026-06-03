/**
 * CommandRouter 单元测试
 *
 * 测试命令路由器的核心功能：
 * - 处理器注册和管理
 * - 命令路由分发
 * - 错误处理
 * - 统计信息
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CommandRouter, ERROR_CODES } from "../command-router";

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("CommandRouter", () => {
  let router;

  beforeEach(() => {
    router = new CommandRouter({
      enableLogging: false,
      enableStats: true,
    });
  });

  describe("构造函数", () => {
    it("应该使用默认选项初始化", () => {
      const defaultRouter = new CommandRouter();
      expect(defaultRouter.options.enableLogging).toBe(true);
      expect(defaultRouter.options.enableStats).toBe(true);
    });

    it("应该初始化空的处理器映射", () => {
      expect(router.handlers.size).toBe(0);
    });

    it("应该初始化统计信息", () => {
      expect(router.stats.totalCommands).toBe(0);
      expect(router.stats.successCommands).toBe(0);
      expect(router.stats.failedCommands).toBe(0);
    });
  });

  describe("registerHandler", () => {
    it("应该成功注册有效的处理器", () => {
      const mockHandler = {
        handle: vi.fn(),
      };

      router.registerHandler("test", mockHandler);

      expect(router.handlers.has("test")).toBe(true);
      expect(router.hasHandler("test")).toBe(true);
    });

    it("应该在注册时初始化命名空间统计", () => {
      const mockHandler = { handle: vi.fn() };
      router.registerHandler("ai", mockHandler);

      expect(router.stats.byNamespace.ai).toEqual({
        total: 0,
        success: 0,
        failed: 0,
      });
    });

    it("应该拒绝没有 handle 方法的处理器", () => {
      expect(() => {
        router.registerHandler("invalid", {});
      }).toThrow(
        "Handler for namespace 'invalid' must implement handle() method",
      );
    });

    it("应该拒绝 null 处理器", () => {
      expect(() => {
        router.registerHandler("null", null);
      }).toThrow();
    });
  });

  describe("unregisterHandler", () => {
    it("应该成功取消注册已存在的处理器", () => {
      const mockHandler = { handle: vi.fn() };
      router.registerHandler("test", mockHandler);

      router.unregisterHandler("test");

      expect(router.handlers.has("test")).toBe(false);
    });

    it("取消注册不存在的处理器不应抛出错误", () => {
      expect(() => {
        router.unregisterHandler("nonexistent");
      }).not.toThrow();
    });
  });

  describe("route", () => {
    let mockHandler;

    beforeEach(() => {
      mockHandler = {
        handle: vi.fn().mockResolvedValue({ success: true, data: "test" }),
      };
      router.registerHandler("test", mockHandler);
    });

    it("应该成功路由有效命令", async () => {
      const request = {
        id: "1",
        method: "test.action",
        params: { key: "value" },
      };

      const response = await router.route(request, { peerId: "peer1" });

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe("1");
      expect(response.result).toEqual({ success: true, data: "test" });
      expect(mockHandler.handle).toHaveBeenCalledWith(
        "action",
        { key: "value" },
        { peerId: "peer1" },
      );
    });

    it("应该处理多级方法名", async () => {
      const request = {
        id: "2",
        method: "test.sub.action",
        params: {},
      };

      await router.route(request);

      expect(mockHandler.handle).toHaveBeenCalledWith(
        "sub.action",
        {},
        expect.any(Object),
      );
    });

    it("应该拒绝缺少 method 的请求", async () => {
      const request = { id: "3" };

      const response = await router.route(request);

      expect(response.error.code).toBe(ERROR_CODES.INVALID_REQUEST);
      expect(response.error.message).toBe("Method is required");
    });

    it("应该拒绝无效格式的 method", async () => {
      const request = {
        id: "4",
        method: "invalid",
      };

      const response = await router.route(request);

      expect(response.error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
      expect(response.error.message).toContain("Invalid method format");
    });

    it("应该处理不存在的命名空间", async () => {
      const request = {
        id: "5",
        method: "unknown.action",
        params: {},
      };

      const response = await router.route(request);

      expect(response.error.code).toBe(ERROR_CODES.HANDLER_NOT_FOUND);
      expect(response.error.message).toContain("Handler not found");
    });

    it("应该处理处理器执行错误", async () => {
      mockHandler.handle.mockRejectedValue(new Error("Handler failed"));

      const request = {
        id: "6",
        method: "test.action",
        params: {},
      };

      const response = await router.route(request);

      expect(response.error.code).toBe(ERROR_CODES.HANDLER_ERROR);
      expect(response.error.message).toBe("Handler failed");
    });

    it("应该处理带自定义错误码的处理器错误", async () => {
      const customError = new Error("Custom error");
      customError.code = -32100;
      customError.data = { detail: "extra info" };
      mockHandler.handle.mockRejectedValue(customError);

      const request = {
        id: "7",
        method: "test.action",
        params: {},
      };

      const response = await router.route(request);

      expect(response.error.code).toBe(-32100);
      expect(response.error.data).toEqual({ detail: "extra info" });
    });

    it("应该在 params 为空时使用空对象", async () => {
      const request = {
        id: "8",
        method: "test.action",
      };

      await router.route(request);

      expect(mockHandler.handle).toHaveBeenCalledWith(
        "action",
        {},
        expect.any(Object),
      );
    });
  });

  describe("统计信息", () => {
    let mockHandler;

    beforeEach(() => {
      mockHandler = {
        handle: vi.fn().mockResolvedValue({ ok: true }),
      };
      router.registerHandler("stats", mockHandler);
    });

    it("应该跟踪成功命令", async () => {
      await router.route({ id: "1", method: "stats.test", params: {} });
      await router.route({ id: "2", method: "stats.test", params: {} });

      expect(router.stats.totalCommands).toBe(2);
      expect(router.stats.successCommands).toBe(2);
      expect(router.stats.failedCommands).toBe(0);
    });

    it("应该跟踪失败命令", async () => {
      mockHandler.handle.mockRejectedValue(new Error("fail"));

      await router.route({ id: "1", method: "stats.test", params: {} });

      expect(router.stats.totalCommands).toBe(1);
      expect(router.stats.successCommands).toBe(0);
      expect(router.stats.failedCommands).toBe(1);
    });

    it("应该按命名空间跟踪统计", async () => {
      await router.route({ id: "1", method: "stats.a", params: {} });
      await router.route({ id: "2", method: "stats.b", params: {} });

      expect(router.stats.byNamespace.stats.total).toBe(2);
      expect(router.stats.byNamespace.stats.success).toBe(2);
    });

    it("getStats 应该返回完整统计信息", async () => {
      await router.route({ id: "1", method: "stats.test", params: {} });

      const stats = router.getStats();

      expect(stats.totalCommands).toBe(1);
      expect(stats.registeredHandlers).toBe(1);
      expect(stats.successRate).toBe("100.00%");
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
    });

    it("resetStats 应该重置所有统计", async () => {
      await router.route({ id: "1", method: "stats.test", params: {} });

      router.resetStats();

      expect(router.stats.totalCommands).toBe(0);
      expect(router.stats.successCommands).toBe(0);
      expect(router.stats.byNamespace.stats).toEqual({
        total: 0,
        success: 0,
        failed: 0,
      });
    });
  });

  describe("parseMethod", () => {
    it("应该正确解析 namespace.action 格式", () => {
      const [namespace, action] = router.parseMethod("ai.chat");
      expect(namespace).toBe("ai");
      expect(action).toBe("chat");
    });

    it("应该处理多级 action", () => {
      const [namespace, action] = router.parseMethod("channel.telegram.send");
      expect(namespace).toBe("channel");
      expect(action).toBe("telegram.send");
    });

    it("应该对无效格式返回 null", () => {
      const [namespace, action] = router.parseMethod("invalid");
      expect(namespace).toBeNull();
      expect(action).toBeNull();
    });
  });

  describe("getRegisteredHandlers", () => {
    it("应该返回所有已注册的处理器名称", () => {
      router.registerHandler("ai", { handle: vi.fn() });
      router.registerHandler("system", { handle: vi.fn() });

      const handlers = router.getRegisteredHandlers();

      expect(handlers).toContain("ai");
      expect(handlers).toContain("system");
      expect(handlers.length).toBe(2);
    });
  });

  describe("响应格式", () => {
    it("createSuccessResponse 应该返回正确格式", () => {
      const response = router.createSuccessResponse("123", { data: "test" });

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: "123",
        result: { data: "test" },
      });
    });

    it("createSuccessResponse 应该处理 undefined 结果", () => {
      const response = router.createSuccessResponse("123", undefined);

      expect(response.result).toBeNull();
    });

    it("createErrorResponse 应该返回正确格式", () => {
      const response = router.createErrorResponse(
        "123",
        -32600,
        "Invalid request",
        { detail: "missing method" },
      );

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: "123",
        error: {
          code: -32600,
          message: "Invalid request",
          data: { detail: "missing method" },
        },
      });
    });

    it("createErrorResponse 应该省略空的 data", () => {
      const response = router.createErrorResponse("123", -32600, "Error");

      expect(response.error.data).toBeUndefined();
    });
  });
});
