/**
 * Voice/Video Call IPC处理器
 *
 * 提供前端与语音/视频通话功能的通信接口
 */

const { ipcMain } = require('electron');

class VoiceVideoIPC {
  constructor(voiceVideoManager) {
    this.voiceVideoManager = voiceVideoManager;
    this.registeredHandlers = [];
  }

  /**
   * 注册所有IPC处理器
   */
  register() {
    console.log('[VoiceVideoIPC] 注册IPC处理器...');

    // 通话控制
    this.registerHandler('p2p-call:start', this.handleStartCall.bind(this));
    this.registerHandler('p2p-call:accept', this.handleAcceptCall.bind(this));
    this.registerHandler('p2p-call:reject', this.handleRejectCall.bind(this));
    this.registerHandler('p2p-call:end', this.handleEndCall.bind(this));

    // 通话功能
    this.registerHandler('p2p-call:toggle-mute', this.handleToggleMute.bind(this));
    this.registerHandler('p2p-call:toggle-video', this.handleToggleVideo.bind(this));

    // 通话信息
    this.registerHandler('p2p-call:get-info', this.handleGetCallInfo.bind(this));
    this.registerHandler('p2p-call:get-active-calls', this.handleGetActiveCalls.bind(this));
    this.registerHandler('p2p-call:get-stats', this.handleGetStats.bind(this));

    // 设置事件转发
    this.setupEventForwarding();

    console.log('[VoiceVideoIPC] ✅ IPC处理器注册完成');
  }

  /**
   * 注册单个处理器
   */
  registerHandler(channel, handler) {
    ipcMain.handle(channel, handler);
    this.registeredHandlers.push(channel);
  }

  /**
   * 设置事件转发到渲染进程
   */
  setupEventForwarding() {
    const { BrowserWindow } = require('electron');

    // 通话事件
    this.voiceVideoManager.on('call:started', (data) => {
      this.sendToRenderer('p2p-call:started', data);
    });

    this.voiceVideoManager.on('call:incoming', (data) => {
      this.sendToRenderer('p2p-call:incoming', data);
    });

    this.voiceVideoManager.on('call:accepted', (data) => {
      this.sendToRenderer('p2p-call:accepted', data);
    });

    this.voiceVideoManager.on('call:rejected', (data) => {
      this.sendToRenderer('p2p-call:rejected', data);
    });

    this.voiceVideoManager.on('call:connected', (data) => {
      this.sendToRenderer('p2p-call:connected', data);
    });

    this.voiceVideoManager.on('call:ended', (data) => {
      this.sendToRenderer('p2p-call:ended', data);
    });

    this.voiceVideoManager.on('call:remote-stream', (data) => {
      this.sendToRenderer('p2p-call:remote-stream', data);
    });

    this.voiceVideoManager.on('call:quality-update', (data) => {
      this.sendToRenderer('p2p-call:quality-update', data);
    });

    this.voiceVideoManager.on('call:mute-changed', (data) => {
      this.sendToRenderer('p2p-call:mute-changed', data);
    });

    this.voiceVideoManager.on('call:video-changed', (data) => {
      this.sendToRenderer('p2p-call:video-changed', data);
    });
  }

  /**
   * 发送事件到渲染进程
   */
  sendToRenderer(channel, data) {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();

    windows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    });
  }

  /**
   * 处理发起通话
   */
  async handleStartCall(event, { peerId, type, options }) {
    try {
      const callId = await this.voiceVideoManager.startCall(peerId, type, options);

      return {
        success: true,
        callId
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 发起通话失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理接受通话
   */
  async handleAcceptCall(event, { callId }) {
    try {
      await this.voiceVideoManager.acceptCall(callId);

      return {
        success: true
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 接受通话失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理拒绝通话
   */
  async handleRejectCall(event, { callId, reason }) {
    try {
      await this.voiceVideoManager.rejectCall(callId, reason);

      return {
        success: true
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 拒绝通话失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理结束通话
   */
  async handleEndCall(event, { callId }) {
    try {
      await this.voiceVideoManager.endCall(callId);

      return {
        success: true
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 结束通话失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理切换静音
   */
  async handleToggleMute(event, { callId }) {
    try {
      const isMuted = this.voiceVideoManager.toggleMute(callId);

      return {
        success: true,
        isMuted
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 切换静音失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理切换视频
   */
  async handleToggleVideo(event, { callId }) {
    try {
      const isVideoEnabled = this.voiceVideoManager.toggleVideo(callId);

      return {
        success: true,
        isVideoEnabled
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 切换视频失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取通话信息
   */
  async handleGetCallInfo(event, { callId }) {
    try {
      const info = this.voiceVideoManager.getCallInfo(callId);

      return {
        success: true,
        info
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 获取通话信息失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取活动通话列表
   */
  async handleGetActiveCalls(event) {
    try {
      const calls = this.voiceVideoManager.getActiveCalls();

      return {
        success: true,
        calls
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 获取活动通话失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取统计信息
   */
  async handleGetStats(event) {
    try {
      const stats = this.voiceVideoManager.getStats();

      return {
        success: true,
        stats
      };
    } catch (error) {
      console.error('[VoiceVideoIPC] 获取统计信息失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 注销所有处理器
   */
  unregister() {
    console.log('[VoiceVideoIPC] 注销IPC处理器...');

    this.registeredHandlers.forEach(channel => {
      ipcMain.removeHandler(channel);
    });

    this.registeredHandlers = [];

    console.log('[VoiceVideoIPC] ✅ IPC处理器已注销');
  }
}

module.exports = VoiceVideoIPC;
