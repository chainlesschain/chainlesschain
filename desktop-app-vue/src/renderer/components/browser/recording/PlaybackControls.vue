<template>
  <div class="playback-controls">
    <!-- Playback Status -->
    <div class="playback-status" :class="playbackState">
      <div class="status-info">
        <span class="status-icon">
          <PlayCircleOutlined v-if="playbackState === 'playing'" />
          <PauseCircleOutlined v-if="playbackState === 'paused'" />
          <CheckCircleOutlined v-if="playbackState === 'completed'" />
          <LoadingOutlined v-if="playbackState === 'loading'" spin />
        </span>
        <span class="status-text">{{ statusText }}</span>
      </div>
      <div class="playback-progress" v-if="totalEvents > 0">
        {{ currentEventIndex }} / {{ totalEvents }}
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-section">
      <a-slider
        v-model:value="progressPercent"
        :disabled="!canSeek"
        :tip-formatter="formatProgress"
        @change="handleSeek"
      />
      <div class="time-display">
        <span>{{ formatTime(currentTime) }}</span>
        <span>{{ formatTime(totalDuration) }}</span>
      </div>
    </div>

    <!-- Main Controls -->
    <div class="main-controls">
      <a-button
        shape="circle"
        :disabled="!canSkipBack"
        @click="skipBack"
      >
        <StepBackwardOutlined />
      </a-button>

      <a-button
        v-if="playbackState !== 'playing'"
        type="primary"
        shape="circle"
        size="large"
        :disabled="!canPlay"
        :loading="playbackState === 'loading'"
        @click="play"
      >
        <PlayCircleOutlined />
      </a-button>
      <a-button
        v-else
        type="primary"
        shape="circle"
        size="large"
        @click="pause"
      >
        <PauseOutlined />
      </a-button>

      <a-button
        shape="circle"
        :disabled="!canSkipForward"
        @click="skipForward"
      >
        <StepForwardOutlined />
      </a-button>

      <a-button
        danger
        shape="circle"
        :disabled="playbackState === 'idle'"
        @click="stop"
      >
        <StopOutlined />
      </a-button>
    </div>

    <!-- Speed Control -->
    <div class="speed-control">
      <span class="label">Speed:</span>
      <a-radio-group v-model:value="playbackSpeed" size="small" @change="updateSpeed">
        <a-radio-button value="0.5">0.5x</a-radio-button>
        <a-radio-button value="1">1x</a-radio-button>
        <a-radio-button value="2">2x</a-radio-button>
        <a-radio-button value="4">4x</a-radio-button>
      </a-radio-group>
    </div>

    <!-- Options -->
    <div class="playback-options">
      <a-checkbox v-model:checked="visualFeedback">
        Visual Feedback
      </a-checkbox>
      <a-checkbox v-model:checked="stepMode">
        Step Mode
      </a-checkbox>
      <a-checkbox v-model:checked="loopPlayback">
        Loop
      </a-checkbox>
    </div>

    <!-- Current Event Info -->
    <div class="current-event" v-if="currentEvent">
      <div class="event-header">Current Event</div>
      <div class="event-details">
        <a-tag :color="getEventColor(currentEvent.type)">{{ currentEvent.type }}</a-tag>
        <span class="event-target">{{ currentEvent.selector || currentEvent.url || '' }}</span>
      </div>
      <div class="event-value" v-if="currentEvent.text || currentEvent.value">
        {{ currentEvent.text || currentEvent.value }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  PauseOutlined,
  StopOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  recording: {
    type: Object,
    required: true
  },
  targetId: String
});

const emit = defineEmits(['playback-complete', 'event-played']);

// State
const playbackState = ref('idle'); // idle, loading, playing, paused, completed
const playbackId = ref(null);
const currentEventIndex = ref(0);
const currentTime = ref(0);
const playbackSpeed = ref('1');
const visualFeedback = ref(true);
const stepMode = ref(false);
const loopPlayback = ref(false);
const progressPercent = ref(0);

let unsubscribe = null;

// Computed
const totalEvents = computed(() => {
  const events = props.recording?.events;
  return events ? JSON.parse(events).length : 0;
});

const totalDuration = computed(() => props.recording?.duration || 0);

const currentEvent = computed(() => {
  const events = props.recording?.events;
  if (!events) return null;
  const parsed = JSON.parse(events);
  return parsed[currentEventIndex.value];
});

const statusText = computed(() => {
  const states = {
    idle: 'Ready',
    loading: 'Loading...',
    playing: 'Playing',
    paused: 'Paused',
    completed: 'Completed'
  };
  return states[playbackState.value];
});

const canPlay = computed(() => {
  return totalEvents.value > 0 && playbackState.value !== 'loading';
});

const canSeek = computed(() => {
  return playbackState.value === 'paused' || playbackState.value === 'idle';
});

const canSkipBack = computed(() => {
  return currentEventIndex.value > 0 && playbackState.value !== 'loading';
});

const canSkipForward = computed(() => {
  return currentEventIndex.value < totalEvents.value - 1 && playbackState.value !== 'loading';
});

// Methods
const play = async () => {
  if (!props.recording?.id) {
    message.error('No recording selected');
    return;
  }

  playbackState.value = 'loading';

  try {
    const result = await window.electronAPI.browser.recording.play(
      props.recording.id,
      props.targetId,
      {
        speed: parseFloat(playbackSpeed.value),
        visualFeedback: visualFeedback.value,
        stepMode: stepMode.value,
        startFromEvent: currentEventIndex.value
      }
    );

    playbackId.value = result.playbackId;
    playbackState.value = 'playing';
  } catch (error) {
    message.error('Failed to start playback: ' + error.message);
    playbackState.value = 'idle';
  }
};

const pause = async () => {
  if (playbackId.value) {
    try {
      await window.electronAPI.browser.recording.playPause(playbackId.value);
      playbackState.value = 'paused';
    } catch (error) {
      message.error('Failed to pause: ' + error.message);
    }
  }
};

const resume = async () => {
  if (playbackId.value) {
    try {
      await window.electronAPI.browser.recording.playResume(playbackId.value);
      playbackState.value = 'playing';
    } catch (error) {
      message.error('Failed to resume: ' + error.message);
    }
  }
};

const stop = async () => {
  if (playbackId.value) {
    try {
      await window.electronAPI.browser.recording.playStop(playbackId.value);
    } catch (error) {
      console.error('Failed to stop:', error);
    }
  }
  playbackState.value = 'idle';
  playbackId.value = null;
  currentEventIndex.value = 0;
  currentTime.value = 0;
  progressPercent.value = 0;
};

const skipBack = () => {
  if (currentEventIndex.value > 0) {
    currentEventIndex.value--;
    updateProgress();
  }
};

const skipForward = () => {
  if (currentEventIndex.value < totalEvents.value - 1) {
    currentEventIndex.value++;
    updateProgress();
  }
};

const handleSeek = (value) => {
  const eventIndex = Math.floor((value / 100) * totalEvents.value);
  currentEventIndex.value = Math.min(eventIndex, totalEvents.value - 1);
  currentTime.value = (value / 100) * totalDuration.value;
};

const updateSpeed = async () => {
  if (playbackId.value && playbackState.value === 'playing') {
    // Would need an IPC call to update speed mid-playback
    // For now, user needs to restart playback
    message.info('Restart playback for speed change to take effect');
  }
};

const updateProgress = () => {
  progressPercent.value = totalEvents.value > 0
    ? (currentEventIndex.value / totalEvents.value) * 100
    : 0;

  const events = props.recording?.events;
  if (events) {
    const parsed = JSON.parse(events);
    const event = parsed[currentEventIndex.value];
    if (event) {
      currentTime.value = event.timestamp - parsed[0].timestamp;
    }
  }
};

const formatTime = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const formatProgress = (value) => {
  const eventIndex = Math.floor((value / 100) * totalEvents.value);
  return `Event ${eventIndex + 1}`;
};

const getEventColor = (type) => {
  const colors = {
    click: 'green',
    type: 'blue',
    navigate: 'purple',
    scroll: 'orange',
    key: 'cyan',
  };
  return colors[type] || 'default';
};

const handlePlaybackEvent = (event) => {
  if (event.playbackId !== playbackId.value) return;

  switch (event.type) {
    case 'event:played':
      currentEventIndex.value = event.eventIndex;
      currentTime.value = event.currentTime || 0;
      updateProgress();
      emit('event-played', event);
      break;

    case 'playback:completed':
      playbackState.value = 'completed';
      if (loopPlayback.value) {
        currentEventIndex.value = 0;
        currentTime.value = 0;
        progressPercent.value = 0;
        play();
      } else {
        emit('playback-complete');
      }
      break;

    case 'playback:error':
      playbackState.value = 'idle';
      message.error('Playback error: ' + event.error);
      break;
  }
};

onMounted(() => {
  unsubscribe = window.electronAPI.browser.recording.onEvent(handlePlaybackEvent);
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
  stop();
});

// Watch recording change
watch(() => props.recording, () => {
  stop();
}, { deep: true });
</script>

<style scoped>
.playback-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.playback-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f5f5f5;
  border-radius: 8px;
}

.playback-status.playing {
  background: #e6f7ff;
  border: 1px solid #91d5ff;
}

.playback-status.paused {
  background: #fffbe6;
  border: 1px solid #ffe58f;
}

.playback-status.completed {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-icon {
  font-size: 18px;
}

.status-text {
  font-weight: 500;
}

.progress-section {
  padding: 0 8px;
}

.time-display {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.main-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.speed-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.speed-control .label {
  font-size: 12px;
  color: #666;
}

.playback-options {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.current-event {
  background: #fafafa;
  border-radius: 8px;
  padding: 12px;
}

.event-header {
  font-size: 12px;
  color: #666;
  margin-bottom: 8px;
}

.event-details {
  display: flex;
  align-items: center;
  gap: 8px;
}

.event-target {
  font-family: monospace;
  font-size: 12px;
  color: #666;
}

.event-value {
  margin-top: 4px;
  font-size: 12px;
  color: #333;
  background: #fff;
  padding: 4px 8px;
  border-radius: 4px;
}
</style>
