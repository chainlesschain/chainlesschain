/**
 * P2P增强功能IPC处理器
 *
 * 提供前端与P2P增强功能的通信接口
 */

const { ipcMain } = require('electron');

class P2PEnhancedIPC {
  constructor(enhancedManager) {
    this.enhancedManager = enhancedManager;
    this.registeredHandlers = [];
  }

  /**
   * 注册所有IPC处理器
   */
  register() {
    console.log('[P2PEnhancedIPC] 注册IPC处理器...');

    // 消息相关
    this.registerHandler('p2p-enhanced:send-message', this.handleSendMessage.bind(this));
    this.registerHandler('p2p-enhanced:get-message-stats', this.handleGetMessageStats.bind(this));

    // 知识库同步相关
    this.registerHandler('p2p-enhanced:sync-knowledge', this.handleSyncKnowledge.bind(this));
    this.registerHandler('p2p-enhanced:get-sync-stats', this.handleGetSyncStats.bind(this));
    this.registerHandler('p2p-enhanced:get-conflicts', this.handleGetConflicts.bind(this));
    this.registerHandler('p2p-enhanced:resolve-conflict', this.handleResolveConflict.bind(this));

    // 文件传输相关
    this.registerHandler('p2p-enhanced:upload-file', this.handleUploadFile.bind(this));
    this.registerHandler('p2p-enhanced:download-file', this.handleDownloadFile.bind(this));
    this.registerHandler('p2p-enhanced:get-transfer-progress', this.handleGetTransferProgress.bind(this));
    this.registerHandler('p2p-enhanced:cancel-transfer', this.handleCancelTransfer.bind(this));
    this.registerHandler('p2p-enhanced:get-transfer-stats', this.handleGetTransferStats.bind(this));

    // 语音/视频通话相关
    this.registerHandler('p2p-enhanced:start-call', this.handleStartCall.bind(this));
    this.registerHandler('p2p-enhanced:accept-call', this.handleAcceptCall.bind(this));
    this.registerHandler('p2p-enhanced:reject-call', this.handleRejectCall.bind(this));
    this.registerHandler('p2p-enhanced:end-call', this.handleEndCall.bind(this));
    this.registerHandler('p2p-enhanced:toggle-mute', this.handleToggleMute.bind(this));
    this.registerHandler('p2p-enhanced:toggle-video', this.handleToggleVideo.bind(this));
    this.registerHandler('p2p-enhanced:get-call-info', this.handleGetCallInfo.bind(this));
    this.registerHandler('p2p-enhanced:get-active-calls', this.handleGetActiveCalls.bind(this));

    // 统计信息
    this.registerHandler('p2p-enhanced:get-stats', this.handleGetStats.bind(this));

    // 设置事件转发
    this.setupEventForwarding();

    console.log('[P2PEnhancedIPC] ✅ IPC处理器注册完成');
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

    // 消息事件
    this.enhancedManager.on('message', (data) => {
      this.sendToRenderer('p2p-enhanced:message', data);
    });

    this.enhancedManager.on('message:send-failed', (data) => {
      this.sendToRenderer('p2p-enhanced:message-send-failed', data);
    });

    // 知识库同步事件
    this.enhancedManager.on('knowledge:sync-started', (data) => {
      this.sendToRenderer('p2p-enhanced:sync-started', data);
    });

    this.enhancedManager.on('knowledge:sync-completed', (data) => {
      this.sendToRenderer('p2p-enhanced:sync-completed', data);
    });

    this.enhancedManager.on('knowledge:sync-failed', (data) => {
      this.sendToRenderer('p2p-enhanced:sync-failed', data);
    });

    this.enhancedManager.on('knowledge:sync-progress', (data) => {
      this.sendToRenderer('p2p-enhanced:sync-progress', data);
    });

    this.enhancedManager.on('knowledge:conflict', (data) => {
      this.sendToRenderer('p2p-enhanced:conflict-detected', data);
    });

    this.enhancedManager.on('knowledge:conflict-resolved', (data) => {
      this.sendToRenderer('p2p-enhanced:conflict-resolved', data);
    });

    // 文件传输事件
    this.enhancedManager.on('file:upload-completed', (data) => {
      this.sendToRenderer('p2p-enhanced:upload-completed', data);
    });

    this.enhancedManager.on('file:upload-failed', (data) => {
      this.sendToRenderer('p2p-enhanced:upload-failed', data);
    });

    this.enhancedManager.on('file:upload-progress', (data) => {
      this.sendToRenderer('p2p-enhanced:upload-progress', data);
    });

    this.enhancedManager.on('file:download-completed', (data) => {
      this.sendToRenderer('p2p-enhanced:download-completed', data);
    });

    this.enhancedManager.on('file:download-failed', (data) => {
      this.sendToRenderer('p2p-enhanced:download-failed', data);
    });

    this.enhancedManager.on('file:download-progress', (data) => {
      this.sendToRenderer('p2p-enhanced:download-progress', data);
    });

    this.enhancedManager.on('file:transfer-request', (data) => {
      this.sendToRenderer('p2p-enhanced:transfer-request', data);
    });

    // 语音/视频通话事件
    this.enhancedManager.on('call:started', (data) => {
      this.sendToRenderer('p2p-enhanced:call-started', data);
    });

    this.enhancedManager.on('call:incoming', (data) => {
      this.sendToRenderer('p2p-enhanced:call-incoming', data);
    });

    this.enhancedManager.on('call:accepted', (data) => {
      this.sendToRenderer('p2p-enhanced:call-accepted', data);
    });

    this.enhancedManager.on('call:rejected', (data) => {
      this.sendToRenderer('p2p-enhanced:call-rejected', data);
    });

    this.enhancedManager.on('call:connected', (data) => {
      this.sendToRenderer('p2p-enhanced:call-connected', data);
    });

    this.enhancedManager.on('call:ended', (data) => {
      this.sendToRenderer('p2p-enhanced:call-ended', data);
    });

    this.enhancedManager.on('call:remote-stream', (data) => {
      this.sendToRenderer('p2p-enhanced:call-remote-stream', data);
    });

    this.enhancedManager.on('call:quality-update', (data) => {
      this.sendToRenderer('p2p-enhanced:call-quality-update', data);
    });

    this.enhancedManager.on('call:mute-changed', (data) => {
      this.sendToRenderer('p2p-enhanced:call-mute-changed', data);
    });

    this.enhancedManager.on('call:video-changed', (data) => {
      this.sendToRenderer('p2p-enhanced:call-video-changed', data);
    });

    // 节点连接事件
    this.enhancedManager.on('peer:connected', (data) => {
      this.sendToRenderer('p2p-enhanced:peer-connected', data);
    });

    this.enhancedManager.on('peer:disconnected', (data) => {
      this.sendToRenderer('p2p-enhanced:peer-disconnected', data);
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
   * 处理发送消息
   */
  async handleSendMessage(event, { peerId, payload, options = {} }) {
    try {
      const messageId = await this.enhancedManager.sendMessage(peerId, payload, options);

      return {
        success: true,
        messageId
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 发送消息失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取消息统计
   */
  async handleGetMessageStats(event) {
    try {
      const stats = this.enhancedManager.messageManager.getStats();

      return {
        success: true,
        stats
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取消息统计失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理知识库同步
   */
  async handleSyncKnowledge(event, { peerId, options = {} }) {
    try {
      await this.enhancedManager.syncKnowledge(peerId, options);

      return {
        success: true
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 知识库同步失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取同步统计
   */
  async handleGetSyncStats(event) {
    try {
      const stats = this.enhancedManager.knowledgeSyncManager.getStats();

      return {
        success: true,
        stats
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取同步统计失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取冲突列表
   */
  async handleGetConflicts(event) {
    try {
      const conflicts = this.enhancedManager.getKnowledgeConflicts();

      return {
        success: true,
        conflicts
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取冲突列表失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 解决冲突
   */
  async handleResolveConflict(event, { conflictId, resolution }) {
    try {
      await this.enhancedManager.resolveKnowledgeConflict(conflictId, resolution);

      return {
        success: true
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 解决冲突失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理文件上传
   */
  async handleUploadFile(event, { peerId, filePath, options = {} }) {
    try {
      const transferId = await this.enhancedManager.uploadFile(peerId, filePath, options);

      return {
        success: true,
        transferId
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 文件上传失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理文件下载
   */
  async handleDownloadFile(event, { peerId, transferId, savePath }) {
    try {
      const filePath = await this.enhancedManager.downloadFile(peerId, transferId, savePath);

      return {
        success: true,
        filePath
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 文件下载失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取传输进度
   */
  async handleGetTransferProgress(event, { transferId }) {
    try {
      const progress = this.enhancedManager.getFileTransferProgress(transferId);

      return {
        success: true,
        progress
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取传输进度失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 取消传输
   */
  async handleCancelTransfer(event, { transferId }) {
    try {
      await this.enhancedManager.cancelFileTransfer(transferId);

      return {
        success: true
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 取消传输失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取传输统计
   */
  async handleGetTransferStats(event) {
    try {
      const stats = this.enhancedManager.fileTransferManager.getStats();

      return {
        success: true,
        stats
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取传输统计失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取总体统计
   */
  async handleGetStats(event) {
    try {
      const stats = this.enhancedManager.getStats();

      return {
        success: true,
        stats
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取统计信息失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 处理发起通话
   */
  async handleStartCall(event, { peerId, type, options }) {
    try {
      const callId = await this.enhancedManager.startCall(peerId, type, options);

      return {
        success: true,
        callId
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 发起通话失败:', error);
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
      await this.enhancedManager.acceptCall(callId);

      return {
        success: true
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 接受通话失败:', error);
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
      await this.enhancedManager.rejectCall(callId, reason);

      return {
        success: true
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 拒绝通话失败:', error);
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
      await this.enhancedManager.endCall(callId);

      return {
        success: true
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 结束通话失败:', error);
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
      const isMuted = this.enhancedManager.toggleMute(callId);

      return {
        success: true,
        isMuted
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 切换静音失败:', error);
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
      const isVideoEnabled = this.enhancedManager.toggleVideo(callId);

      return {
        success: true,
        isVideoEnabled
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 切换视频失败:', error);
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
      const info = this.enhancedManager.getCallInfo(callId);

      return {
        success: true,
        info
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取通话信息失败:', error);
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
      const calls = this.enhancedManager.getActiveCalls();

      return {
        success: true,
        calls
      };
    } catch (error) {
      console.error('[P2PEnhancedIPC] 获取活动通话失败:', error);
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
    console.log('[P2PEnhancedIPC] 注销IPC处理器...');

    this.registeredHandlers.forEach(channel => {
      ipcMain.removeHandler(channel);
    });

    this.registeredHandlers = [];

    console.log('[P2PEnhancedIPC] ✅ IPC处理器已注销');
  }
}

module.exports = P2PEnhancedIPC;
