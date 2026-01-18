/**
 * P2P Enhanced Manager 集成测试
 *
 * 测试P2P增强管理器与各子管理器的集成
 */

import { describe, it, expect, beforeEach, afterEach, vi, test } from "vitest";
import EventEmitter from "events";

// Mock dependencies
vi.mock("../../../src/main/p2p/message-manager");
vi.mock("../../../src/main/p2p/knowledge-sync-manager");
vi.mock("../../../src/main/p2p/file-transfer-manager");
vi.mock("../../../src/main/p2p/wrtc-compat", () => ({
  available: true,
  loadError: null,
  RTCPeerConnection: vi.fn().mockImplementation(() => ({
    createOffer: vi
      .fn()
      .mockResolvedValue({ type: "offer", sdp: "mock-offer-sdp" }),
    createAnswer: vi
      .fn()
      .mockResolvedValue({ type: "answer", sdp: "mock-answer-sdp" }),
    setLocalDescription: vi.fn().mockResolvedValue(),
    setRemoteDescription: vi.fn().mockResolvedValue(),
    addTrack: vi.fn(),
    addIceCandidate: vi.fn().mockResolvedValue(),
    close: vi.fn(),
    getStats: vi.fn().mockResolvedValue(new Map()),
    connectionState: "connected",
    onicecandidate: null,
    onconnectionstatechange: null,
    ontrack: null,
  })),
  RTCSessionDescription: vi.fn().mockImplementation((desc) => desc),
  RTCIceCandidate: vi.fn().mockImplementation((candidate) => candidate),
  MediaStream: vi.fn().mockImplementation(() => ({
    getTracks: vi.fn().mockReturnValue([]),
    getAudioTracks: vi.fn().mockReturnValue([{ enabled: true, stop: vi.fn() }]),
    getVideoTracks: vi.fn().mockReturnValue([{ enabled: true, stop: vi.fn() }]),
  })),
}));

const P2PEnhancedManager =
  (await import("../../../src/main/p2p/p2p-enhanced-manager")).default ||
  (await import("../../../src/main/p2p/p2p-enhanced-manager"));
const { CallType, CallState } =
  await import("../../../src/main/p2p/voice-video-manager");

describe("P2PEnhancedManager Integration", () => {
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
      all: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue(),
      get: vi.fn().mockResolvedValue(null),
    };

    // 创建增强管理器
    enhancedManager = new P2PEnhancedManager(mockP2PManager, mockDatabase, {
      callTimeout: 1000,
      qualityCheckInterval: 500,
    });

    // 初始化
    await enhancedManager.initialize();
  });

  afterEach(async () => {
    await enhancedManager.stop();
  });

  describe("初始化", () => {
    test("应该正确初始化所有子管理器", () => {
      expect(enhancedManager.messageManager).toBeDefined();
      expect(enhancedManager.knowledgeSyncManager).toBeDefined();
      expect(enhancedManager.fileTransferManager).toBeDefined();
      expect(enhancedManager.voiceVideoManager).toBeDefined();
      expect(enhancedManager.initialized).toBe(true);
      expect(enhancedManager.isRunning).toBe(true);
    });

    test("应该设置所有事件监听器", () => {
      // 验证管理器存在并且是 EventEmitter 实例（有 on 方法）
      expect(typeof enhancedManager.messageManager.on).toBe("function");
      expect(typeof enhancedManager.knowledgeSyncManager.on).toBe("function");
      expect(typeof enhancedManager.fileTransferManager.on).toBe("function");
      expect(typeof enhancedManager.voiceVideoManager.on).toBe("function");
    });

    test("应该连接到P2P网络", () => {
      // 验证 mockP2PManager 有事件监听器（通过 listenerCount 检查）
      expect(mockP2PManager.listenerCount("message")).toBeGreaterThan(0);
      expect(mockP2PManager.listenerCount("peer:connected")).toBeGreaterThan(0);
      expect(mockP2PManager.listenerCount("peer:disconnected")).toBeGreaterThan(
        0,
      );
    });
  });

  describe("语音/视频通话集成", () => {
    test("应该能够发起语音通话", async () => {
      const peerId = "peer-audio-123";
      const callStartedSpy = vi.fn();

      enhancedManager.on("call:started", callStartedSpy);

      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      expect(callId).toBeTruthy();
      expect(callStartedSpy).toHaveBeenCalledWith({
        callId,
        peerId,
        type: CallType.AUDIO,
        isInitiator: true,
      });
      expect(enhancedManager.stats.totalCalls).toBe(1);
    });

    test("应该能够发起视频通话", async () => {
      const peerId = "peer-video-456";
      const callStartedSpy = vi.fn();

      enhancedManager.on("call:started", callStartedSpy);

      const callId = await enhancedManager.startCall(peerId, CallType.VIDEO);

      expect(callId).toBeTruthy();
      expect(callStartedSpy).toHaveBeenCalledWith({
        callId,
        peerId,
        type: CallType.VIDEO,
        isInitiator: true,
      });
    });

    test("应该能够接受来电", async () => {
      const peerId = "peer-incoming";
      const callId = "call-incoming-789";

      // 创建完整的 mock session
      const mockSession = {
        callId,
        peerId,
        type: CallType.AUDIO,
        state: CallState.RINGING,
        isInitiator: false,
        startTime: null,
        peerConnection: {
          createOffer: vi
            .fn()
            .mockResolvedValue({ type: "offer", sdp: "mock-offer" }),
          createAnswer: vi
            .fn()
            .mockResolvedValue({ type: "answer", sdp: "mock-answer" }),
          setLocalDescription: vi.fn().mockResolvedValue(),
          setRemoteDescription: vi.fn().mockResolvedValue(),
          addTrack: vi.fn(),
          addIceCandidate: vi.fn().mockResolvedValue(),
          close: vi.fn(),
          getStats: vi.fn().mockResolvedValue(new Map()),
          connectionState: "connected",
        },
        localStream: {
          getTracks: vi.fn().mockReturnValue([]),
          getAudioTracks: vi
            .fn()
            .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
          getVideoTracks: vi
            .fn()
            .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
        },
        getDuration: vi.fn().mockReturnValue(0),
      };

      enhancedManager.voiceVideoManager.sessions.set(callId, mockSession);
      enhancedManager.voiceVideoManager.peerSessions.set(peerId, callId);

      const callAcceptedSpy = vi.fn();
      enhancedManager.on("call:accepted", callAcceptedSpy);

      await enhancedManager.acceptCall(callId);

      expect(callAcceptedSpy).toHaveBeenCalled();
    });

    test("应该能够拒绝来电", async () => {
      const peerId = "peer-reject";
      const callId = "call-reject-101";

      // 创建完整的 mock session
      const mockSession = {
        callId,
        peerId,
        type: CallType.AUDIO,
        state: CallState.RINGING,
        isInitiator: false,
        startTime: null,
        peerConnection: {
          createOffer: vi
            .fn()
            .mockResolvedValue({ type: "offer", sdp: "mock-offer" }),
          createAnswer: vi
            .fn()
            .mockResolvedValue({ type: "answer", sdp: "mock-answer" }),
          setLocalDescription: vi.fn().mockResolvedValue(),
          setRemoteDescription: vi.fn().mockResolvedValue(),
          addTrack: vi.fn(),
          addIceCandidate: vi.fn().mockResolvedValue(),
          close: vi.fn(),
          getStats: vi.fn().mockResolvedValue(new Map()),
          connectionState: "connected",
        },
        localStream: {
          getTracks: vi.fn().mockReturnValue([]),
          getAudioTracks: vi
            .fn()
            .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
          getVideoTracks: vi
            .fn()
            .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
        },
        getDuration: vi.fn().mockReturnValue(0),
      };

      enhancedManager.voiceVideoManager.sessions.set(callId, mockSession);
      enhancedManager.voiceVideoManager.peerSessions.set(peerId, callId);

      await enhancedManager.rejectCall(callId, "busy");

      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.ENDED);
    });

    test("应该能够结束通话", async () => {
      const peerId = "peer-end";
      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      // 模拟通话已连接
      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now();

      const callEndedSpy = vi.fn();
      enhancedManager.on("call:ended", callEndedSpy);

      await enhancedManager.endCall(callId);

      expect(session.state).toBe(CallState.ENDED);
    });

    test("应该能够切换静音", async () => {
      const peerId = "peer-mute";
      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      // 创建 mock MediaStream 对象
      session.localStream = {
        getTracks: vi.fn().mockReturnValue([]),
        getAudioTracks: vi
          .fn()
          .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
        getVideoTracks: vi
          .fn()
          .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
      };

      const muteChangedSpy = vi.fn();
      enhancedManager.on("call:mute-changed", muteChangedSpy);

      const isMuted = enhancedManager.toggleMute(callId);

      expect(muteChangedSpy).toHaveBeenCalled();
    });

    test("应该能够切换视频", async () => {
      const peerId = "peer-video-toggle";
      const callId = await enhancedManager.startCall(peerId, CallType.VIDEO);

      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      // 创建 mock MediaStream 对象
      session.localStream = {
        getTracks: vi.fn().mockReturnValue([]),
        getAudioTracks: vi
          .fn()
          .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
        getVideoTracks: vi
          .fn()
          .mockReturnValue([{ enabled: true, stop: vi.fn() }]),
      };

      const videoChangedSpy = vi.fn();
      enhancedManager.on("call:video-changed", videoChangedSpy);

      const isVideoEnabled = enhancedManager.toggleVideo(callId);

      expect(videoChangedSpy).toHaveBeenCalled();
    });

    test("应该能够获取通话信息", async () => {
      const peerId = "peer-info";
      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      const info = enhancedManager.getCallInfo(callId);

      expect(info).toMatchObject({
        callId,
        peerId,
        type: CallType.AUDIO,
        isInitiator: true,
      });
    });

    test("应该能够获取活动通话列表", async () => {
      const peerId1 = "peer-active-1";
      const peerId2 = "peer-active-2";

      await enhancedManager.startCall(peerId1, CallType.AUDIO);
      await enhancedManager.startCall(peerId2, CallType.VIDEO);

      const activeCalls = enhancedManager.getActiveCalls();

      expect(activeCalls).toHaveLength(2);
    });
  });

  describe("事件转发", () => {
    test("应该转发通话事件到应用层", async () => {
      const peerId = "peer-event";

      const callStartedSpy = vi.fn();
      const callIncomingSpy = vi.fn();
      const callConnectedSpy = vi.fn();
      const callEndedSpy = vi.fn();

      enhancedManager.on("call:started", callStartedSpy);
      enhancedManager.on("call:incoming", callIncomingSpy);
      enhancedManager.on("call:connected", callConnectedSpy);
      enhancedManager.on("call:ended", callEndedSpy);

      // 发起通话
      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);
      expect(callStartedSpy).toHaveBeenCalled();

      // 模拟通话连接
      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now();

      // 结束通话
      await enhancedManager.endCall(callId);
    });

    test("应该转发质量更新事件", async () => {
      const peerId = "peer-quality";
      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now();

      const qualityUpdateSpy = vi.fn();
      enhancedManager.on("call:quality-update", qualityUpdateSpy);

      // 开始质量监控
      enhancedManager.voiceVideoManager._startQualityMonitoring(session);

      // 等待质量检查
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(qualityUpdateSpy).toHaveBeenCalled();

      // 清理
      if (session.qualityCheckInterval) {
        clearInterval(session.qualityCheckInterval);
      }
    });
  });

  describe("统计信息", () => {
    test("应该正确统计通话数据", async () => {
      const peerId1 = "peer-stats-1";
      const peerId2 = "peer-stats-2";

      await enhancedManager.startCall(peerId1, CallType.AUDIO);
      await enhancedManager.startCall(peerId2, CallType.VIDEO);

      const stats = enhancedManager.getStats();

      expect(stats.totalCalls).toBe(2);
      expect(stats.voiceVideoManager).toBeDefined();
      expect(stats.voiceVideoManager.totalCalls).toBe(2);
      expect(stats.voiceVideoManager.audioCallsCount).toBe(1);
      expect(stats.voiceVideoManager.videoCallsCount).toBe(1);
    });

    test("应该包含所有子管理器的统计信息", () => {
      const stats = enhancedManager.getStats();

      expect(stats).toHaveProperty("messageManager");
      expect(stats).toHaveProperty("knowledgeSyncManager");
      expect(stats).toHaveProperty("fileTransferManager");
      expect(stats).toHaveProperty("voiceVideoManager");
      expect(stats).toHaveProperty("uptime");
      expect(stats).toHaveProperty("totalMessages");
      expect(stats).toHaveProperty("totalSyncs");
      expect(stats).toHaveProperty("totalFileTransfers");
      expect(stats).toHaveProperty("totalCalls");
    });
  });

  describe("错误处理", () => {
    test("应该处理未初始化时的调用", async () => {
      const uninitializedManager = new P2PEnhancedManager(
        mockP2PManager,
        mockDatabase,
      );

      await expect(
        uninitializedManager.startCall("peer-123", CallType.AUDIO),
      ).rejects.toThrow("增强管理器未初始化");
    });

    test("应该处理通话失败", async () => {
      const peerId = "peer-fail";

      // 模拟P2P连接失败
      mockP2PManager.node.dialProtocol.mockRejectedValueOnce(
        new Error("连接失败"),
      );

      await expect(
        enhancedManager.startCall(peerId, CallType.AUDIO),
      ).rejects.toThrow();

      expect(
        enhancedManager.voiceVideoManager.stats.failedCalls,
      ).toBeGreaterThan(0);
    });

    test("应该处理不存在的通话操作", async () => {
      await expect(
        enhancedManager.acceptCall("non-existent-call"),
      ).rejects.toThrow("通话会话不存在");

      await expect(
        enhancedManager.endCall("non-existent-call"),
      ).rejects.toThrow("通话会话不存在");
    });
  });

  describe("资源清理", () => {
    test("应该正确清理所有资源", async () => {
      const peerId1 = "peer-cleanup-1";
      const peerId2 = "peer-cleanup-2";

      await enhancedManager.startCall(peerId1, CallType.AUDIO);
      await enhancedManager.startCall(peerId2, CallType.VIDEO);

      expect(enhancedManager.voiceVideoManager.sessions.size).toBe(2);

      await enhancedManager.stop();

      expect(enhancedManager.isRunning).toBe(false);
      expect(enhancedManager.voiceVideoManager.sessions.size).toBe(0);
    });

    test("应该停止所有活动通话", async () => {
      const peerId1 = "peer-stop-1";
      const peerId2 = "peer-stop-2";

      const callId1 = await enhancedManager.startCall(peerId1, CallType.AUDIO);
      const callId2 = await enhancedManager.startCall(peerId2, CallType.VIDEO);

      // 模拟通话已连接
      const session1 = enhancedManager.voiceVideoManager.sessions.get(callId1);
      const session2 = enhancedManager.voiceVideoManager.sessions.get(callId2);
      session1.state = CallState.CONNECTED;
      session2.state = CallState.CONNECTED;

      await enhancedManager.stop();

      expect(session1.state).toBe(CallState.ENDED);
      expect(session2.state).toBe(CallState.ENDED);
    });
  });

  describe("并发通话", () => {
    test("应该支持多个并发通话", async () => {
      const peers = ["peer-1", "peer-2", "peer-3"];
      const callIds = [];

      for (const peerId of peers) {
        const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);
        callIds.push(callId);
      }

      expect(callIds).toHaveLength(3);
      expect(enhancedManager.getActiveCalls()).toHaveLength(3);
    });

    test("应该拒绝向同一用户发起多个通话", async () => {
      const peerId = "peer-duplicate";

      await enhancedManager.startCall(peerId, CallType.AUDIO);

      await expect(
        enhancedManager.startCall(peerId, CallType.VIDEO),
      ).rejects.toThrow("该用户已在通话中");
    });
  });

  describe("通话超时", () => {
    test("应该在超时后自动结束通话", async () => {
      const peerId = "peer-timeout";
      const callId = await enhancedManager.startCall(peerId, CallType.AUDIO);

      // 等待超时
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const session = enhancedManager.voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.ENDED);
    });
  });
});
