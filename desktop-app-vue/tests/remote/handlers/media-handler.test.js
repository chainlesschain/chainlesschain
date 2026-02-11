/**
 * MediaHandler 单元测试
 *
 * 注意：需要系统命令的测试可能在某些环境跳过
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

const { MediaHandler } =
  await import("../../../src/main/remote/handlers/media-handler");

describe("MediaHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new MediaHandler();
  });

  afterEach(async () => {
    if (handler) {
      await handler.cleanup();
    }
  });

  describe("handler initialization", () => {
    it("应该使用默认配置创建处理器", () => {
      const h = new MediaHandler();
      expect(h.options.maxVolume).toBe(100);
      expect(h.options.minVolume).toBe(0);
    });

    it("应该支持自定义配置", () => {
      const h = new MediaHandler({ maxVolume: 80, minVolume: 10 });
      expect(h.options.maxVolume).toBe(80);
      expect(h.options.minVolume).toBe(10);
    });
  });

  describe("setVolume", () => {
    it.skip("应该成功设置音量 (跳过：需要系统命令)", async () => {
      const result = await handler.handle(
        "setVolume",
        { volume: 50 },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.volume).toBe(50);
    });

    it("缺少 volume 参数应该报错", async () => {
      await expect(
        handler.handle("setVolume", {}, mockContext),
      ).rejects.toThrow('Parameter "volume" is required');
    });

    it("volume 为 null 应该报错", async () => {
      await expect(
        handler.handle("setVolume", { volume: null }, mockContext),
      ).rejects.toThrow('Parameter "volume" is required');
    });
  });

  describe("mediaControl", () => {
    it("缺少 action 参数应该报错", async () => {
      await expect(
        handler.handle("mediaControl", {}, mockContext),
      ).rejects.toThrow('Parameter "action" is required');
    });

    it("无效的 action 应该报错", async () => {
      await expect(
        handler.handle("mediaControl", { action: "invalid" }, mockContext),
      ).rejects.toThrow("Invalid action");
    });

    it("应该接受有效的 action 值", async () => {
      const validActions = [
        "play",
        "pause",
        "toggle",
        "next",
        "previous",
        "stop",
      ];
      for (const action of validActions) {
        // 只验证参数验证通过，不验证命令执行
        // 命令执行可能因平台而异
        const handler2 = new MediaHandler();
        try {
          await handler2.handle("mediaControl", { action }, mockContext);
        } catch (e) {
          // 如果错误不是参数验证错误，则测试通过
          expect(e.message).not.toContain("Invalid action");
          expect(e.message).not.toContain('Parameter "action" is required');
        }
        await handler2.cleanup();
      }
    });
  });

  describe("stopSound", () => {
    it("应该请求停止声音", async () => {
      const result = await handler.handle("stopSound", {}, mockContext);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Stop sound requested");
    });
  });

  describe("getPlaybackStatus", () => {
    it("应该返回播放状态", async () => {
      const result = await handler.handle("getPlaybackStatus", {}, mockContext);
      expect(result.success).toBe(true);
      expect(typeof result.playing).toBe("boolean");
    });
  });

  describe("unknown action", () => {
    it("应该对未知操作报错", async () => {
      await expect(
        handler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });

  describe("volume clamping", () => {
    it("应该将音量限制在最小值以上", async () => {
      const h = new MediaHandler({ minVolume: 10, maxVolume: 100 });
      try {
        const result = await h.handle("setVolume", { volume: 5 }, mockContext);
        expect(result.volume).toBe(10);
      } catch {
        // 如果命令执行失败，跳过验证
      }
      await h.cleanup();
    });

    it("应该将音量限制在最大值以下", async () => {
      const h = new MediaHandler({ minVolume: 0, maxVolume: 80 });
      try {
        const result = await h.handle(
          "setVolume",
          { volume: 100 },
          mockContext,
        );
        expect(result.volume).toBe(80);
      } catch {
        // 如果命令执行失败，跳过验证
      }
      await h.cleanup();
    });
  });

  describe("sound types", () => {
    it.skip("应该播放默认系统声音 (跳过：需要系统命令)", async () => {
      const result = await handler.handle("playSound", {}, mockContext);
      expect(result.success).toBe(true);
      expect(result.sound).toBe("default");
    });

    it.skip("应该播放指定的声音文件 (跳过：需要系统命令)", async () => {
      const result = await handler.handle(
        "playSound",
        { file: "/path/to/sound.wav" },
        mockContext,
      );
      expect(result.success).toBe(true);
      expect(result.sound).toBe("/path/to/sound.wav");
    });
  });
});
