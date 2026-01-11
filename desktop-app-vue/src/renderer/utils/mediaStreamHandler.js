/**
 * MediaStream Handler (Renderer Process)
 *
 * 在渲染进程中处理媒体流获取和管理
 */

const { ipcRenderer } = window.require('electron');

class MediaStreamHandler {
  constructor() {
    this.streams = new Map(); // streamId -> MediaStream
    this.setupListeners();
  }

  /**
   * 设置事件监听
   */
  setupListeners() {
    // 监听主进程的媒体流请求
    ipcRenderer.on('media-stream:request', (event, data) => {
      this.handleStreamRequest(data);
    });

    // 监听停止流请求
    ipcRenderer.on('media-stream:stop', (event, data) => {
      this.handleStopRequest(data);
    });

    // 监听切换track请求
    ipcRenderer.on('media-stream:toggle-track', (event, data) => {
      this.handleToggleTrack(data);
    });
  }

  /**
   * 处理媒体流请求
   */
  async handleStreamRequest(data) {
    const { requestId, type, constraints, callId, peerId } = data;

    try {
      console.log('[MediaStreamHandler] 收到媒体流请求:', {
        requestId,
        type,
        callId
      });

      // 构建约束
      const mediaConstraints = this.buildConstraints(type, constraints);

      // 获取媒体流
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

      // 生成streamId
      const streamId = stream.id || this.generateStreamId();

      // 保存流
      this.streams.set(streamId, stream);

      // 提取track信息
      const tracks = stream.getTracks().map(track => ({
        id: track.id,
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      }));

      // 监听track事件
      stream.getTracks().forEach(track => {
        track.onended = () => {
          console.log('[MediaStreamHandler] Track已结束:', track.kind);
          this.notifyTrackChanged(streamId, track.id, track.kind, false);
        };

        track.onmute = () => {
          console.log('[MediaStreamHandler] Track已静音:', track.kind);
          this.notifyTrackChanged(streamId, track.id, track.kind, false);
        };

        track.onunmute = () => {
          console.log('[MediaStreamHandler] Track已取消静音:', track.kind);
          this.notifyTrackChanged(streamId, track.id, track.kind, true);
        };
      });

      // 通知主进程
      ipcRenderer.send('media-stream:ready', {
        requestId,
        streamId,
        tracks,
        type,
        callId,
        peerId
      });

      console.log('[MediaStreamHandler] 媒体流已就绪:', {
        streamId,
        trackCount: tracks.length
      });

      return stream;
    } catch (error) {
      console.error('[MediaStreamHandler] 获取媒体流失败:', error);

      // 通知主进程失败
      ipcRenderer.send('media-stream:error', {
        requestId,
        error: {
          name: error.name,
          message: error.message
        }
      });

      throw error;
    }
  }

  /**
   * 处理停止流请求
   */
  handleStopRequest(data) {
    const { streamId } = data;

    const stream = this.streams.get(streamId);
    if (stream) {
      // 停止所有track
      stream.getTracks().forEach(track => {
        track.stop();
      });

      // 清理
      this.streams.delete(streamId);

      // 通知主进程
      ipcRenderer.send('media-stream:stopped', { streamId });

      console.log('[MediaStreamHandler] 媒体流已停止:', streamId);
    }
  }

  /**
   * 处理切换track请求
   */
  handleToggleTrack(data) {
    const { streamId, kind, enabled } = data;

    const stream = this.streams.get(streamId);
    if (stream) {
      const tracks = stream.getTracks().filter(t => t.kind === kind);

      tracks.forEach(track => {
        track.enabled = enabled;

        // 通知主进程
        this.notifyTrackChanged(streamId, track.id, kind, enabled);
      });

      console.log('[MediaStreamHandler] Track状态已切换:', {
        streamId,
        kind,
        enabled
      });
    }
  }

  /**
   * 通知track状态变化
   */
  notifyTrackChanged(streamId, trackId, kind, enabled) {
    ipcRenderer.send('media-stream:track-changed', {
      streamId,
      trackId,
      kind,
      enabled
    });
  }

  /**
   * 构建媒体约束
   */
  buildConstraints(type, customConstraints = {}) {
    const constraints = {};

    if (type === 'audio' || type === 'video') {
      // 音频约束
      constraints.audio = customConstraints.audio || {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      // 视频约束
      if (type === 'video') {
        constraints.video = customConstraints.video || {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        };
      } else {
        constraints.video = false;
      }
    }

    return constraints;
  }

  /**
   * 生成streamId
   */
  generateStreamId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取媒体流
   * @param {string} streamId - 流ID
   * @returns {MediaStream|null}
   */
  getStream(streamId) {
    return this.streams.get(streamId) || null;
  }

  /**
   * 获取所有活动流
   * @returns {Array<{streamId: string, stream: MediaStream}>}
   */
  getActiveStreams() {
    return Array.from(this.streams.entries()).map(([streamId, stream]) => ({
      streamId,
      stream
    }));
  }

  /**
   * 清理所有流
   */
  cleanup() {
    for (const [streamId, stream] of this.streams) {
      stream.getTracks().forEach(track => track.stop());
    }
    this.streams.clear();

    console.log('[MediaStreamHandler] 所有媒体流已清理');
  }
}

// 创建全局实例
const mediaStreamHandler = new MediaStreamHandler();

// 导出
export default mediaStreamHandler;

// 也可以通过window访问
if (typeof window !== 'undefined') {
  window.mediaStreamHandler = mediaStreamHandler;
}
