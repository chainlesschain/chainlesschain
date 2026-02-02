/**
 * RemoteDesktopHandler 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RemoteDesktopHandler } from "../../src/main/remote/handlers/remote-desktop-handler.js";

// Mock screenshot-desktop
vi.mock("screenshot-desktop", () => ({
  default: vi.fn(async () => Buffer.from("fake-screenshot-data")),
  listDisplays: vi.fn(async () => [
    { id: 0, name: "Display 1", width: 1920, height: 1080, primary: true },
    { id: 1, name: "Display 2", width: 1920, height: 1080, primary: false },
  ]),
}));

// Mock sharp
vi.mock("sharp", () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn(async () => ({ width: 1920, height: 1080 })),
    resize: vi.fn(() => mockSharp()),
    jpeg: vi.fn(() => mockSharp()),
    png: vi.fn(() => mockSharp()),
    toBuffer: vi.fn(async () => Buffer.from("compressed-image-data")),
  }));
  return { default: mockSharp };
});

// Mock robotjs
vi.mock("robotjs", () => ({
  moveMouse: vi.fn(),
  mouseClick: vi.fn(),
  scrollMouse: vi.fn(),
  keyTap: vi.fn(),
  keyToggle: vi.fn(),
  typeString: vi.fn(),
}));

// Mock database
function createMockDatabase() {
  const sessions = new Map();
  return {
    exec: vi.fn(),
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => {
        if (sql.includes("INSERT")) {
          sessions.set(args[0], {
            id: args[0],
            device_did: args[1],
            display_id: args[2],
            quality: args[3],
            max_fps: args[4],
            status: args[5],
            started_at: args[6],
          });
        }
        if (sql.includes("UPDATE")) {
          const id = args[args.length - 1];
          const session = sessions.get(id);
          if (session) {
            if (sql.includes("status")) {
              session.status = args[0];
            }
          }
        }
        return { changes: 1 };
      }),
      get: vi.fn((...args) => sessions.get(args[0]) || null),
      all: vi.fn(() => Array.from(sessions.values())),
    })),
    close: vi.fn(),
    _sessions: sessions,
  };
}

describe("RemoteDesktopHandler", () => {
  let handler;
  let database;

  beforeEach(() => {
    // 创建 mock 数据库
    database = createMockDatabase();

    // 创建 RemoteDesktopHandler
    handler = new RemoteDesktopHandler(database, {
      maxFps: 30,
      quality: 80,
      enableInputControl: true,
    });
  });

  afterEach(() => {
    // 清理数据库
    database.close();
  });

  describe("startSession", () => {
    it("应该成功创建远程桌面会话", async () => {
      const params = {
        displayId: 0,
        quality: 80,
        maxFps: 30,
      };

      const context = {
        did: "did:key:test123",
        peerId: "peer123",
      };

      const result = await handler.startSession(params, context);

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("quality", 80);
      expect(result).toHaveProperty("maxFps", 30);
      expect(result).toHaveProperty("captureInterval", 33); // 1000/30 ≈ 33ms
      expect(result).toHaveProperty("displays");
      expect(result.displays.length).toBeGreaterThan(0);
      expect(result).toHaveProperty("inputControlEnabled", true);

      // 验证会话已创建
      const session = handler.sessions.get(result.sessionId);
      expect(session).toBeDefined();
      expect(session.deviceDid).toBe("did:key:test123");
      expect(session.status).toBe("active");

      // 验证数据库记录已创建
      const dbSession = database
        .prepare("SELECT * FROM remote_desktop_sessions WHERE id = ?")
        .get(result.sessionId);

      expect(dbSession).toBeDefined();
      expect(dbSession.device_did).toBe("did:key:test123");
      expect(dbSession.status).toBe("active");
    });

    it("应该使用默认参数创建会话", async () => {
      const params = {};

      const context = {
        did: "did:key:test123",
        peerId: "peer123",
      };

      const result = await handler.startSession(params, context);

      expect(result.quality).toBe(80); // 默认值
      expect(result.maxFps).toBe(30); // 默认值
    });
  });

  describe("stopSession", () => {
    it("应该成功停止远程桌面会话", async () => {
      // 先创建一个会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 停止会话
      const result = await handler.stopSession(
        { sessionId },
        { did: "did:key:test123" },
      );

      expect(result.sessionId).toBe(sessionId);
      expect(result).toHaveProperty("duration");
      expect(result).toHaveProperty("frameCount", 0);
      expect(result).toHaveProperty("bytesSent", 0);

      // 验证会话已移除
      expect(handler.sessions.has(sessionId)).toBe(false);

      // 验证数据库记录已更新
      const dbSession = database
        .prepare("SELECT * FROM remote_desktop_sessions WHERE id = ?")
        .get(sessionId);

      expect(dbSession.status).toBe("stopped");
      expect(dbSession.stopped_at).toBeDefined();
    });

    it("应该拒绝不存在的会话", async () => {
      await expect(
        handler.stopSession(
          { sessionId: "invalid-session" },
          { did: "did:key:test123" },
        ),
      ).rejects.toThrow(/Session not found/);
    });

    it("应该拒绝不匹配的设备", async () => {
      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );

      // 尝试从不同的设备停止
      await expect(
        handler.stopSession(
          { sessionId: startResult.sessionId },
          { did: "did:key:other-device" },
        ),
      ).rejects.toThrow(/Permission denied.*mismatch/);
    });
  });

  describe("getFrame", () => {
    it("应该成功捕获屏幕帧", async () => {
      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 等待一点时间（避免帧率限制）
      await new Promise((resolve) => setTimeout(resolve, 40));

      // 获取屏幕帧
      const result = await handler.getFrame(
        { sessionId },
        { did: "did:key:test123" },
      );

      expect(result.sessionId).toBe(sessionId);
      expect(result).toHaveProperty("frameData"); // Base64 编码的数据
      expect(result).toHaveProperty("width");
      expect(result).toHaveProperty("height");
      expect(result).toHaveProperty("format", "jpeg");
      expect(result).toHaveProperty("size");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("captureTime");
      expect(result).toHaveProperty("encodeTime");

      // 验证会话统计已更新
      const session = handler.sessions.get(sessionId);
      expect(session.frameCount).toBe(1);
      expect(session.bytesSent).toBeGreaterThan(0);
    });

    it("应该限制帧率", async () => {
      // 创建会话（30 FPS = 33ms 间隔）
      const startResult = await handler.startSession(
        { maxFps: 30 },
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 第一帧
      await handler.getFrame({ sessionId }, { did: "did:key:test123" });

      // 立即请求第二帧（应该被拒绝）
      await expect(
        handler.getFrame({ sessionId }, { did: "did:key:test123" }),
      ).rejects.toThrow(/Frame rate limit exceeded/);
    });

    it("应该拒绝不存在的会话", async () => {
      await expect(
        handler.getFrame(
          { sessionId: "invalid-session" },
          { did: "did:key:test123" },
        ),
      ).rejects.toThrow(/Session not found/);
    });
  });

  describe("sendInput", () => {
    it("应该成功发送鼠标移动事件", async () => {
      const robot = require("robotjs");

      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 发送鼠标移动
      const result = await handler.sendInput(
        {
          sessionId,
          type: "mouse_move",
          data: { x: 100, y: 200 },
        },
        { did: "did:key:test123" },
      );

      expect(result.success).toBe(true);
      expect(robot.moveMouse).toHaveBeenCalledWith(100, 200);
    });

    it("应该成功发送鼠标点击事件", async () => {
      const robot = require("robotjs");

      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 发送鼠标点击
      const result = await handler.sendInput(
        {
          sessionId,
          type: "mouse_click",
          data: { button: "left", double: false },
        },
        { did: "did:key:test123" },
      );

      expect(result.success).toBe(true);
      expect(robot.mouseClick).toHaveBeenCalledWith("left", false);
    });

    it("应该成功发送按键事件", async () => {
      const robot = require("robotjs");

      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 发送按键（Ctrl+C）
      const result = await handler.sendInput(
        {
          sessionId,
          type: "key_press",
          data: { key: "c", modifiers: ["control"] },
        },
        { did: "did:key:test123" },
      );

      expect(result.success).toBe(true);
      expect(robot.keyToggle).toHaveBeenCalledWith("control", "down");
      expect(robot.keyTap).toHaveBeenCalledWith("c");
      expect(robot.keyToggle).toHaveBeenCalledWith("control", "up");
    });

    it("应该拒绝未知的输入类型", async () => {
      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );

      await expect(
        handler.sendInput(
          {
            sessionId: startResult.sessionId,
            type: "unknown_type",
            data: {},
          },
          { did: "did:key:test123" },
        ),
      ).rejects.toThrow(/Unknown input type/);
    });
  });

  describe("getDisplays", () => {
    it("应该成功获取显示器列表", async () => {
      const result = await handler.getDisplays({}, { did: "did:key:test123" });

      expect(result).toHaveProperty("displays");
      expect(result).toHaveProperty("count");
      expect(result.displays.length).toBeGreaterThan(0);
      expect(result.count).toBe(result.displays.length);

      // 验证显示器信息
      const firstDisplay = result.displays[0];
      expect(firstDisplay).toHaveProperty("id");
      expect(firstDisplay).toHaveProperty("name");
      expect(firstDisplay).toHaveProperty("primary");
    });
  });

  describe("switchDisplay", () => {
    it("应该成功切换显示器", async () => {
      // 创建会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 切换到显示器 1
      const result = await handler.switchDisplay(
        { sessionId, displayId: 1 },
        { did: "did:key:test123" },
      );

      expect(result.sessionId).toBe(sessionId);
      expect(result.displayId).toBe(1);

      // 验证会话已更新
      const session = handler.sessions.get(sessionId);
      expect(session.displayId).toBe(1);
    });

    it("应该拒绝不存在的会话", async () => {
      await expect(
        handler.switchDisplay(
          { sessionId: "invalid-session", displayId: 1 },
          { did: "did:key:test123" },
        ),
      ).rejects.toThrow(/Session not found/);
    });
  });

  describe("getStats", () => {
    it("应该返回性能统计", async () => {
      const result = await handler.getStats({}, { did: "did:key:test123" });

      expect(result).toHaveProperty("totalFrames");
      expect(result).toHaveProperty("totalBytes");
      expect(result).toHaveProperty("avgFrameSize");
      expect(result).toHaveProperty("avgCaptureTime");
      expect(result).toHaveProperty("avgEncodeTime");
      expect(result).toHaveProperty("activeSessions");
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("应该清理过期的会话", async () => {
      // 创建一个会话
      const startResult = await handler.startSession(
        {},
        { did: "did:key:test123" },
      );
      const sessionId = startResult.sessionId;

      // 手动设置为过期（修改开始时间）
      const session = handler.sessions.get(sessionId);
      session.startedAt = Date.now() - 2 * 60 * 60 * 1000; // 2小时前

      // 清理过期会话（超过1小时）
      const cleaned = await handler.cleanupExpiredSessions(60 * 60 * 1000);

      expect(cleaned).toBe(1);
      expect(handler.sessions.has(sessionId)).toBe(false);

      // 验证数据库记录已更新
      const dbSession = database
        .prepare("SELECT * FROM remote_desktop_sessions WHERE id = ?")
        .get(sessionId);

      expect(dbSession.status).toBe("expired");
    });
  });
});
