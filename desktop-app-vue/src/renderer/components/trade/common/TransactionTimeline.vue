<template>
  <div class="transaction-timeline">
    <a-timeline :mode="mode" :pending="pending">
      <a-timeline-item
        v-for="(item, index) in sortedItems"
        :key="item.id || index"
        :color="getTimelineColor(item)"
      >
        <!-- 时间线图标 -->
        <template #dot>
          <div class="timeline-dot" :style="{ backgroundColor: getTimelineColor(item) }">
            <component
              :is="getTimelineIcon(item)"
              :style="{ color: 'white', fontSize: '16px' }"
            />
          </div>
        </template>

        <!-- 时间线内容 -->
        <a-card
          class="timeline-card"
          size="small"
          :hoverable="hoverable"
          @click="handleItemClick(item)"
        >
          <!-- 标题 -->
          <template #title>
            <a-space>
              <a-tag :color="getItemTypeColor(item.type)">
                {{ getItemTypeName(item.type) }}
              </a-tag>
              <span class="item-title">{{ item.title || getDefaultTitle(item) }}</span>
            </a-space>
          </template>

          <!-- 操作按钮 -->
          <template v-if="showActions" #extra>
            <a-dropdown :trigger="['click']">
              <a-button type="text" size="small">
                <ellipsis-outlined />
              </a-button>
              <template #overlay>
                <a-menu @click="handleActionClick($event, item)">
                  <a-menu-item key="view">
                    <eye-outlined /> 查看详情
                  </a-menu-item>
                  <a-menu-item key="copy">
                    <copy-outlined /> 复制ID
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>

          <!-- 卡片内容 -->
          <div class="timeline-content">
            <!-- 主要信息 -->
            <a-descriptions :column="compact ? 1 : 2" size="small">
              <!-- 状态 -->
              <a-descriptions-item v-if="item.status" label="状态">
                <status-badge :status="item.status" :type="statusType" show-icon />
              </a-descriptions-item>

              <!-- 金额 -->
              <a-descriptions-item v-if="item.amount !== undefined" label="金额">
                <span class="amount-value">
                  {{ formatAmount(item.amount) }}
                  <span v-if="item.asset_symbol" class="amount-symbol">
                    {{ item.asset_symbol }}
                  </span>
                </span>
              </a-descriptions-item>

              <!-- 数量 -->
              <a-descriptions-item v-if="item.quantity" label="数量">
                {{ item.quantity }}
              </a-descriptions-item>

              <!-- 发起方 -->
              <a-descriptions-item v-if="item.from_did" label="发起方">
                <a-typography-text copyable :ellipsis="{ tooltip: item.from_did }">
                  {{ formatDid(item.from_did) }}
                </a-typography-text>
              </a-descriptions-item>

              <!-- 接收方 -->
              <a-descriptions-item v-if="item.to_did" label="接收方">
                <a-typography-text copyable :ellipsis="{ tooltip: item.to_did }">
                  {{ formatDid(item.to_did) }}
                </a-typography-text>
              </a-descriptions-item>

              <!-- 时间 -->
              <a-descriptions-item label="时间" :span="compact ? 1 : 2">
                <a-tooltip :title="formatFullTime(item.created_at || item.timestamp)">
                  <clock-circle-outlined style="margin-right: 4px" />
                  {{ formatTime(item.created_at || item.timestamp) }}
                </a-tooltip>
              </a-descriptions-item>
            </a-descriptions>

            <!-- 描述信息 -->
            <div v-if="item.description || item.memo" class="item-description">
              <a-typography-paragraph
                :ellipsis="{ rows: 2, expandable: true, symbol: '展开' }"
                style="margin: 0"
              >
                {{ item.description || item.memo }}
              </a-typography-paragraph>
            </div>

            <!-- 元数据 -->
            <div v-if="showMetadata && item.metadata" class="item-metadata">
              <a-tag
                v-for="(value, key) in visibleMetadata(item.metadata)"
                :key="key"
                color="blue"
                size="small"
              >
                {{ key }}: {{ value }}
              </a-tag>
            </div>
          </div>
        </a-card>
      </a-timeline-item>

      <!-- Pending 占位符 -->
      <a-timeline-item v-if="pending" color="gray">
        <template #dot>
          <loading-outlined style="font-size: 16px" />
        </template>
        <span style="color: #8c8c8c">{{ pendingText }}</span>
      </a-timeline-item>
    </a-timeline>

    <!-- 空状态 -->
    <a-empty
      v-if="!loading && sortedItems.length === 0"
      :description="emptyText"
      :image="simpleImage ? Empty.PRESENTED_IMAGE_SIMPLE : undefined"
    />

    <!-- 加载状态 -->
    <div v-if="loading" class="timeline-loading">
      <a-spin tip="加载中...">
        <div style="height: 100px"></div>
      </a-spin>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Empty, message } from 'ant-design-vue';
import {
  ClockCircleOutlined,
  EyeOutlined,
  CopyOutlined,
  EllipsisOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  DollarOutlined,
  SwapOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons-vue';
import StatusBadge from './StatusBadge.vue';

// Props
const props = defineProps({
  // 时间线数据
  items: {
    type: Array,
    default: () => [],
  },
  // 时间线模式
  mode: {
    type: String,
    default: 'left', // 'left' | 'alternate' | 'right'
  },
  // 是否显示pending状态
  pending: {
    type: Boolean,
    default: false,
  },
  // pending文本
  pendingText: {
    type: String,
    default: '处理中...',
  },
  // 是否可悬停
  hoverable: {
    type: Boolean,
    default: true,
  },
  // 是否显示操作按钮
  showActions: {
    type: Boolean,
    default: false,
  },
  // 是否显示元数据
  showMetadata: {
    type: Boolean,
    default: false,
  },
  // 紧凑模式
  compact: {
    type: Boolean,
    default: false,
  },
  // 状态类型（用于StatusBadge）
  statusType: {
    type: String,
    default: 'transaction',
  },
  // 排序方式
  sortOrder: {
    type: String,
    default: 'desc', // 'asc' | 'desc'
  },
  // 加载状态
  loading: {
    type: Boolean,
    default: false,
  },
  // 空状态文本
  emptyText: {
    type: String,
    default: '暂无记录',
  },
  // 简单图片
  simpleImage: {
    type: Boolean,
    default: true,
  },
});

// Emits
const emit = defineEmits(['item-click', 'action-click']);

// 排序后的数据
const sortedItems = computed(() => {
  const items = [...props.items];
  return items.sort((a, b) => {
    const timeA = new Date(a.created_at || a.timestamp).getTime();
    const timeB = new Date(b.created_at || b.timestamp).getTime();
    return props.sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
  });
});

// 工具函数

// 获取时间线颜色
const getTimelineColor = (item) => {
  if (item.color) return item.color;

  // 根据状态判断
  if (item.status) {
    const statusColors = {
      completed: '#52c41a',
      success: '#52c41a',
      released: '#52c41a',
      pending: '#1890ff',
      processing: '#1890ff',
      locked: '#faad14',
      escrowed: '#faad14',
      failed: '#f5222d',
      error: '#f5222d',
      cancelled: '#d9d9d9',
      disputed: '#ff4d4f',
    };
    return statusColors[item.status] || '#1890ff';
  }

  // 根据类型判断
  const typeColors = {
    create: '#1890ff',
    transfer: '#52c41a',
    payment: '#faad14',
    refund: '#ff7a45',
    dispute: '#f5222d',
  };
  return typeColors[item.type] || '#1890ff';
};

// 获取时间线图标
const getTimelineIcon = (item) => {
  if (item.icon) return item.icon;

  // 根据状态判断
  if (item.status) {
    const statusIcons = {
      completed: CheckCircleOutlined,
      success: CheckCircleOutlined,
      released: UnlockOutlined,
      pending: SyncOutlined,
      processing: SyncOutlined,
      locked: LockOutlined,
      escrowed: LockOutlined,
      failed: CloseCircleOutlined,
      error: CloseCircleOutlined,
      cancelled: CloseCircleOutlined,
      disputed: ExclamationCircleOutlined,
    };
    if (statusIcons[item.status]) return statusIcons[item.status];
  }

  // 根据类型判断
  const typeIcons = {
    create: CheckCircleOutlined,
    transfer: SwapOutlined,
    payment: DollarOutlined,
    refund: SwapOutlined,
    dispute: ExclamationCircleOutlined,
  };
  return typeIcons[item.type] || CheckCircleOutlined;
};

// 获取项目类型颜色
const getItemTypeColor = (type) => {
  const colors = {
    create: 'blue',
    transfer: 'green',
    payment: 'orange',
    refund: 'red',
    dispute: 'volcano',
    escrow: 'gold',
    release: 'cyan',
  };
  return colors[type] || 'default';
};

// 获取项目类型名称
const getItemTypeName = (type) => {
  const names = {
    create: '创建',
    transfer: '转账',
    payment: '支付',
    refund: '退款',
    dispute: '争议',
    escrow: '托管',
    release: '释放',
  };
  return names[type] || type;
};

// 获取默认标题
const getDefaultTitle = (item) => {
  const titles = {
    create: '创建记录',
    transfer: '转账记录',
    payment: '支付记录',
    refund: '退款记录',
    dispute: '争议记录',
    escrow: '托管记录',
    release: '释放记录',
  };
  return titles[item.type] || '交易记录';
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) return '0';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

// 格式化 DID
const formatDid = (did) => {
  if (!did) return '-';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 24小时内显示相对时间
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}小时前`;
    } else if (minutes > 0) {
      return `${minutes}分钟前`;
    } else {
      return '刚刚';
    }
  }

  // 超过24小时显示日期
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

// 格式化完整时间
const formatFullTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// 可见的元数据
const visibleMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return {};

  // 过滤掉空值和内部字段
  const filtered = {};
  Object.keys(metadata).forEach((key) => {
    if (
      metadata[key] !== null &&
      metadata[key] !== undefined &&
      metadata[key] !== '' &&
      !key.startsWith('_')
    ) {
      filtered[key] = metadata[key];
    }
  });

  return filtered;
};

// 事件处理
const handleItemClick = (item) => {
  if (props.hoverable) {
    emit('item-click', item);
  }
};

const handleActionClick = (event, item) => {
  const { key } = event;

  if (key === 'view') {
    emit('action-click', { action: 'view', item });
  } else if (key === 'copy') {
    if (item.id) {
      navigator.clipboard.writeText(item.id);
      message.success('已复制ID');
    }
  }

  emit('action-click', { action: key, item });
};
</script>

<style scoped>
.transaction-timeline {
  padding: 16px 0;
}

.timeline-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.timeline-card {
  margin-bottom: 8px;
  border-radius: 8px;
  transition: all 0.3s;
}

.timeline-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.item-title {
  font-weight: 500;
  color: #262626;
}

.timeline-content {
  padding: 8px 0;
}

.amount-value {
  font-size: 16px;
  font-weight: 600;
  color: #52c41a;
}

.amount-symbol {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 4px;
  font-weight: 400;
}

.item-description {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
  color: #595959;
  font-size: 13px;
  line-height: 1.6;
}

.item-metadata {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

:deep(.ant-timeline-item-head) {
  background: transparent !important;
}

:deep(.ant-timeline-item-tail) {
  border-left-width: 2px;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
  color: #8c8c8c;
}

:deep(.ant-descriptions-item-content) {
  color: #262626;
}
</style>
