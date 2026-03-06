<template>
  <div
    v-show="enabled"
    ref="overlayRef"
    class="danmaku-overlay"
  >
    <!-- Scrolling (normal) danmaku -->
    <div
      v-for="item in visibleNormalMessages"
      :key="item.id"
      class="danmaku-item danmaku-scroll"
      :style="getScrollStyle(item)"
    >
      {{ item.content }}
    </div>

    <!-- Fixed top danmaku -->
    <div
      v-for="item in visibleTopMessages"
      :key="item.id"
      class="danmaku-item danmaku-top"
      :style="getFixedStyle(item)"
    >
      {{ item.content }}
    </div>

    <!-- Fixed bottom danmaku -->
    <div
      v-for="item in visibleBottomMessages"
      :key="item.id"
      class="danmaku-item danmaku-bottom"
      :style="getFixedStyle(item)"
    >
      {{ item.content }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

// ==================== Props ====================

const props = defineProps({
  /**
   * Array of danmaku messages to display
   */
  messages: {
    type: Array,
    default: () => [],
  },
  /**
   * Whether the danmaku overlay is enabled
   */
  enabled: {
    type: Boolean,
    default: true,
  },
});

// ==================== Configuration ====================

const TRACK_COUNT = 12; // Number of horizontal tracks for scrolling danmaku
const SCROLL_DURATION = 8; // Seconds for a message to scroll across the screen
const FIXED_DURATION = 5; // Seconds for fixed (top/bottom) messages to display
const MAX_VISIBLE = 60; // Maximum visible danmaku at once
const TOP_TRACKS = 3; // Number of tracks for fixed-top danmaku
const BOTTOM_TRACKS = 3; // Number of tracks for fixed-bottom danmaku

// ==================== State ====================

const overlayRef = ref(null);

/**
 * Active danmaku items with their display metadata
 * Map<id, { message, track, startTime, type }>
 */
const activeItems = ref(new Map());

/**
 * Track allocation for scroll danmaku
 * Array of timestamps when each track becomes free
 */
const scrollTrackFreeAt = ref(new Array(TRACK_COUNT).fill(0));

/**
 * Track allocation for fixed top danmaku
 */
const topTrackFreeAt = ref(new Array(TOP_TRACKS).fill(0));

/**
 * Track allocation for fixed bottom danmaku
 */
const bottomTrackFreeAt = ref(new Array(BOTTOM_TRACKS).fill(0));

/**
 * Counter for processed message index (tracks which messages have been rendered)
 */
const processedCount = ref(0);

let cleanupTimer = null;

// ==================== Computed ====================

const visibleNormalMessages = computed(() => {
  const items = [];
  for (const [, item] of activeItems.value) {
    if (item.type === 'normal') {
      items.push(item);
    }
  }
  return items;
});

const visibleTopMessages = computed(() => {
  const items = [];
  for (const [, item] of activeItems.value) {
    if (item.type === 'top') {
      items.push(item);
    }
  }
  return items;
});

const visibleBottomMessages = computed(() => {
  const items = [];
  for (const [, item] of activeItems.value) {
    if (item.type === 'bottom') {
      items.push(item);
    }
  }
  return items;
});

// ==================== Methods ====================

/**
 * Allocate a track for a scrolling danmaku message
 * @returns {number} Track index, or -1 if no track available
 */
function allocateScrollTrack() {
  const now = Date.now();
  let bestTrack = -1;
  let earliestFree = Infinity;

  for (let i = 0; i < TRACK_COUNT; i++) {
    if (scrollTrackFreeAt.value[i] <= now) {
      // Track is free now
      scrollTrackFreeAt.value[i] = now + (SCROLL_DURATION * 1000) / 2;
      return i;
    }
    if (scrollTrackFreeAt.value[i] < earliestFree) {
      earliestFree = scrollTrackFreeAt.value[i];
      bestTrack = i;
    }
  }

  // No free track, use the one that becomes free earliest
  if (bestTrack !== -1) {
    scrollTrackFreeAt.value[bestTrack] = now + (SCROLL_DURATION * 1000) / 2;
  }
  return bestTrack;
}

/**
 * Allocate a track for a fixed top danmaku
 * @returns {number} Track index
 */
function allocateTopTrack() {
  const now = Date.now();
  for (let i = 0; i < TOP_TRACKS; i++) {
    if (topTrackFreeAt.value[i] <= now) {
      topTrackFreeAt.value[i] = now + FIXED_DURATION * 1000;
      return i;
    }
  }
  // Reuse track 0 if all occupied
  topTrackFreeAt.value[0] = now + FIXED_DURATION * 1000;
  return 0;
}

/**
 * Allocate a track for a fixed bottom danmaku
 * @returns {number} Track index
 */
function allocateBottomTrack() {
  const now = Date.now();
  for (let i = 0; i < BOTTOM_TRACKS; i++) {
    if (bottomTrackFreeAt.value[i] <= now) {
      bottomTrackFreeAt.value[i] = now + FIXED_DURATION * 1000;
      return i;
    }
  }
  bottomTrackFreeAt.value[0] = now + FIXED_DURATION * 1000;
  return 0;
}

/**
 * Process a new danmaku message and add it to the display
 * @param {Object} msg - Danmaku message
 */
function processMessage(msg) {
  if (!msg || !msg.id) {return;}
  if (activeItems.value.has(msg.id)) {return;}
  if (activeItems.value.size >= MAX_VISIBLE) {return;}

  const type = msg.message_type || 'normal';
  const now = Date.now();
  let track = 0;

  switch (type) {
    case 'top':
      track = allocateTopTrack();
      break;
    case 'bottom':
      track = allocateBottomTrack();
      break;
    case 'special':
    case 'normal':
    default:
      track = allocateScrollTrack();
      break;
  }

  const item = {
    id: msg.id,
    content: msg.content,
    color: msg.color || '#FFFFFF',
    font_size: msg.font_size || 24,
    type: type === 'special' ? 'normal' : type,
    track,
    startTime: now,
  };

  const newMap = new Map(activeItems.value);
  newMap.set(msg.id, item);
  activeItems.value = newMap;
}

/**
 * Get CSS style for a scrolling danmaku
 */
function getScrollStyle(item) {
  const trackHeight = 100 / TRACK_COUNT;
  return {
    color: item.color,
    fontSize: `${item.font_size}px`,
    top: `${item.track * trackHeight}%`,
    animationDuration: `${SCROLL_DURATION}s`,
  };
}

/**
 * Get CSS style for a fixed (top/bottom) danmaku
 */
function getFixedStyle(item) {
  const trackHeight = 32; // Fixed px per track for fixed danmaku
  const offset = item.track * trackHeight;
  return {
    color: item.color,
    fontSize: `${item.font_size}px`,
    ...(item.type === 'top'
      ? { top: `${offset + 8}px` }
      : { bottom: `${offset + 8}px` }),
    animationDuration: `${FIXED_DURATION}s`,
  };
}

/**
 * Clean up expired danmaku items
 */
function cleanupExpired() {
  const now = Date.now();
  let changed = false;
  const newMap = new Map(activeItems.value);

  for (const [id, item] of newMap) {
    const duration =
      (item.type === 'normal' ? SCROLL_DURATION : FIXED_DURATION) * 1000;
    if (now - item.startTime > duration) {
      newMap.delete(id);
      changed = true;
    }
  }

  if (changed) {
    activeItems.value = newMap;
  }
}

// ==================== Watchers ====================

watch(
  () => props.messages.length,
  (newLen) => {
    // Process only new messages (from processedCount to end)
    if (newLen > processedCount.value) {
      for (let i = processedCount.value; i < newLen; i++) {
        processMessage(props.messages[i]);
      }
      processedCount.value = newLen;
    }
  },
);

watch(
  () => props.enabled,
  (val) => {
    if (!val) {
      // Clear all active items when disabled
      activeItems.value = new Map();
      processedCount.value = props.messages.length;
    }
  },
);

// ==================== Lifecycle ====================

onMounted(() => {
  // Start cleanup timer
  cleanupTimer = setInterval(cleanupExpired, 1000);

  // Process any existing messages
  processedCount.value = 0;
  for (let i = 0; i < props.messages.length; i++) {
    processMessage(props.messages[i]);
  }
  processedCount.value = props.messages.length;
});

onUnmounted(() => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  activeItems.value = new Map();
});
</script>

<style scoped>
.danmaku-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
}

.danmaku-item {
  position: absolute;
  white-space: nowrap;
  font-weight: bold;
  text-shadow:
    1px 1px 2px rgba(0, 0, 0, 0.8),
    -1px -1px 2px rgba(0, 0, 0, 0.8),
    1px -1px 2px rgba(0, 0, 0, 0.8),
    -1px 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  will-change: transform;
  line-height: 1.4;
}

/* Scrolling danmaku: right to left */
.danmaku-scroll {
  right: 0;
  animation: danmaku-scroll-rtl linear forwards;
  transform: translateX(100%);
}

@keyframes danmaku-scroll-rtl {
  0% {
    transform: translateX(100%);
    right: 0;
  }
  100% {
    transform: translateX(0);
    right: 100%;
  }
}

/* Fixed top danmaku */
.danmaku-top {
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  animation: danmaku-fixed-fade linear forwards;
}

/* Fixed bottom danmaku */
.danmaku-bottom {
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  animation: danmaku-fixed-fade linear forwards;
}

@keyframes danmaku-fixed-fade {
  0% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
</style>
