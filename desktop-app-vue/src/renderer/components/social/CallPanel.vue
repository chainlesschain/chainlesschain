<template>
  <div
    v-if="callStore.isInCall"
    class="call-panel"
  >
    <div class="call-panel-container">
      <!-- Call Header -->
      <div class="call-panel-header">
        <div class="call-info">
          <a-badge
            :status="callStore.activeCall?.type === 'video' ? 'processing' : 'success'"
            :text="callStore.activeCall?.type === 'video' ? 'Video Call' : 'Voice Call'"
          />
          <span class="call-duration">{{ callStore.formattedDuration }}</span>
        </div>

        <div class="call-quality">
          <a-tooltip
            v-if="callStore.callQuality"
            :title="qualityTooltip"
          >
            <span :class="['quality-dot', qualityClass]" />
            <span class="quality-text">{{ callStore.qualityLevelText }}</span>
          </a-tooltip>
        </div>
      </div>

      <!-- Video Grid -->
      <div
        v-if="callStore.isVideoCall"
        class="video-grid"
        :class="gridClass"
      >
        <!-- Remote Participant Videos -->
        <div
          v-for="participant in remoteParticipants"
          :key="participant.participantDid"
          class="video-cell"
        >
          <video
            :ref="(el) => setVideoRef(participant.participantDid, el)"
            class="remote-video"
            autoplay
            playsinline
          />
          <div class="participant-label">
            <a-avatar :size="24">
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
            <span class="participant-name">
              {{ shortenDid(participant.participantDid) }}
            </span>
            <AudioMutedOutlined
              v-if="participant.status !== 'connected'"
              class="muted-icon"
            />
          </div>
        </div>

        <!-- Local Preview -->
        <div class="video-cell local-preview">
          <video
            ref="localVideoRef"
            class="local-video"
            autoplay
            playsinline
            muted
          />
          <div class="participant-label local-label">
            <span class="participant-name">You</span>
            <AudioMutedOutlined
              v-if="!callStore.audioEnabled"
              class="muted-icon"
            />
          </div>
          <div
            v-if="!callStore.videoEnabled"
            class="video-off-overlay"
          >
            <VideoCameraAddOutlined class="video-off-icon" />
            <span>Camera Off</span>
          </div>
        </div>
      </div>

      <!-- Audio Call View (no video) -->
      <div
        v-else
        class="audio-call-view"
      >
        <div class="audio-participants-grid">
          <div
            v-for="participant in callStore.connectedParticipants"
            :key="participant.participantDid"
            class="audio-participant"
          >
            <a-avatar :size="64">
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
            <span class="audio-participant-name">
              {{ shortenDid(participant.participantDid) }}
            </span>
            <a-badge
              :status="participant.status === 'connected' ? 'success' : 'default'"
            />
          </div>
        </div>
      </div>

      <!-- Screen Sharing Indicator -->
      <div
        v-if="callStore.screenSharing"
        class="screen-share-indicator"
      >
        <DesktopOutlined />
        <span>Screen sharing active</span>
      </div>

      <!-- Controls Bar -->
      <div class="call-controls-bar">
        <a-space :size="16">
          <!-- Mute Toggle -->
          <a-tooltip :title="callStore.audioEnabled ? 'Mute' : 'Unmute'">
            <a-button
              :type="!callStore.audioEnabled ? 'primary' : 'default'"
              shape="circle"
              size="large"
              :class="{ 'control-active': !callStore.audioEnabled }"
              @click="handleToggleAudio"
            >
              <template #icon>
                <AudioMutedOutlined v-if="!callStore.audioEnabled" />
                <AudioOutlined v-else />
              </template>
            </a-button>
          </a-tooltip>

          <!-- Camera Toggle (video calls only) -->
          <a-tooltip
            v-if="callStore.isVideoCall"
            :title="callStore.videoEnabled ? 'Turn Off Camera' : 'Turn On Camera'"
          >
            <a-button
              :type="!callStore.videoEnabled ? 'primary' : 'default'"
              shape="circle"
              size="large"
              :class="{ 'control-active': !callStore.videoEnabled }"
              @click="handleToggleVideo"
            >
              <template #icon>
                <VideoCameraOutlined v-if="callStore.videoEnabled" />
                <VideoCameraAddOutlined v-else />
              </template>
            </a-button>
          </a-tooltip>

          <!-- Screen Share Toggle -->
          <a-tooltip :title="callStore.screenSharing ? 'Stop Sharing' : 'Share Screen'">
            <a-button
              :type="callStore.screenSharing ? 'primary' : 'default'"
              shape="circle"
              size="large"
              :class="{ 'control-active': callStore.screenSharing }"
              @click="handleShareScreen"
            >
              <template #icon>
                <DesktopOutlined />
              </template>
            </a-button>
          </a-tooltip>

          <!-- End Call -->
          <a-tooltip title="End Call">
            <a-button
              type="primary"
              danger
              shape="circle"
              size="large"
              class="end-call-btn"
              @click="handleEndCall"
            >
              <template #icon>
                <PhoneOutlined :rotate="135" />
              </template>
            </a-button>
          </a-tooltip>
        </a-space>
      </div>

      <!-- Participant Count -->
      <div class="participant-count">
        <TeamOutlined />
        <span>{{ callStore.participantCount }} participant{{ callStore.participantCount !== 1 ? 's' : '' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from '@/utils/logger';
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useCallStore } from '../../stores/call';
import { message } from 'ant-design-vue';
import {
  UserOutlined,
  PhoneOutlined,
  AudioOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
  VideoCameraAddOutlined,
  DesktopOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue';

const callStore = useCallStore();

// Template refs for video elements
const localVideoRef = ref(null);
const videoRefs = ref({});

// Duration timer
let durationTimer = null;

// Computed
const remoteParticipants = computed(() => {
  return callStore.connectedParticipants.filter(
    (p) => p.role !== 'host' || callStore.connectedParticipants.length > 1,
  );
});

const gridClass = computed(() => {
  const count = callStore.participantCount;
  if (count <= 2) {return 'grid-2';}
  if (count <= 4) {return 'grid-4';}
  if (count <= 6) {return 'grid-6';}
  return 'grid-8';
});

const qualityClass = computed(() => {
  if (!callStore.callQuality) {return '';}
  return `quality-${callStore.callQuality.level}`;
});

const qualityTooltip = computed(() => {
  if (!callStore.callQuality) {return '';}
  const q = callStore.callQuality;
  return `RTT: ${Math.round(q.roundTripTime)}ms | Loss: ${(q.packetLossRate * 100).toFixed(1)}% | Jitter: ${Math.round(q.jitter)}ms`;
});

// Methods
const setVideoRef = (did, el) => {
  if (el) {
    videoRefs.value[did] = el;
  } else {
    delete videoRefs.value[did];
  }
};

const shortenDid = (did) => {
  if (!did) {return 'Unknown';}
  if (did.length <= 16) {return did;}
  return `${did.substring(0, 8)}...${did.substring(did.length - 6)}`;
};

const handleToggleAudio = async () => {
  const success = await callStore.toggleAudio();
  if (!success) {
    message.error('Failed to toggle audio');
  }
};

const handleToggleVideo = async () => {
  const success = await callStore.toggleVideo();
  if (!success) {
    message.error('Failed to toggle video');
  }
};

const handleShareScreen = async () => {
  const success = await callStore.shareScreen();
  if (!success) {
    message.error('Failed to toggle screen sharing');
  }
};

const handleEndCall = async () => {
  const success = await callStore.endCall();
  if (!success) {
    message.error('Failed to end call');
  }
};

const startDurationTimer = () => {
  stopDurationTimer();
  durationTimer = setInterval(() => {
    callStore.incrementDuration();
  }, 1000);
};

const stopDurationTimer = () => {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
};

// Watch for call state changes
watch(
  () => callStore.isInCall,
  (isInCall) => {
    if (isInCall) {
      startDurationTimer();
    } else {
      stopDurationTimer();
    }
  },
);

// Lifecycle
onMounted(() => {
  if (callStore.isInCall) {
    startDurationTimer();
  }
});

onUnmounted(() => {
  stopDurationTimer();
});
</script>

<style scoped lang="scss">
.call-panel {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9990;
  background: #1a1a2e;
}

.call-panel-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.call-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  z-index: 10;

  .call-info {
    display: flex;
    align-items: center;
    gap: 16px;
    color: rgba(255, 255, 255, 0.9);
  }

  .call-duration {
    font-size: 16px;
    font-weight: 500;
    font-family: 'Courier New', monospace;
    color: rgba(255, 255, 255, 0.85);
  }

  .call-quality {
    display: flex;
    align-items: center;
    gap: 8px;

    .quality-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;

      &.quality-excellent {
        background: #52c41a;
        box-shadow: 0 0 6px #52c41a;
      }
      &.quality-good {
        background: #73d13d;
      }
      &.quality-fair {
        background: #faad14;
      }
      &.quality-poor {
        background: #ff4d4f;
      }
    }

    .quality-text {
      color: rgba(255, 255, 255, 0.7);
      font-size: 13px;
    }
  }
}

// Video Grid
.video-grid {
  flex: 1;
  display: grid;
  gap: 4px;
  padding: 4px;
  background: #0d0d1a;
  overflow: hidden;

  &.grid-2 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }

  &.grid-4 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }

  &.grid-6 {
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }

  &.grid-8 {
    grid-template-columns: 1fr 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
}

.video-cell {
  position: relative;
  background: #16213e;
  border-radius: 8px;
  overflow: hidden;

  .remote-video,
  .local-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .participant-label {
    position: absolute;
    bottom: 8px;
    left: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 16px;
    backdrop-filter: blur(4px);

    .participant-name {
      color: white;
      font-size: 13px;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .muted-icon {
      color: #ff4d4f;
      font-size: 14px;
    }
  }

  .local-label {
    .participant-name {
      color: #69c0ff;
    }
  }

  .video-off-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.7);
    color: rgba(255, 255, 255, 0.5);

    .video-off-icon {
      font-size: 32px;
    }

    span {
      font-size: 14px;
    }
  }
}

// Audio Call View
.audio-call-view {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.audio-participants-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  justify-content: center;
  padding: 32px;
}

.audio-participant {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  .audio-participant-name {
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

// Screen Share Indicator
.screen-share-indicator {
  position: absolute;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  background: rgba(24, 144, 255, 0.9);
  border-radius: 20px;
  color: white;
  font-size: 13px;
  z-index: 10;
  backdrop-filter: blur(4px);
}

// Controls Bar
.call-controls-bar {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  padding: 16px 32px;
  background: rgba(0, 0, 0, 0.75);
  border-radius: 48px;
  backdrop-filter: blur(16px);
  z-index: 10;

  :deep(.ant-btn) {
    width: 52px;
    height: 52px;
    font-size: 20px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.1);
    color: white;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
    }

    &.control-active {
      background: #ff4d4f;
      border-color: #ff4d4f;
      color: white;
    }
  }

  .end-call-btn {
    width: 60px;
    height: 60px;
    font-size: 24px;
  }
}

// Participant Count
.participant-count {
  position: absolute;
  bottom: 32px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  z-index: 10;
  backdrop-filter: blur(4px);
}
</style>
