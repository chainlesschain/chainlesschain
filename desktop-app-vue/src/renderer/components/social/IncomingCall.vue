<template>
  <Transition name="incoming-call">
    <div
      v-if="callStore.hasIncomingCall"
      class="incoming-call"
    >
      <div class="incoming-call-content">
        <!-- Call Type Icon -->
        <div class="call-type-indicator">
          <PhoneOutlined
            v-if="callStore.incomingCall?.type === 'voice'"
            class="call-type-icon voice"
          />
          <VideoCameraOutlined
            v-else
            class="call-type-icon video"
          />
        </div>

        <!-- Caller Info -->
        <div class="caller-info">
          <a-avatar
            :size="48"
            class="caller-avatar"
          >
            <template #icon>
              <UserOutlined />
            </template>
          </a-avatar>
          <div class="caller-details">
            <div class="caller-did">
              {{ shortenDid(callStore.incomingCall?.callerDid) }}
            </div>
            <div class="call-type-text">
              {{ callTypeText }}
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="call-actions">
          <a-tooltip title="Reject">
            <a-button
              type="primary"
              danger
              shape="circle"
              size="large"
              class="reject-btn"
              @click="handleReject"
            >
              <template #icon>
                <CloseOutlined />
              </template>
            </a-button>
          </a-tooltip>

          <a-tooltip title="Accept">
            <a-button
              type="primary"
              shape="circle"
              size="large"
              class="accept-btn"
              @click="handleAccept"
            >
              <template #icon>
                <PhoneOutlined v-if="callStore.incomingCall?.type === 'voice'" />
                <VideoCameraOutlined v-else />
              </template>
            </a-button>
          </a-tooltip>
        </div>
      </div>

      <!-- Pulsing ring animation -->
      <div class="ring-animation">
        <span class="ring-pulse ring-1" />
        <span class="ring-pulse ring-2" />
        <span class="ring-pulse ring-3" />
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { logger } from '@/utils/logger';
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { useCallStore } from '../../stores/call';
import { message } from 'ant-design-vue';
import {
  PhoneOutlined,
  VideoCameraOutlined,
  UserOutlined,
  CloseOutlined,
} from '@ant-design/icons-vue';
import { getIpcBridge } from '@/utils/ipc-shim';

const callStore = useCallStore();
const ipcRenderer = getIpcBridge();

// Computed
const callTypeText = computed(() => {
  if (!callStore.incomingCall) {return '';}
  return callStore.incomingCall.type === 'voice'
    ? 'Incoming voice call...'
    : 'Incoming video call...';
});

// Methods
const shortenDid = (did) => {
  if (!did) {return 'Unknown';}
  if (did.length <= 16) {return did;}
  return `${did.substring(0, 8)}...${did.substring(did.length - 6)}`;
};

const handleAccept = async () => {
  try {
    const success = await callStore.acceptIncoming();
    if (!success) {
      message.error('Failed to accept call');
    }
  } catch (error) {
    logger.error('[IncomingCall] Accept failed:', error);
    message.error('Failed to accept call');
  }
};

const handleReject = async () => {
  try {
    const success = await callStore.rejectIncoming();
    if (!success) {
      message.error('Failed to reject call');
    }
  } catch (error) {
    logger.error('[IncomingCall] Reject failed:', error);
    message.error('Failed to reject call');
  }
};

// IPC event listener for incoming calls
const handleIncomingCallEvent = (_event, data) => {
  if (data && data.roomId && data.callerDid) {
    callStore.setIncomingCall({
      roomId: data.roomId,
      callerDid: data.callerDid,
      type: data.type || 'voice',
    });
  }
};

const handleCallEndedEvent = (_event, data) => {
  if (
    callStore.incomingCall &&
    data &&
    data.roomId === callStore.incomingCall.roomId
  ) {
    callStore.rejectIncoming();
  }
};

// Auto-dismiss after 30 seconds
let dismissTimer = null;

const startDismissTimer = () => {
  stopDismissTimer();
  dismissTimer = setTimeout(() => {
    if (callStore.hasIncomingCall) {
      callStore.rejectIncoming();
      logger.info('[IncomingCall] Auto-dismissed after timeout');
    }
  }, 30000);
};

const stopDismissTimer = () => {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
};

// Watch incoming call state
watch(
  () => callStore.hasIncomingCall,
  (hasCall) => {
    if (hasCall) {
      startDismissTimer();
    } else {
      stopDismissTimer();
    }
  },
);

// Lifecycle
onMounted(() => {
  if (ipcRenderer?.on) {
    ipcRenderer.on('call:incoming', handleIncomingCallEvent);
    ipcRenderer.on('call:room-ended', handleCallEndedEvent);
  }

  if (callStore.hasIncomingCall) {
    startDismissTimer();
  }
});

onUnmounted(() => {
  stopDismissTimer();

  if (ipcRenderer?.removeListener) {
    ipcRenderer.removeListener('call:incoming', handleIncomingCallEvent);
    ipcRenderer.removeListener('call:room-ended', handleCallEndedEvent);
  }
});
</script>

<style scoped lang="scss">
.incoming-call {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  width: 360px;
  background: rgba(22, 33, 62, 0.97);
  border-radius: 16px;
  padding: 20px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  overflow: hidden;
}

.incoming-call-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  position: relative;
  z-index: 2;
}

.call-type-indicator {
  .call-type-icon {
    font-size: 28px;

    &.voice {
      color: #52c41a;
    }

    &.video {
      color: #1890ff;
    }
  }
}

.caller-info {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;

  .caller-avatar {
    flex-shrink: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .caller-details {
    flex: 1;
    min-width: 0;

    .caller-did {
      color: white;
      font-size: 16px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .call-type-text {
      color: rgba(255, 255, 255, 0.6);
      font-size: 13px;
      margin-top: 2px;
      animation: textPulse 2s ease-in-out infinite;
    }
  }
}

@keyframes textPulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.call-actions {
  display: flex;
  gap: 32px;
  margin-top: 4px;

  .reject-btn {
    width: 52px;
    height: 52px;
    font-size: 20px;
    background: #ff4d4f;
    border-color: #ff4d4f;

    &:hover {
      background: #ff7875;
      border-color: #ff7875;
    }
  }

  .accept-btn {
    width: 52px;
    height: 52px;
    font-size: 20px;
    background: #52c41a;
    border-color: #52c41a;

    &:hover {
      background: #73d13d;
      border-color: #73d13d;
    }
  }
}

// Pulsing ring animation
.ring-animation {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  pointer-events: none;

  .ring-pulse {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 2px solid rgba(82, 196, 26, 0.3);
    animation: ringPulse 2s ease-out infinite;

    &.ring-2 {
      animation-delay: 0.5s;
    }

    &.ring-3 {
      animation-delay: 1s;
    }
  }
}

@keyframes ringPulse {
  0% {
    width: 60px;
    height: 60px;
    opacity: 1;
  }
  100% {
    width: 200px;
    height: 200px;
    opacity: 0;
  }
}

// Transition
.incoming-call-enter-active {
  animation: slideInRight 0.3s ease-out;
}

.incoming-call-leave-active {
  animation: slideOutRight 0.25s ease-in;
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(100px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideOutRight {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100px);
  }
}
</style>
