/**
 * ProcessHandler 单元测试
 *
 * 注意：
 * - 进程终止测试已跳过，避免意外终止进程
 * - 需要外部命令的测试在某些环境下可能跳过
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

const { ProcessHandler } =
  await import("../../../src/main/remote/handlers/process-handler");

describe("ProcessHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new ProcessHandler();
  });

  afterEach(async () => {
    if (handler) {
      await handler.cleanup();
    }
  });

  // 注意：listProcesses 需要执行实际的 wmic/ps 命令，在某些 CI 环境可能不可用
  describe("listProcesses", () => {
    it.skip("应该返回进程列表 (跳过：需要执行系统命令)", async () => {
      const result = await handler.handle("list", {}, mockContext);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.processes)).toBe(true);
    });
  });

  describe("getProcess", () => {
    it("缺少 pid 参数应该报错", async () => {
      await expect(handler.handle("get", {}, mockContext)).rejects.toThrow(
        'Parameter "pid" is required',
      );
    });

    it.skip("进程不存在应该报错 (跳过：需要执行系统命令)", async () => {
      await expect(
        handler.handle("get", { pid: 99999 }, mockContext),
      ).rejects.toThrow("Process 99999 not found");
    });
  });

  describe("killProcess", () => {
    it.skip("应该成功终止进程 (跳过：避免实际终止进程)", async () => {
      // This test is skipped to avoid accidentally killing processes
    });

    it("缺少 pid 参数应该报错", async () => {
      await expect(handler.handle("kill", {}, mockContext)).rejects.toThrow(
        'Parameter "pid" is required',
      );
    });

    it.skip("不应该终止受保护的系统进程 (跳过：需要执行系统命令)", async () => {
      await expect(
        handler.handle("kill", { pid: 4 }, mockContext),
      ).rejects.toThrow("Cannot kill protected system process");
    });
  });

  describe("startProcess", () => {
    it.skip("应该成功启动进程 (跳过：避免实际启动进程)", async () => {
      // This test is skipped to avoid accidentally starting processes
    });

    it("缺少 command 参数应该报错", async () => {
      await expect(handler.handle("start", {}, mockContext)).rejects.toThrow(
        'Parameter "command" is required',
      );
    });

    it("应该阻止危险命令", async () => {
      await expect(
        handler.handle(
          "start",
          { command: "rm", args: ["-rf", "/"] },
          mockContext,
        ),
      ).rejects.toThrow("Dangerous command blocked");
    });

    it("应该阻止 del /s 命令", async () => {
      await expect(
        handler.handle(
          "start",
          { command: "del", args: ["/s", "C:\\"] },
          mockContext,
        ),
      ).rejects.toThrow("Dangerous command blocked");
    });

    it("应该阻止 format 命令", async () => {
      await expect(
        handler.handle(
          "start",
          { command: "format", args: ["C:"] },
          mockContext,
        ),
      ).rejects.toThrow("Dangerous command blocked");
    });
  });

  describe("getResources", () => {
    it("应该返回系统资源使用情况", async () => {
      const result = await handler.handle("getResources", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.resources).toBeDefined();
      expect(result.resources.cpu).toBeDefined();
      expect(result.resources.memory).toBeDefined();
      expect(result.resources.loadAverage).toBeDefined();
      expect(result.resources.uptime).toBeDefined();
    });

    it("应该返回 CPU 信息", async () => {
      const result = await handler.handle("getResources", {}, mockContext);

      expect(result.resources.cpu.cores).toBeGreaterThan(0);
      expect(result.resources.cpu.model).toBeDefined();
    });

    it("应该返回内存信息", async () => {
      const result = await handler.handle("getResources", {}, mockContext);

      expect(result.resources.memory.total).toBeGreaterThan(0);
      expect(result.resources.memory.free).toBeGreaterThanOrEqual(0);
      expect(result.resources.memory.used).toBeGreaterThan(0);
      expect(result.resources.memory.usagePercent).toBeGreaterThanOrEqual(0);
      expect(result.resources.memory.usagePercent).toBeLessThanOrEqual(100);
    });

    it("应该返回系统运行时间", async () => {
      const result = await handler.handle("getResources", {}, mockContext);

      expect(result.resources.uptime).toBeGreaterThan(0);
    });

    it("应该返回平台信息", async () => {
      const result = await handler.handle("getResources", {}, mockContext);

      expect(result.resources.platform).toBeDefined();
      expect(result.resources.arch).toBeDefined();
    });
  });

  describe("searchProcesses", () => {
    it("缺少 query 参数应该报错", async () => {
      await expect(handler.handle("search", {}, mockContext)).rejects.toThrow(
        'Parameter "query" is required',
      );
    });

    it.skip("应该搜索匹配的进程 (跳过：需要执行系统命令)", async () => {
      const result = await handler.handle(
        "search",
        { query: "chrome" },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.query).toBe("chrome");
    });
  });

  describe("unknown action", () => {
    it("应该对未知操作报错", async () => {
      await expect(
        handler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });

  describe("handler initialization", () => {
    it("应该使用默认配置创建处理器", () => {
      const h = new ProcessHandler();
      expect(h.options.maxProcesses).toBe(500);
      expect(h.options.allowKillProtected).toBe(false);
    });

    it("应该支持自定义配置", () => {
      const h = new ProcessHandler({
        maxProcesses: 100,
        allowKillProtected: true,
      });
      expect(h.options.maxProcesses).toBe(100);
      expect(h.options.allowKillProtected).toBe(true);
    });
  });
});
