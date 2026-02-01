/**
 * IPC 错误处理中间件测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ErrorType,
  ValidationError,
  NetworkError,
  PermissionError,
  withErrorHandling,
  classifyError,
  getErrorStats,
  resetErrorStats,
} from "../../../src/main/utils/ipc-error-handler.js";

describe("IPC Error Handler", () => {
  beforeEach(() => {
    resetErrorStats();
    vi.clearAllMocks();
  });

  describe("错误类型", () => {
    it("ValidationError 应该设置正确的类型", () => {
      const error = new ValidationError("Invalid input", { field: "name" });

      expect(error.type).toBe(ErrorType.VALIDATION);
      expect(error.message).toBe("Invalid input");
      expect(error.details.field).toBe("name");
    });

    it("NetworkError 应该设置正确的类型", () => {
      const error = new NetworkError("Connection failed");

      expect(error.type).toBe(ErrorType.NETWORK);
      expect(error.message).toBe("Connection failed");
    });

    it("PermissionError 应该设置正确的类型", () => {
      const error = new PermissionError("Access denied");

      expect(error.type).toBe(ErrorType.PERMISSION);
    });
  });

  describe("错误分类", () => {
    it("应该识别网络错误", () => {
      const error = new Error("network request failed");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.NETWORK);
    });

    it("应该识别 ECONNREFUSED", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:8080");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.NETWORK);
    });

    it("应该识别超时错误", () => {
      const error = new Error("Request timed out");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.TIMEOUT);
    });

    it("应该识别权限错误", () => {
      const error = new Error("Permission denied");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.PERMISSION);
    });

    it("应该识别 EACCES", () => {
      const error = new Error("EACCES: permission denied");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.PERMISSION);
    });

    it("应该识别未找到错误", () => {
      const error = new Error("File not found");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.NOT_FOUND);
    });

    it("应该识别 ENOENT", () => {
      const error = new Error("ENOENT: no such file or directory");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.NOT_FOUND);
    });

    it("应该识别冲突错误", () => {
      const error = new Error("Resource already exists");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.CONFLICT);
    });

    it("应该识别数据库错误", () => {
      const error = new Error("SQLite error: table not found");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.DATABASE);
    });

    it("应该识别验证错误", () => {
      const error = new Error("Invalid parameter: name is required");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.VALIDATION);
    });

    it("未知错误应该归类为内部错误", () => {
      const error = new Error("Something went wrong");
      const classified = classifyError(error);

      expect(classified.type).toBe(ErrorType.INTERNAL);
    });
  });

  describe("withErrorHandling 中间件", () => {
    it("成功时应该返回结果", async () => {
      const handler = vi
        .fn()
        .mockResolvedValue({ success: true, data: "test" });
      const wrapped = withErrorHandling("test:channel", handler);

      const result = await wrapped({}, "arg1", "arg2");

      expect(result).toEqual({ success: true, data: "test" });
      expect(handler).toHaveBeenCalledWith({}, "arg1", "arg2");
    });

    it("失败时应该抛出分类后的错误", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("network timeout"));
      const wrapped = withErrorHandling("test:channel", handler, {
        enableLogging: false,
      });

      await expect(wrapped({}, "arg1")).rejects.toThrow();

      try {
        await wrapped({}, "arg1");
      } catch (error) {
        expect(error.type).toBe(ErrorType.TIMEOUT);
        expect(error.message).toBe("network timeout");
      }
    });

    it("应该记录错误统计", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("Test error"));
      const wrapped = withErrorHandling("test:channel", handler, {
        enableLogging: false,
        enableStats: true,
      });

      try {
        await wrapped({});
      } catch (_error) {
        // Expected error - intentionally ignored
      }

      const stats = getErrorStats();
      expect(stats.total).toBe(1);
      expect(stats.byChannel["test:channel"]).toBeDefined();
      expect(stats.byChannel["test:channel"].count).toBe(1);
    });

    it("应该保留原始错误类型", async () => {
      const handler = vi
        .fn()
        .mockRejectedValue(
          new ValidationError("Invalid input", { field: "email" }),
        );
      const wrapped = withErrorHandling("test:channel", handler, {
        enableLogging: false,
      });

      try {
        await wrapped({});
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.type).toBe(ErrorType.VALIDATION);
        expect(error.details.field).toBe("email");
      }
    });
  });

  describe("错误统计", () => {
    it("应该统计多个错误", async () => {
      const handler1 = vi.fn().mockRejectedValue(new Error("network error"));
      const handler2 = vi
        .fn()
        .mockRejectedValue(new Error("permission denied"));

      const wrapped1 = withErrorHandling("channel1", handler1, {
        enableLogging: false,
      });
      const wrapped2 = withErrorHandling("channel2", handler2, {
        enableLogging: false,
      });

      try {
        await wrapped1({});
      } catch (_e) {
        /* Expected error - intentionally ignored */
      }

      try {
        await wrapped2({});
      } catch (_e) {
        /* Expected error - intentionally ignored */
      }

      const stats = getErrorStats();
      expect(stats.total).toBe(2);
      expect(stats.byType[ErrorType.NETWORK]).toBe(1);
      expect(stats.byType[ErrorType.PERMISSION]).toBe(1);
    });

    it("resetErrorStats 应该清除统计", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("test"));
      const wrapped = withErrorHandling("test", handler, {
        enableLogging: false,
      });

      try {
        await wrapped({});
      } catch (_e) {
        /* Expected error - intentionally ignored */
      }

      expect(getErrorStats().total).toBe(1);

      resetErrorStats();

      expect(getErrorStats().total).toBe(0);
    });
  });

  describe("错误 JSON 序列化", () => {
    it("应该包含错误类型和详情", () => {
      const error = new ValidationError("Invalid email", {
        field: "email",
        reason: "format",
      });

      const json = error.toJSON();

      expect(json.type).toBe(ErrorType.VALIDATION);
      expect(json.message).toBe("Invalid email");
      expect(json.details.field).toBe("email");
      expect(json.details.reason).toBe("format");
      expect(json.timestamp).toBeDefined();
    });

    it("开发环境应该包含堆栈", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const error = new ValidationError("Test");
      const json = error.toJSON();

      expect(json.stack).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    it("生产环境不应包含堆栈", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const error = new ValidationError("Test");
      const json = error.toJSON();

      expect(json.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });
});
