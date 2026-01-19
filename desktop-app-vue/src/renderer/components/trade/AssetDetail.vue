<template>
  <a-drawer
    :open="open"
    :title="asset ? asset.name : '资产详情'"
    width="600px"
    placement="right"
    @close="handleClose"
  >
    <div
      v-if="asset"
      class="asset-detail"
    >
      <!-- 资产封面 -->
      <div
        class="asset-cover"
        :style="{ background: getCoverGradient(asset.asset_type) }"
      >
        <div class="asset-icon-large">
          <component
            :is="getAssetIcon(asset.asset_type)"
            style="font-size: 64px; color: white"
          />
        </div>
      </div>

      <!-- 资产类型标签 -->
      <div class="asset-type-section">
        <a-tag
          :color="getTypeColor(asset.asset_type)"
          style="font-size: 14px; padding: 4px 12px"
        >
          {{ getTypeLabel(asset.asset_type) }}
        </a-tag>
      </div>

      <!-- 基本信息 -->
      <a-descriptions
        title="基本信息"
        bordered
        :column="1"
        size="small"
        style="margin-top: 24px"
      >
        <a-descriptions-item label="资产 ID">
          <a-typography-text
            copyable
            :ellipsis="{ tooltip: asset.id || asset.asset_id }"
          >
            {{ formatId(asset.id || asset.asset_id) }}
          </a-typography-text>
        </a-descriptions-item>

        <a-descriptions-item label="资产名称">
          <strong>{{ asset.name }}</strong>
        </a-descriptions-item>

        <a-descriptions-item
          v-if="asset.symbol"
          label="资产符号"
        >
          <a-tag color="blue">
            {{ asset.symbol }}
          </a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="资产类型">
          {{ getTypeLabel(asset.asset_type) }}
        </a-descriptions-item>

        <a-descriptions-item
          v-if="asset.description"
          label="描述"
        >
          <div class="description-text">
            {{ asset.description }}
          </div>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 持有信息 -->
      <a-descriptions
        title="持有信息"
        bordered
        :column="1"
        size="small"
        style="margin-top: 24px"
      >
        <a-descriptions-item label="我的余额">
          <div class="balance-highlight">
            {{ formatAmount(balance) }}
            <span class="symbol">{{ asset.symbol || asset.name }}</span>
          </div>
        </a-descriptions-item>

        <a-descriptions-item
          v-if="asset.total_supply"
          label="总供应量"
        >
          {{ formatAmount(asset.total_supply) }}
        </a-descriptions-item>

        <a-descriptions-item
          v-if="asset.decimals !== undefined"
          label="小数位数"
        >
          {{ asset.decimals }}
        </a-descriptions-item>

        <a-descriptions-item label="持有时间">
          {{ formatTime(asset.acquired_at || asset.created_at) }}
        </a-descriptions-item>
      </a-descriptions>

      <!-- 创建者信息 -->
      <a-descriptions
        v-if="asset.creator_did"
        title="创建者信息"
        bordered
        :column="1"
        size="small"
        style="margin-top: 24px"
      >
        <a-descriptions-item label="创建者 DID">
          <a-typography-text
            copyable
            :ellipsis="{ tooltip: asset.creator_did }"
          >
            {{ formatDid(asset.creator_did) }}
          </a-typography-text>
          <a-tag
            v-if="isCurrentUser(asset.creator_did)"
            color="green"
            style="margin-left: 8px"
          >
            我创建的
          </a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="创建时间">
          {{ formatTime(asset.created_at) }}
        </a-descriptions-item>
      </a-descriptions>

      <!-- 元数据（如果有） -->
      <a-descriptions
        v-if="hasMetadata"
        title="元数据"
        bordered
        :column="1"
        size="small"
        style="margin-top: 24px"
      >
        <a-descriptions-item
          v-if="asset.metadata?.imageUrl"
          label="资产图片"
        >
          <a-image
            :src="asset.metadata.imageUrl"
            :width="200"
          />
        </a-descriptions-item>

        <a-descriptions-item
          v-if="asset.metadata?.externalUrl"
          label="外部链接"
        >
          <a
            :href="asset.metadata.externalUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ asset.metadata.externalUrl }}
            <link-outlined style="margin-left: 4px" />
          </a>
        </a-descriptions-item>

        <!-- NFT 属性 -->
        <a-descriptions-item
          v-if="nftAttributes.length > 0"
          label="NFT 属性"
        >
          <a-space
            direction="vertical"
            style="width: 100%"
          >
            <a-tag
              v-for="(attr, index) in nftAttributes"
              :key="index"
              color="purple"
            >
              {{ attr.trait_type }}: {{ attr.value }}
            </a-tag>
          </a-space>
        </a-descriptions-item>

        <!-- 自定义数据 -->
        <a-descriptions-item
          v-if="asset.metadata?.custom"
          label="自定义数据"
        >
          <pre class="custom-data">{{ JSON.stringify(asset.metadata.custom, null, 2) }}</pre>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <a-space
          direction="vertical"
          style="width: 100%"
        >
          <a-button
            type="primary"
            block
            @click="handleTransfer"
          >
            <swap-outlined /> 转账
          </a-button>

          <a-button
            v-if="canMint"
            block
            @click="handleMint"
          >
            <plus-circle-outlined /> 铸造更多
          </a-button>

          <a-button
            block
            @click="handleViewHistory"
          >
            <history-outlined /> 查看历史记录
          </a-button>

          <a-button
            block
            @click="handleShowQR"
          >
            <qrcode-outlined /> 显示二维码
          </a-button>

          <a-button
            v-if="balance > 0"
            danger
            block
            @click="handleBurn"
          >
            <fire-outlined /> 销毁资产
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 空状态 -->
    <a-empty
      v-else
      description="资产信息不存在"
    />
  </a-drawer>
</template>

<script setup>
import { computed } from 'vue';
import { Modal } from 'ant-design-vue';
import {
  WalletOutlined,
  PictureOutlined,
  ReadOutlined,
  FileProtectOutlined,
  SwapOutlined,
  PlusCircleOutlined,
  HistoryOutlined,
  QrcodeOutlined,
  FireOutlined,
  LinkOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  asset: {
    type: Object,
    default: null,
  },
  balance: {
    type: [Number, String],
    default: 0,
  },
  currentUserDid: {
    type: String,
    default: '',
  },
});

// Emits
const emit = defineEmits(['close', 'transfer', 'mint', 'burn', 'view-history', 'show-qr']);

// 计算属性

// 是否有元数据
const hasMetadata = computed(() => {
  if (!props.asset || !props.asset.metadata) {return false;}
  const meta = props.asset.metadata;
  return meta.imageUrl || meta.externalUrl || (meta.attributes && meta.attributes.length > 0) || meta.custom;
});

// NFT 属性
const nftAttributes = computed(() => {
  if (!props.asset || !props.asset.metadata || !props.asset.metadata.attributes) {return [];}
  return props.asset.metadata.attributes.filter(attr => attr.trait_type && attr.value);
});

// 是否可以铸造（仅创建者）
const canMint = computed(() => {
  if (!props.asset || !props.currentUserDid) {return false;}
  return props.asset.creator_did === props.currentUserDid && props.asset.asset_type === 'token';
});

// 工具函数

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

// 格式化 ID
const formatId = (id) => {
  if (!id) {return '-';}
  return id.length > 20 ? `${id.slice(0, 10)}...${id.slice(-8)}` : id;
};

// 格式化 DID
const formatDid = (did) => {
  if (!did) {return '-';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
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

  // 超过24小时显示完整日期
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 判断是否为当前用户
const isCurrentUser = (did) => {
  return props.currentUserDid && did === props.currentUserDid;
};

// 事件处理

const handleClose = () => {
  emit('close');
};

const handleTransfer = () => {
  emit('transfer', props.asset);
  emit('close');
};

const handleMint = () => {
  Modal.confirm({
    title: '铸造资产',
    content: '确定要铸造更多资产吗？这将增加总供应量。',
    okText: '确定',
    cancelText: '取消',
    onOk() {
      emit('mint', props.asset);
    },
  });
};

const handleBurn = () => {
  Modal.confirm({
    title: '销毁资产',
    content: `确定要销毁 ${props.asset.name} 吗？销毁后无法恢复！`,
    okText: '确定销毁',
    okType: 'danger',
    cancelText: '取消',
    onOk() {
      emit('burn', props.asset);
    },
  });
};

const handleViewHistory = () => {
  emit('view-history', props.asset);
};

const handleShowQR = () => {
  emit('show-qr', props.asset);
};
</script>

<style scoped>
.asset-detail {
  padding-bottom: 24px;
}

.asset-cover {
  width: 100%;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
}

.asset-icon-large {
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

.asset-type-section {
  text-align: center;
  margin-bottom: 16px;
}

.description-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #595959;
  line-height: 1.6;
}

.balance-highlight {
  font-size: 20px;
  font-weight: 600;
  color: #52c41a;
}

.balance-highlight .symbol {
  font-size: 14px;
  color: #8c8c8c;
  margin-left: 8px;
  font-weight: 400;
}

.custom-data {
  background: #f5f5f5;
  border-radius: 4px;
  padding: 12px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  overflow-x: auto;
  margin: 0;
}

.action-buttons {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}

:deep(.ant-descriptions-title) {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 12px;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
  color: #595959;
}

:deep(.ant-descriptions-item-content) {
  color: #262626;
}
</style>
