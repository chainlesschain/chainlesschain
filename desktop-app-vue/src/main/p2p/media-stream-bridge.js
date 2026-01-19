/**
 * MediaStream Bridge Service
 *
 * 在Electron主进程和渲染进程之间桥接MediaStream
 * 由于主进程无法直接访问getUserMedia，需要通过渲染进程获取媒体流
 */

let electron;
try {
  electron = require('electron');
} catch (error) {
  electron = {};
}

const createIpcMainStub = () => ({
  on: () => {},
  once: () => {},
  removeListener: () => {},
});

const { ipcMain = createIpcMainStub() } = electron || {};
const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');

class MediaStreamBridge extends EventEmitter {
  constructor() {
    super();

    // 存储媒体流信息
    this.streams = new Map(); // streamId -> { type, tracks, peerId, callId }
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

    this.registerHandlers();
  }

  /**
   * 注册IPC处理器
   */
  registerHandlers() {
    // 渲染进程通知媒体流已准备好
    ipcMain.on('media-stream:ready', (event, data) => {
      this.handleStreamReady(data);
    });

    // 渲染进程通知媒体流已停止
    ipcMain.on('media-stream:stopped', (event, data) => {
      this.handleStreamStopped(data);
    });

    // 渲染进程通知track状态变化
    ipcMain.on('media-stream:track-changed', (event, data) => {
      this.handleTrackChanged(data);
    });
  }

  /**
   * 请求媒体流
   * @param {string} type - 'audio' | 'video'
   * @param {Object} constraints - 媒体约束
   * @param {Object} options - 额外选项
   * @returns {Promise<Object>} 媒体流信息
   */
  async requestMediaStream(type, constraints = {}, options = {}) {
    const requestId = this._generateRequestId();

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('请求媒体流超时'));
      }, options.timeout || 30000);

      // 保存请求
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout
      });

      // 向所有渲染进程发送请求
      this.emit('request-media-stream', {
        requestId,
        type,
        constraints,
        callId: options.callId,
        peerId: options.peerId
      });
    });
  }

  /**
   * 处理媒体流就绪
   */
  handleStreamReady(data) {
    const { requestId, streamId, tracks, type } = data;

    logger.info('[MediaStreamBridge] 媒体流已就绪:', {
      requestId,
      streamId,
      trackCount: tracks.length
    });

    // 保存流信息
    this.streams.set(streamId, {
      type,
      tracks,
      peerId: data.peerId,
      callId: data.callId,
      createdAt: Date.now()
    });

    // 解决pending请求
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({
        streamId,
        tracks,
        type
      });
      this.pendingRequests.delete(requestId);
    }

    // 触发事件
    this.emit('stream-ready', {
      streamId,
      tracks,
      type,
      callId: data.callId
    });
  }

  /**
   * 处理媒体流停止
   */
  handleStreamStopped(data) {
    const { streamId } = data;

    logger.info('[MediaStreamBridge] 媒体流已停止:', streamId);

    const streamInfo = this.streams.get(streamId);
    if (streamInfo) {
      this.streams.delete(streamId);

      // 触发事件
      this.emit('stream-stopped', {
        streamId,
        callId: streamInfo.callId
      });
    }
  }

  /**
   * 处理track状态变化
   */
  handleTrackChanged(data) {
    const { streamId, trackId, kind, enabled } = data;

    const streamInfo = this.streams.get(streamId);
    if (streamInfo) {
      // 更新track状态
      const track = streamInfo.tracks.find(t => t.id === trackId);
      if (track) {
        track.enabled = enabled;
      }

      // 触发事件
      this.emit('track-changed', {
        streamId,
        trackId,
        kind,
        enabled,
        callId: streamInfo.callId
      });
    }
  }

  /**
   * 停止媒体流
   * @param {string} streamId - 流ID
   */
  stopMediaStream(streamId) {
    const streamInfo = this.streams.get(streamId);
    if (streamInfo) {
      // 通知渲染进程停止流
      this.emit('stop-media-stream', { streamId });

      // 清理本地记录
      this.streams.delete(streamId);
    }
  }

  /**
   * 获取媒体流信息
   * @param {string} streamId - 流ID
   * @returns {Object|null} 流信息
   */
  getStreamInfo(streamId) {
    return this.streams.get(streamId) || null;
  }

  /**
   * 获取所有活动流
   * @returns {Array} 流列表
   */
  getActiveStreams() {
    return Array.from(this.streams.entries()).map(([streamId, info]) => ({
      streamId,
      ...info
    }));
  }

  /**
   * 切换track启用状态
   * @param {string} streamId - 流ID
   * @param {string} kind - 'audio' | 'video'
   * @param {boolean} enabled - 是否启用
   */
  toggleTrack(streamId, kind, enabled) {
    const streamInfo = this.streams.get(streamId);
    if (streamInfo) {
      // 通知渲染进程切换track
      this.emit('toggle-track', {
        streamId,
        kind,
        enabled
      });

      // 更新本地状态
      streamInfo.tracks
        .filter(t => t.kind === kind)
        .forEach(t => {
          t.enabled = enabled;
        });
    }
  }

  /**
   * 生成请求ID
   */
  _generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清理所有pending请求
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('MediaStreamBridge已清理'));
    }
    this.pendingRequests.clear();

    // 停止所有流
    for (const streamId of this.streams.keys()) {
      this.stopMediaStream(streamId);
    }
    this.streams.clear();

    logger.info('[MediaStreamBridge] 资源已清理');
  }
}

module.exports = MediaStreamBridge;
