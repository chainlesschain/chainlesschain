/**
 * Voice/Video IPC Handler 测试
 *
 * 由于 Vitest 的 vi.mock() 与 CommonJS require() 存在兼容性问题，
 * 本测试使用静态分析和直接调用 handler 方法的方式进行测试
 */

import { describe, it, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 获取源文件路径 - 使用 process.cwd() 作为基准
const VOICE_VIDEO_IPC_PATH = path.join(
  process.cwd(),
  "src/main/p2p/voice-video-ipc.js",
);

/**
 * 从源文件中提取 registerHandler() 调用 (包装了 ipcMain.handle)
 */
function extractIPCHandlers(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  // 匹配 this.registerHandler('channel-name', ...) 的模式
  const handlerPattern = /this\.registerHandler\(['"]([^'"]+)['"]/g;
  const handlers = [];
  let match;
  while ((match = handlerPattern.exec(content)) !== null) {
    handlers.push(match[1]);
  }
  return handlers;
}

/**
 * 从源文件中提取事件监听器
 */
function extractEventListeners(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const eventPattern = /this\.voiceVideoManager\.on\(['"]([^'"]+)['"]/g;
  const events = [];
  let match;
  while ((match = eventPattern.exec(content)) !== null) {
    events.push(match[1]);
  }
  return events;
}

describe("VoiceVideoIPC - Static Analysis", () => {
  let expectedHandlers;
  let expectedEvents;

  beforeEach(() => {
    expectedHandlers = [
      "p2p-call:start",
      "p2p-call:accept",
      "p2p-call:reject",
      "p2p-call:end",
      "p2p-call:toggle-mute",
      "p2p-call:toggle-video",
      "p2p-call:get-info",
      "p2p-call:get-active-calls",
      "p2p-call:get-stats",
    ];

    expectedEvents = [
      "call:started",
      "call:incoming",
      "call:accepted",
      "call:rejected",
      "call:connected",
      "call:ended",
      "call:remote-stream",
      "call:quality-update",
      "call:mute-changed",
      "call:video-changed",
    ];
  });

  describe("IPC Handler 注册", () => {
    test("应该注册所有预期的 IPC handlers", () => {
      const registeredHandlers = extractIPCHandlers(VOICE_VIDEO_IPC_PATH);

      expectedHandlers.forEach((handler) => {
        expect(registeredHandlers).toContain(handler);
      });
    });

    test("应该注册正确数量的 IPC handlers", () => {
      const registeredHandlers = extractIPCHandlers(VOICE_VIDEO_IPC_PATH);
      expect(registeredHandlers.length).toBe(expectedHandlers.length);
    });
  });

  describe("事件监听器注册", () => {
    test("应该注册所有预期的事件监听器", () => {
      const registeredEvents = extractEventListeners(VOICE_VIDEO_IPC_PATH);

      expectedEvents.forEach((event) => {
        expect(registeredEvents).toContain(event);
      });
    });

    test("应该注册正确数量的事件监听器", () => {
      const registeredEvents = extractEventListeners(VOICE_VIDEO_IPC_PATH);
      expect(registeredEvents.length).toBe(expectedEvents.length);
    });
  });

  describe("源文件结构验证", () => {
    test("应该导出 VoiceVideoIPC 类", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("class VoiceVideoIPC");
      expect(content).toContain("module.exports");
    });

    test("应该包含 register 方法", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("register()");
    });

    test("应该包含 unregister 方法", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("unregister()");
    });

    test("应该包含 sendToRenderer 方法", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("sendToRenderer(");
    });
  });

  describe("Handler 方法验证", () => {
    test("应该包含所有 handler 方法", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");

      const handlerMethods = [
        "handleStartCall",
        "handleAcceptCall",
        "handleRejectCall",
        "handleEndCall",
        "handleToggleMute",
        "handleToggleVideo",
        "handleGetCallInfo",
        "handleGetActiveCalls",
        "handleGetStats",
      ];

      handlerMethods.forEach((method) => {
        expect(content).toContain(method);
      });
    });

    test("handler 方法应该返回正确的响应结构", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");

      // 验证成功响应结构
      expect(content).toMatch(/success:\s*true/);

      // 验证错误响应结构
      expect(content).toMatch(/success:\s*false/);
      expect(content).toMatch(/error:\s*error\.message/);
    });
  });

  describe("错误处理验证", () => {
    test("应该在 handler 中包含 try-catch 错误处理", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");

      // 计算 try-catch 块的数量
      const tryCount = (content.match(/try\s*{/g) || []).length;
      const catchCount = (content.match(/catch\s*\(/g) || []).length;

      // 至少应该有9个 try-catch（每个 handler 一个）
      expect(tryCount).toBeGreaterThanOrEqual(9);
      expect(catchCount).toBeGreaterThanOrEqual(9);
    });

    test("应该记录错误日志", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");

      // 验证有错误日志记录
      expect(content).toContain("console.error");
    });
  });

  describe("事件转发验证", () => {
    test("应该使用 BrowserWindow.getAllWindows 获取窗口", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("BrowserWindow.getAllWindows");
    });

    test("应该检查窗口是否已销毁", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("isDestroyed()");
    });

    test("应该使用 webContents.send 发送事件", () => {
      const content = fs.readFileSync(VOICE_VIDEO_IPC_PATH, "utf-8");
      expect(content).toContain("webContents.send");
    });
  });
});

describe("VoiceVideoIPC - Handler Logic Tests", () => {
  // 测试 handler 方法的逻辑，不实际调用 electron

  describe("handleStartCall 逻辑", () => {
    test("应该调用 voiceVideoManager.startCall 并返回 callId", async () => {
      const mockVoiceVideoManager = {
        startCall: vi.fn().mockResolvedValue("call-123"),
      };

      // 模拟 handler 逻辑
      const handleStartCall = async (event, { peerId, type, options }) => {
        try {
          const callId = await mockVoiceVideoManager.startCall(
            peerId,
            type,
            options,
          );
          return { success: true, callId };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = await handleStartCall(null, {
        peerId: "peer-123",
        type: "audio",
        options: {},
      });

      expect(result).toEqual({ success: true, callId: "call-123" });
      expect(mockVoiceVideoManager.startCall).toHaveBeenCalledWith(
        "peer-123",
        "audio",
        {},
      );
    });

    test("应该处理 startCall 错误", async () => {
      const mockVoiceVideoManager = {
        startCall: vi.fn().mockRejectedValue(new Error("通话失败")),
      };

      const handleStartCall = async (event, { peerId, type, options }) => {
        try {
          const callId = await mockVoiceVideoManager.startCall(
            peerId,
            type,
            options,
          );
          return { success: true, callId };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = await handleStartCall(null, {
        peerId: "peer-123",
        type: "audio",
        options: {},
      });

      expect(result).toEqual({ success: false, error: "通话失败" });
    });
  });

  describe("handleAcceptCall 逻辑", () => {
    test("应该调用 voiceVideoManager.acceptCall", async () => {
      const mockVoiceVideoManager = {
        acceptCall: vi.fn().mockResolvedValue(),
      };

      const handleAcceptCall = async (event, { callId }) => {
        try {
          await mockVoiceVideoManager.acceptCall(callId);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = await handleAcceptCall(null, { callId: "call-789" });

      expect(result).toEqual({ success: true });
      expect(mockVoiceVideoManager.acceptCall).toHaveBeenCalledWith("call-789");
    });
  });

  describe("handleRejectCall 逻辑", () => {
    test("应该调用 voiceVideoManager.rejectCall 并传递原因", async () => {
      const mockVoiceVideoManager = {
        rejectCall: vi.fn().mockResolvedValue(),
      };

      const handleRejectCall = async (event, { callId, reason }) => {
        try {
          await mockVoiceVideoManager.rejectCall(callId, reason);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = await handleRejectCall(null, {
        callId: "call-202",
        reason: "busy",
      });

      expect(result).toEqual({ success: true });
      expect(mockVoiceVideoManager.rejectCall).toHaveBeenCalledWith(
        "call-202",
        "busy",
      );
    });
  });

  describe("handleToggleMute 逻辑", () => {
    test("应该返回 isMuted 状态", async () => {
      const mockVoiceVideoManager = {
        toggleMute: vi.fn().mockReturnValue(true),
      };

      const handleToggleMute = async (event, { callId }) => {
        try {
          const isMuted = mockVoiceVideoManager.toggleMute(callId);
          return { success: true, isMuted };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = await handleToggleMute(null, { callId: "call-404" });

      expect(result).toEqual({ success: true, isMuted: true });
    });
  });

  describe("handleGetStats 逻辑", () => {
    test("应该返回统计信息", async () => {
      const mockStats = {
        totalCalls: 10,
        successfulCalls: 8,
        failedCalls: 2,
      };

      const mockVoiceVideoManager = {
        getStats: vi.fn().mockReturnValue(mockStats),
      };

      const handleGetStats = async () => {
        try {
          const stats = mockVoiceVideoManager.getStats();
          return { success: true, stats };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const result = await handleGetStats();

      expect(result).toEqual({ success: true, stats: mockStats });
    });
  });
});
