<template>
  <div class="transaction-list">
    <!-- 过滤器 -->
    <div
      v-if="showFilters"
      class="list-header"
    >
      <a-space :size="12">
        <a-select
          v-model:value="filters.status"
          placeholder="交易状态"
          :style="{ width: '120px' }"
          allow-clear
          @change="handleFilterChange"
        >
          <a-select-option value="">
            全部状态
          </a-select-option>
          <a-select-option value="pending">
            待确认
          </a-select-option>
          <a-select-option value="confirmed">
            已确认
          </a-select-option>
          <a-select-option value="failed">
            失败
          </a-select-option>
        </a-select>

        <a-select
          v-model:value="filters.tx_type"
          placeholder="交易类型"
          :style="{ width: '140px' }"
          allow-clear
          @change="handleFilterChange"
        >
          <a-select-option value="">
            全部类型
          </a-select-option>
          <a-select-option value="transfer">
            转账
          </a-select-option>
          <a-select-option value="mint">
            铸造
          </a-select-option>
          <a-select-option value="contract_call">
            合约调用
          </a-select-option>
        </a-select>

        <a-button
          :loading="loading"
          @click="handleRefresh"
        >
          <template #icon>
            <reload-outlined />
          </template>
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- 交易列表 -->
    <a-list
      :data-source="displayedTransactions"
      :loading="loading"
      :pagination="pagination"
      :locale="{ emptyText: '暂无交易记录' }"
    >
      <template #renderItem="{ item }">
        <a-list-item class="transaction-item">
          <a-list-item-meta>
            <!-- 交易类型图标 -->
            <template #avatar>
              <a-avatar :style="{ backgroundColor: getTxTypeColor(item.tx_type) }">
                <component :is="getTxTypeIcon(item.tx_type)" />
              </a-avatar>
            </template>

            <!-- 交易信息 -->
            <template #title>
              <div class="tx-title">
                <span class="tx-type">{{ getTxTypeText(item.tx_type) }}</span>
                <a-tag
                  :color="getStatusColor(item.status)"
                  size="small"
                >
                  {{ getStatusText(item.status) }}
                </a-tag>
                <span class="tx-time">{{ formatTime(item.created_at) }}</span>
              </div>
            </template>

            <template #description>
              <div class="tx-description">
                <!-- 交易哈希 -->
                <div class="tx-hash">
                  <span class="label">哈希:</span>
                  <span class="value">
                    {{ formatHash(item.tx_hash) }}
                    <copy-outlined
                      class="copy-icon"
                      @click="handleCopyHash(item.tx_hash)"
                    />
                    <link-outlined
                      v-if="currentNetwork?.blockExplorer"
                      class="link-icon"
                      @click="handleViewInExplorer(item.tx_hash)"
                    />
                  </span>
                </div>

                <!-- 发送方和接收方 -->
                <div class="tx-addresses">
                  <span class="label">从:</span>
                  <span class="value">{{ formatAddress(item.from_address) }}</span>
                  <arrow-right-outlined class="arrow-icon" />
                  <span class="label">到:</span>
                  <span class="value">{{ formatAddress(item.to_address) }}</span>
                </div>

                <!-- 金额和 Gas -->
                <div class="tx-details">
                  <span
                    v-if="item.value"
                    class="detail-item"
                  >
                    <span class="label">金额:</span>
                    <span class="value amount">{{ formatValue(item.value) }}</span>
                  </span>
                  <span
                    v-if="item.gas_used"
                    class="detail-item"
                  >
                    <span class="label">Gas:</span>
                    <span class="value">{{ item.gas_used }}</span>
                  </span>
                  <span
                    v-if="item.block_number"
                    class="detail-item"
                  >
                    <span class="label">区块:</span>
                    <span class="value">{{ item.block_number }}</span>
                  </span>
                </div>
              </div>
            </template>
          </a-list-item-meta>

          <!-- 操作按钮 -->
          <template #actions>
            <a-button
              type="link"
              size="small"
              @click="handleViewDetails(item)"
            >
              详情
            </a-button>
          </template>
        </a-list-item>
      </template>
    </a-list>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  ReloadOutlined,
  CopyOutlined,
  LinkOutlined,
  ArrowRightOutlined,
  SwapOutlined,
  PlusCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';
import { useBlockchainStore } from '@/stores/blockchain';

const props = defineProps({
  // 地址过滤（只显示该地址相关的交易）
  address: {
    type: String,
    default: null,
  },
  // 链 ID 过滤
  chainId: {
    type: Number,
    default: null,
  },
  // 是否显示过滤器
  showFilters: {
    type: Boolean,
    default: true,
  },
  // 每页显示数量
  pageSize: {
    type: Number,
    default: 10,
  },
  // 是否自动加载
  autoLoad: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['view-details']);

const blockchainStore = useBlockchainStore();

// 状态
const loading = ref(false);
const currentPage = ref(1);
const filters = ref({
  status: '',
  tx_type: '',
});

// 从 store 获取数据
const transactions = computed(() => blockchainStore.transactions);
const currentNetwork = computed(() => blockchainStore.currentNetwork);

// 过滤后的交易列表
const filteredTransactions = computed(() => {
  let result = [...transactions.value];

  // 按地址过滤
  if (props.address) {
    result = result.filter(
      tx => tx.from_address === props.address || tx.to_address === props.address
    );
  }

  // 按链 ID 过滤
  if (props.chainId !== null) {
    result = result.filter(tx => tx.chain_id === props.chainId);
  }

  // 按状态过滤
  if (filters.value.status) {
    result = result.filter(tx => tx.status === filters.value.status);
  }

  // 按类型过滤
  if (filters.value.tx_type) {
    result = result.filter(tx => tx.tx_type === filters.value.tx_type);
  }

  return result;
});

// 显示的交易列表（分页后）
const displayedTransactions = computed(() => {
  const start = (currentPage.value - 1) * props.pageSize;
  const end = start + props.pageSize;
  return filteredTransactions.value.slice(start, end);
});

// 分页配置
const pagination = computed(() => ({
  current: currentPage.value,
  pageSize: props.pageSize,
  total: filteredTransactions.value.length,
  onChange: (page) => {
    currentPage.value = page;
  },
  showSizeChanger: false,
  showTotal: (total) => `共 ${total} 条交易`,
}));

/**
 * 获取交易类型文本
 */
const getTxTypeText = (type) => {
  const typeMap = {
    transfer: '转账',
    mint: '铸造',
    contract_call: '合约调用',
  };
  return typeMap[type] || '未知';
};

/**
 * 获取交易类型图标
 */
const getTxTypeIcon = (type) => {
  const iconMap = {
    transfer: SwapOutlined,
    mint: PlusCircleOutlined,
    contract_call: FileTextOutlined,
  };
  return iconMap[type] || FileTextOutlined;
};

/**
 * 获取交易类型颜色
 */
const getTxTypeColor = (type) => {
  const colorMap = {
    transfer: '#1890ff',
    mint: '#52c41a',
    contract_call: '#fa8c16',
  };
  return colorMap[type] || '#8c8c8c';
};

/**
 * 获取状态文本
 */
const getStatusText = (status) => {
  const statusMap = {
    pending: '待确认',
    confirmed: '已确认',
    failed: '失败',
  };
  return statusMap[status] || '未知';
};

/**
 * 获取状态颜色
 */
const getStatusColor = (status) => {
  const colorMap = {
    pending: 'processing',
    confirmed: 'success',
    failed: 'error',
  };
  return colorMap[status] || 'default';
};

/**
 * 格式化哈希
 */
const formatHash = (hash) => {
  if (!hash) {return '';}
  if (hash.length <= 20) {return hash;}
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
};

/**
 * 格式化地址
 */
const formatAddress = (address) => {
  if (!address) {return '';}
  if (address.length <= 20) {return address;}
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * 格式化金额
 */
const formatValue = (value) => {
  if (!value || value === '0') {return '0 ETH';}

  // 简化版本：将 wei 转换为 ether
  const etherValue = (parseFloat(value) / 1e18).toFixed(6);
  const symbol = currentNetwork.value?.symbol || 'ETH';

  return `${etherValue} ${symbol}`;
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) {return '';}

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚';
  }

  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前`;
  }

  // 小于24小时
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前`;
  }

  // 超过24小时，显示具体日期
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * 复制哈希
 */
const handleCopyHash = async (hash) => {
  try {
    await navigator.clipboard.writeText(hash);
    message.success('交易哈希已复制');
  } catch (error) {
    logger.error('[TransactionList] 复制失败:', error);
    message.error('复制失败');
  }
};

/**
 * 在区块浏览器中查看
 */
const handleViewInExplorer = (hash) => {
  if (!currentNetwork.value?.blockExplorer) {
    message.warning('当前网络没有区块浏览器');
    return;
  }

  const url = `${currentNetwork.value.blockExplorer}/tx/${hash}`;

  // 使用 Electron 的 shell.openExternal 打开外部链接
  if (window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
};

/**
 * 查看详情
 */
const handleViewDetails = (transaction) => {
  emit('view-details', transaction);
};

/**
 * 刷新交易列表
 */
const handleRefresh = async () => {
  loading.value = true;
  try {
    await blockchainStore.loadTransactions({
      address: props.address,
      chainId: props.chainId,
    });
    message.success('刷新成功');
  } catch (error) {
    logger.error('[TransactionList] 刷新失败:', error);
    message.error('刷新失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

/**
 * 过滤器变化处理
 */
const handleFilterChange = () => {
  currentPage.value = 1; // 重置到第一页
};

// 生命周期
onMounted(() => {
  if (props.autoLoad && transactions.value.length === 0) {
    handleRefresh();
  }
});

// 监听 address 和 chainId 变化
watch(
  [() => props.address, () => props.chainId],
  () => {
    if (props.autoLoad) {
      handleRefresh();
    }
  }
);
</script>

<style scoped>
.transaction-list {
  width: 100%;
}

.list-header {
  padding: 12px 16px;
  background-color: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}

.transaction-item {
  padding: 16px;
  transition: background-color 0.3s;
}

.transaction-item:hover {
  background-color: #fafafa;
}

.tx-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tx-type {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
}

.tx-time {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: auto;
}

.tx-description {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-hash,
.tx-addresses,
.tx-details {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.label {
  color: #8c8c8c;
  font-weight: 500;
  min-width: 40px;
}

.value {
  color: #595959;
  font-family: 'Courier New', monospace;
}

.value.amount {
  color: #52c41a;
  font-weight: 500;
}

.copy-icon,
.link-icon {
  color: #1890ff;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 13px;
}

.copy-icon:hover,
.link-icon:hover {
  color: #40a9ff;
  transform: scale(1.1);
}

.arrow-icon {
  color: #d9d9d9;
  font-size: 12px;
}

.detail-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-right: 12px;
  border-right: 1px solid #f0f0f0;
}

.detail-item:last-child {
  border-right: none;
}

:deep(.ant-list-item-meta-avatar) {
  margin-right: 16px;
}

:deep(.ant-list-item-action) {
  margin-left: 16px;
}

:deep(.ant-list-pagination) {
  margin-top: 16px;
  text-align: center;
}
</style>
