<template>
  <div class="recording-control">
    <!-- Recording Status -->
    <div class="recording-status" :class="{ recording: isRecording, paused: isPaused }">
      <div class="status-indicator">
        <span class="recording-dot" v-if="isRecording && !isPaused"></span>
        <span class="status-text">{{ statusText }}</span>
      </div>
      <div class="recording-time" v-if="isRecording">
        {{ formatDuration(recordingDuration) }}
      </div>
    </div>

    <!-- Main Controls -->
    <div class="main-controls">
      <a-button
        v-if="!isRecording"
        type="primary"
        size="large"
        danger
        @click="startRecording"
        :loading="starting"
      >
        <template #icon><VideoCameraOutlined /></template>
        Start Recording
      </a-button>

      <template v-else>
        <a-button
          v-if="!isPaused"
          size="large"
          @click="pauseRecording"
        >
          <template #icon><PauseOutlined /></template>
          Pause
        </a-button>
        <a-button
          v-else
          type="primary"
          size="large"
          @click="resumeRecording"
        >
          <template #icon><PlayCircleOutlined /></template>
          Resume
        </a-button>

        <a-button
          type="primary"
          size="large"
          danger
          @click="stopRecording"
        >
          <template #icon><StopOutlined /></template>
          Stop
        </a-button>
      </template>
    </div>

    <!-- Recording Options -->
    <div class="recording-options" v-if="!isRecording">
      <a-collapse :bordered="false">
        <a-collapse-panel key="options" header="Recording Options">
          <a-form layout="vertical" size="small">
            <a-form-item label="Recording Name">
              <a-input v-model:value="recordingName" placeholder="My Recording" />
            </a-form-item>
            <a-form-item label="Capture">
              <a-checkbox-group v-model:value="captureOptions">
                <a-checkbox value="clicks">Clicks</a-checkbox>
                <a-checkbox value="typing">Typing</a-checkbox>
                <a-checkbox value="scrolls">Scrolls</a-checkbox>
                <a-checkbox value="navigation">Navigation</a-checkbox>
                <a-checkbox value="screenshots">Auto Screenshots</a-checkbox>
              </a-checkbox-group>
            </a-form-item>
            <a-form-item label="Event Coalescing">
              <a-slider
                v-model:value="coalesceDelay"
                :min="0"
                :max="1000"
                :step="100"
                :marks="{ 0: 'Off', 500: '500ms', 1000: '1s' }"
              />
            </a-form-item>
          </a-form>
        </a-collapse-panel>
      </a-collapse>
    </div>

    <!-- Live Stats -->
    <div class="live-stats" v-if="isRecording">
      <a-statistic title="Events" :value="eventCount" />
      <a-statistic title="Clicks" :value="clickCount" />
      <a-statistic title="Inputs" :value="inputCount" />
      <a-statistic title="Navigations" :value="navigationCount" />
    </div>

    <!-- Recent Events -->
    <div class="recent-events" v-if="isRecording && recentEvents.length > 0">
      <div class="events-header">
        <span>Recent Events</span>
        <a-badge :count="eventCount" :overflow-count="999" />
      </div>
      <div class="events-list">
        <div
          v-for="(event, index) in recentEvents"
          :key="index"
          class="event-item"
          :class="event.type"
        >
          <span class="event-icon">
            <component :is="getEventIcon(event.type)" />
          </span>
          <span class="event-desc">{{ getEventDescription(event) }}</span>
          <span class="event-time">{{ formatTime(event.timestamp) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  VideoCameraOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SelectOutlined,
  FormOutlined,
  GlobalOutlined,
  ArrowDownOutlined,
  KeyOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  targetId: String
});

const emit = defineEmits(['recording-saved', 'recording-started', 'recording-stopped']);

// State
const isRecording = ref(false);
const isPaused = ref(false);
const starting = ref(false);
const recordingName = ref('');
const captureOptions = ref(['clicks', 'typing', 'scrolls', 'navigation']);
const coalesceDelay = ref(300);
const recordingDuration = ref(0);
const eventCount = ref(0);
const clickCount = ref(0);
const inputCount = ref(0);
const navigationCount = ref(0);
const recentEvents = ref([]);

let durationInterval = null;
let unsubscribe = null;

// Computed
const statusText = computed(() => {
  if (!isRecording.value) return 'Ready to Record';
  if (isPaused.value) return 'Paused';
  return 'Recording...';
});

// Methods
const startRecording = async () => {
  starting.value = true;
  try {
    await window.electronAPI.browser.recording.start(props.targetId, {
      name: recordingName.value || `Recording ${Date.now()}`,
      captureClicks: captureOptions.value.includes('clicks'),
      captureTyping: captureOptions.value.includes('typing'),
      captureScrolls: captureOptions.value.includes('scrolls'),
      captureNavigation: captureOptions.value.includes('navigation'),
      captureScreenshots: captureOptions.value.includes('screenshots'),
      coalesceDelay: coalesceDelay.value
    });

    isRecording.value = true;
    isPaused.value = false;
    recordingDuration.value = 0;
    eventCount.value = 0;
    clickCount.value = 0;
    inputCount.value = 0;
    navigationCount.value = 0;
    recentEvents.value = [];

    // Start duration timer
    durationInterval = setInterval(() => {
      if (!isPaused.value) {
        recordingDuration.value += 1000;
      }
    }, 1000);

    emit('recording-started');
    message.success('Recording started');
  } catch (error) {
    message.error('Failed to start recording: ' + error.message);
  } finally {
    starting.value = false;
  }
};

const pauseRecording = async () => {
  try {
    await window.electronAPI.browser.recording.pause(props.targetId);
    isPaused.value = true;
    message.info('Recording paused');
  } catch (error) {
    message.error('Failed to pause: ' + error.message);
  }
};

const resumeRecording = async () => {
  try {
    await window.electronAPI.browser.recording.resume(props.targetId);
    isPaused.value = false;
    message.info('Recording resumed');
  } catch (error) {
    message.error('Failed to resume: ' + error.message);
  }
};

const stopRecording = async () => {
  try {
    const recording = await window.electronAPI.browser.recording.stop(props.targetId);

    isRecording.value = false;
    isPaused.value = false;

    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }

    // Save the recording
    if (recording) {
      const saved = await window.electronAPI.browser.recording.save({
        ...recording,
        name: recordingName.value || `Recording ${new Date().toLocaleString()}`
      });
      emit('recording-saved', saved);
      message.success('Recording saved');
    }

    emit('recording-stopped');
  } catch (error) {
    message.error('Failed to stop recording: ' + error.message);
  }
};

const handleRecordingEvent = (event) => {
  eventCount.value++;

  // Update counters
  switch (event.type) {
    case 'click':
      clickCount.value++;
      break;
    case 'type':
    case 'input':
      inputCount.value++;
      break;
    case 'navigate':
      navigationCount.value++;
      break;
  }

  // Add to recent events (keep last 5)
  recentEvents.value.unshift(event);
  if (recentEvents.value.length > 5) {
    recentEvents.value.pop();
  }
};

const getEventIcon = (type) => {
  const icons = {
    click: SelectOutlined,
    type: FormOutlined,
    input: FormOutlined,
    navigate: GlobalOutlined,
    scroll: ArrowDownOutlined,
    key: KeyOutlined,
  };
  return icons[type] || SelectOutlined;
};

const getEventDescription = (event) => {
  switch (event.type) {
    case 'click':
      return `Clicked ${event.selector || 'element'}`;
    case 'type':
    case 'input':
      return `Typed "${truncate(event.text, 20)}"`;
    case 'navigate':
      return `Navigated to ${truncate(event.url, 30)}`;
    case 'scroll':
      return `Scrolled ${event.direction || 'down'}`;
    case 'key':
      return `Pressed ${event.key}`;
    default:
      return event.type;
  }
};

const truncate = (str, maxLen) => {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
};

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

onMounted(() => {
  // Subscribe to recording events
  unsubscribe = window.electronAPI.browser.recording.onEvent((event) => {
    if (event.targetId === props.targetId) {
      handleRecordingEvent(event);
    }
  });
});

onUnmounted(() => {
  if (durationInterval) {
    clearInterval(durationInterval);
  }
  if (unsubscribe) {
    unsubscribe();
  }
});
</script>

<style scoped>
.recording-control {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.recording-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f5f5f5;
  border-radius: 8px;
}

.recording-status.recording {
  background: #fff1f0;
  border: 1px solid #ffa39e;
}

.recording-status.paused {
  background: #fffbe6;
  border: 1px solid #ffe58f;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.recording-dot {
  width: 12px;
  height: 12px;
  background: #ff4d4f;
  border-radius: 50%;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.status-text {
  font-weight: 500;
}

.recording-time {
  font-family: monospace;
  font-size: 18px;
  font-weight: 600;
}

.main-controls {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.live-stats {
  display: flex;
  justify-content: space-around;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
}

.live-stats :deep(.ant-statistic-title) {
  font-size: 12px;
}

.live-stats :deep(.ant-statistic-content) {
  font-size: 20px;
}

.recent-events {
  background: #fafafa;
  border-radius: 8px;
  overflow: hidden;
}

.events-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f0f0f0;
  font-weight: 500;
}

.events-list {
  max-height: 200px;
  overflow: auto;
}

.event-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12px;
}

.event-item:last-child {
  border-bottom: none;
}

.event-icon {
  color: #666;
}

.event-desc {
  flex: 1;
}

.event-time {
  color: #999;
  font-size: 11px;
}
</style>
