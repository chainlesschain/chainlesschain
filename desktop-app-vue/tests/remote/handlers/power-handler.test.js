/**
 * PowerHandler 单元测试
 *
 * 注意：实际触发系统电源操作的测试已跳过，避免意外关机/重启
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

// Mock execAsync results
const mockExecAsync = vi.fn();

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (typeof opts === "function") {
      callback = opts;
    }
    setImmediate(() => callback(null, "", ""));
  }),
  spawn: vi.fn(() => ({
    pid: 12345,
    unref: vi.fn(),
  })),
}));

// Mock util.promisify
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

// Must import after mocks are set up
const { PowerHandler } =
  await import("../../../src/main/remote/handlers/power-handler");

describe("PowerHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    handler = new PowerHandler({ requireConfirmation: false });
  });

  afterEach(async () => {
    if (handler) {
      await handler.cleanup();
    }
  });

  // ⚠️ 跳过所有可能触发实际电源操作的测试
  describe("lock", () => {
    it.skip("应该成功锁屏 (跳过：避免实际锁屏)", async () => {
      const result = await handler.handle("lock", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.action).toBe("lock");
    });
  });

  describe("sleep", () => {
    it.skip("应该成功进入睡眠模式 (跳过：避免实际睡眠)", async () => {
      const result = await handler.handle("sleep", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.action).toBe("sleep");
    });
  });

  describe("hibernate", () => {
    it.skip("应该成功进入休眠模式 (跳过：避免实际休眠)", async () => {
      const result = await handler.handle("hibernate", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.action).toBe("hibernate");
    });
  });

  describe("shutdown", () => {
    it.skip("应该成功执行关机 (跳过：避免实际关机)", async () => {
      const result = await handler.handle(
        "shutdown",
        { confirm: false },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("shutdown");
    });

    it.skip("应该支持延迟关机 (跳过：避免实际关机)", async () => {
      const result = await handler.handle(
        "shutdown",
        { delay: 60, confirm: false },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.delay).toBe(60);
    });
  });

  describe("restart", () => {
    it.skip("应该成功执行重启 (跳过：避免实际重启)", async () => {
      const result = await handler.handle(
        "restart",
        { confirm: false },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("restart");
    });
  });

  describe("logout", () => {
    it.skip("应该成功执行注销 (跳过：避免实际注销)", async () => {
      const result = await handler.handle(
        "logout",
        { confirm: false },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("logout");
    });
  });

  // ✅ 以下测试是安全的，不会触发实际电源操作
  describe("scheduleShutdown", () => {
    it("应该成功创建定时关机任务", async () => {
      const result = await handler.handle(
        "scheduleShutdown",
        { delay: 3600 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.taskId).toBeDefined();
      expect(result.action).toBe("shutdown");
    });

    it("缺少 delay 和 time 应该报错", async () => {
      await expect(
        handler.handle("scheduleShutdown", {}, mockContext),
      ).rejects.toThrow('Parameter "delay" or "time" is required');
    });

    it("过去的时间应该报错", async () => {
      const pastTime = new Date(Date.now() - 10000).toISOString();
      await expect(
        handler.handle("scheduleShutdown", { time: pastTime }, mockContext),
      ).rejects.toThrow("Scheduled time is in the past");
    });
  });

  describe("cancelSchedule", () => {
    it("应该成功取消定时任务", async () => {
      // 先创建任务
      const scheduleResult = await handler.handle(
        "scheduleShutdown",
        { delay: 3600 },
        mockContext,
      );

      // 取消任务
      const cancelResult = await handler.handle(
        "cancelSchedule",
        { taskId: scheduleResult.taskId },
        mockContext,
      );

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.taskId).toBe(scheduleResult.taskId);
    });

    it("缺少 taskId 应该报错", async () => {
      await expect(
        handler.handle("cancelSchedule", {}, mockContext),
      ).rejects.toThrow('Parameter "taskId" is required');
    });

    it("取消不存在的任务应该报错", async () => {
      await expect(
        handler.handle("cancelSchedule", { taskId: "invalid" }, mockContext),
      ).rejects.toThrow("Task invalid not found");
    });
  });

  describe("getSchedule", () => {
    it("应该返回空的定时任务列表", async () => {
      const result = await handler.handle("getSchedule", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.tasks).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("应该返回已创建的定时任务列表", async () => {
      // 创建一个任务
      await handler.handle("scheduleShutdown", { delay: 3600 }, mockContext);

      const result = await handler.handle("getSchedule", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.tasks.length).toBe(1);
      expect(result.tasks[0].action).toBe("shutdown");
    });

    it("应该返回正确的任务详情", async () => {
      await handler.handle(
        "scheduleShutdown",
        { delay: 3600, action: "restart" },
        mockContext,
      );

      const result = await handler.handle("getSchedule", {}, mockContext);

      expect(result.tasks[0]).toHaveProperty("id");
      expect(result.tasks[0]).toHaveProperty("scheduledTime");
      expect(result.tasks[0]).toHaveProperty("createdAt");
      expect(result.tasks[0]).toHaveProperty("createdBy");
    });
  });

  describe("confirmation flow", () => {
    it("需要确认时应返回确认 ID", async () => {
      const confirmHandler = new PowerHandler({ requireConfirmation: true });

      const result = await confirmHandler.handle(
        "shutdown",
        { confirm: true },
        mockContext,
      );

      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmId).toBeDefined();
      expect(result.action).toBe("shutdown");
      expect(result.expiresIn).toBeDefined();

      await confirmHandler.cleanup();
    });

    it.skip("确认后应执行操作 (跳过：避免实际关机)", async () => {
      const confirmHandler = new PowerHandler({ requireConfirmation: true });

      // 请求关机（需要确认）
      const shutdownResult = await confirmHandler.handle(
        "shutdown",
        { confirm: true },
        mockContext,
      );

      // 确认操作
      const confirmResult = await confirmHandler.handle(
        "confirm",
        { confirmId: shutdownResult.confirmId },
        mockContext,
      );

      expect(confirmResult.success).toBe(true);
      expect(confirmResult.action).toBe("shutdown");

      await confirmHandler.cleanup();
    });

    it("确认时缺少 confirmId 应该报错", async () => {
      await expect(handler.handle("confirm", {}, mockContext)).rejects.toThrow(
        'Parameter "confirmId" is required',
      );
    });

    it("确认无效的 confirmId 应该报错", async () => {
      await expect(
        handler.handle("confirm", { confirmId: "invalid-id" }, mockContext),
      ).rejects.toThrow("Confirmation expired or invalid");
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
    it("应该清理处理器的 pendingConfirmations", async () => {
      const confirmHandler = new PowerHandler({ requireConfirmation: true });

      // 创建一个待确认的请求
      const result = await confirmHandler.handle(
        "shutdown",
        { confirm: true },
        mockContext,
      );
      expect(result.requiresConfirmation).toBe(true);

      // 清理
      await confirmHandler.cleanup();

      // 确认 ID 应该失效
      await expect(
        confirmHandler.handle(
          "confirm",
          { confirmId: result.confirmId },
          mockContext,
        ),
      ).rejects.toThrow("Confirmation expired or invalid");
    });

    it("应该清理定时任务", async () => {
      // 创建任务
      const scheduleResult = await handler.handle(
        "scheduleShutdown",
        { delay: 3600 },
        mockContext,
      );

      // 验证任务存在
      const beforeCleanup = await handler.handle(
        "getSchedule",
        {},
        mockContext,
      );
      expect(beforeCleanup.tasks.length).toBeGreaterThan(0);

      // 清理 - 模块级的 scheduledTasks 会被清空
      await handler.cleanup();

      // 验证任务被清理
      const afterCleanup = await handler.handle("getSchedule", {}, mockContext);
      expect(afterCleanup.tasks.length).toBe(0);
    });
  });
});
