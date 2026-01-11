/**
 * P2P通话管理 Composable
 *
 * 提供统一的通话管理接口
 */

import { ref, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';

const { ipcRenderer } = window.require('electron');

export function useP2PCall() {
  // 状态
  const activeCall = ref(null);
  const incomingCall = ref(null);
  const activeCalls = ref([]);
  const callStats = ref(null);

  /**
   * 发起语音通话
   */
  const startAudioCall = async (peerId, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:start-call', {
        peerId,
        type: 'audio',
        options
      });

      if (result.success) {
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
      console.error('发起语音通话失败:', error);
      message.error('发起语音通话失败');
      return null;
    }
  };

  /**
   * 发起视频通话
   */
  const startVideoCall = async (peerId, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:start-call', {
        peerId,
        type: 'video',
        options
      });

      if (result.success) {
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
      console.error('发起视频通话失败:', error);
      message.error('发起视频通话失败');
      return null;
    }
  };

  /**
   * 发起屏幕共享
   */
  const startScreenShare = async (peerId, sourceId, options = {}) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:start-call', {
        peerId,
        type: 'screen',
        options: {
          ...options,
          sourceId
        }
      });

      if (result.success) {
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
      console.error('发起屏幕共享失败:', error);
      message.error('发起屏幕共享失败');
      return null;
    }
  };

  /**
   * 获取屏幕源列表
   */
  const getScreenSources = async (options = {}) => {
    try {
      const result = await ipcRenderer.invoke('screen-share:get-sources', options);
      if (result.success) {
        return result.sources;
      } else {
        message.error('获取屏幕源失败: ' + result.error);
        return [];
      }
    } catch (error) {
      console.error('获取屏幕源失败:', error);
      message.error('获取屏幕源失败');
      return [];
    }
  };

  /**
   * 接受通话
   */
  const acceptCall = async (callId) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:accept-call', {
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
      console.error('接受通话失败:', error);
      message.error('接受通话失败');
      return false;
    }
  };

  /**
   * 拒绝通话
   */
  const rejectCall = async (callId, reason = 'rejected') => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:reject-call', {
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
      console.error('拒绝通话失败:', error);
      message.error('拒绝通话失败');
      return false;
    }
  };

  /**
   * 结束通话
   */
  const endCall = async (callId) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:end-call', {
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
      console.error('结束通话失败:', error);
      message.error('结束通话失败');
      return false;
    }
  };

  /**
   * 切换静音
   */
  const toggleMute = async (callId) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:toggle-mute', {
        callId
      });

      if (result.success) {
        return result.isMuted;
      } else {
        message.error('切换静音失败: ' + result.error);
        return null;
      }
    } catch (error) {
      console.error('切换静音失败:', error);
      message.error('切换静音失败');
      return null;
    }
  };

  /**
   * 切换视频
   */
  const toggleVideo = async (callId) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:toggle-video', {
        callId
      });

      if (result.success) {
        return result.isVideoEnabled;
      } else {
        message.error('切换视频失败: ' + result.error);
        return null;
      }
    } catch (error) {
      console.error('切换视频失败:', error);
      message.error('切换视频失败');
      return null;
    }
  };

  /**
   * 获取通话信息
   */
  const getCallInfo = async (callId) => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:get-call-info', {
        callId
      });

      if (result.success) {
        return result.info;
      } else {
        return null;
      }
    } catch (error) {
      console.error('获取通话信息失败:', error);
      return null;
    }
  };

  /**
   * 获取活动通话列表
   */
  const getActiveCalls = async () => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:get-active-calls');

      if (result.success) {
        activeCalls.value = result.calls;
        return result.calls;
      } else {
        return [];
      }
    } catch (error) {
      console.error('获取活动通话失败:', error);
      return [];
    }
  };

  /**
   * 获取通话统计
   */
  const getCallStats = async () => {
    try {
      const result = await ipcRenderer.invoke('p2p-enhanced:get-stats');

      if (result.success && result.stats.voiceVideoManager) {
        callStats.value = result.stats.voiceVideoManager;
        return result.stats.voiceVideoManager;
      } else {
        return null;
      }
    } catch (error) {
      console.error('获取通话统计失败:', error);
      return null;
    }
  };

  // 事件处理
  const handleCallStarted = (event, data) => {
    console.log('通话已发起:', data);
    if (data.isInitiator) {
      activeCall.value = data;
    }
  };

  const handleCallIncoming = (event, data) => {
    console.log('收到来电:', data);
    incomingCall.value = data;
  };

  const handleCallConnected = (event, data) => {
    console.log('通话已连接:', data);
    if (activeCall.value && activeCall.value.callId === data.callId) {
      activeCall.value.state = 'connected';
    }
  };

  const handleCallEnded = (event, data) => {
    console.log('通话已结束:', data);

    if (activeCall.value && activeCall.value.callId === data.callId) {
      activeCall.value = null;
    }

    if (incomingCall.value && incomingCall.value.callId === data.callId) {
      incomingCall.value = null;
    }

    // 刷新活动通话列表
    getActiveCalls();
  };

  const handleCallRejected = (event, data) => {
    console.log('通话已拒绝:', data);

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
