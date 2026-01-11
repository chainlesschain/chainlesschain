/**
 * Voice/Video IPC Handler 测试
 */

const VoiceVideoIPC = require('../../../src/main/p2p/voice-video-ipc');
const { CallType, CallState } = require('../../../src/main/p2p/voice-video-manager');
const { ipcMain, BrowserWindow } = require('electron');

// Mock Electron
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn()
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}));

describe('VoiceVideoIPC', () => {
  let voiceVideoIPC;
  let mockVoiceVideoManager;
  let mockWindow;

  beforeEach(() => {
    // 重置mocks
    jest.clearAllMocks();

    // 创建模拟的VoiceVideoManager
    mockVoiceVideoManager = {
      on: jest.fn(),
      startCall: jest.fn(),
      acceptCall: jest.fn(),
      rejectCall: jest.fn(),
      endCall: jest.fn(),
      toggleMute: jest.fn(),
      toggleVideo: jest.fn(),
      getCallInfo: jest.fn(),
      getActiveCalls: jest.fn(),
      getStats: jest.fn()
    };

    // 创建模拟的窗口
    mockWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: {
        send: jest.fn()
      }
    };

    BrowserWindow.getAllWindows.mockReturnValue([mockWindow]);

    // 创建IPC处理器
    voiceVideoIPC = new VoiceVideoIPC(mockVoiceVideoManager);
  });

  afterEach(() => {
    voiceVideoIPC.unregister();
  });

  describe('注册处理器', () => {
    test('应该注册所有IPC处理器', () => {
      voiceVideoIPC.register();

      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:start', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:accept', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:reject', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:end', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:toggle-mute', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:toggle-video', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:get-info', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:get-active-calls', expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith('p2p-call:get-stats', expect.any(Function));
    });

    test('应该设置事件转发', () => {
      voiceVideoIPC.register();

      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:started', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:incoming', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:accepted', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:rejected', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:connected', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:ended', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:remote-stream', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:quality-update', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:mute-changed', expect.any(Function));
      expect(mockVoiceVideoManager.on).toHaveBeenCalledWith('call:video-changed', expect.any(Function));
    });
  });

  describe('发起通话', () => {
    test('应该成功处理发起通话请求', async () => {
      const callId = 'call-123';
      mockVoiceVideoManager.startCall.mockResolvedValue(callId);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:start'
      )[1];

      const result = await handler(null, {
        peerId: 'peer-123',
        type: CallType.AUDIO,
        options: {}
      });

      expect(result).toEqual({
        success: true,
        callId
      });
      expect(mockVoiceVideoManager.startCall).toHaveBeenCalledWith(
        'peer-123',
        CallType.AUDIO,
        {}
      );
    });

    test('应该处理发起通话失败', async () => {
      const error = new Error('通话失败');
      mockVoiceVideoManager.startCall.mockRejectedValue(error);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:start'
      )[1];

      const result = await handler(null, {
        peerId: 'peer-456',
        type: CallType.VIDEO,
        options: {}
      });

      expect(result).toEqual({
        success: false,
        error: '通话失败'
      });
    });
  });

  describe('接受通话', () => {
    test('应该成功处理接受通话请求', async () => {
      mockVoiceVideoManager.acceptCall.mockResolvedValue();

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:accept'
      )[1];

      const result = await handler(null, { callId: 'call-789' });

      expect(result).toEqual({ success: true });
      expect(mockVoiceVideoManager.acceptCall).toHaveBeenCalledWith('call-789');
    });

    test('应该处理接受通话失败', async () => {
      const error = new Error('接受失败');
      mockVoiceVideoManager.acceptCall.mockRejectedValue(error);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:accept'
      )[1];

      const result = await handler(null, { callId: 'call-101' });

      expect(result).toEqual({
        success: false,
        error: '接受失败'
      });
    });
  });

  describe('拒绝通话', () => {
    test('应该成功处理拒绝通话请求', async () => {
      mockVoiceVideoManager.rejectCall.mockResolvedValue();

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:reject'
      )[1];

      const result = await handler(null, {
        callId: 'call-202',
        reason: 'busy'
      });

      expect(result).toEqual({ success: true });
      expect(mockVoiceVideoManager.rejectCall).toHaveBeenCalledWith('call-202', 'busy');
    });
  });

  describe('结束通话', () => {
    test('应该成功处理结束通话请求', async () => {
      mockVoiceVideoManager.endCall.mockResolvedValue();

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:end'
      )[1];

      const result = await handler(null, { callId: 'call-303' });

      expect(result).toEqual({ success: true });
      expect(mockVoiceVideoManager.endCall).toHaveBeenCalledWith('call-303');
    });
  });

  describe('切换静音', () => {
    test('应该成功处理切换静音请求', async () => {
      mockVoiceVideoManager.toggleMute.mockReturnValue(true);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:toggle-mute'
      )[1];

      const result = await handler(null, { callId: 'call-404' });

      expect(result).toEqual({
        success: true,
        isMuted: true
      });
      expect(mockVoiceVideoManager.toggleMute).toHaveBeenCalledWith('call-404');
    });

    test('应该处理切换静音失败', async () => {
      const error = new Error('切换失败');
      mockVoiceVideoManager.toggleMute.mockImplementation(() => {
        throw error;
      });

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:toggle-mute'
      )[1];

      const result = await handler(null, { callId: 'call-505' });

      expect(result).toEqual({
        success: false,
        error: '切换失败'
      });
    });
  });

  describe('切换视频', () => {
    test('应该成功处理切换视频请求', async () => {
      mockVoiceVideoManager.toggleVideo.mockReturnValue(false);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:toggle-video'
      )[1];

      const result = await handler(null, { callId: 'call-606' });

      expect(result).toEqual({
        success: true,
        isVideoEnabled: false
      });
      expect(mockVoiceVideoManager.toggleVideo).toHaveBeenCalledWith('call-606');
    });
  });

  describe('获取通话信息', () => {
    test('应该成功获取通话信息', async () => {
      const mockInfo = {
        callId: 'call-707',
        peerId: 'peer-707',
        type: CallType.AUDIO,
        state: CallState.CONNECTED,
        duration: 120
      };

      mockVoiceVideoManager.getCallInfo.mockReturnValue(mockInfo);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:get-info'
      )[1];

      const result = await handler(null, { callId: 'call-707' });

      expect(result).toEqual({
        success: true,
        info: mockInfo
      });
    });
  });

  describe('获取活动通话', () => {
    test('应该成功获取活动通话列表', async () => {
      const mockCalls = [
        { callId: 'call-1', peerId: 'peer-1', type: CallType.AUDIO },
        { callId: 'call-2', peerId: 'peer-2', type: CallType.VIDEO }
      ];

      mockVoiceVideoManager.getActiveCalls.mockReturnValue(mockCalls);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:get-active-calls'
      )[1];

      const result = await handler(null);

      expect(result).toEqual({
        success: true,
        calls: mockCalls
      });
    });
  });

  describe('获取统计信息', () => {
    test('应该成功获取统计信息', async () => {
      const mockStats = {
        totalCalls: 10,
        successfulCalls: 8,
        failedCalls: 2,
        totalDuration: 3600,
        activeCalls: 2
      };

      mockVoiceVideoManager.getStats.mockReturnValue(mockStats);

      voiceVideoIPC.register();
      const handler = ipcMain.handle.mock.calls.find(
        call => call[0] === 'p2p-call:get-stats'
      )[1];

      const result = await handler(null);

      expect(result).toEqual({
        success: true,
        stats: mockStats
      });
    });
  });

  describe('事件转发', () => {
    test('应该转发call:started事件到渲染进程', () => {
      voiceVideoIPC.register();

      const eventHandler = mockVoiceVideoManager.on.mock.calls.find(
        call => call[0] === 'call:started'
      )[1];

      const eventData = {
        callId: 'call-808',
        peerId: 'peer-808',
        type: CallType.AUDIO
      };

      eventHandler(eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'p2p-call:started',
        eventData
      );
    });

    test('应该转发call:incoming事件到渲染进程', () => {
      voiceVideoIPC.register();

      const eventHandler = mockVoiceVideoManager.on.mock.calls.find(
        call => call[0] === 'call:incoming'
      )[1];

      const eventData = {
        callId: 'call-909',
        peerId: 'peer-909',
        type: CallType.VIDEO
      };

      eventHandler(eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'p2p-call:incoming',
        eventData
      );
    });

    test('应该转发call:quality-update事件到渲染进程', () => {
      voiceVideoIPC.register();

      const eventHandler = mockVoiceVideoManager.on.mock.calls.find(
        call => call[0] === 'call:quality-update'
      )[1];

      const eventData = {
        callId: 'call-1010',
        stats: {
          bytesReceived: 1024,
          bytesSent: 2048,
          packetsLost: 5
        }
      };

      eventHandler(eventData);

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'p2p-call:quality-update',
        eventData
      );
    });

    test('不应该向已销毁的窗口发送事件', () => {
      mockWindow.isDestroyed.mockReturnValue(true);

      voiceVideoIPC.register();

      const eventHandler = mockVoiceVideoManager.on.mock.calls.find(
        call => call[0] === 'call:started'
      )[1];

      eventHandler({ callId: 'call-1111' });

      expect(mockWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('注销处理器', () => {
    test('应该注销所有IPC处理器', () => {
      voiceVideoIPC.register();

      const registeredChannels = voiceVideoIPC.registeredHandlers.length;
      expect(registeredChannels).toBeGreaterThan(0);

      voiceVideoIPC.unregister();

      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(registeredChannels);
      expect(voiceVideoIPC.registeredHandlers).toHaveLength(0);
    });

    test('应该能够安全地多次注销', () => {
      voiceVideoIPC.register();
      voiceVideoIPC.unregister();
      voiceVideoIPC.unregister();

      // 不应该抛出错误
      expect(voiceVideoIPC.registeredHandlers).toHaveLength(0);
    });
  });
});
