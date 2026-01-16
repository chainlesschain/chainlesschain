/**
 * P2P Enhanced Manager 集成测试 - 包含语音/视频功能
 */

import { describe, it, expect, beforeEach, afterEach, vi, test } from "vitest";
import EventEmitter from "events";

// Mock dependencies
vi.mock("../../../src/main/p2p/message-manager");
vi.mock("../../../src/main/p2p/knowledge-sync-manager");
vi.mock("../../../src/main/p2p/file-transfer-manager");
vi.mock("../../../src/main/p2p/voice-video-manager");

const P2PEnhancedManager =
  (await import("../../../src/main/p2p/p2p-enhanced-manager")).default ||
  (await import("../../../src/main/p2p/p2p-enhanced-manager"));
const { CallType } = await import("../../../src/main/p2p/voice-video-manager");

describe("P2PEnhancedManager - Voice/Video Integration", () => {
  let enhancedManager;
  let mockP2PManager;
  let mockDatabase;

  beforeEach(async () => {
    // 创建模拟的P2P管理器
    mockP2PManager = new EventEmitter();
    mockP2PManager.node = {
      handle: vi.fn(),
      dialProtocol: vi.fn().mockResolvedValue({
        sink: vi.fn().mockResolvedValue(),
        close: vi.fn().mockResolvedValue(),
      }),
    };
    mockP2PManager.sendMessage = vi.fn().mockResolvedValue();

    // 创建模拟的数据库
    mockDatabase = {
      getAllSettings: vi.fn().mockResolvedValue({}),
      getNote: vi.fn(),
      updateNote: vi.fn(),
    };

    // 创建增强管理器
    enhancedManager = new P2PEnhancedManager(mockP2PManager, mockDatabase, {
      callTimeout: 1000,
      qualityCheckInterval: 500,
    });

    await enhancedManager.initialize();
  });

  afterEach(async () => {
    await enhancedManager.stop();
  });

  describe("语音/视频通话集成", () => {
    test("应该能够发起语音通话", async () => {
      const peerId = "peer-audio-123";

      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      expect(callId).toBeTruthy();
      expect(enhancedManager.stats.totalCalls).toBe(1);
      expect(enhancedManager.voiceVideoManager.startCall).toHaveBeenCalledWith(
        peerId,
        CallType.AUDIO,
        {},
      );
    });

    test("应该能够发起视频通话", async () => {
      const peerId = "peer-video-456";

      const callId = await enhancedManager.startCall(peerId, CallType.VIDEO, {
        videoConstraints: { width: 1920, height: 1080 },
      });

      expect(callId).toBeTruthy();
      expect(enhancedManager.voiceVideoManager.startCall).toHaveBeenCalledWith(
        peerId,
        CallType.VIDEO,
        { videoConstraints: { width: 1920, height: 1080 } },
      );
    });

    test("应该能够接受通话", async () => {
      const callId = "call-accept-789";

      await enhancedManager.acceptCall(callId);

      expect(enhancedManager.voiceVideoManager.acceptCall).toHaveBeenCalledWith(
        callId,
      );
    });

    test("应该能够拒绝通话", async () => {
      const callId = "call-reject-101";
      const reason = "busy";

      await enhancedManager.rejectCall(callId, reason);

      expect(enhancedManager.voiceVideoManager.rejectCall).toHaveBeenCalledWith(
        callId,
        reason,
      );
    });

    test("应该能够结束通话", async () => {
      const callId = "call-end-202";

      await enhancedManager.endCall(callId);

      expect(enhancedManager.voiceVideoManager.endCall).toHaveBeenCalledWith(
        callId,
      );
    });

    test("应该能够切换静音", () => {
      const callId = "call-mute-303";

      enhancedManager.voiceVideoManager.toggleMute.mockReturnValue(true);

      const isMuted = enhancedManager.toggleMute(callId);

      expect(isMuted).toBe(true);
      expect(enhancedManager.voiceVideoManager.toggleMute).toHaveBeenCalledWith(
        callId,
      );
    });

    test("应该能够切换视频", () => {
      const callId = "call-video-404";

      enhancedManager.voiceVideoManager.toggleVideo.mockReturnValue(false);

      const isVideoEnabled = enhancedManager.toggleVideo(callId);

      expect(isVideoEnabled).toBe(false);
      expect(
        enhancedManager.voiceVideoManager.toggleVideo,
      ).toHaveBeenCalledWith(callId);
    });

    test("应该能够获取通话信息", () => {
      const callId = "call-info-505";
      const mockInfo = {
        callId,
        peerId: "peer-505",
        type: CallType.AUDIO,
        state: "connected",
        duration: 120,
      };

      enhancedManager.voiceVideoManager.getCallInfo.mockReturnValue(mockInfo);

      const info = enhancedManager.getCallInfo(callId);

      expect(info).toEqual(mockInfo);
      expect(
        enhancedManager.voiceVideoManager.getCallInfo,
      ).toHaveBeenCalledWith(callId);
    });

    test("应该能够获取活动通话列表", () => {
      const mockCalls = [
        { callId: "call-1", peerId: "peer-1", type: CallType.AUDIO },
        { callId: "call-2", peerId: "peer-2", type: CallType.VIDEO },
      ];

      enhancedManager.voiceVideoManager.getActiveCalls.mockReturnValue(
        mockCalls,
      );

      const calls = enhancedManager.getActiveCalls();

      expect(calls).toEqual(mockCalls);
      expect(calls).toHaveLength(2);
    });
  });

  describe("事件转发", () => {
    test("应该转发call:started事件", () =>
      new Promise((done) => {
        const eventData = {
          callId: "call-started-606",
          peerId: "peer-606",
          type: CallType.AUDIO,
        };

        enhancedManager.on("call:started", (data) => {
          expect(data).toEqual(eventData);
          done();
        });

        enhancedManager.voiceVideoManager.emit("call:started", eventData);
      }));

    test("应该转发call:incoming事件", () =>
      new Promise((done) => {
        const eventData = {
          callId: "call-incoming-707",
          peerId: "peer-707",
          type: CallType.VIDEO,
        };

        enhancedManager.on("call:incoming", (data) => {
          expect(data).toEqual(eventData);
          done();
        });

        enhancedManager.voiceVideoManager.emit("call:incoming", eventData);
      }));

    test("应该转发call:connected事件", () =>
      new Promise((done) => {
        const eventData = {
          callId: "call-connected-808",
          peerId: "peer-808",
        };

        enhancedManager.on("call:connected", (data) => {
          expect(data).toEqual(eventData);
          done();
        });

        enhancedManager.voiceVideoManager.emit("call:connected", eventData);
      }));

    test("应该转发call:ended事件", () =>
      new Promise((done) => {
        const eventData = {
          callId: "call-ended-909",
          peerId: "peer-909",
        };

        enhancedManager.on("call:ended", (data) => {
          expect(data).toEqual(eventData);
          done();
        });

        enhancedManager.voiceVideoManager.emit("call:ended", eventData);
      }));

    test("应该转发call:quality-update事件", () =>
      new Promise((done) => {
        const eventData = {
          callId: "call-quality-1010",
          stats: {
            bytesReceived: 1024,
            bytesSent: 2048,
            packetsLost: 5,
            jitter: 0.02,
            roundTripTime: 0.05,
          },
        };

        enhancedManager.on("call:quality-update", (data) => {
          expect(data).toEqual(eventData);
          done();
        });

        enhancedManager.voiceVideoManager.emit(
          "call:quality-update",
          eventData,
        );
      }));
  });

  describe("统计信息", () => {
    test("应该包含语音/视频统计信息", () => {
      const mockVoiceVideoStats = {
        totalCalls: 10,
        successfulCalls: 8,
        failedCalls: 2,
        totalDuration: 3600,
        audioCallsCount: 6,
        videoCallsCount: 4,
        activeCalls: 2,
      };

      enhancedManager.voiceVideoManager.getStats.mockReturnValue(
        mockVoiceVideoStats,
      );

      const stats = enhancedManager.getStats();

      expect(stats.voiceVideoManager).toEqual(mockVoiceVideoStats);
      expect(stats.totalCalls).toBeDefined();
    });

    test("应该正确累计通话次数", async () => {
      const peerId1 = "peer-stats-1";
      const peerId2 = "peer-stats-2";

      await enhancedManager.startCall(peerId1, CallType.AUDIO);
      await enhancedManager.startCall(peerId2, CallType.VIDEO);

      expect(enhancedManager.stats.totalCalls).toBe(2);
    });
  });

  describe("错误处理", () => {
    test("应该在未初始化时拒绝发起通话", async () => {
      const uninitializedManager = new P2PEnhancedManager(
        mockP2PManager,
        mockDatabase,
      );

      await expect(
        uninitializedManager.startCall("peer-123", CallType.AUDIO),
      ).rejects.toThrow("增强管理器未初始化");
    });

    test("应该在未初始化时拒绝接受通话", async () => {
      const uninitializedManager = new P2PEnhancedManager(
        mockP2PManager,
        mockDatabase,
      );

      await expect(uninitializedManager.acceptCall("call-123")).rejects.toThrow(
        "增强管理器未初始化",
      );
    });

    test("应该处理通话管理器错误", async () => {
      const error = new Error("通话失败");
      enhancedManager.voiceVideoManager.startCall.mockRejectedValue(error);

      await expect(
        enhancedManager.startCall("peer-error", CallType.AUDIO),
      ).rejects.toThrow("通话失败");
    });
  });

  describe("资源清理", () => {
    test("应该在停止时清理语音/视频资源", async () => {
      await enhancedManager.stop();

      expect(enhancedManager.voiceVideoManager.cleanup).toHaveBeenCalled();
    });

    test("应该能够安全地多次停止", async () => {
      await enhancedManager.stop();
      await enhancedManager.stop();

      // 不应该抛出错误
      expect(enhancedManager.isRunning).toBe(false);
    });
  });

  describe("并发通话", () => {
    test("应该支持多个并发通话", async () => {
      const peerId1 = "peer-concurrent-1";
      const peerId2 = "peer-concurrent-2";
      const peerId3 = "peer-concurrent-3";

      const mockCalls = [
        { callId: "call-1", peerId: peerId1, type: CallType.AUDIO },
        { callId: "call-2", peerId: peerId2, type: CallType.VIDEO },
        { callId: "call-3", peerId: peerId3, type: CallType.AUDIO },
      ];

      enhancedManager.voiceVideoManager.getActiveCalls.mockReturnValue(
        mockCalls,
      );

      await enhancedManager.startCall(peerId1, CallType.AUDIO);
      await enhancedManager.startCall(peerId2, CallType.VIDEO);
      await enhancedManager.startCall(peerId3, CallType.AUDIO);

      const activeCalls = enhancedManager.getActiveCalls();

      expect(activeCalls).toHaveLength(3);
      expect(enhancedManager.stats.totalCalls).toBe(3);
    });
  });

  describe("与其他功能的集成", () => {
    test("应该能够同时进行消息传输和通话", async () => {
      const peerId = "peer-multi-feature";

      // 发送消息
      await enhancedManager.sendMessage(peerId, {
        type: "text",
        content: "Hello",
      });

      // 发起通话
      await enhancedManager.startCall(peerId, CallType.AUDIO);

      expect(enhancedManager.messageManager.sendMessage).toHaveBeenCalled();
      expect(enhancedManager.voiceVideoManager.startCall).toHaveBeenCalled();
    });

    test("应该能够在通话期间传输文件", async () => {
      const peerId = "peer-file-call";
      const filePath = "/path/to/file.pdf";

      // 发起通话
      await enhancedManager.startCall(peerId, CallType.VIDEO);

      // 传输文件
      await enhancedManager.uploadFile(peerId, filePath);

      expect(enhancedManager.voiceVideoManager.startCall).toHaveBeenCalled();
      expect(enhancedManager.fileTransferManager.uploadFile).toHaveBeenCalled();
    });
  });
});
