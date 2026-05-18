/**
 * DisplayHandler 单元测试
 *
 * 注意: DisplayHandler 依赖 Electron screen/desktopCapturer 模块和系统命令,
 * 这些在非 Electron 环境下难以正确模拟。
 * 因此这里主要测试参数验证和错误处理逻辑。
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

// Mock util.promisify to return a mock function
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  };
});

// Mock fs.promises
vi.mock("fs", () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// 创建模拟显示器数据
const mockDisplay = {
  id: 12345,
  label: "Built-in Display",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  size: { width: 1920, height: 1080 },
  scaleFactor: 1.25,
  rotation: 0,
  colorSpace: "srgb",
  colorDepth: 24,
  internal: true,
  accelerometerSupport: "unknown",
  touchSupport: "unknown",
  monochrome: false,
};

// Mock Electron modules
vi.mock("electron", () => ({
  screen: {
    getAllDisplays: vi.fn(() => [mockDisplay]),
    getPrimaryDisplay: vi.fn(() => mockDisplay),
    getCursorScreenPoint: vi.fn(() => ({ x: 500, y: 300 })),
    getDisplayNearestPoint: vi.fn(() => mockDisplay),
  },
  desktopCapturer: {
    getSources: vi.fn(() =>
      Promise.resolve([
        {
          id: "screen:0:0",
          name: "Entire Screen",
          display_id: "12345",
          thumbnail: {
            toPNG: () => Buffer.from("mock-png"),
            toJPEG: () => Buffer.from("mock-jpeg"),
            getSize: () => ({ width: 1920, height: 1080 }),
          },
          appIcon: null,
        },
      ]),
    ),
  },
  nativeImage: {
    createEmpty: () => ({
      toPNG: () => Buffer.from("mock-png"),
      toJPEG: () => Buffer.from("mock-jpeg"),
      getSize: () => ({ width: 1920, height: 1080 }),
    }),
  },
}));

const {
  DisplayHandler,
} = require("../../../src/main/remote/handlers/display-handler");

describe("DisplayHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new DisplayHandler();
  });

  afterEach(async () => {
    if (handler && handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("constructor", () => {
    it("应该使用默认选项创建处理器", () => {
      const h = new DisplayHandler();
      expect(h.options.screenshotFormat).toBe("png");
      expect(h.options.screenshotQuality).toBe(90);
      expect(h.options.maxScreenshotSize).toBe(4096);
    });

    it("应该接受自定义选项", () => {
      const h = new DisplayHandler({
        screenshotFormat: "jpeg",
        screenshotQuality: 75,
        maxScreenshotSize: 2048,
      });
      expect(h.options.screenshotFormat).toBe("jpeg");
      expect(h.options.screenshotQuality).toBe(75);
      expect(h.options.maxScreenshotSize).toBe(2048);
    });
  });

  describe("setBrightness 参数验证", () => {
    it("缺少 brightness 参数应该报错", async () => {
      await expect(
        handler.handle("setBrightness", {}, mockContext),
      ).rejects.toThrow(
        'Parameter "brightness" must be a number between 0 and 100',
      );
    });

    it("无效的 brightness 值应该报错 (>100)", async () => {
      await expect(
        handler.handle("setBrightness", { brightness: 150 }, mockContext),
      ).rejects.toThrow(
        'Parameter "brightness" must be a number between 0 and 100',
      );
    });

    it("负数 brightness 值应该报错", async () => {
      await expect(
        handler.handle("setBrightness", { brightness: -10 }, mockContext),
      ).rejects.toThrow(
        'Parameter "brightness" must be a number between 0 and 100',
      );
    });

    it("非数字 brightness 值应该报错", async () => {
      await expect(
        handler.handle("setBrightness", { brightness: "abc" }, mockContext),
      ).rejects.toThrow(
        'Parameter "brightness" must be a number between 0 and 100',
      );
    });

    // 跳过需要 execAsync mock 的测试 - 在 Windows 上会实际执行 powershell 命令
    it.skip("有效的 brightness 值应该被接受 (边界值 0)", async () => {
      const result = await handler.handle(
        "setBrightness",
        { brightness: 0 },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.brightness).toBe(0);
    });

    it.skip("有效的 brightness 值应该被接受 (边界值 100)", async () => {
      const result = await handler.handle(
        "setBrightness",
        { brightness: 100 },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.brightness).toBe(100);
    });

    it.skip("有效的 brightness 值应该被接受 (中间值 50)", async () => {
      const result = await handler.handle(
        "setBrightness",
        { brightness: 50 },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.brightness).toBe(50);
    });
  });

  describe("getBrightness", () => {
    it("应该返回亮度信息结构", async () => {
      const result = await handler.handle("getBrightness", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.platform).toBeDefined();
      expect(typeof result.platform).toBe("string");
    });
  });

  describe("getRefreshRate", () => {
    it("应该返回刷新率信息结构", async () => {
      const result = await handler.handle("getRefreshRate", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.unit).toBe("Hz");
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

  // 以下测试需要 Electron 环境，在 CI 中跳过
  describe.skip("Electron-dependent tests (需要 Electron 环境)", () => {
    describe("getDisplays", () => {
      it("应该返回显示器列表", async () => {
        const result = await handler.handle("getDisplays", {}, mockContext);

        expect(result.success).toBe(true);
        expect(Array.isArray(result.displays)).toBe(true);
        expect(result.total).toBeGreaterThan(0);
      });
    });

    describe("getPrimary", () => {
      it("应该返回主显示器信息", async () => {
        const result = await handler.handle("getPrimary", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.display).toBeDefined();
        expect(result.display.size).toBeDefined();
      });
    });

    describe("getResolution", () => {
      it("应该返回分辨率信息", async () => {
        const result = await handler.handle("getResolution", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.resolution).toBeDefined();
        expect(result.resolution.width).toBeGreaterThan(0);
        expect(result.resolution.height).toBeGreaterThan(0);
      });
    });

    describe("getScaling", () => {
      it("应该返回缩放比例", async () => {
        const result = await handler.handle("getScaling", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.scaling).toBeDefined();
        expect(result.scaling.factor).toBeGreaterThan(0);
      });
    });

    describe("getColorDepth", () => {
      it("应该返回色深", async () => {
        const result = await handler.handle("getColorDepth", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.colorDepth).toBeGreaterThan(0);
      });
    });

    describe("screenshot", () => {
      it("应该截取屏幕", async () => {
        const result = await handler.handle("screenshot", {}, mockContext);

        expect(result.success).toBe(true);
        expect(result.format).toBeDefined();
      });
    });

    describe("getWindowList", () => {
      it("应该返回窗口列表", async () => {
        const result = await handler.handle("getWindowList", {}, mockContext);

        expect(result.success).toBe(true);
        expect(Array.isArray(result.windows)).toBe(true);
      });
    });

    describe("getCursorPosition", () => {
      it("应该返回鼠标位置", async () => {
        const result = await handler.handle(
          "getCursorPosition",
          {},
          mockContext,
        );

        expect(result.success).toBe(true);
        expect(result.cursor).toBeDefined();
      });
    });
  });
});
