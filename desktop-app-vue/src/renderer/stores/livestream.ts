/**
 * Livestream Store - Pinia State Management
 *
 * Manages decentralized livestream state:
 * - Active stream listing and discovery
 * - Current stream viewing state
 * - Viewer tracking
 * - Danmaku (bullet chat) message queue
 * - Stream creation and lifecycle
 *
 * @module livestream-store
 * @version 0.44.0
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { createRetryableIPC } from '../utils/ipc';

// ==================== Type Definitions ====================

/**
 * Stream status
 */
export type StreamStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

/**
 * Stream access type
 */
export type StreamAccessType = 'public' | 'friends' | 'password' | 'invite';

/**
 * Danmaku message type
 */
export type DanmakuMessageType = 'normal' | 'top' | 'bottom' | 'special';

/**
 * Livestream
 */
export interface Livestream {
  id: string;
  title: string;
  description: string;
  streamer_did: string;
  status: StreamStatus;
  access_type: StreamAccessType;
  access_code: string | null;
  viewer_count: number;
  max_viewers: number;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * Livestream viewer
 */
export interface LivestreamViewer {
  id: string;
  stream_id: string;
  viewer_did: string;
  status: 'watching' | 'left';
  joined_at: number;
  left_at: number | null;
  [key: string]: any;
}

/**
 * Danmaku message
 */
export interface DanmakuMessage {
  id: string;
  stream_id: string;
  sender_did: string;
  content: string;
  message_type: DanmakuMessageType;
  color: string;
  font_size: number;
  position: number;
  is_moderated: number;
  created_at: number;
  [key: string]: any;
}

/**
 * Create stream parameters
 */
export interface CreateStreamParams {
  title: string;
  description?: string;
  accessType?: StreamAccessType;
  accessCode?: string;
  maxViewers?: number;
}

/**
 * Send danmaku parameters
 */
export interface SendDanmakuParams {
  streamId: string;
  senderDid: string;
  content: string;
  options?: {
    messageType?: DanmakuMessageType;
    color?: string;
    fontSize?: number;
    position?: number;
  };
}

/**
 * Livestream store state
 */
export interface LivestreamState {
  activeStreams: Livestream[];
  currentStream: Livestream | null;
  viewers: LivestreamViewer[];
  danmakuQueue: DanmakuMessage[];
  isStreaming: boolean;
  viewerCount: number;
  loading: boolean;
  myStreams: Livestream[];
}

// ==================== IPC Setup ====================

const ipcRenderer = createRetryableIPC((window as any).electron?.ipcRenderer, {
  silentErrors: true,
});

// ==================== Constants ====================

const MAX_DANMAKU_QUEUE_SIZE = 100;

// ==================== Store ====================

export const useLivestreamStore = defineStore('livestream', {
  state: (): LivestreamState => ({
    activeStreams: [],
    currentStream: null,
    viewers: [],
    danmakuQueue: [],
    isStreaming: false,
    viewerCount: 0,
    loading: false,
    myStreams: [],
  }),

  getters: {
    /**
     * Whether currently viewing or streaming
     */
    isInStream(): boolean {
      return this.currentStream !== null;
    },

    /**
     * Whether the current stream is live
     */
    isCurrentStreamLive(): boolean {
      return this.currentStream?.status === 'live';
    },

    /**
     * Active viewer count for current stream
     */
    activeViewerCount(): number {
      return this.viewers.filter((v) => v.status === 'watching').length;
    },

    /**
     * Number of danmaku messages in queue
     */
    danmakuCount(): number {
      return this.danmakuQueue.length;
    },

    /**
     * Public active streams
     */
    publicActiveStreams(): Livestream[] {
      return this.activeStreams.filter((s) => s.access_type === 'public');
    },

    /**
     * Live streams from my streams list
     */
    myLiveStreams(): Livestream[] {
      return this.myStreams.filter((s) => s.status === 'live');
    },

    /**
     * Scheduled streams from my streams list
     */
    myScheduledStreams(): Livestream[] {
      return this.myStreams.filter((s) => s.status === 'scheduled');
    },
  },

  actions: {
    // ========== Stream Discovery ==========

    /**
     * Load active (live) streams
     */
    async loadActiveStreams(): Promise<void> {
      this.loading = true;
      try {
        const streams = await ipcRenderer.invoke('livestream:get-active');
        this.activeStreams = Array.isArray(streams) ? streams : [];
      } catch (error: any) {
        if (error?.message !== 'IPC not available') {
          logger.error('Failed to load active streams:', error);
        }
        this.activeStreams = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Load streams created by the current user
     */
    async loadMyStreams(): Promise<void> {
      this.loading = true;
      try {
        const streams = await ipcRenderer.invoke('livestream:get-my-streams');
        this.myStreams = Array.isArray(streams) ? streams : [];
      } catch (error: any) {
        if (error?.message !== 'IPC not available') {
          logger.error('Failed to load my streams:', error);
        }
        this.myStreams = [];
      } finally {
        this.loading = false;
      }
    },

    // ========== Stream Lifecycle ==========

    /**
     * Create a new livestream
     */
    async createStream(params: CreateStreamParams): Promise<Livestream> {
      try {
        const stream = await ipcRenderer.invoke('livestream:create', params);
        this.myStreams.unshift(stream);
        return stream;
      } catch (error) {
        logger.error('Failed to create stream:', error as any);
        throw error;
      }
    },

    /**
     * Start a scheduled stream
     */
    async startStream(streamId: string): Promise<Livestream> {
      try {
        const stream = await ipcRenderer.invoke('livestream:start', streamId);
        this.currentStream = stream;
        this.isStreaming = true;

        // Update in myStreams
        const idx = this.myStreams.findIndex((s) => s.id === streamId);
        if (idx !== -1) {
          this.myStreams[idx] = stream;
        }

        return stream;
      } catch (error) {
        logger.error('Failed to start stream:', error as any);
        throw error;
      }
    },

    /**
     * End a live stream
     */
    async endStream(streamId: string): Promise<Livestream> {
      try {
        const stream = await ipcRenderer.invoke('livestream:end', streamId);
        this.isStreaming = false;
        this.viewerCount = 0;
        this.viewers = [];
        this.danmakuQueue = [];

        // Update current stream
        if (this.currentStream?.id === streamId) {
          this.currentStream = stream;
        }

        // Update in myStreams
        const idx = this.myStreams.findIndex((s) => s.id === streamId);
        if (idx !== -1) {
          this.myStreams[idx] = stream;
        }

        return stream;
      } catch (error) {
        logger.error('Failed to end stream:', error as any);
        throw error;
      }
    },

    // ========== Viewer Actions ==========

    /**
     * Join a livestream as a viewer
     */
    async joinStream(streamId: string, accessCode?: string): Promise<Livestream> {
      try {
        const stream = await ipcRenderer.invoke(
          'livestream:join',
          streamId,
          accessCode || null,
        );
        this.currentStream = stream;
        this.viewerCount = stream.viewer_count || 0;

        // Load viewers
        await this.loadViewers(streamId);

        return stream;
      } catch (error) {
        logger.error('Failed to join stream:', error as any);
        throw error;
      }
    },

    /**
     * Leave the current livestream
     */
    async leaveStream(streamId: string): Promise<void> {
      try {
        await ipcRenderer.invoke('livestream:leave', streamId);

        if (this.currentStream?.id === streamId) {
          this.currentStream = null;
          this.viewers = [];
          this.viewerCount = 0;
          this.danmakuQueue = [];
        }
      } catch (error) {
        logger.error('Failed to leave stream:', error as any);
        throw error;
      }
    },

    /**
     * Load viewers for a stream
     */
    async loadViewers(streamId: string): Promise<void> {
      try {
        const viewers = await ipcRenderer.invoke(
          'livestream:get-viewers',
          streamId,
          true,
        );
        this.viewers = Array.isArray(viewers) ? viewers : [];
        this.viewerCount = this.viewers.length;
      } catch (error) {
        logger.error('Failed to load viewers:', error as any);
        this.viewers = [];
      }
    },

    // ========== Danmaku Actions ==========

    /**
     * Send a danmaku message
     */
    async sendDanmaku(params: SendDanmakuParams): Promise<DanmakuMessage> {
      try {
        const danmaku = await ipcRenderer.invoke('danmaku:send', params);
        this.addDanmaku(danmaku);
        return danmaku;
      } catch (error) {
        logger.error('Failed to send danmaku:', error as any);
        throw error;
      }
    },

    /**
     * Load danmaku history for a stream
     */
    async loadDanmakuHistory(
      streamId: string,
      limit: number = 50,
      offset: number = 0,
    ): Promise<void> {
      try {
        const messages = await ipcRenderer.invoke(
          'danmaku:get-history',
          streamId,
          limit,
          offset,
        );
        const safeMsgs: DanmakuMessage[] = Array.isArray(messages) ? messages : [];

        if (offset === 0) {
          // Replace queue with history (reversed to chronological order)
          this.danmakuQueue = safeMsgs.reverse().slice(-MAX_DANMAKU_QUEUE_SIZE);
        } else {
          // Prepend older messages
          const combined = [...safeMsgs.reverse(), ...this.danmakuQueue];
          this.danmakuQueue = combined.slice(-MAX_DANMAKU_QUEUE_SIZE);
        }
      } catch (error) {
        logger.error('Failed to load danmaku history:', error as any);
      }
    },

    /**
     * Add a danmaku message to the queue (local, for real-time display)
     * Maintains a max queue size of 100 items.
     */
    addDanmaku(danmaku: DanmakuMessage): void {
      // Avoid duplicates
      if (this.danmakuQueue.some((d) => d.id === danmaku.id)) {
        return;
      }

      this.danmakuQueue.push(danmaku);

      // Trim to max size
      if (this.danmakuQueue.length > MAX_DANMAKU_QUEUE_SIZE) {
        this.danmakuQueue = this.danmakuQueue.slice(-MAX_DANMAKU_QUEUE_SIZE);
      }
    },

    /**
     * Clear danmaku queue
     */
    clearDanmakuQueue(): void {
      this.danmakuQueue = [];
    },

    // ========== State Management ==========

    /**
     * Update viewer count (called from event listener)
     */
    updateViewerCount(streamId: string, count: number): void {
      if (this.currentStream?.id === streamId) {
        this.viewerCount = count;
        this.currentStream.viewer_count = count;
      }

      // Update in activeStreams
      const activeStream = this.activeStreams.find((s) => s.id === streamId);
      if (activeStream) {
        activeStream.viewer_count = count;
      }
    },

    /**
     * Reset store state
     */
    resetState(): void {
      this.activeStreams = [];
      this.currentStream = null;
      this.viewers = [];
      this.danmakuQueue = [];
      this.isStreaming = false;
      this.viewerCount = 0;
      this.loading = false;
      this.myStreams = [];
    },
  },
});
