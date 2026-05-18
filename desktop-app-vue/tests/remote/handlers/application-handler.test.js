/**
 * ApplicationHandler 单元测试
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
    setImmediate(() => callback(null, "[]", ""));
  }),
}));

// Mock util.promisify
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => vi.fn().mockResolvedValue({ stdout: "[]", stderr: "" }),
  };
});

// Mock fs.promises
vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
  },
}));

const {
  ApplicationHandler,
} = require("../../../src/main/remote/handlers/application-handler");

describe("ApplicationHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new ApplicationHandler();
  });

  afterEach(async () => {
    if (handler && handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("constructor", () => {
    it("应该使用默认选项创建处理器", () => {
      const h = new ApplicationHandler();
      expect(h.options.maxResults).toBe(100);
      expect(h.options.includeSystemApps).toBe(true);
    });

    it("应该接受自定义选项", () => {
      const h = new ApplicationHandler({
        maxResults: 50,
        includeSystemApps: false,
      });
      expect(h.options.maxResults).toBe(50);
      expect(h.options.includeSystemApps).toBe(false);
    });
  });

  describe("getInfo 参数验证", () => {
    it("缺少 name 和 path 参数应该报错", async () => {
      await expect(handler.handle("getInfo", {}, mockContext)).rejects.toThrow(
        'Parameter "name" or "path" is required',
      );
    });

    it("无效的应用名称应该报错", async () => {
      await expect(
        handler.handle(
          "getInfo",
          { name: "<script>alert(1)</script>" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid application name");
    });

    it("过长的应用名称应该报错", async () => {
      await expect(
        handler.handle("getInfo", { name: "a".repeat(300) }, mockContext),
      ).rejects.toThrow("Invalid application name");
    });
  });

  describe("launch 参数验证", () => {
    it("缺少 name 和 path 参数应该报错", async () => {
      await expect(handler.handle("launch", {}, mockContext)).rejects.toThrow(
        'Parameter "name" or "path" is required',
      );
    });

    it("路径遍历攻击应该被阻止", async () => {
      await expect(
        handler.handle("launch", { path: "../../../etc/passwd" }, mockContext),
      ).rejects.toThrow("Invalid path");
    });
  });

  describe("close 参数验证", () => {
    it("缺少 name 和 pid 参数应该报错", async () => {
      await expect(handler.handle("close", {}, mockContext)).rejects.toThrow(
        'Parameter "name" or "pid" is required',
      );
    });
  });

  describe("focus 参数验证", () => {
    it("缺少 name 和 pid 参数应该报错", async () => {
      await expect(handler.handle("focus", {}, mockContext)).rejects.toThrow(
        'Parameter "name" or "pid" is required',
      );
    });
  });

  describe("search 参数验证", () => {
    it("缺少 query 参数应该报错", async () => {
      await expect(handler.handle("search", {}, mockContext)).rejects.toThrow(
        'Parameter "query" is required',
      );
    });
  });

  describe("listInstalled", () => {
    it.skip("应该返回已安装应用列表 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle("listInstalled", {}, mockContext);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.apps)).toBe(true);
    });
  });

  describe("listRunning", () => {
    it.skip("应该返回运行中应用列表 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle("listRunning", {}, mockContext);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.apps)).toBe(true);
    });
  });

  describe("getRecent", () => {
    it.skip("应该返回最近使用的应用 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle("getRecent", {}, mockContext);
      expect(result.success).toBe(true);
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
