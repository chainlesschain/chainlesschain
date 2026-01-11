<template>
  <div v-if="activeCall" class="call-window">
    <div class="call-container">
      <!-- 视频区域 -->
      <div class="video-container" v-if="activeCall.type === 'video'">
        <!-- 远程视频 -->
        <video
          ref="remoteVideo"
          class="remote-video"
          autoplay
          playsinline
        ></video>

        <!-- 本地视频（画中画） -->
        <video
          ref="localVideo"
          class="local-video"
          autoplay
          playsinline
          muted
        ></video>
      </div>

      <!-- 音频通话界面 -->
      <div v-else class="audio-call-container">
        <div class="audio-call-content">
          <a-avatar :size="120" :src="getCallerAvatar()">
            <template #icon><UserOutlined /></template>
          </a-avatar>
          <div class="caller-name">{{ getCallerName() }}</div>
          <div class="call-status">{{ callStatusText }}</div>
          <div class="call-duration">{{ formattedDuration }}</div>
        </div>
      </div>

      <!-- 通话质量指示器 -->
      <div class="quality-indicator" v-if="callQuality">
        <SignalFilled :class="['signal-icon', qualityClass]" />
        <span class="quality-text">{{ qualityText }}</span>
      </div>

      <!-- 控制栏 -->
      <div class="call-controls">
        <!-- 静音按钮 -->
        <a-tooltip :title="isMuted ? '取消静音' : '静音'">
          <a-button
            :type="isMuted ? 'primary' : 'default'"
            shape="circle"
            size="large"
            @click="toggleMute"
            :class="{ active: isMuted }"
          >
            <template #icon>
              <AudioMutedOutlined v-if="isMuted" />
              <AudioOutlined v-else />
            </template>
          </a-button>
        </a-tooltip>

        <!-- 视频开关按钮（仅视频通话） -->
        <a-tooltip v-if="activeCall.type === 'video'" :title="isVideoEnabled ? '关闭视频' : '开启视频'">
          <a-button
            :type="!isVideoEnabled ? 'primary' : 'default'"
            shape="circle"
            size="large"
            @click="toggleVideo"
            :class="{ active: !isVideoEnabled }"
          >
            <template #icon>
              <VideoCameraOutlined v-if="isVideoEnabled" />
              <VideoCameraAddOutlined v-else />
            </template>
          </a-button>
        </a-tooltip>

        <!-- 挂断按钮 -->
        <a-tooltip title="挂断">
          <a-button
            type="primary"
            danger
            shape="circle"
            size="large"
            @click="endCall"
            class="end-call-btn"
          >
            <template #icon><PhoneOutlined :rotate="135" /></template>
          </a-button>
        </a-tooltip>

        <!-- 设置按钮 -->
        <a-tooltip title="设置">
          <a-button
            shape="circle"
            size="large"
            @click="showSettings = true"
          >
            <template #icon><SettingOutlined /></template>
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 设置抽屉 -->
    <a-drawer
      v-model:open="showSettings"
      title="通话设置"
      placement="right"
      :width="360"
    >
      <div class="call-settings">
        <h4>音频设备</h4>
        <a-select
          v-model:value="selectedAudioInput"
          style="width: 100%; margin-bottom: 16px"
          placeholder="选择麦克风"
        >
          <a-select-option
            v-for="device in audioInputDevices"
            :key="device.deviceId"
            :value="device.deviceId"
          >
            {{ device.label }}
          </a-select-option>
        </a-select>

        <a-select
          v-model:value="selectedAudioOutput"
          style="width: 100%; margin-bottom: 16px"
          placeholder="选择扬声器"
        >
          <a-select-option
            v-for="device in audioOutputDevices"
            :key="device.deviceId"
            :value="device.deviceId"
          >
            {{ device.label }}
          </a-select-option>
        </a-select>

        <h4 v-if="activeCall.type === 'video'">视频设备</h4>
        <a-select
          v-if="activeCall.type === 'video'"
          v-model:value="selectedVideoInput"
          style="width: 100%"
          placeholder="选择摄像头"
        >
          <a-select-option
            v-for="device in videoInputDevices"
            :key="device.deviceId"
            :value="device.deviceId"
          >
            {{ device.label }}
          </a-select-option>
        </a-select>

        <a-divider />

        <h4>通话统计</h4>
        <div class="call-stats" v-if="callStats">
          <div class="stat-item">
            <span class="stat-label">接收:</span>
            <span class="stat-value">{{ formatBytes(callStats.bytesReceived) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">发送:</span>
            <span class="stat-value">{{ formatBytes(callStats.bytesSent) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">丢包:</span>
            <span class="stat-value">{{ callStats.packetsLost }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">延迟:</span>
            <span class="stat-value">{{ Math.round(callStats.roundTripTime * 1000) }}ms</span>
          </div>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  PhoneOutlined,
  AudioOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
  VideoCameraAddOutlined,
  UserOutlined,
  SettingOutlined,
  SignalFilled
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const { ipcRenderer } = window.require('electron');

// Props
const props = defineProps({
  callId: {
    type: String,
    required: true
  },
  callType: {
    type: String,
    required: true
  },
  peerId: {
    type: String,
    required: true
  },
  contactsMap: {
    type: Map,
    default: () => new Map()
  }
});

// Emits
const emit = defineEmits(['call-ended']);

// State
const activeCall = ref({
  callId: props.callId,
  type: props.callType,
  peerId: props.peerId,
  state: 'connecting'
});

const isMuted = ref(false);
const isVideoEnabled = ref(true);
const callDuration = ref(0);
const callQuality = ref(null);
const callStats = ref(null);
const showSettings = ref(false);

// 媒体设备
const audioInputDevices = ref([]);
const audioOutputDevices = ref([]);
const videoInputDevices = ref([]);
const selectedAudioInput = ref(null);
const selectedAudioOutput = ref(null);
const selectedVideoInput = ref(null);

// 视频元素引用
const localVideo = ref(null);
const remoteVideo = ref(null);

// 本地媒体流
let localStream = null;
let remoteStream = null;

// 计时器
let durationTimer = null;

// 计算属性
const callStatusText = computed(() => {
  switch (activeCall.value.state) {
    case 'connecting':
      return '连接中...';
    case 'connected':
      return '通话中';
    case 'ended':
      return '通话已结束';
    default:
      return '';
  }
});

const formattedDuration = computed(() => {
  const minutes = Math.floor(callDuration.value / 60);
  const seconds = callDuration.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

const qualityClass = computed(() => {
  if (!callQuality.value) return 'good';
  const { packetsLost, roundTripTime } = callQuality.value;

  if (packetsLost > 50 || roundTripTime > 0.3) return 'poor';
  if (packetsLost > 20 || roundTripTime > 0.15) return 'fair';
  return 'good';
});

const qualityText = computed(() => {
  const classMap = {
    good: '良好',
    fair: '一般',
    poor: '较差'
  };
  return classMap[qualityClass.value] || '未知';
});

// 方法
const getCallerName = () => {
  const contact = props.contactsMap.get(props.peerId);
  return contact?.name || contact?.did || props.peerId.substring(0, 8);
};

const getCallerAvatar = () => {
  const contact = props.contactsMap.get(props.peerId);
  return contact?.avatar || null;
};

const toggleMute = async () => {
  try {
    const result = await ipcRenderer.invoke('p2p-enhanced:toggle-mute', {
      callId: props.callId
    });

    if (result.success) {
      isMuted.value = result.isMuted;
    }
  } catch (error) {
    console.error('切换静音失败:', error);
    message.error('切换静音失败');
  }
};

const toggleVideo = async () => {
  try {
    const result = await ipcRenderer.invoke('p2p-enhanced:toggle-video', {
      callId: props.callId
    });

    if (result.success) {
      isVideoEnabled.value = result.isVideoEnabled;

      // 更新本地视频显示
      if (localStream) {
        localStream.getVideoTracks().forEach(track => {
          track.enabled = result.isVideoEnabled;
        });
      }
    }
  } catch (error) {
    console.error('切换视频失败:', error);
    message.error('切换视频失败');
  }
};

const endCall = async () => {
  try {
    const result = await ipcRenderer.invoke('p2p-enhanced:end-call', {
      callId: props.callId
    });

    if (result.success) {
      cleanup();
      emit('call-ended');
    }
  } catch (error) {
    console.error('结束通话失败:', error);
    message.error('结束通话失败');
  }
};

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 获取媒体设备列表
const enumerateDevices = async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    audioInputDevices.value = devices.filter(d => d.kind === 'audioinput');
    audioOutputDevices.value = devices.filter(d => d.kind === 'audiooutput');
    videoInputDevices.value = devices.filter(d => d.kind === 'videoinput');

    // 设置默认设备
    if (audioInputDevices.value.length > 0 && !selectedAudioInput.value) {
      selectedAudioInput.value = audioInputDevices.value[0].deviceId;
    }
    if (audioOutputDevices.value.length > 0 && !selectedAudioOutput.value) {
      selectedAudioOutput.value = audioOutputDevices.value[0].deviceId;
    }
    if (videoInputDevices.value.length > 0 && !selectedVideoInput.value) {
      selectedVideoInput.value = videoInputDevices.value[0].deviceId;
    }
  } catch (error) {
    console.error('获取媒体设备失败:', error);
  }
};

// 获取本地媒体流
const getUserMedia = async () => {
  try {
    const constraints = {
      audio: {
        deviceId: selectedAudioInput.value ? { exact: selectedAudioInput.value } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: props.callType === 'video' ? {
        deviceId: selectedVideoInput.value ? { exact: selectedVideoInput.value } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      } : false
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    // 显示本地视频
    if (localVideo.value && props.callType === 'video') {
      localVideo.value.srcObject = localStream;
    }

    return localStream;
  } catch (error) {
    console.error('获取媒体流失败:', error);
    message.error('无法访问摄像头或麦克风');
    throw error;
  }
};

// 事件处理
const handleCallConnected = (event, data) => {
  if (data.callId === props.callId) {
    activeCall.value.state = 'connected';

    // 开始计时
    durationTimer = setInterval(() => {
      callDuration.value++;
    }, 1000);
  }
};

const handleCallEnded = (event, data) => {
  if (data.callId === props.callId) {
    cleanup();
    emit('call-ended');
  }
};

const handleRemoteStream = (event, data) => {
  if (data.callId === props.callId && data.stream) {
    remoteStream = data.stream;

    // 显示远程视频
    if (remoteVideo.value) {
      remoteVideo.value.srcObject = remoteStream;
    }
  }
};

const handleQualityUpdate = (event, data) => {
  if (data.callId === props.callId) {
    callQuality.value = data.stats;
    callStats.value = data.stats;
  }
};

const handleMuteChanged = (event, data) => {
  if (data.callId === props.callId) {
    isMuted.value = data.isMuted;
  }
};

const handleVideoChanged = (event, data) => {
  if (data.callId === props.callId) {
    isVideoEnabled.value = data.isVideoEnabled;
  }
};

// 清理资源
const cleanup = () => {
  // 停止计时器
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }

  // 停止本地媒体流
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // 清除视频元素
  if (localVideo.value) {
    localVideo.value.srcObject = null;
  }
  if (remoteVideo.value) {
    remoteVideo.value.srcObject = null;
  }
};

// 生命周期
onMounted(async () => {
  // 获取媒体设备列表
  await enumerateDevices();

  // 获取本地媒体流
  await getUserMedia();

  // 注册事件监听
  ipcRenderer.on('p2p-enhanced:call-connected', handleCallConnected);
  ipcRenderer.on('p2p-enhanced:call-ended', handleCallEnded);
  ipcRenderer.on('p2p-enhanced:call-remote-stream', handleRemoteStream);
  ipcRenderer.on('p2p-enhanced:call-quality-update', handleQualityUpdate);
  ipcRenderer.on('p2p-enhanced:call-mute-changed', handleMuteChanged);
  ipcRenderer.on('p2p-enhanced:call-video-changed', handleVideoChanged);

  // 监听设备变化
  navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
});

onUnmounted(() => {
  cleanup();

  // 移除事件监听
  ipcRenderer.removeListener('p2p-enhanced:call-connected', handleCallConnected);
  ipcRenderer.removeListener('p2p-enhanced:call-ended', handleCallEnded);
  ipcRenderer.removeListener('p2p-enhanced:call-remote-stream', handleRemoteStream);
  ipcRenderer.removeListener('p2p-enhanced:call-quality-update', handleQualityUpdate);
  ipcRenderer.removeListener('p2p-enhanced:call-mute-changed', handleMuteChanged);
  ipcRenderer.removeListener('p2p-enhanced:call-video-changed', handleVideoChanged);

  navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
});

// 监听设备选择变化
watch([selectedAudioInput, selectedVideoInput], async () => {
  if (localStream) {
    // 重新获取媒体流
    localStream.getTracks().forEach(track => track.stop());
    await getUserMedia();
  }
});
</script>

<style scoped lang="scss">
.call-window {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9998;
  background: #000;
}

.call-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.video-container {
  flex: 1;
  position: relative;
  background: #000;

  .remote-video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .local-video {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 240px;
    height: 180px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    border: 2px solid rgba(255, 255, 255, 0.2);
  }
}

.audio-call-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.audio-call-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: white;

  .caller-name {
    font-size: 32px;
    font-weight: 600;
  }

  .call-status {
    font-size: 18px;
    opacity: 0.9;
  }

  .call-duration {
    font-size: 24px;
    font-weight: 500;
    font-family: 'Courier New', monospace;
  }
}

.quality-indicator {
  position: absolute;
  top: 20px;
  left: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 20px;
  color: white;
  backdrop-filter: blur(10px);

  .signal-icon {
    font-size: 16px;

    &.good {
      color: #52c41a;
    }

    &.fair {
      color: #faad14;
    }

    &.poor {
      color: #ff4d4f;
    }
  }

  .quality-text {
    font-size: 14px;
  }
}

.call-controls {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 24px;
  padding: 20px 32px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 48px;
  backdrop-filter: blur(10px);

  .ant-btn {
    width: 56px;
    height: 56px;
    font-size: 20px;

    &.active {
      background: #ff4d4f;
      border-color: #ff4d4f;
      color: white;
    }
  }

  .end-call-btn {
    width: 64px;
    height: 64px;
    font-size: 24px;
  }
}

.call-settings {
  h4 {
    margin-top: 16px;
    margin-bottom: 12px;
    font-weight: 600;
  }

  .call-stats {
    .stat-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;

      &:last-child {
        border-bottom: none;
      }

      .stat-label {
        color: rgba(0, 0, 0, 0.65);
      }

      .stat-value {
        font-weight: 500;
      }
    }
  }
}
</style>
