/**
 * SecurityHandler 单元测试
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
  SecurityHandler,
} = require("../../../src/main/remote/handlers/security-handler");

describe("SecurityHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new SecurityHandler();
  });

  afterEach(async () => {
    if (handler && handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("constructor", () => {
    it("应该使用默认选项创建处理器", () => {
      const h = new SecurityHandler();
      expect(h.options.maxLoginHistory).toBe(50);
    });

    it("应该接受自定义选项", () => {
      const h = new SecurityHandler({
        maxLoginHistory: 100,
      });
      expect(h.options.maxLoginHistory).toBe(100);
    });
  });

  describe("lockWorkstation", () => {
    it.skip("应该锁定工作站 (跳过: 会实际执行)", async () => {
      const result = await handler.handle("lockWorkstation", {}, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("应该返回安全状态摘要", async () => {
      // Spy on sub-methods to avoid real system command execution
      vi.spyOn(handler, "getFirewallStatus").mockResolvedValue({ success: true, enabled: true });
      vi.spyOn(handler, "getAntivirusStatus").mockResolvedValue({ success: true, installed: true });
      vi.spyOn(handler, "getEncryptionStatus").mockResolvedValue({ success: true, enabled: false });
      vi.spyOn(handler, "getUpdates").mockResolvedValue({ success: true, pendingCount: 0 });

      const result = await handler.handle("getStatus", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.security).toBeDefined();
      expect(result.security.platform).toBeDefined();
    });
  });

  describe("getActiveUsers", () => {
    it("应该返回活动用户列表", async () => {
      const result = await handler.handle("getActiveUsers", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.users)).toBe(true);
      expect(result.currentUser).toBeDefined();
    });
  });

  describe("getLoginHistory", () => {
    it.skip("应该返回登录历史 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle(
        "getLoginHistory",
        { limit: 10 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.history)).toBe(true);
    });
  });

  describe("getFirewallStatus", () => {
    it("应该返回防火墙状态", async () => {
      const result = await handler.handle("getFirewallStatus", {}, mockContext);

      expect(result.success).toBe(true);
      // enabled 可能为 null、true 或 false
    });
  });

  describe("getAntivirusStatus", () => {
    it("应该返回杀毒软件状态", async () => {
      const result = await handler.handle(
        "getAntivirusStatus",
        {},
        mockContext,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("getEncryptionStatus", () => {
    it("应该返回加密状态", async () => {
      const result = await handler.handle(
        "getEncryptionStatus",
        {},
        mockContext,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("getUpdates", () => {
    it("应该返回系统更新状态", async () => {
      const result = await handler.handle("getUpdates", {}, mockContext);

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
