<template>
  <a-drawer
    :open="open"
    title="托管详情"
    width="720px"
    @close="handleClose"
  >
    <div
      v-if="escrow"
      class="escrow-detail-content"
    >
      <!-- 状态卡片 -->
      <a-card
        size="small"
        style="margin-bottom: 16px"
      >
        <template #title>
          <a-space>
            <lock-outlined />
            <span>托管状态</span>
          </a-space>
        </template>

        <div class="status-section">
          <div class="status-badge-large">
            <status-badge
              :status="escrow.status"
              type="escrow"
              show-icon
            />
          </div>
          <div class="status-info">
            <div class="status-title">
              {{ getStatusTitle(escrow.status) }}
            </div>
            <div class="status-description">
              {{ getStatusDescription(escrow.status) }}
            </div>
          </div>
        </div>
      </a-card>

      <!-- 基本信息 -->
      <a-card
        size="small"
        title="基本信息"
        style="margin-bottom: 16px"
      >
        <a-descriptions
          :column="2"
          bordered
          size="small"
        >
          <a-descriptions-item
            label="托管 ID"
            :span="2"
          >
            <a-typography-text copyable>
              {{ escrow.id }}
            </a-typography-text>
          </a-descriptions-item>

          <a-descriptions-item
            label="交易 ID"
            :span="2"
          >
            <a-typography-text copyable>
              {{ escrow.transaction_id }}
            </a-typography-text>
          </a-descriptions-item>

          <a-descriptions-item
            v-if="escrow.order_id"
            label="订单 ID"
            :span="2"
          >
            <a-typography-text copyable>
              {{ escrow.order_id }}
            </a-typography-text>
          </a-descriptions-item>

          <a-descriptions-item
            label="创建时间"
            :span="2"
          >
            {{ formatFullTime(escrow.created_at) }}
          </a-descriptions-item>

          <a-descriptions-item
            v-if="escrow.updated_at"
            label="更新时间"
            :span="2"
          >
            {{ formatFullTime(escrow.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- 托管金额 -->
      <a-card
        size="small"
        title="托管金额"
        style="margin-bottom: 16px"
      >
        <div class="amount-display">
          <div class="amount-icon">
            <dollar-outlined style="font-size: 32px; color: white" />
          </div>
          <div class="amount-details">
            <div class="amount-label">
              托管金额
            </div>
            <div class="amount-value">
              {{ formatAmount(escrow.amount) }}
              <span class="amount-symbol">{{ escrow.asset_symbol || 'CC' }}</span>
            </div>
            <div class="amount-description">
              <a-tag
                v-if="escrow.asset_id"
                color="blue"
              >
                资产ID: {{ formatId(escrow.asset_id) }}
              </a-tag>
            </div>
          </div>
        </div>
      </a-card>

      <!-- 交易双方 -->
      <a-card
        size="small"
        title="交易双方"
        style="margin-bottom: 16px"
      >
        <a-descriptions
          :column="1"
          bordered
          size="small"
        >
          <a-descriptions-item label="买家">
            <a-space>
              <user-outlined />
              <a-typography-text
                copyable
                :ellipsis="{ tooltip: escrow.buyer_did }"
              >
                {{ formatDid(escrow.buyer_did) }}
              </a-typography-text>
              <a-tag
                v-if="isCurrentUser(escrow.buyer_did)"
                color="blue"
              >
                我
              </a-tag>
            </a-space>
          </a-descriptions-item>

          <a-descriptions-item label="卖家">
            <a-space>
              <shop-outlined />
              <a-typography-text
                copyable
                :ellipsis="{ tooltip: escrow.seller_did }"
              >
                {{ formatDid(escrow.seller_did) }}
              </a-typography-text>
              <a-tag
                v-if="isCurrentUser(escrow.seller_did)"
                color="green"
              >
                我
              </a-tag>
            </a-space>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- 托管条件 -->
      <a-card
        v-if="escrow.conditions"
        size="small"
        title="托管条件"
        style="margin-bottom: 16px"
      >
        <a-typography-paragraph>
          {{ escrow.conditions }}
        </a-typography-paragraph>
      </a-card>

      <!-- 托管历史 -->
      <a-card
        size="small"
        title="托管历史"
        style="margin-bottom: 16px"
      >
        <transaction-timeline
          :items="history"
          mode="left"
          :compact="true"
          status-type="escrow"
          :loading="historyLoading"
          empty-text="暂无历史记录"
        />
      </a-card>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <a-space>
          <a-button
            v-if="canDispute"
            danger
            @click="handleDispute"
          >
            <exclamation-circle-outlined />
            发起争议
          </a-button>
          <a-button @click="handleClose">
            关闭
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 空状态 -->
    <a-empty
      v-else
      description="托管信息不存在"
    />
  </a-drawer>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch } from 'vue';
import {
  LockOutlined,
  DollarOutlined,
  UserOutlined,
  ShopOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import StatusBadge from './common/StatusBadge.vue';
import TransactionTimeline from './common/TransactionTimeline.vue';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  escrow: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['close', 'dispute']);

// 状态
const historyLoading = ref(false);
const currentUserDid = ref('');

// 从 store 获取数据
const history = computed(() => tradeStore.escrow.escrowHistory);

// 是否可以发起争议
const canDispute = computed(() => {
  if (!props.escrow) {return false;}
  return (
    props.escrow.status === 'locked' &&
    (isCurrentUser(props.escrow.buyer_did) || isCurrentUser(props.escrow.seller_did))
  );
});

// 工具函数

// 判断是否为当前用户
const isCurrentUser = (did) => {
  return currentUserDid.value && did === currentUserDid.value;
};

// 获取状态标题
const getStatusTitle = (status) => {
  const titles = {
    locked: '资金已托管',
    released: '资金已释放',
    refunded: '资金已退款',
    disputed: '存在争议',
  };
  return titles[status] || status;
};

// 获取状态描述
const getStatusDescription = (status) => {
  const descriptions = {
    locked: '托管资金已锁定，等待交易完成',
    released: '托管资金已释放给卖家',
    refunded: '托管资金已退款给买家',
    disputed: '交易存在争议，等待仲裁',
  };
  return descriptions[status] || '';
};

// 格式化 ID
const formatId = (id) => {
  if (!id) {return '-';}
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
};

// 格式化 DID
const formatDid = (did) => {
  if (!did) {return '-';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) {return '0';}
  const num = parseFloat(amount);
  if (isNaN(num)) {return '0';}
  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

// 格式化完整时间
const formatFullTime = (timestamp) => {
  if (!timestamp) {return '-';}
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

// 事件处理

// 加载托管历史
const loadHistory = async () => {
  if (!props.escrow) {return;}

  historyLoading.value = true;
  try {
    await tradeStore.loadEscrowHistory(props.escrow.id);
    logger.info('[EscrowDetail] 托管历史已加载:', history.value.length);
  } catch (error) {
    logger.error('[EscrowDetail] 加载托管历史失败:', error);
  } finally {
    historyLoading.value = false;
  }
};

// 发起争议
const handleDispute = () => {
  emit('dispute', props.escrow);
};

// 关闭抽屉
const handleClose = () => {
  emit('close');
};

// 获取当前用户 DID
const loadCurrentUserDid = async () => {
  try {
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentUserDid.value = identity.did;
    }
  } catch (error) {
    logger.error('[EscrowDetail] 获取当前用户 DID 失败:', error);
  }
};

// 监听抽屉打开
watch(
  () => props.open,
  async (newVal) => {
    if (newVal) {
      await loadCurrentUserDid();
      await loadHistory();
    }
  }
);
</script>

<style scoped>
.escrow-detail-content {
  /* 样式 */
}

.status-section {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
}

.status-badge-large {
  transform: scale(1.5);
  margin-left: 12px;
}

.status-info {
  flex: 1;
  color: white;
}

.status-title {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 8px;
}

.status-description {
  font-size: 14px;
  opacity: 0.9;
}

.amount-display {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  border-radius: 12px;
}

.amount-icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.amount-details {
  flex: 1;
  color: white;
}

.amount-label {
  font-size: 14px;
  opacity: 0.9;
  margin-bottom: 8px;
}

.amount-value {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 8px;
}

.amount-symbol {
  font-size: 18px;
  font-weight: 400;
  margin-left: 8px;
  opacity: 0.9;
}

.amount-description {
  font-size: 12px;
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
  background: #fafafa;
}
</style>
