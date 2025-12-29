<template>
  <a-card class="contract-card" hoverable :bordered="true">
    <!-- 合约状态角标 -->
    <div class="contract-status-badge">
      <status-badge :status="contract.status" type="contract" show-icon />
    </div>

    <!-- 卡片内容 -->
    <div class="contract-content">
      <!-- 合约类型标签 -->
      <div class="contract-type-section">
        <a-tag :color="getContractTypeColor(contract.contract_type)" style="font-size: 13px">
          {{ getContractTypeName(contract.contract_type) }}
        </a-tag>
        <a-tag v-if="isMyContract" color="blue">我的合约</a-tag>
      </div>

      <!-- 合约标题 -->
      <div class="contract-title">
        {{ contract.name || contract.title || '未命名合约' }}
      </div>

      <!-- 合约描述 -->
      <div v-if="contract.description" class="contract-description">
        {{ contract.description }}
      </div>

      <!-- 合约参与方 -->
      <div class="contract-parties">
        <div class="party-item">
          <span class="party-label">
            <user-outlined />
            甲方:
          </span>
          <a-typography-text copyable :ellipsis="{ tooltip: contract.party_a_did }">
            {{ formatDid(contract.party_a_did) }}
          </a-typography-text>
          <a-tag v-if="isCurrentUser(contract.party_a_did)" color="blue" size="small">
            我
          </a-tag>
        </div>
        <div class="party-item">
          <span class="party-label">
            <team-outlined />
            乙方:
          </span>
          <a-typography-text copyable :ellipsis="{ tooltip: contract.party_b_did }">
            {{ formatDid(contract.party_b_did) }}
          </a-typography-text>
          <a-tag v-if="isCurrentUser(contract.party_b_did)" color="green" size="small">
            我
          </a-tag>
        </div>
      </div>

      <!-- 合约金额（如果有） -->
      <div v-if="contract.amount !== undefined" class="contract-amount">
        <span class="amount-label">合约金额:</span>
        <span class="amount-value">
          {{ formatAmount(contract.amount) }}
          <span class="amount-symbol">{{ contract.asset_symbol || 'CC' }}</span>
        </span>
      </div>

      <!-- 签名状态 -->
      <div class="signature-status">
        <a-space size="small">
          <a-tooltip title="甲方签名状态">
            <a-badge
              :status="contract.party_a_signed ? 'success' : 'default'"
              :text="contract.party_a_signed ? '甲方已签' : '甲方未签'"
            />
          </a-tooltip>
          <a-tooltip title="乙方签名状态">
            <a-badge
              :status="contract.party_b_signed ? 'success' : 'default'"
              :text="contract.party_b_signed ? '乙方已签' : '乙方未签'"
            />
          </a-tooltip>
        </a-space>
      </div>

      <!-- 时间信息 -->
      <div class="time-info">
        <clock-circle-outlined style="color: #8c8c8c; margin-right: 4px" />
        <span class="time-text">{{ formatTime(contract.created_at) }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <template #actions>
      <a-tooltip title="查看详情">
        <eye-outlined @click="handleView" />
      </a-tooltip>

      <a-tooltip v-if="canSign" title="签名">
        <edit-outlined @click="handleSign" />
      </a-tooltip>

      <a-tooltip v-if="canExecute" title="执行合约">
        <thunderbolt-outlined @click="handleExecute" />
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
                <close-circle-outlined /> 取消合约
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
  TeamOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  EditOutlined,
  ThunderboltOutlined,
  EllipsisOutlined,
  ShareAltOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import StatusBadge from './StatusBadge.vue';

// Props
const props = defineProps({
  contract: {
    type: Object,
    required: true,
  },
  currentUserDid: {
    type: String,
    default: '',
  },
});

// Emits
const emit = defineEmits(['view', 'sign', 'execute', 'edit', 'share', 'cancel']);

// 计算属性

// 是否为我的合约
const isMyContract = computed(() => {
  return (
    props.currentUserDid &&
    (props.contract.party_a_did === props.currentUserDid ||
      props.contract.party_b_did === props.currentUserDid)
  );
});

// 是否可以签名
const canSign = computed(() => {
  if (!isMyContract.value) return false;
  if (props.contract.status !== 'draft' && props.contract.status !== 'active') return false;

  // 当前用户是甲方且未签名
  if (
    props.contract.party_a_did === props.currentUserDid &&
    !props.contract.party_a_signed
  ) {
    return true;
  }

  // 当前用户是乙方且未签名
  if (
    props.contract.party_b_did === props.currentUserDid &&
    !props.contract.party_b_signed
  ) {
    return true;
  }

  return false;
});

// 是否可以执行
const canExecute = computed(() => {
  return (
    isMyContract.value &&
    props.contract.status === 'active' &&
    props.contract.party_a_signed &&
    props.contract.party_b_signed
  );
});

// 是否可以编辑
const canEdit = computed(() => {
  return (
    isMyContract.value &&
    props.contract.status === 'draft' &&
    props.contract.party_a_did === props.currentUserDid
  );
});

// 是否可以取消
const canCancel = computed(() => {
  return (
    isMyContract.value &&
    (props.contract.status === 'draft' || props.contract.status === 'active') &&
    props.contract.party_a_did === props.currentUserDid
  );
});

// 工具函数

// 判断是否为当前用户
const isCurrentUser = (did) => {
  return props.currentUserDid && did === props.currentUserDid;
};

// 合约类型颜色
const getContractTypeColor = (type) => {
  const colorMap = {
    trade: 'green',
    service: 'blue',
    escrow: 'orange',
    subscription: 'purple',
    exchange: 'cyan',
  };
  return colorMap[type] || 'default';
};

// 合约类型名称
const getContractTypeName = (type) => {
  const nameMap = {
    trade: '交易合约',
    service: '服务合约',
    escrow: '托管合约',
    subscription: '订阅合约',
    exchange: '交换合约',
  };
  return nameMap[type] || type;
};

// 格式化 DID
const formatDid = (did) => {
  if (!did) return '-';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) return '0';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
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
const handleView = () => emit('view', props.contract);
const handleSign = () => emit('sign', props.contract);
const handleExecute = () => emit('execute', props.contract);
const handleEdit = () => emit('edit', props.contract);
const handleShare = () => emit('share', props.contract);
const handleCancel = () => emit('cancel', props.contract);
</script>

<style scoped>
.contract-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.contract-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
}

.contract-status-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
}

.contract-content {
  padding: 8px 0;
}

.contract-type-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.contract-title {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contract-description {
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

.contract-parties {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.party-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 8px;
}

.party-item:last-child {
  margin-bottom: 0;
}

.party-label {
  color: #8c8c8c;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 60px;
}

.contract-amount {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  margin-bottom: 12px;
}

.amount-label {
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
}

.amount-value {
  font-size: 18px;
  font-weight: 700;
  color: white;
}

.amount-symbol {
  font-size: 12px;
  font-weight: 400;
  margin-left: 4px;
  opacity: 0.9;
}

.signature-status {
  margin-bottom: 12px;
  padding: 8px 0;
  border-top: 1px solid #f0f0f0;
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

:deep(.ant-badge-status-text) {
  font-size: 12px;
}
</style>
