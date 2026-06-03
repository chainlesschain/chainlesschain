import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { IPCMiddleware } = require("../ipc-middleware");

describe("IPCMiddleware", () => {
  let middleware;

  beforeEach(() => {
    middleware = new IPCMiddleware();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with timing enabled", () => {
      expect(middleware._timingEnabled).toBe(true);
    });

    it("should initialize with empty maps", () => {
      expect(middleware._permissionChecks.size).toBe(0);
      expect(middleware._rateLimits.size).toBe(0);
      expect(middleware._requestCounts.size).toBe(0);
    });
  });

  describe("wrap", () => {
    it("should return a function", () => {
      const handler = vi.fn();
      const wrapped = middleware.wrap("test-channel", handler);
      expect(typeof wrapped).toBe("function");
    });

    it("should call the original handler and return its result", async () => {
      const handler = vi
        .fn()
        .mockResolvedValue({ success: true, data: "hello" });
      const wrapped = middleware.wrap("test-channel", handler);
      const event = { sender: { id: 1 } };
      const result = await wrapped(event, "arg1", "arg2");
      expect(handler).toHaveBeenCalledWith(event, "arg1", "arg2");
      expect(result).toEqual({ success: true, data: "hello" });
    });

    it("should catch errors and return error response", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("boom"));
      const wrapped = middleware.wrap("test-channel", handler);
      const result = await wrapped({});
      expect(result).toEqual({ success: false, error: "boom" });
    });

    it("should still return result even when handler is slow", async () => {
      const handler = vi.fn().mockResolvedValue("slow-result");
      const wrapped = middleware.wrap("slow-channel", handler);
      const result = await wrapped({});
      expect(result).toBe("slow-result");
    });

    it("should not throw when timing is disabled and handler completes", async () => {
      middleware.setTimingEnabled(false);
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("channel", handler);
      const result = await wrapped({});
      expect(result).toBe("ok");
    });

    it("should return error object on handler failure", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("fail"));
      const wrapped = middleware.wrap("err-channel", handler);
      const result = await wrapped({});
      expect(result).toEqual({ success: false, error: "fail" });
    });
  });

  describe("wrap with rate limiting", () => {
    it("should allow requests within rate limit", async () => {
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("limited", handler, {
        rateLimit: { max: 3, windowMs: 60000 },
      });
      const event = { sender: { id: 1 } };
      const r1 = await wrapped(event);
      const r2 = await wrapped(event);
      expect(r1).toBe("ok");
      expect(r2).toBe("ok");
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should block requests exceeding rate limit", async () => {
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("limited", handler, {
        rateLimit: { max: 2, windowMs: 60000 },
      });
      const event = { sender: { id: 1 } };
      await wrapped(event);
      await wrapped(event);
      const result = await wrapped(event);
      expect(result).toEqual({ success: false, error: "Rate limit exceeded" });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should use 'unknown' when event sender is missing", async () => {
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("limited", handler, {
        rateLimit: { max: 1, windowMs: 60000 },
      });
      await wrapped(null);
      const result = await wrapped(null);
      expect(result).toEqual({ success: false, error: "Rate limit exceeded" });
    });
  });

  describe("wrap with permission checks", () => {
    it("should allow when permission checker returns true", async () => {
      middleware.registerPermissionCheck(
        "admin",
        vi.fn().mockResolvedValue(true),
      );
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("secure", handler, {
        permission: "admin",
      });
      const result = await wrapped({});
      expect(result).toBe("ok");
    });

    it("should deny when permission checker returns false", async () => {
      middleware.registerPermissionCheck(
        "admin",
        vi.fn().mockResolvedValue(false),
      );
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("secure", handler, {
        permission: "admin",
      });
      const result = await wrapped({});
      expect(result).toEqual({ success: false, error: "Permission denied" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should skip permission check when no checker is registered for the name", async () => {
      const handler = vi.fn().mockResolvedValue("ok");
      const wrapped = middleware.wrap("secure", handler, {
        permission: "unregistered",
      });
      const result = await wrapped({});
      expect(result).toBe("ok");
    });
  });

  describe("registerPermissionCheck", () => {
    it("should store the checker function", () => {
      const checker = vi.fn();
      middleware.registerPermissionCheck("editor", checker);
      expect(middleware._permissionChecks.get("editor")).toBe(checker);
    });

    it("should overwrite existing checker for same name", () => {
      const checker1 = vi.fn();
      const checker2 = vi.fn();
      middleware.registerPermissionCheck("role", checker1);
      middleware.registerPermissionCheck("role", checker2);
      expect(middleware._permissionChecks.get("role")).toBe(checker2);
    });
  });

  describe("setTimingEnabled", () => {
    it("should disable timing", () => {
      middleware.setTimingEnabled(false);
      expect(middleware._timingEnabled).toBe(false);
    });

    it("should re-enable timing", () => {
      middleware.setTimingEnabled(false);
      middleware.setTimingEnabled(true);
      expect(middleware._timingEnabled).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return initial stats", () => {
      const stats = middleware.getStats();
      expect(stats).toEqual({
        permissionChecks: 0,
        rateLimits: 0,
        activeRequests: 0,
        cachedChannels: 0,
      });
    });

    it("should reflect registered permission checks", () => {
      middleware.registerPermissionCheck("a", vi.fn());
      middleware.registerPermissionCheck("b", vi.fn());
      expect(middleware.getStats().permissionChecks).toBe(2);
    });
  });
});
