/**
 * 远程浏览器自动化和文件操作集成测试
 *
 * 测试 Android → PC 远程命令：
 * - browser.openUrl: 打开浏览器访问指定 URL
 * - browser.screenshot: 截图
 * - browser.navigate: 导航
 * - file.create: 创建文件 (需要 Electron 环境)
 * - file.write: 写入文件 (需要 Electron 环境)
 * - file.read: 读取文件 (需要 Electron 环境)
 *
 * @module tests/integration/remote-browser-file-e2e
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import os from "os";

// Mock logger
vi.mock("../../src/main/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Create a mock BrowserEngine class for dependency injection
const createMockBrowserEngineClass = () => {
  const tabs = new Map();
  let tabCounter = 0;

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
      tabs.clear();
      tabCounter = 0;
      return { uptime: 10000 };
    }

    async createContext(profileName) {
      return { success: true, profileName };
    }

    async openTab(profileName, url, options) {
      const targetId = `tab-${++tabCounter}`;
      tabs.set(targetId, { url, title: `Page: ${url}` });
      return {
        success: true,
        targetId,
        url,
        title: `Page: ${url}`,
      };
    }

    async navigate(targetId, url, options) {
      if (tabs.has(targetId)) {
        tabs.set(targetId, { url, title: `Page: ${url}` });
        return { success: true, url, title: `Page: ${url}` };
      }
      throw new Error(`Tab ${targetId} not found`);
    }

    async screenshot(targetId, options) {
      return Buffer.from("fake-screenshot-data-png");
    }

    getStatus() {
      return {
        isRunning: this.isRunning,
        uptime: 5000,
        cdpPort: 18800,
        contextsCount: 1,
        tabsCount: tabs.size,
      };
    }

    async listTabs(profileName) {
      return Array.from(tabs.entries()).map(([id, data]) => ({
        targetId: id,
        url: data.url,
        title: data.title,
      }));
    }

    async closeTab(targetId) {
      tabs.delete(targetId);
      return { success: true, targetId };
    }

    async focusTab(targetId) {
      if (!tabs.has(targetId)) {
        throw new Error(`Tab ${targetId} not found`);
      }
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
      tabs.clear();
      tabCounter = 0;
    }
  };
};

// Import BrowserHandler
const { BrowserHandler } =
  await import("../../src/main/remote/handlers/browser-handler");

describe("Remote Browser & File E2E Tests", () => {
  let browserHandler;
  let MockBrowserEngine;
  const mockContext = {
    did: "did:key:android-test-device-123",
    peerId: "peer-android-123",
    channel: "p2p",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock BrowserEngine
    MockBrowserEngine = createMockBrowserEngineClass();

    // Create browser handler with dependency injection
    browserHandler = new BrowserHandler(
      {
        defaultProfile: "remote-control",
        headless: true,
      },
      {
        BrowserEngine: MockBrowserEngine,
      },
    );
  });

  afterEach(async () => {
    // Cleanup
    if (browserHandler) {
      await browserHandler.cleanup();
    }
  });

  describe("浏览器远程控制流程", () => {
    describe("browser.openUrl - 打开 URL", () => {
      it("应该成功打开百度", async () => {
        const result = await browserHandler.handle(
          "openUrl",
          { url: "https://www.baidu.com" },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.url).toBe("https://www.baidu.com");
        expect(result.title).toContain("baidu");
        expect(result.targetId).toBeDefined();
        expect(result.profileName).toBe("remote-control");
      });

      it("应该成功打开 Google", async () => {
        const result = await browserHandler.handle(
          "openUrl",
          { url: "https://www.google.com" },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.url).toBe("https://www.google.com");
        expect(result.targetId).toBeDefined();
      });

      it("应该拒绝无效的 URL", async () => {
        await expect(
          browserHandler.handle("openUrl", { url: "invalid-url" }, mockContext),
        ).rejects.toThrow("Invalid URL format");
      });

      it("应该拒绝空 URL", async () => {
        await expect(
          browserHandler.handle("openUrl", {}, mockContext),
        ).rejects.toThrow('Parameter "url" is required');
      });
    });

    describe("browser.navigate - 导航", () => {
      it("应该在已打开的标签页中导航到新 URL", async () => {
        // 先打开一个 URL
        const openResult = await browserHandler.handle(
          "openUrl",
          { url: "https://www.baidu.com" },
          mockContext,
        );

        // 导航到新 URL
        const navResult = await browserHandler.handle(
          "navigate",
          {
            targetId: openResult.targetId,
            url: "https://www.bing.com",
          },
          mockContext,
        );

        expect(navResult.success).toBe(true);
        expect(navResult.url).toBe("https://www.bing.com");
      });
    });

    describe("browser.screenshot - 截图", () => {
      it("应该成功截图并返回 base64 数据", async () => {
        // 先打开一个 URL
        const openResult = await browserHandler.handle(
          "openUrl",
          { url: "https://www.baidu.com" },
          mockContext,
        );

        // 截图
        const screenshotResult = await browserHandler.handle(
          "screenshot",
          { targetId: openResult.targetId },
          mockContext,
        );

        expect(screenshotResult.success).toBe(true);
        expect(screenshotResult.data).toBeDefined();
        expect(screenshotResult.format).toBe("png");
        expect(screenshotResult.size).toBeGreaterThan(0);

        // 验证 base64 格式
        expect(() =>
          Buffer.from(screenshotResult.data, "base64"),
        ).not.toThrow();
      });
    });

    describe("browser.listTabs - 列出标签页", () => {
      it("应该列出所有打开的标签页", async () => {
        // 打开多个标签页
        await browserHandler.handle(
          "openUrl",
          { url: "https://www.baidu.com" },
          mockContext,
        );
        await browserHandler.handle(
          "openUrl",
          { url: "https://www.google.com" },
          mockContext,
        );

        // 列出标签页
        const result = await browserHandler.handle("listTabs", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.tabs.length).toBe(2);
        expect(result.tabs[0].url).toContain("baidu");
        expect(result.tabs[1].url).toContain("google");
      });
    });

    describe("browser.closeTab - 关闭标签页", () => {
      it("应该成功关闭指定标签页", async () => {
        // 打开标签页
        const openResult = await browserHandler.handle(
          "openUrl",
          { url: "https://www.baidu.com" },
          mockContext,
        );

        // 关闭标签页
        const closeResult = await browserHandler.handle(
          "closeTab",
          { targetId: openResult.targetId },
          mockContext,
        );

        expect(closeResult.success).toBe(true);
        expect(closeResult.targetId).toBe(openResult.targetId);

        // 验证标签页已关闭
        const listResult = await browserHandler.handle(
          "listTabs",
          {},
          mockContext,
        );
        expect(listResult.tabs.length).toBe(0);
      });
    });

    describe("browser.getStatus - 获取状态", () => {
      it("应该返回浏览器当前状态", async () => {
        // 启动浏览器
        await browserHandler.handle(
          "openUrl",
          { url: "https://www.baidu.com" },
          mockContext,
        );

        const result = await browserHandler.handle(
          "getStatus",
          {},
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.isRunning).toBe(true);
        expect(result.cdpPort).toBe(18800);
      });
    });

    describe("browser.start/stop - 启动和停止", () => {
      it("应该成功启动浏览器", async () => {
        const result = await browserHandler.handle("start", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.cdpPort).toBe(18800);
      });

      it("应该成功停止浏览器", async () => {
        // 先启动
        await browserHandler.handle("start", {}, mockContext);

        // 停止
        const result = await browserHandler.handle("stop", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.uptime).toBe(10000);
      });

      it("再次启动应返回已运行状态", async () => {
        await browserHandler.handle("start", {}, mockContext);

        const result = await browserHandler.handle("start", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.message).toBe("Browser is already running");
      });
    });

    describe("browser.act - 执行操作", () => {
      it("应该成功执行点击操作", async () => {
        await browserHandler.handle("start", {}, mockContext);

        const result = await browserHandler.handle(
          "act",
          { targetId: "tab-1", action: "click", ref: "button[0]" },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.action).toBe("click");
      });

      it("应该成功执行输入操作", async () => {
        await browserHandler.handle("start", {}, mockContext);

        const result = await browserHandler.handle(
          "act",
          {
            targetId: "tab-1",
            action: "type",
            ref: "input[0]",
            options: { text: "Hello" },
          },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.action).toBe("type");
      });
    });

    describe("browser.takeSnapshot - 获取页面快照", () => {
      it("应该成功获取页面快照", async () => {
        await browserHandler.handle("start", {}, mockContext);

        const result = await browserHandler.handle(
          "takeSnapshot",
          { targetId: "tab-1" },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.elementsCount).toBe(50);
      });
    });

    describe("browser.findElement - 查找元素", () => {
      it("应该成功查找元素", async () => {
        await browserHandler.handle("start", {}, mockContext);

        const result = await browserHandler.handle(
          "findElement",
          { targetId: "tab-1", ref: "button[0]" },
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.element.tag).toBe("button");
      });

      it("应该处理找不到的元素", async () => {
        await browserHandler.handle("start", {}, mockContext);

        const result = await browserHandler.handle(
          "findElement",
          { targetId: "tab-1", ref: "nonexistent" },
          mockContext,
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain("not found");
      });
    });
  });

  describe("组合操作场景", () => {
    it("场景1: 打开百度 → 截图", async () => {
      // 1. 打开百度
      const openResult = await browserHandler.handle(
        "openUrl",
        { url: "https://www.baidu.com" },
        mockContext,
      );
      expect(openResult.success).toBe(true);

      // 2. 截图
      const screenshotResult = await browserHandler.handle(
        "screenshot",
        { targetId: openResult.targetId },
        mockContext,
      );
      expect(screenshotResult.success).toBe(true);
      expect(screenshotResult.data).toBeDefined();
    });

    it("场景2: 打开多个标签页 → 逐个截图", async () => {
      const urls = [
        "https://www.baidu.com",
        "https://www.bing.com",
        "https://www.google.com",
      ];
      const targetIds = [];

      // 打开多个标签页
      for (const url of urls) {
        const result = await browserHandler.handle(
          "openUrl",
          { url },
          mockContext,
        );
        targetIds.push(result.targetId);
      }

      // 列出所有标签页
      const listResult = await browserHandler.handle(
        "listTabs",
        {},
        mockContext,
      );
      expect(listResult.tabs.length).toBe(3);

      // 逐个截图
      for (let i = 0; i < targetIds.length; i++) {
        const screenshotResult = await browserHandler.handle(
          "screenshot",
          { targetId: targetIds[i] },
          mockContext,
        );
        expect(screenshotResult.success).toBe(true);
        expect(screenshotResult.data).toBeDefined();
      }
    });

    it("场景3: 打开 → 导航 → 关闭", async () => {
      // 打开
      const openResult = await browserHandler.handle(
        "openUrl",
        { url: "https://www.baidu.com" },
        mockContext,
      );

      // 导航
      const navResult = await browserHandler.handle(
        "navigate",
        { targetId: openResult.targetId, url: "https://www.google.com" },
        mockContext,
      );
      expect(navResult.url).toBe("https://www.google.com");

      // 关闭
      const closeResult = await browserHandler.handle(
        "closeTab",
        { targetId: openResult.targetId },
        mockContext,
      );
      expect(closeResult.success).toBe(true);
    });
  });

  describe("错误处理", () => {
    it("浏览器未运行时 navigate 应返回适当错误", async () => {
      await expect(
        browserHandler.handle(
          "navigate",
          { targetId: "tab-1", url: "https://www.baidu.com" },
          mockContext,
        ),
      ).rejects.toThrow("Browser is not running");
    });

    it("浏览器未运行时 screenshot 应返回适当错误", async () => {
      await expect(
        browserHandler.handle("screenshot", { targetId: "tab-1" }, mockContext),
      ).rejects.toThrow("Browser is not running");
    });

    it("缺少必要参数时应返回错误", async () => {
      await expect(
        browserHandler.handle("openUrl", {}, mockContext),
      ).rejects.toThrow('Parameter "url" is required');

      await expect(
        browserHandler.handle(
          "navigate",
          { url: "https://test.com" },
          mockContext,
        ),
      ).rejects.toThrow('Parameter "targetId" is required');

      await expect(
        browserHandler.handle("screenshot", {}, mockContext),
      ).rejects.toThrow('Parameter "targetId" is required');
    });

    it("未知操作应返回错误", async () => {
      await expect(
        browserHandler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });

  // 文件操作测试需要 Electron 环境，跳过
  describe.skip("文件远程操作流程 (需要 Electron 环境)", () => {
    it("file.create - 创建文件", async () => {});
    it("file.write - 写入文件", async () => {});
    it("file.read - 读取文件", async () => {});
    it("file.mkdir - 创建目录", async () => {});
    it("file.list - 列出目录", async () => {});
    it("file.delete - 删除文件", async () => {});
    it("file.exists - 检查文件存在", async () => {});
    it("安全性测试 - 路径遍历攻击", async () => {});
  });
});
