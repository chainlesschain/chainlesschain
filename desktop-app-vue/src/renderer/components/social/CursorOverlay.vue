<template>
  <div
    ref="overlayRef"
    class="cursor-overlay"
  >
    <div
      v-for="cursor in visibleCursors"
      :key="cursor.did"
      class="remote-cursor"
      :style="getCursorStyle(cursor)"
    >
      <!-- Cursor Line -->
      <div
        class="cursor-line"
        :style="{ backgroundColor: cursor.color }"
      />

      <!-- Cursor Label -->
      <div
        class="cursor-label"
        :style="{
          backgroundColor: cursor.color,
          color: getContrastColor(cursor.color),
        }"
      >
        {{ cursor.name || 'Anonymous' }}
      </div>

      <!-- Selection Highlight -->
      <div
        v-if="cursor.selection"
        class="cursor-selection"
        :style="getSelectionStyle(cursor)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

// ==================== Props ====================

const props = defineProps({
  /**
   * List of remote cursor positions to display
   */
  cursors: {
    type: Array,
    default: () => [],
  },
  /**
   * Reference to the editor DOM element for position calculation
   */
  editorRef: {
    type: Object,
    default: null,
  },
  /**
   * Line height in pixels (for vertical positioning)
   */
  lineHeight: {
    type: Number,
    default: 27, // 15px font-size * 1.8 line-height
  },
  /**
   * Character width in pixels (approximate, for horizontal positioning)
   */
  charWidth: {
    type: Number,
    default: 8.4,
  },
  /**
   * Editor padding in pixels
   */
  editorPadding: {
    type: Number,
    default: 0,
  },
});

// ==================== Refs ====================

const overlayRef = ref(null);
const fadeTimers = ref(new Map());

// ==================== Computed ====================

/**
 * Filter out cursors that are too stale (> 60s without activity)
 */
const visibleCursors = computed(() => {
  const now = Date.now();
  const STALE_THRESHOLD = 60000; // 60 seconds

  return (props.cursors || []).filter((cursor) => {
    if (!cursor || !cursor.did) {return false;}
    if (!cursor.position) {return false;}

    // Filter stale cursors
    if (cursor.lastActivity && now - cursor.lastActivity > STALE_THRESHOLD) {
      return false;
    }

    // Don't show local cursor
    if (cursor.isLocal) {return false;}

    return true;
  });
});

// ==================== Lifecycle ====================

onMounted(() => {
  // Future: could set up resize observers here
});

onUnmounted(() => {
  // Clear any pending fade timers
  for (const [, timer] of fadeTimers.value) {
    clearTimeout(timer);
  }
  fadeTimers.value.clear();
});

// ==================== Methods ====================

/**
 * Calculate the CSS position for a cursor based on line/column
 */
function getCursorStyle(cursor) {
  if (!cursor.position) {
    return { display: 'none' };
  }

  const line = cursor.position.line || 0;
  const column = cursor.position.column || 0;

  const top = line * props.lineHeight + props.editorPadding;
  const left = column * props.charWidth + props.editorPadding;

  return {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 10,
    pointerEvents: 'none',
  };
}

/**
 * Calculate the selection highlight style
 */
function getSelectionStyle(cursor) {
  if (!cursor.selection) {
    return { display: 'none' };
  }

  const { start, end } = cursor.selection;
  if (!start || !end) {
    return { display: 'none' };
  }

  // Simple single-line selection
  if (start.line === end.line) {
    const width = Math.abs(end.column - start.column) * props.charWidth;
    const offsetLeft = Math.min(start.column, end.column) * props.charWidth;

    return {
      position: 'absolute',
      top: `${start.line * props.lineHeight + props.editorPadding}px`,
      left: `${offsetLeft + props.editorPadding}px`,
      width: `${Math.max(width, 2)}px`,
      height: `${props.lineHeight}px`,
      backgroundColor: cursor.color + '30', // 30 = ~19% opacity hex
      borderRadius: '2px',
      pointerEvents: 'none',
    };
  }

  // Multi-line selection: show just a rectangular approximation
  const startTop = start.line * props.lineHeight + props.editorPadding;
  const endBottom = (end.line + 1) * props.lineHeight + props.editorPadding;
  const height = endBottom - startTop;

  return {
    position: 'absolute',
    top: `${startTop}px`,
    left: `${props.editorPadding}px`,
    width: '100%',
    height: `${height}px`,
    backgroundColor: cursor.color + '15', // ~8% opacity
    borderLeft: `2px solid ${cursor.color}40`,
    borderRadius: '2px',
    pointerEvents: 'none',
  };
}

/**
 * Calculate a contrasting text color (black or white) for a background color
 */
function getContrastColor(hexColor) {
  if (!hexColor || hexColor.length < 7) {return '#ffffff';}

  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Perceived brightness formula
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 128 ? '#000000' : '#ffffff';
}
</script>

<style scoped>
.cursor-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.remote-cursor {
  transition: top 0.15s ease-out, left 0.15s ease-out;
}

.cursor-line {
  width: 2px;
  height: 20px;
  border-radius: 1px;
  animation: cursor-blink 1.2s ease-in-out infinite;
}

@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.cursor-label {
  position: absolute;
  top: -18px;
  left: 0;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  border-radius: 3px 3px 3px 0;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  opacity: 0.9;
  transition: opacity 0.3s ease;
}

.remote-cursor:hover .cursor-label {
  opacity: 1;
}

.cursor-selection {
  transition: all 0.15s ease-out;
}
</style>
