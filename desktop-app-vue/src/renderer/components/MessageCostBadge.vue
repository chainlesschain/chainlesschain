<template>
  <a-tooltip placement="top">
    <template #title>
      <div class="cost-tooltip">
        <div class="tooltip-row">
          <span class="tooltip-label">输入 Token:</span>
          <span class="tooltip-value">{{ usage.inputTokens || 0 }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">输出 Token:</span>
          <span class="tooltip-value">{{ usage.outputTokens || 0 }}</span>
        </div>
        <div
          v-if="usage.cachedTokens > 0"
          class="tooltip-row"
        >
          <span class="tooltip-label">缓存 Token:</span>
          <span class="tooltip-value">{{ usage.cachedTokens }}</span>
        </div>
        <a-divider style="margin: 8px 0; border-color: rgba(255, 255, 255, 0.3)" />
        <div class="tooltip-row">
          <span class="tooltip-label">成本:</span>
          <span class="tooltip-value cost-highlight">${{ formatCost(cost) }}</span>
        </div>
        <div
          v-if="wasCached"
          class="tooltip-row"
        >
          <CheckCircleOutlined style="color: #52c41a" />
          <span class="tooltip-label">来自缓存（节省成本）</span>
        </div>
        <div
          v-if="wasCompressed"
          class="tooltip-row"
        >
          <ThunderboltOutlined style="color: #faad14" />
          <span class="tooltip-label">已压缩 {{ compressionRatio.toFixed(0) }}%</span>
        </div>
      </div>
    </template>

    <a-tag
      :color="getBadgeColor()"
      class="message-cost-badge"
      size="small"
    >
      <template #icon>
        <CheckCircleOutlined v-if="wasCached" />
        <ThunderboltOutlined v-else-if="wasCompressed" />
        <DatabaseOutlined v-else />
      </template>
      {{ formatTokens(totalTokens) }} • ${{ formatCost(cost) }}
    </a-tag>
  </a-tooltip>
</template>

<script setup>
import { computed } from 'vue';
import {
  CheckCircleOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  usage: {
    type: Object,
    required: true,
    default: () => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    }),
  },
  cost: {
    type: Number,
    default: 0,
  },
  wasCached: {
    type: Boolean,
    default: false,
  },
  wasCompressed: {
    type: Boolean,
    default: false,
  },
  compressionRatio: {
    type: Number,
    default: 1.0,
  },
});

// 计算属性
const totalTokens = computed(() => {
  return props.usage.totalTokens ||
         (props.usage.inputTokens + props.usage.outputTokens) ||
         0;
});

// 方法
function formatTokens(tokens) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatCost(cost) {
  if (cost < 0.0001) {
    return cost.toFixed(6);
  } else if (cost < 0.01) {
    return cost.toFixed(5);
  } else {
    return cost.toFixed(4);
  }
}

function getBadgeColor() {
  if (props.wasCached) {
    return 'success'; // 绿色 - 来自缓存
  } else if (props.wasCompressed) {
    return 'warning'; // 橙色 - 已压缩
  } else {
    return 'default'; // 灰色 - 正常
  }
}
</script>

<style scoped>
.message-cost-badge {
  margin-left: 8px;
  cursor: help;
  font-size: 12px;
  user-select: none;
}

.cost-tooltip {
  max-width: 280px;
  font-size: 12px;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  gap: 8px;
}

.tooltip-label {
  color: rgba(255, 255, 255, 0.85);
}

.tooltip-value {
  color: #fff;
  font-weight: bold;
}

.cost-highlight {
  color: #52c41a;
  font-size: 14px;
}
</style>
