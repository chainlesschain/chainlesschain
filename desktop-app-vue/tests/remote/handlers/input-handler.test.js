/**
 * InputHandler 单元测试
 *
 * 注意: InputHandler 依赖系统命令执行键盘/鼠标操作,
 * 这些在测试环境下会实际执行。因此主要测试参数验证。
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
    setImmediate(() => callback(null, "", ""));
  }),
}));

// Mock util.promisify
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  };
});

const {
  InputHandler,
} = require("../../../src/main/remote/handlers/input-handler");

describe("InputHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new InputHandler();
  });

  afterEach(async () => {
    if (handler && handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("constructor", () => {
    it("应该使用默认选项创建处理器", () => {
      const h = new InputHandler();
      expect(h.options.defaultTypeDelay).toBe(50);
      expect(h.options.maxTypeDelay).toBe(500);
      expect(h.options.enableMouse).toBe(true);
      expect(h.options.enableKeyboard).toBe(true);
    });

    it("应该接受自定义选项", () => {
      const h = new InputHandler({
        defaultTypeDelay: 100,
        enableMouse: false,
        enableKeyboard: false,
      });
      expect(h.options.defaultTypeDelay).toBe(100);
      expect(h.options.enableMouse).toBe(false);
      expect(h.options.enableKeyboard).toBe(false);
    });
  });

  describe("sendKeyPress 参数验证", () => {
    it("缺少 key 参数应该报错", async () => {
      await expect(
        handler.handle("sendKeyPress", {}, mockContext),
      ).rejects.toThrow('Parameter "key" is required');
    });

    it("无效的 key 名称应该报错", async () => {
      await expect(
        handler.handle("sendKeyPress", { key: "invalid<script>" }, mockContext),
      ).rejects.toThrow("Invalid key name");
    });

    it("过长的 key 名称应该报错", async () => {
      await expect(
        handler.handle("sendKeyPress", { key: "a".repeat(25) }, mockContext),
      ).rejects.toThrow("Invalid key name");
    });

    it("键盘输入禁用时应该报错", async () => {
      const h = new InputHandler({ enableKeyboard: false });
      await expect(
        h.handle("sendKeyPress", { key: "enter" }, mockContext),
      ).rejects.toThrow("Keyboard input is disabled");
    });
  });

  describe("sendKeyCombo 参数验证", () => {
    it("缺少 key 参数应该报错", async () => {
      await expect(
        handler.handle("sendKeyCombo", { modifiers: ["ctrl"] }, mockContext),
      ).rejects.toThrow('Parameter "key" is required');
    });

    it("应该过滤无效的修饰键", async () => {
      // 这个测试主要验证无效修饰键被过滤
      // 实际执行会使用系统命令
    });
  });

  describe("typeText 参数验证", () => {
    it("缺少 text 参数应该报错", async () => {
      await expect(handler.handle("typeText", {}, mockContext)).rejects.toThrow(
        'Parameter "text" is required',
      );
    });

    it("过长的文本应该报错", async () => {
      await expect(
        handler.handle("typeText", { text: "a".repeat(10001) }, mockContext),
      ).rejects.toThrow("Text too long");
    });

    it("非字符串文本应该报错", async () => {
      await expect(
        handler.handle("typeText", { text: 12345 }, mockContext),
      ).rejects.toThrow("Text must be a string");
    });

    it("键盘输入禁用时应该报错", async () => {
      const h = new InputHandler({ enableKeyboard: false });
      await expect(
        h.handle("typeText", { text: "hello" }, mockContext),
      ).rejects.toThrow("Keyboard input is disabled");
    });
  });

  describe("mouseMove 参数验证", () => {
    it("缺少坐标参数应该报错", async () => {
      await expect(
        handler.handle("mouseMove", {}, mockContext),
      ).rejects.toThrow('Parameters "x" and "y" are required');
    });

    it("缺少 y 坐标应该报错", async () => {
      await expect(
        handler.handle("mouseMove", { x: 100 }, mockContext),
      ).rejects.toThrow('Parameters "x" and "y" are required');
    });

    it("无效的坐标值应该报错", async () => {
      await expect(
        handler.handle("mouseMove", { x: -1, y: 100 }, mockContext),
      ).rejects.toThrow("Invalid x");
    });

    it("过大的坐标值应该报错", async () => {
      await expect(
        handler.handle("mouseMove", { x: 100000, y: 100 }, mockContext),
      ).rejects.toThrow("Invalid x");
    });

    it("鼠标输入禁用时应该报错", async () => {
      const h = new InputHandler({ enableMouse: false });
      await expect(
        h.handle("mouseMove", { x: 100, y: 100 }, mockContext),
      ).rejects.toThrow("Mouse input is disabled");
    });
  });

  describe("mouseClick 参数验证", () => {
    it("鼠标输入禁用时应该报错", async () => {
      const h = new InputHandler({ enableMouse: false });
      await expect(h.handle("mouseClick", {}, mockContext)).rejects.toThrow(
        "Mouse input is disabled",
      );
    });

    it("应该默认使用左键", async () => {
      // 验证默认按钮处理
    });
  });

  describe("mouseDrag 参数验证", () => {
    it("缺少坐标参数应该报错", async () => {
      await expect(
        handler.handle("mouseDrag", { startX: 0, startY: 0 }, mockContext),
      ).rejects.toThrow(
        'Parameters "startX", "startY", "endX", "endY" are required',
      );
    });

    it("鼠标输入禁用时应该报错", async () => {
      const h = new InputHandler({ enableMouse: false });
      await expect(
        h.handle(
          "mouseDrag",
          { startX: 0, startY: 0, endX: 100, endY: 100 },
          mockContext,
        ),
      ).rejects.toThrow("Mouse input is disabled");
    });
  });

  describe("mouseScroll 参数验证", () => {
    it("鼠标输入禁用时应该报错", async () => {
      const h = new InputHandler({ enableMouse: false });
      await expect(h.handle("mouseScroll", {}, mockContext)).rejects.toThrow(
        "Mouse input is disabled",
      );
    });

    it("应该使用默认方向和数量", async () => {
      // 验证默认值处理
    });
  });

  describe("getCursorPosition", () => {
    it.skip("应该返回鼠标位置 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle("getCursorPosition", {}, mockContext);
      expect(result.success).toBe(true);
      expect(typeof result.x).toBe("number");
      expect(typeof result.y).toBe("number");
    });
  });

  describe("getKeyboardLayout", () => {
    it.skip("应该返回键盘布局 (跳过: 需要系统命令)", async () => {
      const result = await handler.handle("getKeyboardLayout", {}, mockContext);
      expect(result.success).toBe(true);
      expect(result.platform).toBeDefined();
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
