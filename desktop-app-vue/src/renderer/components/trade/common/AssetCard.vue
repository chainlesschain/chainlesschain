<template>
  <a-card
    class="asset-card"
    hoverable
    :bordered="true"
  >
    <template #cover>
      <div
        class="asset-cover"
        :style="{ background: getCoverGradient(asset.asset_type) }"
      >
        <div class="asset-icon">
          <component
            :is="getAssetIcon(asset.asset_type)"
            style="font-size: 48px; color: white"
          />
        </div>
      </div>
    </template>

    <a-card-meta>
      <template #title>
        <div class="asset-title">
          <span class="asset-name">{{ asset.name }}</span>
          <a-tag
            :color="getTypeColor(asset.asset_type)"
            class="asset-type-tag"
          >
            {{ getTypeLabel(asset.asset_type) }}
          </a-tag>
        </div>
      </template>

      <template #description>
        <div class="asset-description">
          <!-- 符号 -->
          <div
            v-if="asset.symbol"
            class="info-row"
          >
            <span class="label">符号:</span>
            <span class="value">{{ asset.symbol }}</span>
          </div>

          <!-- 余额 -->
          <div class="info-row balance-row">
            <span class="label">余额:</span>
            <span class="value balance">
              {{ formatAmount(balance) }}
              <span class="symbol">{{ asset.symbol || asset.name }}</span>
            </span>
          </div>

          <!-- 总供应量 -->
          <div
            v-if="showTotalSupply"
            class="info-row"
          >
            <span class="label">总量:</span>
            <span class="value">{{ formatAmount(asset.total_supply) }}</span>
          </div>

          <!-- 创建时间 -->
          <div class="info-row">
            <span class="label">创建:</span>
            <span class="value">{{ formatTime(asset.created_at) }}</span>
          </div>
        </div>
      </template>
    </a-card-meta>

    <!-- 操作按钮 -->
    <template #actions>
      <a-tooltip title="查看详情">
        <eye-outlined @click="handleView" />
      </a-tooltip>
      <a-tooltip title="转账">
        <swap-outlined @click="handleTransfer" />
      </a-tooltip>
      <a-tooltip title="更多操作">
        <a-dropdown :trigger="['click']">
          <ellipsis-outlined />
          <template #overlay>
            <a-menu>
              <a-menu-item
                v-if="canMint"
                key="mint"
                @click="handleMint"
              >
                <plus-circle-outlined /> 铸造
              </a-menu-item>
              <a-menu-item
                v-if="canBurn"
                key="burn"
                @click="handleBurn"
              >
                <fire-outlined /> 销毁
              </a-menu-item>
              <a-menu-divider v-if="canMint || canBurn" />
              <a-menu-item
                key="history"
                @click="handleHistory"
              >
                <history-outlined /> 历史记录
              </a-menu-item>
              <a-menu-item
                key="qr"
                @click="handleShowQR"
              >
                <qrcode-outlined /> 二维码
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
  EyeOutlined,
  SwapOutlined,
  EllipsisOutlined,
  PlusCircleOutlined,
  FireOutlined,
  HistoryOutlined,
  QrcodeOutlined,
  WalletOutlined,
  PictureOutlined,
  ReadOutlined,
  FileProtectOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  asset: {
    type: Object,
    required: true,
  },
  balance: {
    type: [Number, String],
    default: 0,
  },
  showTotalSupply: {
    type: Boolean,
    default: true,
  },
  currentUserDid: {
    type: String,
    default: '',
  },
});

const emit = defineEmits([
  'view',
  'transfer',
  'mint',
  'burn',
  'history',
  'show-qr',
]);

// 是否可以铸造（仅创建者）
const canMint = computed(() => {
  return props.currentUserDid && props.asset.creator_did === props.currentUserDid;
});

// 是否可以销毁（有余额）
const canBurn = computed(() => {
  return props.balance > 0;
});

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

// 资产类型标签
const getTypeLabel = (type) => {
  const labelMap = {
    token: 'Token',
    nft: 'NFT',
    knowledge: '知识产品',
    service: '服务凭证',
  };
  return labelMap[type] || type;
};

// 资产类型颜色
const getTypeColor = (type) => {
  const colorMap = {
    token: 'blue',
    nft: 'purple',
    knowledge: 'green',
    service: 'orange',
  };
  return colorMap[type] || 'default';
};

// 封面渐变色
const getCoverGradient = (type) => {
  const gradientMap = {
    token: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    nft: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    knowledge: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    service: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  };
  return gradientMap[type] || gradientMap.token;
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) {return '0';}
  const num = parseFloat(amount);
  if (isNaN(num)) {return '0';}

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

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '-';}
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
const handleView = () => emit('view', props.asset);
const handleTransfer = () => emit('transfer', props.asset);
const handleMint = () => emit('mint', props.asset);
const handleBurn = () => emit('burn', props.asset);
const handleHistory = () => emit('history', props.asset);
const handleShowQR = () => emit('show-qr', props.asset);
</script>

<style scoped>
.asset-card {
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.asset-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
}

.asset-cover {
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.asset-icon {
  position: relative;
  z-index: 1;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.asset-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.asset-name {
  flex: 1;
  font-weight: 600;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-type-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 0 6px;
  line-height: 18px;
  border-radius: 10px;
}

.asset-description {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.info-row .label {
  color: #8c8c8c;
  font-weight: 500;
}

.info-row .value {
  color: #262626;
  font-weight: 500;
}

.balance-row {
  padding: 8px 0;
  border-top: 1px dashed #f0f0f0;
  border-bottom: 1px dashed #f0f0f0;
}

.balance {
  color: #52c41a !important;
  font-size: 16px !important;
  font-weight: 600 !important;
}

.balance .symbol {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 4px;
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
