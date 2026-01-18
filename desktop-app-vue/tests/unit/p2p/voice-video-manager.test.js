/**
 * Voice/Video Manager 单元测试
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoiceVideoManager, CallState, CallType } from '../../../src/main/p2p/voice-video-manager.js';
import EventEmitter from 'events';

const createMockPeerConnection = () => ({
  close: vi.fn(),
  addTrack: vi.fn(),
  addIceCandidate: vi.fn().mockResolvedValue(undefined),
  setRemoteDescription: vi.fn().mockResolvedValue(undefined),
  setLocalDescription: vi.fn().mockResolvedValue(undefined),
  createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
  createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
  connectionState: 'connected',
  getStats: vi.fn().mockResolvedValue(new Map())
});

const createMockStream = ({ audio = true, video = false } = {}) => {
  const tracks = [];
  if (audio) {
    tracks.push({ kind: 'audio', enabled: true, stop: vi.fn() });
  }
  if (video) {
    tracks.push({ kind: 'video', enabled: true, stop: vi.fn() });
  }
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: (track) => tracks.push(track)
  };
};

const createMockSession = (callId, peerId, type) => ({
  callId,
  peerId,
  type,
  state: CallState.IDLE,
  startTime: Date.now(),
  getDuration() {
    const endTime = this.endTime || Date.now();
    return Math.floor((endTime - this.startTime) / 1000);
  }
});

// Mock wrtc-compat (our WebRTC compatibility layer)
vi.mock('../../../src/main/p2p/wrtc-compat', () => ({
  available: true,
  loadError: null,
  RTCPeerConnection: vi.fn().mockImplementation(() => ({
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' }),
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' }),
    setLocalDescription: vi.fn().mockResolvedValue(),
    setRemoteDescription: vi.fn().mockResolvedValue(),
    addTrack: vi.fn(),
    addIceCandidate: vi.fn().mockResolvedValue(),
    close: vi.fn(),
    getStats: vi.fn().mockResolvedValue(new Map()),
    connectionState: 'connected',
    onicecandidate: null,
    onconnectionstatechange: null,
    ontrack: null
  })),
  RTCSessionDescription: vi.fn().mockImplementation((desc) => desc),
  RTCIceCandidate: vi.fn().mockImplementation((candidate) => candidate),
  MediaStream: vi.fn().mockImplementation(() => ({
    getTracks: vi.fn().mockReturnValue([]),
    getAudioTracks: vi.fn().mockReturnValue([
      { enabled: true, stop: vi.fn() }
    ]),
    getVideoTracks: vi.fn().mockReturnValue([
      { enabled: true, stop: vi.fn() }
    ])
  }))
}));

describe('VoiceVideoManager', () => {
  let voiceVideoManager;
  let mockP2PManager;

  beforeEach(() => {
    // 创建模拟的P2P管理器
    mockP2PManager = new EventEmitter();
    mockP2PManager.node = {
      handle: vi.fn(),
      dialProtocol: vi.fn().mockResolvedValue({
        sink: vi.fn().mockResolvedValue(),
        close: vi.fn().mockResolvedValue()
      })
    };

    // 创建VoiceVideoManager实例
    voiceVideoManager = new VoiceVideoManager(mockP2PManager, {
      callTimeout: 1000, // 1秒超时（用于测试）
      qualityCheckInterval: 500 // 0.5秒检查一次
    });
  });

  afterEach(async () => {
    await voiceVideoManager.cleanup();
  });

  describe('初始化', () => {
    test('应该正确初始化管理器', () => {
      expect(voiceVideoManager.sessions).toBeInstanceOf(Map);
      expect(voiceVideoManager.peerSessions).toBeInstanceOf(Map);
      expect(voiceVideoManager.stats.totalCalls).toBe(0);
    });

    test('应该注册P2P协议处理器', () => {
      expect(mockP2PManager.node.handle).toHaveBeenCalledWith(
        '/chainlesschain/call/1.0.0',
        expect.any(Function)
      );
    });
  });

  describe('发起通话', () => {
    test('应该成功发起语音通话', async () => {
      const peerId = 'peer-123';
      const callStartedSpy = vi.fn();
      voiceVideoManager.on('call:started', callStartedSpy);

      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      expect(callId).toBeTruthy();
      expect(voiceVideoManager.sessions.has(callId)).toBe(true);
      expect(voiceVideoManager.peerSessions.get(peerId)).toBe(callId);
      expect(callStartedSpy).toHaveBeenCalledWith({
        callId,
        peerId,
        type: CallType.AUDIO,
        isInitiator: true
      });
      expect(voiceVideoManager.stats.totalCalls).toBe(1);
      expect(voiceVideoManager.stats.audioCallsCount).toBe(1);
    });

    test('应该成功发起视频通话', async () => {
      const peerId = 'peer-456';
      const callId = await voiceVideoManager.startCall(peerId, CallType.VIDEO);

      const session = voiceVideoManager.sessions.get(callId);
      expect(session.type).toBe(CallType.VIDEO);
      expect(session.state).toBe(CallState.CALLING);
      expect(voiceVideoManager.stats.videoCallsCount).toBe(1);
    });

    test('应该拒绝向已在通话中的用户发起通话', async () => {
      const peerId = 'peer-789';

      // 第一次通话
      await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      // 第二次通话应该失败
      await expect(
        voiceVideoManager.startCall(peerId, CallType.AUDIO)
      ).rejects.toThrow('该用户已在通话中');
    });

    test('应该在超时后自动结束通话', async () => {
      const peerId = 'peer-timeout';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      // 等待超时
      await new Promise(resolve => setTimeout(resolve, 1500));

      const session = voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.ENDED);
    });
  });

  describe('接受通话', () => {
    test('应该成功接受来电', async () => {
      const peerId = 'peer-incoming';
      const callId = 'call-incoming-123';

      // 模拟收到来电
      const session = voiceVideoManager.sessions.get(callId);
      if (!session) {
        // 创建模拟会话
        const mockSession = createMockSession(callId, peerId, CallType.AUDIO);
        mockSession.state = CallState.RINGING;
        mockSession.peerConnection = createMockPeerConnection();
        voiceVideoManager.sessions.set(callId, mockSession);
        voiceVideoManager.peerSessions.set(peerId, callId);
      }

      const callAcceptedSpy = vi.fn();
      voiceVideoManager.on('call:accepted', callAcceptedSpy);

      await voiceVideoManager.acceptCall(callId);

      const updatedSession = voiceVideoManager.sessions.get(callId);
      expect(updatedSession.state).toBe(CallState.CONNECTED);
      expect(updatedSession.startTime).toBeTruthy();
      expect(callAcceptedSpy).toHaveBeenCalled();
    });

    test('应该拒绝接受不存在的通话', async () => {
      await expect(
        voiceVideoManager.acceptCall('non-existent-call')
      ).rejects.toThrow('通话会话不存在');
    });
  });

  describe('拒绝通话', () => {
    test('应该成功拒绝来电', async () => {
      const peerId = 'peer-reject';
      const callId = 'call-reject-123';

      // 创建模拟会话
      const mockSession = createMockSession(callId, peerId, CallType.AUDIO);
      mockSession.state = CallState.RINGING;
      mockSession.peerConnection = createMockPeerConnection();
      voiceVideoManager.sessions.set(callId, mockSession);
      voiceVideoManager.peerSessions.set(peerId, callId);

      await voiceVideoManager.rejectCall(callId, 'busy');

      // 会话应该被标记为结束
      const session = voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.ENDED);
    });
  });

  describe('结束通话', () => {
    test('应该成功结束通话', async () => {
      const peerId = 'peer-end';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      // 模拟通话已连接
      const session = voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now();

      const callEndedSpy = vi.fn();
      voiceVideoManager.on('call:ended', callEndedSpy);

      await voiceVideoManager.endCall(callId);

      expect(session.state).toBe(CallState.ENDED);
      expect(session.endTime).toBeTruthy();
    });
  });

  describe('通话控制', () => {
    let callId;
    let session;

    beforeEach(async () => {
      const peerId = 'peer-control';
      callId = await voiceVideoManager.startCall(peerId, CallType.VIDEO);
    session = voiceVideoManager.sessions.get(callId);
    session.state = CallState.CONNECTED;
    session.localStream = createMockStream({ audio: true, video: true });
    });

    test('应该能够切换静音', () => {
      const muteChangedSpy = vi.fn();
      voiceVideoManager.on('call:mute-changed', muteChangedSpy);

    const isMuted = voiceVideoManager.toggleMute(callId);

    expect(isMuted).toBe(true); // 第一次切换应为静音
      expect(muteChangedSpy).toHaveBeenCalledWith({
        callId,
        isMuted: false
      });
    });

    test('应该能够切换视频', () => {
      const videoChangedSpy = vi.fn();
      voiceVideoManager.on('call:video-changed', videoChangedSpy);

      const isVideoEnabled = voiceVideoManager.toggleVideo(callId);

      expect(isVideoEnabled).toBe(false); // 第一次切换应该是关闭视频
      expect(videoChangedSpy).toHaveBeenCalledWith({
        callId,
        isVideoEnabled: false
      });
    });
  });

  describe('通话信息', () => {
    test('应该能够获取通话信息', async () => {
      const peerId = 'peer-info';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const info = voiceVideoManager.getCallInfo(callId);

      expect(info).toMatchObject({
        callId,
        peerId,
        type: CallType.AUDIO,
        state: CallState.CALLING,
        isInitiator: true
      });
    });

    test('应该返回null对于不存在的通话', () => {
      const info = voiceVideoManager.getCallInfo('non-existent');
      expect(info).toBeNull();
    });

    test('应该能够获取活动通话列表', async () => {
      const peerId1 = 'peer-1';
      const peerId2 = 'peer-2';

      await voiceVideoManager.startCall(peerId1, CallType.AUDIO);
      await voiceVideoManager.startCall(peerId2, CallType.VIDEO);

      const activeCalls = voiceVideoManager.getActiveCalls();

      expect(activeCalls).toHaveLength(2);
      expect(activeCalls[0].peerId).toBe(peerId1);
      expect(activeCalls[1].peerId).toBe(peerId2);
    });
  });

  describe('统计信息', () => {
    test('应该正确统计通话数据', async () => {
      const peerId1 = 'peer-stats-1';
      const peerId2 = 'peer-stats-2';

      await voiceVideoManager.startCall(peerId1, CallType.AUDIO);
      await voiceVideoManager.startCall(peerId2, CallType.VIDEO);

      const stats = voiceVideoManager.getStats();

      expect(stats.totalCalls).toBe(2);
      expect(stats.audioCallsCount).toBe(1);
      expect(stats.videoCallsCount).toBe(1);
      expect(stats.activeCalls).toBe(2);
    });
  });

  describe('信令处理', () => {
    test('应该处理来电请求', async () => {
      const peerId = 'peer-incoming-request';
      const callId = 'call-incoming-456';

      const incomingSpy = vi.fn();
      voiceVideoManager.on('call:incoming', incomingSpy);

      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'call-request',
        callId,
        callType: CallType.AUDIO,
        offer: { type: 'offer', sdp: 'mock-sdp' }
      });

      expect(voiceVideoManager.sessions.has(callId)).toBe(true);
      expect(incomingSpy).toHaveBeenCalledWith({
        callId,
        peerId,
        type: CallType.AUDIO
      });
    });

    test('应该拒绝忙碌时的来电', async () => {
      const peerId = 'peer-busy';
      const callId1 = 'call-busy-1';
      const callId2 = 'call-busy-2';

      // 第一个通话
      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'call-request',
        callId: callId1,
        callType: CallType.AUDIO,
        offer: { type: 'offer', sdp: 'mock-sdp' }
      });

      // 第二个通话应该被拒绝
      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'call-request',
        callId: callId2,
        callType: CallType.AUDIO,
        offer: { type: 'offer', sdp: 'mock-sdp' }
      });

      // 应该只有一个会话
      expect(voiceVideoManager.peerSessions.get(peerId)).toBe(callId1);
      expect(voiceVideoManager.sessions.has(callId2)).toBe(false);
    });

    test('应该处理通话应答', async () => {
      const peerId = 'peer-answer';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const connectedSpy = vi.fn();
      voiceVideoManager.on('call:connected', connectedSpy);

      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'call-answer',
        callId,
        answer: { type: 'answer', sdp: 'mock-answer-sdp' }
      });

      const session = voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.CONNECTED);
      expect(session.startTime).toBeTruthy();
      expect(connectedSpy).toHaveBeenCalled();
    });

    test('应该处理通话拒绝', async () => {
      const peerId = 'peer-reject-signal';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const rejectedSpy = vi.fn();
      voiceVideoManager.on('call:rejected', rejectedSpy);

      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'call-reject',
        callId,
        reason: 'busy'
      });

      const session = voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.ENDED);
      expect(rejectedSpy).toHaveBeenCalledWith({
        callId,
        peerId,
        reason: 'busy'
      });
    });

    test('应该处理通话结束', async () => {
      const peerId = 'peer-end-signal';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const endedSpy = vi.fn();
      voiceVideoManager.on('call:ended', endedSpy);

      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'call-end',
        callId
      });

      const session = voiceVideoManager.sessions.get(callId);
      expect(session.state).toBe(CallState.ENDED);
      expect(endedSpy).toHaveBeenCalled();
    });

    test('应该处理ICE候选', async () => {
      const peerId = 'peer-ice';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const session = voiceVideoManager.sessions.get(callId);
      const addIceCandidateSpy = vi.spyOn(session.peerConnection, 'addIceCandidate');

      await voiceVideoManager._handleCallSignaling(peerId, {
        type: 'ice-candidate',
        callId,
        candidate: { candidate: 'mock-candidate', sdpMid: '0', sdpMLineIndex: 0 }
      });

      expect(addIceCandidateSpy).toHaveBeenCalled();
    });
  });

  describe('资源清理', () => {
    test('应该正确清理所有资源', async () => {
      const peerId1 = 'peer-cleanup-1';
      const peerId2 = 'peer-cleanup-2';

      await voiceVideoManager.startCall(peerId1, CallType.AUDIO);
      await voiceVideoManager.startCall(peerId2, CallType.VIDEO);

      expect(voiceVideoManager.sessions.size).toBe(2);

      await voiceVideoManager.cleanup();

      expect(voiceVideoManager.sessions.size).toBe(0);
      expect(voiceVideoManager.peerSessions.size).toBe(0);
    });

    test('应该停止所有媒体流', async () => {
      const peerId = 'peer-cleanup-stream';
      const callId = await voiceVideoManager.startCall(peerId, CallType.VIDEO);

    const session = voiceVideoManager.sessions.get(callId);
    session.state = CallState.CONNECTED;
    session.localStream = createMockStream({ audio: true, video: true });

      const stopSpy = vi.spyOn(session.localStream.getAudioTracks()[0], 'stop');

      await voiceVideoManager.cleanup();

      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('质量监控', () => {
    test('应该定期更新通话质量', async () => {
      const peerId = 'peer-quality';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const session = voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now();

      // 开始质量监控
      voiceVideoManager._startQualityMonitoring(session);

      const qualityUpdateSpy = vi.fn();
      voiceVideoManager.on('call:quality-update', qualityUpdateSpy);

      // 等待质量检查
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(qualityUpdateSpy).toHaveBeenCalled();
      expect(qualityUpdateSpy.mock.calls[0][0]).toMatchObject({
        callId,
        stats: expect.any(Object)
      });

      // 清理
      if (session.qualityCheckInterval) {
        clearInterval(session.qualityCheckInterval);
      }
    });
  });

  describe('通话时长', () => {
    test('应该正确计算通话时长', async () => {
      const peerId = 'peer-duration';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const session = voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now() - 5000; // 5秒前开始

      const duration = session.getDuration();

      expect(duration).toBeGreaterThanOrEqual(4);
      expect(duration).toBeLessThanOrEqual(6);
    });

    test('应该在通话结束后更新总时长', async () => {
      const peerId = 'peer-total-duration';
      const callId = await voiceVideoManager.startCall(peerId, CallType.AUDIO);

      const session = voiceVideoManager.sessions.get(callId);
      session.state = CallState.CONNECTED;
      session.startTime = Date.now() - 10000; // 10秒前开始

      const initialTotalDuration = voiceVideoManager.stats.totalDuration;

      await voiceVideoManager.endCall(callId);

      expect(voiceVideoManager.stats.totalDuration).toBeGreaterThan(initialTotalDuration);
    });
  });
});
