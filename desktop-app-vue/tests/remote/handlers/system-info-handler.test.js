/**
 * SystemInfoHandler 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../../src/main/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (typeof opts === "function") {
      callback = opts;
    }
    setImmediate(() => callback(null, "{}", ""));
  }),
}));

// Mock util.promisify
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => vi.fn().mockResolvedValue({ stdout: "{}", stderr: "" }),
  };
});

const {
  SystemInfoHandler,
} = require("../../../src/main/remote/handlers/system-info-handler");

describe("SystemInfoHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new SystemInfoHandler();
  });

  afterEach(async () => {
    if (handler && handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("constructor", () => {
    it("应该使用默认选项创建处理器", () => {
      const h = new SystemInfoHandler();
      expect(h.options.maxLogLines).toBe(100);
    });

    it("应该接受自定义选项", () => {
      const h = new SystemInfoHandler({
        maxLogLines: 50,
      });
      expect(h.options.maxLogLines).toBe(50);
    });
  });

  describe("getCPU", () => {
    it("应该返回 CPU 信息", async () => {
      const result = await handler.handle("getCPU", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.cpu).toBeDefined();
      expect(typeof result.cpu.cores).toBe("number");
      expect(result.cpu.cores).toBeGreaterThan(0);
    });
  });

  describe("getMemory", () => {
    it("应该返回内存信息", async () => {
      const result = await handler.handle("getMemory", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.memory).toBeDefined();
      expect(result.memory.total).toBeGreaterThan(0);
      expect(result.memory.usagePercent).toBeDefined();
    });
  });

  describe("getBattery", () => {
    it("应该返回电池状态或 null", async () => {
      const result = await handler.handle("getBattery", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.hasBattery).toBeDefined();
    });
  });

  describe("getTemperature", () => {
    it("应该返回温度信息或空数组", async () => {
      const result = await handler.handle("getTemperature", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.temperatures)).toBe(true);
    });
  });

  describe("getUptime", () => {
    it("应该返回系统运行时间", async () => {
      const result = await handler.handle("getUptime", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.uptime).toBeDefined();
      expect(result.uptime.seconds).toBeGreaterThanOrEqual(0);
      expect(result.uptime.formatted).toBeDefined();
    });
  });

  describe("getOS", () => {
    it("应该返回操作系统信息", async () => {
      const result = await handler.handle("getOS", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.os).toBeDefined();
      expect(result.os.platform).toBeDefined();
      expect(result.os.arch).toBeDefined();
    });
  });

  describe("getHardware", () => {
    it("应该返回硬件信息", async () => {
      const result = await handler.handle("getHardware", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.hardware).toBeDefined();
      expect(result.hardware.cpus).toBeGreaterThan(0);
    });

    it("应该使用缓存", async () => {
      const result1 = await handler.handle("getHardware", {}, mockContext);
      const result2 = await handler.handle("getHardware", {}, mockContext);

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(true);
    });
  });

  describe("getLogs", () => {
    it.skip("应该返回系统日志 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle(
        "getLogs",
        { lines: 10 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.logs)).toBe(true);
    });
  });

  describe("getServices", () => {
    it.skip("应该返回服务状态 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle("getServices", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.services)).toBe(true);
    });
  });

  describe("getPerformance", () => {
    it("应该返回性能摘要", async () => {
      const result = await handler.handle("getPerformance", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.performance).toBeDefined();
      expect(result.performance.cpu).toBeDefined();
      expect(result.performance.memory).toBeDefined();
    });
  });

  describe("unknown action", () => {
    it("应该对未知操作报错", async () => {
      await expect(
        handler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });

  describe("cleanup", () => {
    it("应该正常清理资源", async () => {
      await expect(handler.cleanup()).resolves.not.toThrow();
    });
  });
});
