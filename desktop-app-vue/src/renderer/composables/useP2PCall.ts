/**
 * P2P通话管理 Composable
 *
 * 提供统一的通话管理接口
 */

import { logger } from '@/utils/logger';
import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import { message } from 'ant-design-vue';

// ==================== 类型定义 ====================

/**
 * 通话类型
 */
export type CallType = 'audio' | 'video' | 'screen';

/**
 * 通话状态
 */
export type CallState = 'pending' | 'ringing' | 'connected' | 'ended';

/**
 * 通话信息
 */
export interface CallInfo {
  callId: string;
  peerId: string;
  type: CallType;
  isInitiator: boolean;
  state?: CallState;
  sourceId?: string;
}

/**
 * 通话选项
 */
export interface CallOptions {
  [key: string]: any;
}

/**
 * 屏幕源
 */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
}

/**
 * 通话统计
 */
export interface CallStats {
  totalCalls: number;
  activeCalls: number;
  avgDuration: number;
  [key: string]: any;
}

/**
 * IPC 结果
 */
interface IPCResult<T = any> {
  success: boolean;
  error?: string;
  callId?: string;
  isMuted?: boolean;
  isVideoEnabled?: boolean;
  info?: T;
  calls?: CallInfo[];
  sources?: ScreenSource[];
  stats?: {
    voiceVideoManager?: CallStats;
    [key: string]: any;
  };
}

/**
 * IPC 通话事件数据
 */
interface CallEventData {
  callId: string;
  peerId?: string;
  type?: CallType;
  isInitiator?: boolean;
  reason?: string;
}

/**
 * useP2PCall 返回类型
 */
export interface UseP2PCallReturn {
  activeCall: Ref<CallInfo | null>;
  incomingCall: Ref<CallInfo | null>;
  activeCalls: Ref<CallInfo[]>;
  callStats: Ref<CallStats | null>;
  startAudioCall: (peerId: string, options?: CallOptions) => Promise<string | null>;
  startVideoCall: (peerId: string, options?: CallOptions) => Promise<string | null>;
  startScreenShare: (peerId: string, sourceId: string, options?: CallOptions) => Promise<string | null>;
  getScreenSources: (options?: CallOptions) => Promise<ScreenSource[]>;
  acceptCall: (callId: string) => Promise<boolean>;
  rejectCall: (callId: string, reason?: string) => Promise<boolean>;
  endCall: (callId: string) => Promise<boolean>;
  toggleMute: (callId: string) => Promise<boolean | null>;
  toggleVideo: (callId: string) => Promise<boolean | null>;
  getCallInfo: (callId: string) => Promise<CallInfo | null>;
  getActiveCalls: () => Promise<CallInfo[]>;
  getCallStats: () => Promise<CallStats | null>;
}

// ==================== Electron IPC ====================

// 获取 ipcRenderer
const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

// ==================== Composable ====================

export function useP2PCall(): UseP2PCallReturn {
  // 状态
  const activeCall = ref<CallInfo | null>(null);
  const incomingCall = ref<CallInfo | null>(null);
  const activeCalls = ref<CallInfo[]>([]);
  const callStats = ref<CallStats | null>(null);

  /**
   * 发起语音通话
   */
  const startAudioCall = async (peerId: string, options: CallOptions = {}): Promise<string | null> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:start-call', {
        peerId,
        type: 'audio',
        options
      });

      if (result.success && result.callId) {
        activeCall.value = {
          callId: result.callId,
          peerId,
          type: 'audio',
          isInitiator: true
        };
        return result.callId;
      } else {
        message.error('发起通话失败: ' + result.error);
        return null;
      }
    } catch (error) {
      logger.error('发起语音通话失败:', error as any);
      message.error('发起语音通话失败');
      return null;
    }
  };

  /**
   * 发起视频通话
   */
  const startVideoCall = async (peerId: string, options: CallOptions = {}): Promise<string | null> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:start-call', {
        peerId,
        type: 'video',
        options
      });

      if (result.success && result.callId) {
        activeCall.value = {
          callId: result.callId,
          peerId,
          type: 'video',
          isInitiator: true
        };
        return result.callId;
      } else {
        message.error('发起通话失败: ' + result.error);
        return null;
      }
    } catch (error) {
      logger.error('发起视频通话失败:', error as any);
      message.error('发起视频通话失败');
      return null;
    }
  };

  /**
   * 发起屏幕共享
   */
  const startScreenShare = async (
    peerId: string,
    sourceId: string,
    options: CallOptions = {}
  ): Promise<string | null> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:start-call', {
        peerId,
        type: 'screen',
        options: {
          ...options,
          sourceId
        }
      });

      if (result.success && result.callId) {
        activeCall.value = {
          callId: result.callId,
          peerId,
          type: 'screen',
          isInitiator: true,
          sourceId
        };
        return result.callId;
      } else {
        message.error('发起屏幕共享失败: ' + result.error);
        return null;
      }
    } catch (error) {
      logger.error('发起屏幕共享失败:', error as any);
      message.error('发起屏幕共享失败');
      return null;
    }
  };

  /**
   * 获取屏幕源列表
   */
  const getScreenSources = async (options: CallOptions = {}): Promise<ScreenSource[]> => {
    try {
      const result: IPCResult<ScreenSource[]> = await ipcRenderer.invoke('screen-share:get-sources', options);
      if (result.success && result.sources) {
        return result.sources;
      } else {
        message.error('获取屏幕源失败: ' + result.error);
        return [];
      }
    } catch (error) {
      logger.error('获取屏幕源失败:', error as any);
      message.error('获取屏幕源失败');
      return [];
    }
  };

  /**
   * 接受通话
   */
  const acceptCall = async (callId: string): Promise<boolean> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:accept-call', {
        callId
      });

      if (result.success) {
        // 将来电转为活动通话
        if (incomingCall.value && incomingCall.value.callId === callId) {
          activeCall.value = { ...incomingCall.value };
          incomingCall.value = null;
        }
        return true;
      } else {
        message.error('接受通话失败: ' + result.error);
        return false;
      }
    } catch (error) {
      logger.error('接受通话失败:', error as any);
      message.error('接受通话失败');
      return false;
    }
  };

  /**
   * 拒绝通话
   */
  const rejectCall = async (callId: string, reason: string = 'rejected'): Promise<boolean> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:reject-call', {
        callId,
        reason
      });

      if (result.success) {
        if (incomingCall.value && incomingCall.value.callId === callId) {
          incomingCall.value = null;
        }
        return true;
      } else {
        message.error('拒绝通话失败: ' + result.error);
        return false;
      }
    } catch (error) {
      logger.error('拒绝通话失败:', error as any);
      message.error('拒绝通话失败');
      return false;
    }
  };

  /**
   * 结束通话
   */
  const endCall = async (callId: string): Promise<boolean> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:end-call', {
        callId
      });

      if (result.success) {
        if (activeCall.value && activeCall.value.callId === callId) {
          activeCall.value = null;
        }
        return true;
      } else {
        message.error('结束通话失败: ' + result.error);
        return false;
      }
    } catch (error) {
      logger.error('结束通话失败:', error as any);
      message.error('结束通话失败');
      return false;
    }
  };

  /**
   * 切换静音
   */
  const toggleMute = async (callId: string): Promise<boolean | null> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:toggle-mute', {
        callId
      });

      if (result.success) {
        return result.isMuted ?? null;
      } else {
        message.error('切换静音失败: ' + result.error);
        return null;
      }
    } catch (error) {
      logger.error('切换静音失败:', error as any);
      message.error('切换静音失败');
      return null;
    }
  };

  /**
   * 切换视频
   */
  const toggleVideo = async (callId: string): Promise<boolean | null> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:toggle-video', {
        callId
      });

      if (result.success) {
        return result.isVideoEnabled ?? null;
      } else {
        message.error('切换视频失败: ' + result.error);
        return null;
      }
    } catch (error) {
      logger.error('切换视频失败:', error as any);
      message.error('切换视频失败');
      return null;
    }
  };

  /**
   * 获取通话信息
   */
  const getCallInfo = async (callId: string): Promise<CallInfo | null> => {
    try {
      const result: IPCResult<CallInfo> = await ipcRenderer.invoke('p2p-enhanced:get-call-info', {
        callId
      });

      if (result.success) {
        return result.info ?? null;
      } else {
        return null;
      }
    } catch (error) {
      logger.error('获取通话信息失败:', error as any);
      return null;
    }
  };

  /**
   * 获取活动通话列表
   */
  const getActiveCalls = async (): Promise<CallInfo[]> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:get-active-calls');

      if (result.success && result.calls) {
        activeCalls.value = result.calls;
        return result.calls;
      } else {
        return [];
      }
    } catch (error) {
      logger.error('获取活动通话失败:', error as any);
      return [];
    }
  };

  /**
   * 获取通话统计
   */
  const getCallStats = async (): Promise<CallStats | null> => {
    try {
      const result: IPCResult = await ipcRenderer.invoke('p2p-enhanced:get-stats');

      if (result.success && result.stats?.voiceVideoManager) {
        callStats.value = result.stats.voiceVideoManager;
        return result.stats.voiceVideoManager;
      } else {
        return null;
      }
    } catch (error) {
      logger.error('获取通话统计失败:', error as any);
      return null;
    }
  };

  // 事件处理
  const handleCallStarted = (_event: any, data: CallEventData) => {
    logger.info('通话已发起:', data as any);
    if (data.isInitiator && data.peerId && data.type) {
      activeCall.value = {
        callId: data.callId,
        peerId: data.peerId,
        type: data.type,
        isInitiator: true
      };
    }
  };

  const handleCallIncoming = (_event: any, data: CallEventData) => {
    logger.info('收到来电:', data as any);
    if (data.peerId && data.type) {
      incomingCall.value = {
        callId: data.callId,
        peerId: data.peerId,
        type: data.type,
        isInitiator: false
      };
    }
  };

  const handleCallConnected = (_event: any, data: CallEventData) => {
    logger.info('通话已连接:', data as any);
    if (activeCall.value && activeCall.value.callId === data.callId) {
      activeCall.value.state = 'connected';
    }
  };

  const handleCallEnded = (_event: any, data: CallEventData) => {
    logger.info('通话已结束:', data as any);

    if (activeCall.value && activeCall.value.callId === data.callId) {
      activeCall.value = null;
    }

    if (incomingCall.value && incomingCall.value.callId === data.callId) {
      incomingCall.value = null;
    }

    // 刷新活动通话列表
    getActiveCalls();
  };

  const handleCallRejected = (_event: any, data: CallEventData) => {
    logger.info('通话已拒绝:', data as any);

    if (activeCall.value && activeCall.value.callId === data.callId) {
      activeCall.value = null;
      message.info('对方拒绝了通话');
    }

    if (incomingCall.value && incomingCall.value.callId === data.callId) {
      incomingCall.value = null;
    }
  };

  // 生命周期
  onMounted(() => {
    if (!ipcRenderer) return;

    // 注册事件监听
    ipcRenderer.on('p2p-enhanced:call-started', handleCallStarted);
    ipcRenderer.on('p2p-enhanced:call-incoming', handleCallIncoming);
    ipcRenderer.on('p2p-enhanced:call-connected', handleCallConnected);
    ipcRenderer.on('p2p-enhanced:call-ended', handleCallEnded);
    ipcRenderer.on('p2p-enhanced:call-rejected', handleCallRejected);

    // 获取初始活动通话列表
    getActiveCalls();
  });

  onUnmounted(() => {
    if (!ipcRenderer) return;

    // 移除事件监听
    ipcRenderer.removeListener('p2p-enhanced:call-started', handleCallStarted);
    ipcRenderer.removeListener('p2p-enhanced:call-incoming', handleCallIncoming);
    ipcRenderer.removeListener('p2p-enhanced:call-connected', handleCallConnected);
    ipcRenderer.removeListener('p2p-enhanced:call-ended', handleCallEnded);
    ipcRenderer.removeListener('p2p-enhanced:call-rejected', handleCallRejected);
  });

  return {
    // 状态
    activeCall,
    incomingCall,
    activeCalls,
    callStats,

    // 方法
    startAudioCall,
    startVideoCall,
    startScreenShare,
    getScreenSources,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    getCallInfo,
    getActiveCalls,
    getCallStats
  };
}

export default useP2PCall;
