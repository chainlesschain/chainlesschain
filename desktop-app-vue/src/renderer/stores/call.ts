/**
 * Call Store - Voice/Video Call State Management
 *
 * Manages the state of voice/video calls including room lifecycle,
 * participant tracking, media controls, and call quality monitoring.
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

/**
 * Call type
 */
export type CallType = 'voice' | 'video';

/**
 * Room status
 */
export type RoomStatus = 'active' | 'ended';

/**
 * Participant role
 */
export type ParticipantRole = 'host' | 'participant';

/**
 * Participant connection status
 */
export type ParticipantStatus = 'ringing' | 'connected' | 'left';

/**
 * Call quality level
 */
export type QualityLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

/**
 * Call room
 */
export interface CallRoom {
  id: string;
  type: CallType;
  creatorDid: string;
  status: RoomStatus;
  maxParticipants: number;
  createdAt: number;
  endedAt: number | null;
}

/**
 * Call participant
 */
export interface CallParticipant {
  id: string;
  roomId: string;
  participantDid: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  joinedAt: number | null;
  leftAt: number | null;
}

/**
 * Call quality metrics
 */
export interface CallQuality {
  bytesReceived: number;
  bytesSent: number;
  packetsLost: number;
  packetLossRate: number;
  roundTripTime: number;
  jitter: number;
  framesPerSecond: number;
  level: QualityLevel;
  timestamp: number;
}

/**
 * Incoming call info
 */
export interface IncomingCall {
  roomId: string;
  callerDid: string;
  type: CallType;
}

/**
 * Call store state
 */
export interface CallState {
  activeCall: CallRoom | null;
  incomingCall: IncomingCall | null;
  participants: CallParticipant[];
  localStreamActive: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  callQuality: CallQuality | null;
  activeRooms: CallRoom[];
  loading: boolean;
  callDuration: number;
}

// ==================== IPC Setup ====================

const ipcRenderer =
  (window as any).electron?.ipcRenderer ??
  (window as any).require?.('electron')?.ipcRenderer;

const invokeIPC = async <T = any>(channel: string, ...args: any[]): Promise<T> => {
  const ipcInvoke =
    (window as any).ipc?.invoke?.bind((window as any).ipc) ??
    (window as any).electron?.ipcRenderer?.invoke?.bind(
      (window as any).electron?.ipcRenderer,
    ) ??
    (window as any).electronAPI?.invoke?.bind((window as any).electronAPI) ??
    (window as any)
      .require?.('electron')
      ?.ipcRenderer?.invoke?.bind(
        (window as any).require?.('electron')?.ipcRenderer,
      );

  if (!ipcInvoke) {
    throw new Error('IPC invoke is not available');
  }
  return ipcInvoke(channel, ...args) as Promise<T>;
};

// ==================== Store ====================

export const useCallStore = defineStore('call', {
  state: (): CallState => ({
    activeCall: null,
    incomingCall: null,
    participants: [],
    localStreamActive: false,
    audioEnabled: true,
    videoEnabled: true,
    screenSharing: false,
    callQuality: null,
    activeRooms: [],
    loading: false,
    callDuration: 0,
  }),

  getters: {
    /**
     * Whether a call is currently active
     */
    isInCall(): boolean {
      return this.activeCall !== null && this.activeCall.status === 'active';
    },

    /**
     * Whether there is an incoming call
     */
    hasIncomingCall(): boolean {
      return this.incomingCall !== null;
    },

    /**
     * Connected participants (excluding left)
     */
    connectedParticipants(): CallParticipant[] {
      return this.participants.filter((p) => p.status === 'connected');
    },

    /**
     * Number of connected participants
     */
    participantCount(): number {
      return this.connectedParticipants.length;
    },

    /**
     * Whether the current call is a video call
     */
    isVideoCall(): boolean {
      return this.activeCall?.type === 'video';
    },

    /**
     * Host participant
     */
    hostParticipant(): CallParticipant | undefined {
      return this.participants.find((p) => p.role === 'host');
    },

    /**
     * Quality level text
     */
    qualityLevelText(): string {
      if (!this.callQuality) return '';
      const labels: Record<QualityLevel, string> = {
        excellent: 'Excellent',
        good: 'Good',
        fair: 'Fair',
        poor: 'Poor',
        unknown: 'Unknown',
      };
      return labels[this.callQuality.level] || '';
    },

    /**
     * Formatted call duration (MM:SS)
     */
    formattedDuration(): string {
      const minutes = Math.floor(this.callDuration / 60);
      const seconds = this.callDuration % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    },
  },

  actions: {
    /**
     * Create a new call
     */
    async createCall(
      type: CallType,
      inviteDids: string[] = [],
      maxParticipants?: number,
    ): Promise<boolean> {
      try {
        this.loading = true;

        const result = await invokeIPC<{
          success: boolean;
          room?: CallRoom;
          error?: string;
        }>('call:create-room', {
          type,
          maxParticipants,
          inviteDids,
        });

        if (result.success && result.room) {
          this.activeCall = result.room;
          this.localStreamActive = true;
          this.audioEnabled = true;
          this.videoEnabled = type === 'video';
          this.screenSharing = false;
          this.callDuration = 0;

          // Load participants
          await this.loadParticipants(result.room.id);

          logger.info(`[CallStore] Call created: ${result.room.id} (${type})`);
          return true;
        } else {
          logger.error('[CallStore] Create call failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] Create call error:', error as any);
        return false;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Join an existing call
     */
    async joinCall(roomId: string): Promise<boolean> {
      try {
        this.loading = true;

        const result = await invokeIPC<{
          success: boolean;
          room?: CallRoom;
          error?: string;
        }>('call:join-room', { roomId });

        if (result.success && result.room) {
          this.activeCall = result.room;
          this.localStreamActive = true;
          this.audioEnabled = true;
          this.videoEnabled = result.room.type === 'video';
          this.screenSharing = false;
          this.callDuration = 0;

          await this.loadParticipants(roomId);

          logger.info(`[CallStore] Joined call: ${roomId}`);
          return true;
        } else {
          logger.error('[CallStore] Join call failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] Join call error:', error as any);
        return false;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Leave the current call
     */
    async leaveCall(): Promise<boolean> {
      try {
        if (!this.activeCall) {
          return true;
        }

        const roomId = this.activeCall.id;

        const result = await invokeIPC<{
          success: boolean;
          error?: string;
        }>('call:leave-room', { roomId });

        if (result.success) {
          this._resetCallState();
          logger.info(`[CallStore] Left call: ${roomId}`);
          return true;
        } else {
          logger.error('[CallStore] Leave call failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] Leave call error:', error as any);
        return false;
      }
    },

    /**
     * End the current call (host action)
     */
    async endCall(): Promise<boolean> {
      try {
        if (!this.activeCall) {
          return true;
        }

        const roomId = this.activeCall.id;

        const result = await invokeIPC<{
          success: boolean;
          error?: string;
        }>('call:end-room', { roomId });

        if (result.success) {
          this._resetCallState();
          logger.info(`[CallStore] Ended call: ${roomId}`);
          return true;
        } else {
          logger.error('[CallStore] End call failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] End call error:', error as any);
        return false;
      }
    },

    /**
     * Toggle audio (mute/unmute)
     */
    async toggleAudio(): Promise<boolean> {
      try {
        if (!this.activeCall) {
          return false;
        }

        const newState = !this.audioEnabled;

        const result = await invokeIPC<{
          success: boolean;
          audioEnabled?: boolean;
          error?: string;
        }>('call:toggle-audio', {
          roomId: this.activeCall.id,
          enabled: newState,
        });

        if (result.success) {
          this.audioEnabled = result.audioEnabled ?? newState;
          return true;
        } else {
          logger.error('[CallStore] Toggle audio failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] Toggle audio error:', error as any);
        return false;
      }
    },

    /**
     * Toggle video (camera on/off)
     */
    async toggleVideo(): Promise<boolean> {
      try {
        if (!this.activeCall) {
          return false;
        }

        const newState = !this.videoEnabled;

        const result = await invokeIPC<{
          success: boolean;
          videoEnabled?: boolean;
          error?: string;
        }>('call:toggle-video', {
          roomId: this.activeCall.id,
          enabled: newState,
        });

        if (result.success) {
          this.videoEnabled = result.videoEnabled ?? newState;
          return true;
        } else {
          logger.error('[CallStore] Toggle video failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] Toggle video error:', error as any);
        return false;
      }
    },

    /**
     * Toggle screen sharing
     */
    async shareScreen(sourceId?: string): Promise<boolean> {
      try {
        if (!this.activeCall) {
          return false;
        }

        const result = await invokeIPC<{
          success: boolean;
          screenSharing?: boolean;
          error?: string;
        }>('call:share-screen', {
          roomId: this.activeCall.id,
          sourceId,
        });

        if (result.success) {
          this.screenSharing = result.screenSharing ?? !this.screenSharing;
          return true;
        } else {
          logger.error('[CallStore] Screen share failed:', result.error);
          return false;
        }
      } catch (error) {
        logger.error('[CallStore] Screen share error:', error as any);
        return false;
      }
    },

    /**
     * Accept an incoming call
     */
    async acceptIncoming(): Promise<boolean> {
      try {
        if (!this.incomingCall) {
          return false;
        }

        const { roomId } = this.incomingCall;
        const joined = await this.joinCall(roomId);

        if (joined) {
          this.incomingCall = null;
        }

        return joined;
      } catch (error) {
        logger.error('[CallStore] Accept incoming error:', error as any);
        return false;
      }
    },

    /**
     * Reject an incoming call
     */
    async rejectIncoming(): Promise<boolean> {
      try {
        if (!this.incomingCall) {
          return true;
        }

        this.incomingCall = null;
        logger.info('[CallStore] Incoming call rejected');
        return true;
      } catch (error) {
        logger.error('[CallStore] Reject incoming error:', error as any);
        return false;
      }
    },

    /**
     * Load active rooms
     */
    async loadActiveRooms(): Promise<void> {
      try {
        const result = await invokeIPC<{
          success: boolean;
          rooms?: CallRoom[];
          error?: string;
        }>('call:get-active-rooms');

        if (result.success && result.rooms) {
          this.activeRooms = result.rooms;
        }
      } catch (error) {
        logger.error('[CallStore] Load active rooms error:', error as any);
      }
    },

    /**
     * Load participants for a room
     */
    async loadParticipants(roomId: string): Promise<void> {
      try {
        const result = await invokeIPC<{
          success: boolean;
          participants?: CallParticipant[];
          error?: string;
        }>('call:get-participants', { roomId });

        if (result.success && result.participants) {
          this.participants = result.participants;
        }
      } catch (error) {
        logger.error('[CallStore] Load participants error:', error as any);
      }
    },

    /**
     * Set incoming call (called from IPC event listener)
     */
    setIncomingCall(call: IncomingCall): void {
      this.incomingCall = call;
    },

    /**
     * Update call quality metrics
     */
    updateQuality(quality: CallQuality): void {
      this.callQuality = quality;
    },

    /**
     * Update participant status
     */
    updateParticipant(participantDid: string, status: ParticipantStatus): void {
      const participant = this.participants.find(
        (p) => p.participantDid === participantDid,
      );
      if (participant) {
        participant.status = status;
        if (status === 'left') {
          participant.leftAt = Date.now();
        }
      }
    },

    /**
     * Add a participant to the current call
     */
    addParticipant(participant: CallParticipant): void {
      const existing = this.participants.find(
        (p) => p.participantDid === participant.participantDid,
      );
      if (existing) {
        Object.assign(existing, participant);
      } else {
        this.participants.push(participant);
      }
    },

    /**
     * Increment call duration by 1 second
     */
    incrementDuration(): void {
      this.callDuration++;
    },

    /**
     * Handle room ended event (from remote)
     */
    handleRoomEnded(): void {
      this._resetCallState();
    },

    /**
     * Reset all call state to defaults
     */
    _resetCallState(): void {
      this.activeCall = null;
      this.participants = [];
      this.localStreamActive = false;
      this.audioEnabled = true;
      this.videoEnabled = true;
      this.screenSharing = false;
      this.callQuality = null;
      this.callDuration = 0;
    },
  },
});
