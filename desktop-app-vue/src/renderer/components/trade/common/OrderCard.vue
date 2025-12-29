<template>
  <a-card class="order-card" hoverable :bordered="true">
    <!-- 订单状态角标 -->
    <div class="order-status-badge">
      <status-badge :status="order.status" type="order" show-icon />
    </div>

    <!-- 卡片内容 -->
    <div class="order-content">
      <!-- 订单类型标签 -->
      <div class="order-type-section">
        <a-tag :color="getOrderTypeColor(order.order_type)" style="font-size: 13px">
          {{ getOrderTypeLabel(order.order_type) }}
        </a-tag>
        <a-tag v-if="isMyOrder" color="blue">我的订单</a-tag>
      </div>

      <!-- 资产信息 -->
      <div class="asset-info">
        <div class="asset-icon" :style="{ backgroundColor: getAssetColor(order.asset_type) }">
          <component :is="getAssetIcon(order.asset_type)" style="font-size: 24px; color: white" />
        </div>
        <div class="asset-details">
          <div class="asset-name">{{ order.asset_name }}</div>
          <a-tag v-if="order.asset_symbol" color="blue" size="small">
            {{ order.asset_symbol }}
          </a-tag>
        </div>
      </div>

      <!-- 价格和数量 -->
      <div class="order-pricing">
        <div class="price-row">
          <span class="label">单价:</span>
          <span class="price-value">
            {{ formatAmount(order.price_amount) }}
            <span class="symbol">{{ order.price_asset_symbol || 'CC' }}</span>
          </span>
        </div>
        <div class="quantity-row">
          <span class="label">数量:</span>
          <span class="quantity-value">
            {{ formatAmount(order.quantity) }}
            <span class="symbol">{{ order.asset_symbol || order.asset_name }}</span>
          </span>
        </div>
        <div class="total-row">
          <span class="label">总价:</span>
          <span class="total-value">
            {{ formatAmount(totalPrice) }}
            <span class="symbol">{{ order.price_asset_symbol || 'CC' }}</span>
          </span>
        </div>
      </div>

      <!-- 订单描述 -->
      <div v-if="order.description" class="order-description">
        {{ order.description }}
      </div>

      <!-- 卖家信息 -->
      <div class="seller-info">
        <a-space size="small">
          <user-outlined style="color: #8c8c8c" />
          <span class="label">卖家:</span>
          <a-typography-text copyable :ellipsis="{ tooltip: order.seller_did }">
            {{ formatDid(order.seller_did) }}
          </a-typography-text>
        </a-space>
      </div>

      <!-- 时间信息 -->
      <div class="time-info">
        <clock-circle-outlined style="color: #8c8c8c; margin-right: 4px" />
        <span class="time-text">{{ formatTime(order.created_at) }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <template #actions>
      <a-tooltip title="查看详情">
        <eye-outlined @click="handleView" />
      </a-tooltip>

      <a-tooltip v-if="canPurchase" title="购买">
        <shopping-cart-outlined @click="handlePurchase" />
      </a-tooltip>

      <a-tooltip v-if="canCancel" title="取消订单">
        <close-circle-outlined @click="handleCancel" />
      </a-tooltip>

      <a-tooltip title="更多操作">
        <a-dropdown :trigger="['click']">
          <ellipsis-outlined />
          <template #overlay>
            <a-menu>
              <a-menu-item v-if="canEdit" key="edit" @click="handleEdit">
                <edit-outlined /> 编辑
              </a-menu-item>
              <a-menu-item key="share" @click="handleShare">
                <share-alt-outlined /> 分享
              </a-menu-item>
              <a-menu-divider v-if="canCancel" />
              <a-menu-item v-if="canCancel" key="cancel" danger @click="handleCancel">
                <close-circle-outlined /> 取消订单
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-tooltip>
    </template>
  </a-card>
</template>

<script setup>
import { computed } from 'vue';
import {
  UserOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ShoppingCartOutlined,
  CloseCircleOutlined,
  EllipsisOutlined,
  EditOutlined,
  ShareAltOutlined,
  WalletOutlined,
  PictureOutlined,
  ReadOutlined,
  FileProtectOutlined,
} from '@ant-design/icons-vue';
import StatusBadge from './StatusBadge.vue';

// Props
const props = defineProps({
  order: {
    type: Object,
    required: true,
  },
  currentUserDid: {
    type: String,
    default: '',
  },
});

// Emits
const emit = defineEmits(['view', 'purchase', 'cancel', 'edit', 'share']);

// 计算属性

// 总价
const totalPrice = computed(() => {
  return props.order.price_amount * props.order.quantity;
});

// 是否为我的订单
const isMyOrder = computed(() => {
  return props.currentUserDid && props.order.seller_did === props.currentUserDid;
});

// 是否可以购买
const canPurchase = computed(() => {
  return !isMyOrder.value && props.order.status === 'open';
});

// 是否可以取消
const canCancel = computed(() => {
  return isMyOrder.value && props.order.status === 'open';
});

// 是否可以编辑
const canEdit = computed(() => {
  return isMyOrder.value && props.order.status === 'open';
});

// 工具函数

// 订单类型颜色
const getOrderTypeColor = (type) => {
  const colorMap = {
    sell: 'green',
    buy: 'blue',
    auction: 'purple',
    exchange: 'orange',
  };
  return colorMap[type] || 'default';
};

// 订单类型标签
const getOrderTypeLabel = (type) => {
  const labelMap = {
    sell: '出售',
    buy: '求购',
    auction: '拍卖',
    exchange: '交换',
  };
  return labelMap[type] || type;
};

// 资产类型图标
const getAssetIcon = (type) => {
  const iconMap = {
    token: WalletOutlined,
    nft: PictureOutlined,
    knowledge: ReadOutlined,
    service: FileProtectOutlined,
  };
  return iconMap[type] || WalletOutlined;
};

// 资产类型颜色
const getAssetColor = (type) => {
  const colorMap = {
    token: '#1890ff',
    nft: '#52c41a',
    knowledge: '#faad14',
    service: '#722ed1',
  };
  return colorMap[type] || '#999';
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) return '0';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';

  // 大数字使用科学计数法
  if (num >= 1e9) {
    return (num / 1e9).toFixed(2) + 'B';
  } else if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + 'M';
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(2) + 'K';
  }

  // 小数点后最多8位
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

// 事件处理
const handleView = () => emit('view', props.order);
const handlePurchase = () => emit('purchase', props.order);
const handleCancel = () => emit('cancel', props.order);
const handleEdit = () => emit('edit', props.order);
const handleShare = () => emit('share', props.order);
</script>

<style scoped>
.order-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.order-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
}

.order-status-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
}

.order-content {
  padding: 8px 0;
}

.order-type-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.asset-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.asset-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.asset-details {
  flex: 1;
  min-width: 0;
}

.asset-name {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-pricing {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.price-row,
.quantity-row,
.total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.total-row {
  margin-bottom: 0;
  padding-top: 8px;
  border-top: 1px dashed #d9d9d9;
}

.order-pricing .label {
  color: #595959;
  font-size: 13px;
}

.price-value,
.quantity-value {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
}

.total-value {
  font-size: 18px;
  font-weight: 600;
  color: #52c41a;
}

.price-value .symbol,
.quantity-value .symbol,
.total-value .symbol {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 4px;
  font-weight: 400;
}

.order-description {
  font-size: 13px;
  color: #595959;
  line-height: 1.6;
  margin-bottom: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.seller-info {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}

.seller-info .label {
  color: #8c8c8c;
}

.time-info {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: #8c8c8c;
}

:deep(.ant-card-actions) {
  background: #fafafa;
  border-top: 1px solid #f0f0f0;
}

:deep(.ant-card-actions > li) {
  margin: 8px 0;
}

:deep(.ant-card-actions > li > span) {
  font-size: 18px;
  color: #595959;
  cursor: pointer;
  transition: all 0.3s;
}

:deep(.ant-card-actions > li > span:hover) {
  color: #1890ff;
  transform: scale(1.1);
}
</style>
