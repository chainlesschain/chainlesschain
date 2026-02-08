<template>
  <div class="recording-timeline">
    <!-- Timeline Header -->
    <div class="timeline-header">
      <div class="header-info">
        <h4>{{ recording?.name || "Recording" }}</h4>
        <span class="duration">{{ formatDuration(recording?.duration) }}</span>
      </div>
      <div class="header-actions">
        <a-tooltip title="Zoom In">
          <a-button size="small" :disabled="zoom >= 4" @click="zoomIn">
            <ZoomInOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip title="Zoom Out">
          <a-button size="small" :disabled="zoom <= 0.25" @click="zoomOut">
            <ZoomOutOutlined />
          </a-button>
        </a-tooltip>
        <a-tooltip title="Fit to View">
          <a-button size="small" @click="fitToView">
            <FullscreenOutlined />
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- Timeline Container -->
    <div ref="timelineContainer" class="timeline-container">
      <!-- Time Ruler -->
      <div class="time-ruler" :style="{ width: timelineWidth + 'px' }">
        <div
          v-for="tick in timeTicks"
          :key="tick.time"
          class="tick"
          :class="{ major: tick.major }"
          :style="{ left: tick.position + 'px' }"
        >
          <span v-if="tick.major" class="tick-label">{{ tick.label }}</span>
        </div>
      </div>

      <!-- Events Track -->
      <div class="events-track" :style="{ width: timelineWidth + 'px' }">
        <div
          v-for="(event, index) in events"
          :key="index"
          class="event-marker"
          :class="[event.type, { selected: selectedEventIndex === index }]"
          :style="{ left: getEventPosition(event) + 'px' }"
          @click="selectEvent(index)"
          @dblclick="editEvent(index)"
        >
          <a-tooltip :title="getEventTooltip(event)">
            <div class="marker-icon">
              <component :is="getEventIcon(event.type)" />
            </div>
          </a-tooltip>
        </div>

        <!-- Playhead -->
        <div
          v-if="playheadPosition !== null"
          class="playhead"
          :style="{ left: playheadPosition + 'px' }"
        >
          <div class="playhead-line" />
        </div>
      </div>

      <!-- Waveform/Activity Track (optional) -->
      <div
        v-if="showActivityTrack"
        class="activity-track"
        :style="{ width: timelineWidth + 'px' }"
      >
        <canvas ref="activityCanvas" :width="timelineWidth" height="30" />
      </div>
    </div>

    <!-- Event Details Panel -->
    <div v-if="selectedEvent" class="event-details">
      <div class="details-header">
        <a-tag :color="getEventColor(selectedEvent.type)">
          {{ selectedEvent.type }}
        </a-tag>
        <span class="event-time">{{
          formatTime(selectedEvent.timestamp)
        }}</span>
        <a-button type="link" size="small" @click="selectedEventIndex = null">
          <CloseOutlined />
        </a-button>
      </div>
      <div class="details-content">
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item v-if="selectedEvent.selector" label="Selector">
            <code>{{ selectedEvent.selector }}</code>
          </a-descriptions-item>
          <a-descriptions-item v-if="selectedEvent.url" label="URL">
            {{ selectedEvent.url }}
          </a-descriptions-item>
          <a-descriptions-item v-if="selectedEvent.text" label="Text">
            {{ selectedEvent.text }}
          </a-descriptions-item>
          <a-descriptions-item v-if="selectedEvent.value" label="Value">
            {{ selectedEvent.value }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="selectedEvent.x !== undefined"
            label="Position"
          >
            ({{ selectedEvent.x }}, {{ selectedEvent.y }})
          </a-descriptions-item>
        </a-descriptions>
      </div>
      <div class="details-actions">
        <a-button size="small" @click="playFromEvent">
          <PlayCircleOutlined /> Play from here
        </a-button>
        <a-button size="small" danger @click="deleteEvent">
          <DeleteOutlined /> Delete
        </a-button>
      </div>
    </div>

    <!-- Event List (Compact) -->
    <div v-if="showEventList" class="event-list">
      <div class="list-header">
        <span>Events ({{ events.length }})</span>
        <a-input-search
          v-model:value="searchQuery"
          placeholder="Filter events"
          size="small"
          style="width: 150px"
        />
      </div>
      <div class="list-content">
        <div
          v-for="(event, index) in filteredEvents"
          :key="index"
          class="list-item"
          :class="{ selected: selectedEventIndex === event.originalIndex }"
          @click="selectEvent(event.originalIndex)"
        >
          <span class="item-index">{{ event.originalIndex + 1 }}</span>
          <span class="item-icon">
            <component :is="getEventIcon(event.type)" />
          </span>
          <span class="item-type">{{ event.type }}</span>
          <span class="item-target">{{
            truncate(event.selector || event.url || event.text, 30)
          }}</span>
          <span class="item-time">{{ formatTime(event.timestamp) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from "vue";
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  CloseOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  SelectOutlined,
  FormOutlined,
  GlobalOutlined,
  ArrowDownOutlined,
  KeyOutlined,
  EyeOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  recording: {
    type: Object,
    required: true,
  },
  currentTime: {
    type: Number,
    default: 0,
  },
  showEventList: {
    type: Boolean,
    default: true,
  },
  showActivityTrack: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "select-event",
  "edit-event",
  "delete-event",
  "play-from",
]);

// Refs
const timelineContainer = ref(null);
const activityCanvas = ref(null);

// State
const zoom = ref(1);
const selectedEventIndex = ref(null);
const searchQuery = ref("");

// Computed
const events = computed(() => {
  if (!props.recording?.events) {
    return [];
  }
  try {
    return JSON.parse(props.recording.events);
  } catch {
    return [];
  }
});

const duration = computed(() => props.recording?.duration || 0);

const timelineWidth = computed(() => {
  const containerWidth = timelineContainer.value?.clientWidth || 800;
  const minWidth = containerWidth;
  const calculatedWidth = (duration.value / 1000) * 100 * zoom.value;
  return Math.max(minWidth, calculatedWidth);
});

const timeTicks = computed(() => {
  const ticks = [];
  const intervalMs = getTickInterval();
  const totalMs = duration.value;

  for (let time = 0; time <= totalMs; time += intervalMs) {
    const position = (time / totalMs) * timelineWidth.value;
    const major = time % (intervalMs * 5) === 0;
    ticks.push({
      time,
      position,
      major,
      label: formatTime(time),
    });
  }

  return ticks;
});

const selectedEvent = computed(() => {
  if (selectedEventIndex.value === null) {
    return null;
  }
  return events.value[selectedEventIndex.value];
});

const filteredEvents = computed(() => {
  let result = events.value.map((e, i) => ({ ...e, originalIndex: i }));
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(
      (e) =>
        e.type.toLowerCase().includes(query) ||
        (e.selector && e.selector.toLowerCase().includes(query)) ||
        (e.url && e.url.toLowerCase().includes(query)) ||
        (e.text && e.text.toLowerCase().includes(query)),
    );
  }
  return result;
});

const playheadPosition = computed(() => {
  if (duration.value === 0) {
    return null;
  }
  return (props.currentTime / duration.value) * timelineWidth.value;
});

// Methods
const getTickInterval = () => {
  const durationSec = duration.value / 1000;
  if (durationSec <= 10) {
    return 1000;
  }
  if (durationSec <= 60) {
    return 5000;
  }
  if (durationSec <= 300) {
    return 30000;
  }
  return 60000;
};

const getEventPosition = (event) => {
  if (!events.value.length || duration.value === 0) {
    return 0;
  }
  const startTime = events.value[0].timestamp;
  const relativeTime = event.timestamp - startTime;
  return (relativeTime / duration.value) * timelineWidth.value;
};

const getEventIcon = (type) => {
  const icons = {
    click: SelectOutlined,
    type: FormOutlined,
    input: FormOutlined,
    navigate: GlobalOutlined,
    scroll: ArrowDownOutlined,
    key: KeyOutlined,
    hover: EyeOutlined,
  };
  return icons[type] || SelectOutlined;
};

const getEventColor = (type) => {
  const colors = {
    click: "green",
    type: "blue",
    input: "blue",
    navigate: "purple",
    scroll: "orange",
    key: "cyan",
    hover: "default",
  };
  return colors[type] || "default";
};

const getEventTooltip = (event) => {
  let tooltip = `${event.type}`;
  if (event.selector) {
    tooltip += `: ${event.selector}`;
  }
  if (event.text) {
    tooltip += ` "${truncate(event.text, 20)}"`;
  }
  if (event.url) {
    tooltip += ` ${truncate(event.url, 30)}`;
  }
  return tooltip;
};

const selectEvent = (index) => {
  selectedEventIndex.value = index;
  emit("select-event", index);
};

const editEvent = (index) => {
  emit("edit-event", index);
};

const deleteEvent = () => {
  if (selectedEventIndex.value !== null) {
    emit("delete-event", selectedEventIndex.value);
    selectedEventIndex.value = null;
  }
};

const playFromEvent = () => {
  if (selectedEventIndex.value !== null) {
    emit("play-from", selectedEventIndex.value);
  }
};

const zoomIn = () => {
  zoom.value = Math.min(zoom.value * 1.5, 4);
};

const zoomOut = () => {
  zoom.value = Math.max(zoom.value / 1.5, 0.25);
};

const fitToView = () => {
  zoom.value = 1;
};

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;
};

const formatDuration = (ms) => {
  if (!ms) {
    return "0:00";
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

const truncate = (str, maxLen) => {
  if (!str) {
    return "";
  }
  return str.length > maxLen ? str.substring(0, maxLen) + "..." : str;
};

// Draw activity track
const drawActivityTrack = () => {
  if (!activityCanvas.value || !events.value.length) {
    return;
  }

  const ctx = activityCanvas.value.getContext("2d");
  const width = timelineWidth.value;
  const height = 30;

  ctx.clearRect(0, 0, width, height);

  // Create activity histogram
  const bucketCount = Math.min(width, 200);
  const buckets = new Array(bucketCount).fill(0);
  const startTime = events.value[0].timestamp;

  events.value.forEach((event) => {
    const relativeTime = event.timestamp - startTime;
    const bucketIndex = Math.floor(
      (relativeTime / duration.value) * bucketCount,
    );
    if (bucketIndex >= 0 && bucketIndex < bucketCount) {
      buckets[bucketIndex]++;
    }
  });

  const maxCount = Math.max(...buckets, 1);

  // Draw bars
  ctx.fillStyle = "rgba(24, 144, 255, 0.3)";
  const barWidth = width / bucketCount;

  buckets.forEach((count, i) => {
    const barHeight = (count / maxCount) * height;
    ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
  });
};

// Watch for changes
watch(
  [() => props.recording, zoom],
  () => {
    nextTick(() => {
      drawActivityTrack();
    });
  },
  { deep: true },
);

onMounted(() => {
  drawActivityTrack();
});
</script>

<style scoped>
.recording-timeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  overflow: hidden;
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-info h4 {
  margin: 0;
}

.duration {
  color: #999;
  font-size: 12px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.timeline-container {
  flex: 1;
  overflow-x: auto;
  position: relative;
  min-height: 100px;
}

.time-ruler {
  height: 24px;
  background: #f5f5f5;
  border-bottom: 1px solid #e8e8e8;
  position: relative;
}

.tick {
  position: absolute;
  top: 0;
  height: 100%;
  border-left: 1px solid #d9d9d9;
}

.tick.major {
  border-left: 1px solid #999;
}

.tick-label {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 10px;
  color: #666;
  white-space: nowrap;
}

.events-track {
  height: 50px;
  position: relative;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.02) 1px, transparent 1px);
  background-size: 50px 100%;
}

.event-marker {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  cursor: pointer;
  transition: transform 0.1s;
}

.event-marker:hover {
  transform: translate(-50%, -50%) scale(1.2);
}

.event-marker.selected {
  transform: translate(-50%, -50%) scale(1.3);
}

.marker-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 2px solid #1890ff;
  font-size: 12px;
  color: #1890ff;
}

.event-marker.click .marker-icon {
  border-color: #52c41a;
  color: #52c41a;
}

.event-marker.type .marker-icon,
.event-marker.input .marker-icon {
  border-color: #1890ff;
  color: #1890ff;
}

.event-marker.navigate .marker-icon {
  border-color: #722ed1;
  color: #722ed1;
}

.event-marker.scroll .marker-icon {
  border-color: #fa8c16;
  color: #fa8c16;
}

.playhead {
  position: absolute;
  top: 0;
  height: 100%;
  pointer-events: none;
}

.playhead-line {
  width: 2px;
  height: 100%;
  background: #ff4d4f;
}

.activity-track {
  height: 30px;
  border-top: 1px solid #e8e8e8;
}

.event-details {
  padding: 12px;
  border-top: 1px solid #e8e8e8;
  background: #fafafa;
}

.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.event-time {
  flex: 1;
  font-size: 12px;
  color: #999;
}

.details-content {
  margin-bottom: 8px;
}

.details-content code {
  font-size: 12px;
  background: #f5f5f5;
  padding: 2px 4px;
  border-radius: 2px;
}

.details-actions {
  display: flex;
  gap: 8px;
}

.event-list {
  border-top: 1px solid #e8e8e8;
  max-height: 200px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  font-weight: 500;
}

.list-content {
  flex: 1;
  overflow: auto;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
}

.list-item:hover {
  background: #f5f5f5;
}

.list-item.selected {
  background: #e6f7ff;
}

.item-index {
  color: #999;
  width: 30px;
}

.item-icon {
  color: #666;
}

.item-type {
  width: 60px;
  font-weight: 500;
}

.item-target {
  flex: 1;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-time {
  color: #999;
  font-family: monospace;
}
</style>
