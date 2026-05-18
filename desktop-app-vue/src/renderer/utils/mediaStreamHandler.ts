/**
 * MediaStream Handler (Renderer Process)
 *
 * 在渲染进程中处理媒体流获取和管理
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 媒体流类型
 */
export type MediaStreamType = 'audio' | 'video' | 'screen';

/**
 * Track 类型
 */
export type TrackKind = 'audio' | 'video';

/**
 * Track 状态
 */
export type TrackReadyState = 'live' | 'ended';

/**
 * Track 信息
 */
export interface TrackInfo {
  id: string;
  kind: TrackKind;
  label: string;
  enabled: boolean;
  muted: boolean;
  readyState: TrackReadyState;
}

/**
 * 媒体流请求数据
 */
export interface MediaStreamRequestData {
  requestId: string;
  type: MediaStreamType;
  constraints?: MediaStreamConstraintsConfig;
  callId?: string;
  peerId?: string;
}

/**
 * 媒体流停止请求数据
 */
export interface MediaStreamStopData {
  streamId: string;
}

/**
 * Track 切换请求数据
 */
export interface MediaStreamToggleTrackData {
  streamId: string;
  kind: TrackKind;
  enabled: boolean;
}

/**
 * 媒体流就绪数据
 */
export interface MediaStreamReadyData {
  requestId: string;
  streamId: string;
  tracks: TrackInfo[];
  type: MediaStreamType;
  callId?: string;
  peerId?: string;
}

/**
 * 媒体流错误数据
 */
export interface MediaStreamErrorData {
  requestId: string;
  error: {
    name: string;
    message: string;
  };
}

/**
 * Track 变更数据
 */
export interface MediaStreamTrackChangedData {
  streamId: string;
  trackId: string;
  kind: TrackKind;
  enabled: boolean;
}

/**
 * 媒体流约束配置
 */
export interface MediaStreamConstraintsConfig {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
  sourceId?: string;
}

/**
 * 屏幕源信息
 */
export interface ScreenSourceInfo {
  id: string;
  name: string;
  thumbnail: string;
  type: 'screen' | 'window';
}

/**
 * 活动流信息
 */
export interface ActiveStreamInfo {
  streamId: string;
  stream: MediaStream;
}

/**
 * IPC Renderer 接口
 */
interface IpcRenderer {
  on: (channel: string, listener: (event: any, data: any) => void) => void;
  send: (channel: string, data: any) => void;
}

/**
 * Desktop Capturer Source
 */
interface DesktopCapturerSource {
  id: string;
  name: string;
  thumbnail: {
    toDataURL: () => string;
  };
}

/**
 * Desktop Capturer 接口
 */
interface DesktopCapturer {
  getSources: (options: {
    types: string[];
    thumbnailSize: { width: number; height: number };
  }) => Promise<DesktopCapturerSource[]>;
}

/**
 * Electron 接口
 */
interface ElectronGlobal {
  ipcRenderer?: IpcRenderer;
  desktopCapturer?: DesktopCapturer;
}

// ==================== 辅助函数 ====================

/**
 * 获取 IPC Renderer
 */
const getIpcRenderer = (): IpcRenderer | undefined =>
  (window as any).electron?.ipcRenderer as IpcRenderer | undefined;

/**
 * 获取 Desktop Capturer
 */
const getDesktopCapturer = (): DesktopCapturer | undefined =>
  (window as any).electron?.desktopCapturer as DesktopCapturer | undefined;

// ==================== MediaStreamHandler 类 ====================

/**
 * 媒体流处理器类
 */
class MediaStreamHandler {
  private streams: Map<string, MediaStream>;

  constructor() {
    this.streams = new Map();
    // Defer setup until DOM is ready to ensure preload has completed
    if (typeof window !== 'undefined') {
      if (document.readyState === 'complete') {
        this.setupListeners();
      } else {
        window.addEventListener('DOMContentLoaded', () => this.setupListeners());
      }
    }
  }

  /**
   * 设置事件监听
   */
  setupListeners(): void {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      logger.warn('[MediaStreamHandler] ipcRenderer not available, skipping listener setup');
      return;
    }

    // 监听主进程的媒体流请求
    ipcRenderer.on('media-stream:request', (_event: any, data: MediaStreamRequestData) => {
      this.handleStreamRequest(data);
    });

    // 监听停止流请求
    ipcRenderer.on('media-stream:stop', (_event: any, data: MediaStreamStopData) => {
      this.handleStopRequest(data);
    });

    // 监听切换track请求
    ipcRenderer.on('media-stream:toggle-track', (_event: any, data: MediaStreamToggleTrackData) => {
      this.handleToggleTrack(data);
    });
  }

  /**
   * 处理媒体流请求
   */
  async handleStreamRequest(data: MediaStreamRequestData): Promise<MediaStream> {
    const { requestId, type, constraints, callId, peerId } = data;

    try {
      logger.info('[MediaStreamHandler] 收到媒体流请求:', {
        requestId,
        type,
        callId
      });

      let stream: MediaStream;

      // 根据类型获取媒体流
      if (type === 'screen') {
        // 屏幕共享使用desktopCapturer
        stream = await this.getScreenStream(constraints);
      } else {
        // 音频/视频使用getUserMedia
        const mediaConstraints = this.buildConstraints(type, constraints);
        stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      }

      // 生成streamId
      const streamId = stream.id || this.generateStreamId();

      // 保存流
      this.streams.set(streamId, stream);

      // 提取track信息
      const tracks: TrackInfo[] = stream.getTracks().map(track => ({
        id: track.id,
        kind: track.kind as TrackKind,
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState as TrackReadyState
      }));

      // 监听track事件
      stream.getTracks().forEach(track => {
        track.onended = () => {
          logger.info('[MediaStreamHandler] Track已结束:', { kind: track.kind });
          this.notifyTrackChanged(streamId, track.id, track.kind as TrackKind, false);
        };

        track.onmute = () => {
          logger.info('[MediaStreamHandler] Track已静音:', { kind: track.kind });
          this.notifyTrackChanged(streamId, track.id, track.kind as TrackKind, false);
        };

        track.onunmute = () => {
          logger.info('[MediaStreamHandler] Track已取消静音:', { kind: track.kind });
          this.notifyTrackChanged(streamId, track.id, track.kind as TrackKind, true);
        };
      });

      // 通知主进程
      const readyData: MediaStreamReadyData = {
        requestId,
        streamId,
        tracks,
        type,
        callId,
        peerId
      };
      getIpcRenderer()?.send('media-stream:ready', readyData);

      logger.info('[MediaStreamHandler] 媒体流已就绪:', {
        streamId,
        trackCount: tracks.length
      });

      return stream;
    } catch (error) {
      const err = error as Error;
      logger.error('[MediaStreamHandler] 获取媒体流失败:', err as any);

      // 通知主进程失败
      const errorData: MediaStreamErrorData = {
        requestId,
        error: {
          name: err.name,
          message: err.message
        }
      };
      getIpcRenderer()?.send('media-stream:error', errorData);

      throw error;
    }
  }

  /**
   * 获取屏幕共享流
   */
  async getScreenStream(constraints: MediaStreamConstraintsConfig = {}): Promise<MediaStream> {
    const desktopCapturer = getDesktopCapturer();
    if (!desktopCapturer) {
      throw new Error('desktopCapturer not available');
    }

    try {
      // 获取可用的屏幕和窗口源
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 150, height: 150 }
      });

      if (sources.length === 0) {
        throw new Error('没有可用的屏幕或窗口');
      }

      // 如果指定了sourceId，使用指定的源
      let selectedSource: DesktopCapturerSource | undefined;
      if (constraints.sourceId) {
        selectedSource = sources.find(s => s.id === constraints.sourceId);
        if (!selectedSource) {
          throw new Error('指定的屏幕源不存在');
        }
      } else {
        // 默认使用第一个屏幕
        selectedSource = sources.find(s => s.id.startsWith('screen')) || sources[0];
      }

      logger.info('[MediaStreamHandler] 选择屏幕源:', {
        id: selectedSource.id,
        name: selectedSource.name
      });

      // 获取屏幕流
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSource.id
          }
        } as any
      });

      return stream;
    } catch (error) {
      logger.error('[MediaStreamHandler] 获取屏幕流失败:', error as any);
      throw error;
    }
  }

  /**
   * 获取可用的屏幕源列表（用于UI选择）
   */
  async getAvailableScreenSources(): Promise<ScreenSourceInfo[]> {
    const desktopCapturer = getDesktopCapturer();
    if (!desktopCapturer) {
      throw new Error('desktopCapturer not available');
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 150, height: 150 }
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        type: source.id.startsWith('screen') ? 'screen' as const : 'window' as const
      }));
    } catch (error) {
      logger.error('[MediaStreamHandler] 获取屏幕源列表失败:', error as any);
      throw error;
    }
  }

  /**
   * 处理停止流请求
   */
  handleStopRequest(data: MediaStreamStopData): void {
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
      getIpcRenderer()?.send('media-stream:stopped', { streamId });

      logger.info('[MediaStreamHandler] 媒体流已停止:', { streamId });
    }
  }

  /**
   * 处理切换track请求
   */
  handleToggleTrack(data: MediaStreamToggleTrackData): void {
    const { streamId, kind, enabled } = data;

    const stream = this.streams.get(streamId);
    if (stream) {
      const tracks = stream.getTracks().filter(t => t.kind === kind);

      tracks.forEach(track => {
        track.enabled = enabled;

        // 通知主进程
        this.notifyTrackChanged(streamId, track.id, kind, enabled);
      });

      logger.info('[MediaStreamHandler] Track状态已切换:', {
        streamId,
        kind,
        enabled
      });
    }
  }

  /**
   * 通知track状态变化
   */
  notifyTrackChanged(streamId: string, trackId: string, kind: TrackKind, enabled: boolean): void {
    const data: MediaStreamTrackChangedData = {
      streamId,
      trackId,
      kind,
      enabled
    };
    getIpcRenderer()?.send('media-stream:track-changed', data);
  }

  /**
   * 构建媒体约束
   */
  buildConstraints(type: MediaStreamType, customConstraints: MediaStreamConstraintsConfig = {}): MediaStreamConstraints {
    const constraints: MediaStreamConstraints = {};

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
  generateStreamId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取媒体流
   * @param streamId - 流ID
   * @returns MediaStream 或 null
   */
  getStream(streamId: string): MediaStream | null {
    return this.streams.get(streamId) || null;
  }

  /**
   * 获取所有活动流
   * @returns 活动流信息数组
   */
  getActiveStreams(): ActiveStreamInfo[] {
    return Array.from(this.streams.entries()).map(([streamId, stream]) => ({
      streamId,
      stream
    }));
  }

  /**
   * 清理所有流
   */
  cleanup(): void {
    this.streams.forEach((stream) => {
      stream.getTracks().forEach(track => track.stop());
    });
    this.streams.clear();

    logger.info('[MediaStreamHandler] 所有媒体流已清理');
  }
}

// ==================== 导出 ====================

// 创建全局实例
const mediaStreamHandler = new MediaStreamHandler();

// 导出实例
export default mediaStreamHandler;

// 导出类用于类型
export { MediaStreamHandler };

// 扩展 Window 接口
declare global {
  interface Window {
    mediaStreamHandler?: MediaStreamHandler;
  }
}

// 也可以通过window访问
if (typeof window !== 'undefined') {
  window.mediaStreamHandler = mediaStreamHandler;
}
