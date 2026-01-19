<template>
  <a-tooltip
    :title="statusText"
    placement="top"
  >
    <span
      class="online-status-indicator"
      :class="`status-${status}`"
    >
      <span class="status-dot" />
      <span
        v-if="showText"
        class="status-text"
      >{{ statusText }}</span>
      <span
        v-if="showDeviceCount && deviceCount > 1"
        class="device-count"
      >
        {{ deviceCount }}
      </span>
    </span>
  </a-tooltip>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  // 在线状态: 'online' | 'offline' | 'away'
  status: {
    type: String,
    default: 'offline',
    validator: (value) => ['online', 'offline', 'away'].includes(value),
  },
  // 最后在线时间戳
  lastSeen: {
    type: Number,
    default: 0,
  },
  // 设备数量
  deviceCount: {
    type: Number,
    default: 0,
  },
  // 是否显示文本
  showText: {
    type: Boolean,
    default: false,
  },
  // 是否显示设备数量
  showDeviceCount: {
    type: Boolean,
    default: false,
  },
  // 尺寸: 'small' | 'default' | 'large'
  size: {
    type: String,
    default: 'default',
    validator: (value) => ['small', 'default', 'large'].includes(value),
  },
});

// 状态文本
const statusText = computed(() => {
  switch (props.status) {
    case 'online':
      return props.deviceCount > 1 ? `在线 (${props.deviceCount} 台设备)` : '在线';
    case 'away':
      return '离开';
    case 'offline':
      if (props.lastSeen > 0) {
        return `离线 - ${formatLastSeen(props.lastSeen)}`;
      }
      return '离线';
    default:
      return '未知';
  }
});

// 格式化最后在线时间
function formatLastSeen(timestamp) {
  if (!timestamp) {return '';}

  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return '刚刚';
  } else if (minutes < 60) {
    return `${minutes}分钟前`;
  } else if (hours < 24) {
    return `${hours}小时前`;
  } else if (days < 7) {
    return `${days}天前`;
  } else {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
}
</script>

<style scoped>
.online-status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  position: relative;
}

/* 在线状态 - 绿色 */
.status-online .status-dot {
  background-color: #52c41a;
  box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.2);
}

/* 在线状态动画 */
.status-online .status-dot::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-color: #52c41a;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0;
    transform: scale(1.5);
  }
}

/* 离开状态 - 黄色 */
.status-away .status-dot {
  background-color: #faad14;
  box-shadow: 0 0 0 2px rgba(250, 173, 20, 0.2);
}

/* 离线状态 - 灰色 */
.status-offline .status-dot {
  background-color: #d9d9d9;
  box-shadow: 0 0 0 2px rgba(217, 217, 217, 0.2);
}

.status-text {
  color: rgba(0, 0, 0, 0.65);
  font-size: 12px;
}

.device-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background-color: #52c41a;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  border-radius: 8px;
  line-height: 1;
}

/* 尺寸变体 */
.online-status-indicator.size-small .status-dot {
  width: 6px;
  height: 6px;
}

.online-status-indicator.size-large .status-dot {
  width: 10px;
  height: 10px;
}
</style>
