<template>
  <div v-if="incomingCall" class="call-notification">
    <div class="call-notification-content">
      <div class="call-header">
        <PhoneOutlined
          v-if="incomingCall.type === 'audio'"
          class="call-icon audio"
        />
        <VideoCameraOutlined v-else class="call-icon video" />
        <span class="call-title">
          {{ incomingCall.type === "audio" ? "语音通话" : "视频通话" }}
        </span>
      </div>

      <div class="caller-info">
        <a-avatar :size="64" :src="getCallerAvatar(incomingCall.peerId)">
          <template #icon>
            <UserOutlined />
          </template>
        </a-avatar>
        <div class="caller-name">
          {{ getCallerName(incomingCall.peerId) }}
        </div>
        <div class="caller-status">来电中...</div>
      </div>

      <div class="call-actions">
        <a-button
          type="primary"
          danger
          size="large"
          shape="circle"
          class="reject-btn"
          @click="rejectCall"
        >
          <template #icon>
            <CloseOutlined />
          </template>
        </a-button>

        <a-button
          type="primary"
          size="large"
          shape="circle"
          class="accept-btn"
          @click="acceptCall"
        >
          <template #icon>
            <PhoneOutlined v-if="incomingCall.type === 'audio'" />
            <VideoCameraOutlined v-else />
          </template>
        </a-button>
      </div>
    </div>

    <!-- 铃声音频 -->
    <audio ref="ringtone" loop>
      <source src="@/assets/sounds/ringtone.mp3" type="audio/mpeg" />
    </audio>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, watch, onMounted, onUnmounted } from "vue";
import { getIpcBridge } from "@/utils/ipc-shim";
import {
  PhoneOutlined,
  VideoCameraOutlined,
  UserOutlined,
  CloseOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";

const ipcRenderer = getIpcBridge();

// Props
const props = defineProps({
  contactsMap: {
    type: Map,
    default: () => new Map(),
  },
});

// Emits
const emit = defineEmits(["call-accepted", "call-rejected"]);

// State
const incomingCall = ref(null);
const ringtone = ref(null);

// 获取来电者信息
const getCallerName = (peerId) => {
  const contact = props.contactsMap.get(peerId);
  return contact?.name || contact?.did || peerId.substring(0, 8);
};

const getCallerAvatar = (peerId) => {
  const contact = props.contactsMap.get(peerId);
  return contact?.avatar || null;
};

// 接受通话
const acceptCall = async () => {
  if (!incomingCall.value) {
    return;
  }

  try {
    // 停止铃声
    stopRingtone();

    const result = await ipcRenderer.invoke("p2p-enhanced:accept-call", {
      callId: incomingCall.value.callId,
    });

    if (result.success) {
      emit("call-accepted", incomingCall.value);
      incomingCall.value = null;
    } else {
      message.error("接受通话失败: " + result.error);
    }
  } catch (error) {
    logger.error("接受通话失败:", error);
    message.error("接受通话失败");
  }
};

// 拒绝通话
const rejectCall = async () => {
  if (!incomingCall.value) {
    return;
  }

  try {
    // 停止铃声
    stopRingtone();

    const result = await ipcRenderer.invoke("p2p-enhanced:reject-call", {
      callId: incomingCall.value.callId,
      reason: "rejected",
    });

    if (result.success) {
      emit("call-rejected", incomingCall.value);
      incomingCall.value = null;
    } else {
      message.error("拒绝通话失败: " + result.error);
    }
  } catch (error) {
    logger.error("拒绝通话失败:", error);
    message.error("拒绝通话失败");
  }
};

// 播放铃声
const playRingtone = () => {
  if (ringtone.value) {
    ringtone.value.play().catch((err) => {
      logger.error("播放铃声失败:", err);
    });
  }
};

// 停止铃声
const stopRingtone = () => {
  if (ringtone.value) {
    ringtone.value.pause();
    ringtone.value.currentTime = 0;
  }
};

// 监听来电事件
const handleIncomingCall = (event, data) => {
  logger.info("收到来电:", data);
  incomingCall.value = data;
  playRingtone();
};

// 监听通话结束事件
const handleCallEnded = (event, data) => {
  if (incomingCall.value && incomingCall.value.callId === data.callId) {
    stopRingtone();
    incomingCall.value = null;
  }
};

// 生命周期
onMounted(() => {
  if (!ipcRenderer?.on) {
    return;
  }
  ipcRenderer.on("p2p-enhanced:call-incoming", handleIncomingCall);
  ipcRenderer.on("p2p-enhanced:call-ended", handleCallEnded);
  ipcRenderer.on("p2p-enhanced:call-rejected", handleCallEnded);
});

onUnmounted(() => {
  stopRingtone();
  if (!ipcRenderer?.removeListener) {
    return;
  }
  ipcRenderer.removeListener("p2p-enhanced:call-incoming", handleIncomingCall);
  ipcRenderer.removeListener("p2p-enhanced:call-ended", handleCallEnded);
  ipcRenderer.removeListener("p2p-enhanced:call-rejected", handleCallEnded);
});

// 监听来电变化
watch(incomingCall, (newCall) => {
  if (!newCall) {
    stopRingtone();
  }
});
</script>

<style scoped lang="scss">
.call-notification {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 9999;
  background: rgba(0, 0, 0, 0.95);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  min-width: 320px;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translate(-50%, -60%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

.call-notification-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.call-header {
  display: flex;
  align-items: center;
  gap: 12px;
  color: white;

  .call-icon {
    font-size: 24px;

    &.audio {
      color: #52c41a;
    }

    &.video {
      color: #1890ff;
    }
  }

  .call-title {
    font-size: 18px;
    font-weight: 500;
  }
}

.caller-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  .caller-name {
    color: white;
    font-size: 20px;
    font-weight: 600;
  }

  .caller-status {
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    animation: pulse 1.5s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.call-actions {
  display: flex;
  gap: 48px;
  margin-top: 8px;

  .reject-btn {
    width: 64px;
    height: 64px;
    font-size: 24px;
    background: #ff4d4f;
    border-color: #ff4d4f;

    &:hover {
      background: #ff7875;
      border-color: #ff7875;
    }
  }

  .accept-btn {
    width: 64px;
    height: 64px;
    font-size: 24px;
    background: #52c41a;
    border-color: #52c41a;

    &:hover {
      background: #73d13d;
      border-color: #73d13d;
    }
  }
}
</style>
