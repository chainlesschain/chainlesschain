/**
 * BrowserHandler 单元测试
 *
 * 使用依赖注入模式解决 CommonJS/Vitest 模拟问题
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

const {
  BrowserHandler,
} = require("../../../src/main/remote/handlers/browser-handler");

// Create a mock BrowserEngine class for dependency injection
const createMockBrowserEngineClass = () => {
  return class MockBrowserEngine {
    constructor(options) {
      this.options = options;
      this.isRunning = false;
    }

    async start(params) {
      this.isRunning = true;
      return { cdpPort: 18800, pid: 12345 };
    }

    async stop() {
      this.isRunning = false;
      return { uptime: 10000 };
    }

    async createContext(profileName) {
      return { success: true, profileName };
    }

    async openTab(profileName, url, options) {
      return {
        success: true,
        targetId: "tab-1",
        url: url,
        title: "百度一下",
      };
    }

    async navigate(targetId, url, options) {
      return {
        success: true,
        url: url,
        title: "Google",
      };
    }

    async screenshot(targetId, options) {
      return Buffer.from("fake-image-data");
    }

    getStatus() {
      return {
        isRunning: this.isRunning,
        uptime: 5000,
        cdpPort: 18800,
        contextsCount: 1,
        tabsCount: 1,
      };
    }

    async listTabs(profileName) {
      return [
        { targetId: "tab-1", url: "https://www.baidu.com", title: "百度一下" },
      ];
    }

    async closeTab(targetId) {
      return { success: true, targetId };
    }

    async focusTab(targetId) {
      return { success: true, targetId };
    }

    async act(targetId, action, ref, options) {
      return { success: true, action, ref };
    }

    async takeSnapshot(targetId, options) {
      return { elementsCount: 50, elements: [] };
    }

    findElement(targetId, ref) {
      if (ref === "nonexistent") {
        return null;
      }
      return { tag: "button", text: "Submit" };
    }

    async cleanup() {
      this.isRunning = false;
    }
  };
};

describe("BrowserHandler", () => {
  let handler;
  let MockBrowserEngine;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    MockBrowserEngine = createMockBrowserEngineClass();
    handler = new BrowserHandler({}, { BrowserEngine: MockBrowserEngine });
  });

  afterEach(async () => {
    if (handler) {
      await handler.cleanup();
    }
  });

  describe("openUrl", () => {
    it("应该成功打开 URL", async () => {
      const result = await handler.handle(
        "openUrl",
        { url: "https://www.baidu.com" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://www.baidu.com");
      expect(result.title).toBe("百度一下");
      expect(result.targetId).toBe("tab-1");
    });

    it("缺少 URL 应该报错", async () => {
      await expect(handler.handle("openUrl", {}, mockContext)).rejects.toThrow(
        'Parameter "url" is required',
      );
    });

    it("无效的 URL 格式应该报错", async () => {
      await expect(
        handler.handle("openUrl", { url: "not-a-valid-url" }, mockContext),
      ).rejects.toThrow("Invalid URL format");
    });
  });

  describe("start", () => {
    it("应该成功启动浏览器", async () => {
      const result = await handler.handle("start", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.cdpPort).toBe(18800);
    });

    it("浏览器已运行时应返回已运行状态", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      // 再次尝试启动
      const result = await handler.handle("start", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Browser is already running");
    });
  });

  describe("stop", () => {
    it("应该成功停止浏览器", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle("stop", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.uptime).toBe(10000);
    });

    it("浏览器未运行时应返回未运行状态", async () => {
      const result = await handler.handle("stop", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Browser is not running");
    });
  });

  describe("navigate", () => {
    it("应该成功导航到 URL", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "navigate",
        { targetId: "tab-1", url: "https://www.google.com" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://www.google.com");
    });

    it("缺少 targetId 应该报错", async () => {
      await expect(
        handler.handle(
          "navigate",
          { url: "https://www.google.com" },
          mockContext,
        ),
      ).rejects.toThrow('Parameter "targetId" is required');
    });

    it("缺少 url 应该报错", async () => {
      await expect(
        handler.handle("navigate", { targetId: "tab-1" }, mockContext),
      ).rejects.toThrow('Parameter "url" is required');
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle(
          "navigate",
          { targetId: "tab-1", url: "https://www.google.com" },
          mockContext,
        ),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("screenshot", () => {
    it("应该成功截图并返回 base64", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "screenshot",
        { targetId: "tab-1" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.format).toBe("png");
    });

    it("缺少 targetId 应该报错", async () => {
      await expect(
        handler.handle("screenshot", {}, mockContext),
      ).rejects.toThrow('Parameter "targetId" is required');
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle("screenshot", { targetId: "tab-1" }, mockContext),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("getStatus", () => {
    it("应该返回浏览器状态", async () => {
      // 先初始化引擎
      await handler.getEngine();

      const result = await handler.handle("getStatus", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.isRunning).toBeDefined();
    });

    it("引擎未初始化时应返回未运行状态", async () => {
      const newHandler = new BrowserHandler(
        {},
        { BrowserEngine: MockBrowserEngine },
      );
      const result = await newHandler.handle("getStatus", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.isRunning).toBe(false);
    });
  });

  describe("listTabs", () => {
    it("应该返回标签页列表", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle("listTabs", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.tabs).toHaveLength(1);
      expect(result.tabs[0].url).toBe("https://www.baidu.com");
    });

    it("浏览器未运行时应返回空列表", async () => {
      const result = await handler.handle("listTabs", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.tabs).toHaveLength(0);
    });
  });

  describe("closeTab", () => {
    it("应该成功关闭标签页", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "closeTab",
        { targetId: "tab-1" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.targetId).toBe("tab-1");
    });

    it("缺少 targetId 应该报错", async () => {
      await expect(handler.handle("closeTab", {}, mockContext)).rejects.toThrow(
        'Parameter "targetId" is required',
      );
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle("closeTab", { targetId: "tab-1" }, mockContext),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("focusTab", () => {
    it("应该成功聚焦标签页", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "focusTab",
        { targetId: "tab-1" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.targetId).toBe("tab-1");
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle("focusTab", { targetId: "tab-1" }, mockContext),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("act", () => {
    it("应该成功执行操作", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "act",
        { targetId: "tab-1", action: "click", ref: "button[0]" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("click");
    });

    it("缺少必要参数应该报错", async () => {
      await expect(
        handler.handle(
          "act",
          { targetId: "tab-1", action: "click" },
          mockContext,
        ),
      ).rejects.toThrow('Parameter "ref" is required');
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle(
          "act",
          { targetId: "tab-1", action: "click", ref: "button[0]" },
          mockContext,
        ),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("takeSnapshot", () => {
    it("应该成功获取快照", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "takeSnapshot",
        { targetId: "tab-1" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.elementsCount).toBe(50);
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle("takeSnapshot", { targetId: "tab-1" }, mockContext),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("findElement", () => {
    it("应该成功查找元素", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "findElement",
        { targetId: "tab-1", ref: "button[0]" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.element).toBeDefined();
      expect(result.element.tag).toBe("button");
    });

    it("元素未找到时应返回失败", async () => {
      // 先启动浏览器
      await handler.handle("start", {}, mockContext);

      const result = await handler.handle(
        "findElement",
        { targetId: "tab-1", ref: "nonexistent" },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("浏览器未运行时应报错", async () => {
      await expect(
        handler.handle(
          "findElement",
          { targetId: "tab-1", ref: "button[0]" },
          mockContext,
        ),
      ).rejects.toThrow("Browser is not running");
    });
  });

  describe("unknown action", () => {
    it("应该对未知操作报错", async () => {
      await expect(
        handler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });
});
