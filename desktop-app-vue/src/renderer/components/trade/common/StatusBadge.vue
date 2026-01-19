<template>
  <a-badge
    :status="getBadgeStatus(status)"
    :text="getText()"
    :color="getColor(status)"
    :class="['status-badge', `status-${status}`]"
  >
    <template
      v-if="showIcon"
      #icon
    >
      <component
        :is="getIcon(status)"
        :spin="isProcessing(status)"
      />
    </template>
  </a-badge>
</template>

<script setup>
import { computed } from 'vue';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  LockOutlined,
  UnlockOutlined,
  FireOutlined,
  StopOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  // 状态值
  status: {
    type: String,
    required: true,
  },
  // 状态类型（用于区分不同模块的状态）
  type: {
    type: String,
    default: 'default', // 'order', 'contract', 'escrow', 'transaction'
  },
  // 自定义文本
  text: {
    type: String,
    default: '',
  },
  // 是否显示图标
  showIcon: {
    type: Boolean,
    default: false,
  },
});

/**
 * 获取状态文本
 */
const getText = () => {
  if (props.text) {return props.text;}

  // 根据type和status返回默认文本
  const textMap = {
    // 订单状态
    order: {
      open: '开放中',
      matched: '已匹配',
      closed: '已关闭',
      cancelled: '已取消',
      completed: '已完成',
    },
    // 合约状态
    contract: {
      draft: '草稿',
      active: '生效中',
      completed: '已完成',
      cancelled: '已取消',
      disputed: '争议中',
      arbitrating: '仲裁中',
    },
    // 托管状态
    escrow: {
      created: '已创建',
      locked: '已锁定',
      released: '已释放',
      refunded: '已退款',
      disputed: '有争议',
      cancelled: '已取消',
    },
    // 交易状态
    transaction: {
      pending: '待处理',
      escrowed: '托管中',
      completed: '已完成',
      cancelled: '已取消',
      refunded: '已退款',
      disputed: '有争议',
    },
    // 资产转账状态
    transfer: {
      pending: '待确认',
      confirmed: '已确认',
      failed: '失败',
    },
    // 默认通用状态
    default: {
      success: '成功',
      error: '错误',
      warning: '警告',
      processing: '处理中',
      pending: '待处理',
      active: '活跃',
      inactive: '未激活',
      completed: '已完成',
      cancelled: '已取消',
      failed: '失败',
    },
  };

  return textMap[props.type]?.[props.status] || props.status;
};

/**
 * 获取Ant Design Badge状态
 */
const getBadgeStatus = (status) => {
  // 成功类
  if (['completed', 'success', 'released', 'confirmed'].includes(status)) {
    return 'success';
  }
  // 错误类
  if (['error', 'failed', 'cancelled', 'closed'].includes(status)) {
    return 'error';
  }
  // 警告类
  if (['warning', 'disputed', 'arbitrating', 'refunded'].includes(status)) {
    return 'warning';
  }
  // 处理中类
  if (['processing', 'pending', 'matched', 'escrowed', 'locked'].includes(status)) {
    return 'processing';
  }
  // 默认类
  if (['default', 'draft', 'created', 'open', 'active'].includes(status)) {
    return 'default';
  }

  return 'default';
};

/**
 * 获取颜色
 */
const getColor = (status) => {
  const colorMap = {
    // 成功 - 绿色
    completed: '#52c41a',
    success: '#52c41a',
    released: '#52c41a',
    confirmed: '#52c41a',

    // 进行中 - 蓝色
    open: '#1890ff',
    active: '#1890ff',
    processing: '#1890ff',
    matched: '#1890ff',

    // 等待 - 橙色
    pending: '#faad14',
    draft: '#faad14',
    created: '#faad14',
    escrowed: '#faad14',
    locked: '#faad14',

    // 警告 - 金色/红色
    disputed: '#ff7a45',
    arbitrating: '#ff7a45',
    warning: '#faad14',

    // 错误/取消 - 红色/灰色
    error: '#ff4d4f',
    failed: '#ff4d4f',
    cancelled: '#8c8c8c',
    closed: '#8c8c8c',
    refunded: '#8c8c8c',

    // 默认 - 默认色
    default: '#d9d9d9',
  };

  return colorMap[status] || colorMap.default;
};

/**
 * 获取图标
 */
const getIcon = (status) => {
  const iconMap = {
    completed: CheckCircleOutlined,
    success: CheckCircleOutlined,
    released: UnlockOutlined,
    confirmed: CheckCircleOutlined,

    open: ClockCircleOutlined,
    active: CheckCircleOutlined,
    processing: SyncOutlined,
    matched: CheckCircleOutlined,

    pending: ClockCircleOutlined,
    draft: ClockCircleOutlined,
    created: ClockCircleOutlined,
    escrowed: LockOutlined,
    locked: LockOutlined,

    disputed: ExclamationCircleOutlined,
    arbitrating: ExclamationCircleOutlined,
    warning: ExclamationCircleOutlined,

    error: CloseCircleOutlined,
    failed: CloseCircleOutlined,
    cancelled: StopOutlined,
    closed: StopOutlined,
    refunded: CloseCircleOutlined,

    default: ClockCircleOutlined,
  };

  return iconMap[status] || iconMap.default;
};

/**
 * 是否处于处理中状态（图标旋转）
 */
const isProcessing = (status) => {
  return ['processing', 'pending', 'matched'].includes(status);
};
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
}

/* 成功状态 - 绿色底色 */
.status-badge.status-completed,
.status-badge.status-success,
.status-badge.status-released,
.status-badge.status-confirmed {
  padding: 2px 8px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 4px;
  color: #52c41a;
}

/* 进行中状态 - 蓝色底色 */
.status-badge.status-open,
.status-badge.status-active,
.status-badge.status-processing,
.status-badge.status-matched {
  padding: 2px 8px;
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  border-radius: 4px;
  color: #1890ff;
}

/* 等待状态 - 橙色底色 */
.status-badge.status-pending,
.status-badge.status-draft,
.status-badge.status-created,
.status-badge.status-escrowed,
.status-badge.status-locked {
  padding: 2px 8px;
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 4px;
  color: #faad14;
}

/* 警告状态 - 红橙底色 */
.status-badge.status-disputed,
.status-badge.status-arbitrating,
.status-badge.status-warning {
  padding: 2px 8px;
  background: #fff2e8;
  border: 1px solid #ffbb96;
  border-radius: 4px;
  color: #ff7a45;
}

/* 错误/取消状态 - 红色/灰色底色 */
.status-badge.status-error,
.status-badge.status-failed {
  padding: 2px 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
  color: #ff4d4f;
}

.status-badge.status-cancelled,
.status-badge.status-closed,
.status-badge.status-refunded {
  padding: 2px 8px;
  background: #fafafa;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  color: #8c8c8c;
}

/* 图标样式 */
:deep(.anticon) {
  font-size: 12px;
}
</style>
