<template>
  <a-modal
    :open="open"
    title="交易详情"
    width="700px"
    :footer="null"
    @cancel="handleClose"
  >
    <div class="transaction-detail-modal">
      <a-spin :spinning="loading">
        <div v-if="transaction">
          <!-- 交易状态 -->
          <a-result
            :status="getStatusIcon(transaction.status)"
            :title="getStatusTitle(transaction.status)"
          >
            <template #subTitle>
              <div class="transaction-hash">
                <a-typography-text copyable>
                  {{ transaction.tx_hash || transaction.transaction_hash }}
                </a-typography-text>
              </div>
            </template>
            <template #extra>
              <a-space>
                <a-button
                  v-if="transaction.tx_hash"
                  type="primary"
                  @click="handleViewOnExplorer"
                >
                  <template #icon><link-outlined /></template>
                  在区块链浏览器查看
                </a-button>
                <a-button @click="handleRefresh" :loading="refreshing">
                  <template #icon><reload-outlined /></template>
                  刷新状态
                </a-button>
              </a-space>
            </template>
          </a-result>

          <a-divider />

          <!-- 交易信息 -->
          <a-descriptions title="基本信息" :column="2" bordered>
            <a-descriptions-item label="交易类型">
              <a-tag :color="getTypeColor(transaction.tx_type || transaction.type)">
                {{ getTypeText(transaction.tx_type || transaction.type) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="交易状态">
              <a-tag :color="getStatusColor(transaction.status)">
                {{ getStatusText(transaction.status) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="发起时间" :span="2">
              {{ formatDateTime(transaction.created_at || transaction.timestamp) }}
            </a-descriptions-item>
            <a-descriptions-item label="确认时间" :span="2" v-if="transaction.confirmed_at">
              {{ formatDateTime(transaction.confirmed_at) }}
            </a-descriptions-item>
          </a-descriptions>

          <a-divider />

          <!-- 区块链信息 -->
          <a-descriptions title="区块链信息" :column="2" bordered v-if="transaction.chain_id">
            <a-descriptions-item label="网络">
              {{ getNetworkName(transaction.chain_id) }}
            </a-descriptions-item>
            <a-descriptions-item label="链ID">
              {{ transaction.chain_id }}
            </a-descriptions-item>
            <a-descriptions-item label="区块号" v-if="transaction.block_number">
              {{ transaction.block_number }}
            </a-descriptions-item>
            <a-descriptions-item label="Gas费用" v-if="transaction.gas_used">
              {{ formatGas(transaction.gas_used, transaction.gas_price) }}
            </a-descriptions-item>
            <a-descriptions-item label="交易哈希" :span="2" v-if="transaction.tx_hash">
              <a-typography-text copyable>
                {{ transaction.tx_hash }}
              </a-typography-text>
            </a-descriptions-item>
          </a-descriptions>

          <a-divider />

          <!-- 交易详情 -->
          <a-descriptions title="交易详情" :column="1" bordered>
            <a-descriptions-item label="发送方" v-if="transaction.from_address || transaction.from_did">
              <a-typography-text copyable>
                {{ transaction.from_address || transaction.from_did }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="接收方" v-if="transaction.to_address || transaction.to_did">
              <a-typography-text copyable>
                {{ transaction.to_address || transaction.to_did }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="金额" v-if="transaction.amount">
              {{ transaction.amount }} {{ transaction.asset_symbol || '' }}
            </a-descriptions-item>
            <a-descriptions-item label="备注" v-if="transaction.memo || transaction.description">
              {{ transaction.memo || transaction.description }}
            </a-descriptions-item>
          </a-descriptions>

          <!-- 错误信息 -->
          <a-alert
            v-if="transaction.status === 'failed' && transaction.error_message"
            type="error"
            :message="transaction.error_message"
            show-icon
            style="margin-top: 16px"
          />

          <!-- 原始数据 -->
          <a-collapse style="margin-top: 16px" v-if="transaction.raw_data">
            <a-collapse-panel key="raw" header="原始数据">
              <pre class="raw-data">{{ formatJSON(transaction.raw_data) }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </div>

        <a-empty v-else description="暂无交易数据" />
      </a-spin>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  LinkOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  transaction: {
    type: Object,
    default: null,
  },
  chainId: {
    type: Number,
    default: null,
  },
});

const emit = defineEmits(['update:open', 'refresh']);

const loading = ref(false);
const refreshing = ref(false);

/**
 * 刷新交易状态
 */
const handleRefresh = async () => {
  refreshing.value = true;
  try {
    emit('refresh', props.transaction);
    message.success('刷新成功');
  } catch (error) {
    console.error('刷新失败:', error);
    message.error('刷新失败');
  } finally {
    refreshing.value = false;
  }
};

/**
 * 在区块链浏览器查看
 */
const handleViewOnExplorer = () => {
  const txHash = props.transaction.tx_hash || props.transaction.transaction_hash;
  if (!txHash) {
    message.warning('交易哈希不存在');
    return;
  }

  const chainId = props.transaction.chain_id || props.chainId;
  const explorerUrl = getBlockExplorerUrl(chainId, 'tx', txHash);

  if (explorerUrl) {
    window.open(explorerUrl, '_blank');
  } else {
    message.warning('当前网络不支持区块链浏览器');
  }
};

/**
 * 关闭对话框
 */
const handleClose = () => {
  emit('update:open', false);
};

/**
 * 获取区块链浏览器URL
 */
const getBlockExplorerUrl = (chainId, type, value) => {
  const explorers = {
    1: 'https://etherscan.io',
    11155111: 'https://sepolia.etherscan.io',
    137: 'https://polygonscan.com',
    80001: 'https://mumbai.polygonscan.com',
    56: 'https://bscscan.com',
    97: 'https://testnet.bscscan.com',
    42161: 'https://arbiscan.io',
    421613: 'https://goerli.arbiscan.io',
    10: 'https://optimistic.etherscan.io',
    420: 'https://goerli-optimism.etherscan.io',
    43114: 'https://snowtrace.io',
    43113: 'https://testnet.snowtrace.io',
    250: 'https://ftmscan.com',
    4002: 'https://testnet.ftmscan.com',
    100: 'https://gnosisscan.io',
    31337: null,
  };

  const baseUrl = explorers[chainId];
  if (!baseUrl) return null;

  const paths = {
    address: 'address',
    tx: 'tx',
    block: 'block',
  };

  return `${baseUrl}/${paths[type]}/${value}`;
};

/**
 * 获取网络名称
 */
const getNetworkName = (chainId) => {
  const networks = {
    1: '以太坊主网',
    11155111: 'Sepolia测试网',
    137: 'Polygon主网',
    80001: 'Mumbai测试网',
    56: 'BSC主网',
    97: 'BSC测试网',
    42161: 'Arbitrum One',
    421613: 'Arbitrum Goerli',
    10: 'Optimism',
    420: 'Optimism Goerli',
    43114: 'Avalanche C-Chain',
    43113: 'Avalanche Fuji',
    250: 'Fantom Opera',
    4002: 'Fantom Testnet',
    100: 'Gnosis Chain',
    31337: 'Hardhat本地网络',
  };
  return networks[chainId] || `Chain ${chainId}`;
};

/**
 * 获取状态图标
 */
const getStatusIcon = (status) => {
  const icons = {
    pending: 'info',
    confirmed: 'success',
    success: 'success',
    failed: 'error',
    error: 'error',
  };
  return icons[status] || 'info';
};

/**
 * 获取状态标题
 */
const getStatusTitle = (status) => {
  const titles = {
    pending: '交易待确认',
    confirmed: '交易已确认',
    success: '交易成功',
    failed: '交易失败',
    error: '交易错误',
  };
  return titles[status] || '未知状态';
};

/**
 * 获取状态颜色
 */
const getStatusColor = (status) => {
  const colors = {
    pending: 'processing',
    confirmed: 'success',
    success: 'success',
    failed: 'error',
    error: 'error',
  };
  return colors[status] || 'default';
};

/**
 * 获取状态文本
 */
const getStatusText = (status) => {
  const texts = {
    pending: '待确认',
    confirmed: '已确认',
    success: '成功',
    failed: '失败',
    error: '错误',
  };
  return texts[status] || status;
};

/**
 * 获取类型颜色
 */
const getTypeColor = (type) => {
  const colors = {
    transfer: 'blue',
    deploy: 'purple',
    mint: 'green',
    burn: 'orange',
    approve: 'cyan',
    swap: 'magenta',
  };
  return colors[type] || 'default';
};

/**
 * 获取类型文本
 */
const getTypeText = (type) => {
  const texts = {
    transfer: '转账',
    deploy: '部署合约',
    mint: '铸造',
    burn: '销毁',
    approve: '授权',
    swap: '交换',
  };
  return texts[type] || type;
};

/**
 * 格式化日期时间
 */
const formatDateTime = (timestamp) => {
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

/**
 * 格式化Gas费用
 */
const formatGas = (gasUsed, gasPrice) => {
  if (!gasUsed || !gasPrice) return '-';
  const gasCost = (gasUsed * gasPrice) / 1e18;
  return `${gasCost.toFixed(6)} ETH`;
};

/**
 * 格式化JSON
 */
const formatJSON = (data) => {
  try {
    if (typeof data === 'string') {
      return JSON.stringify(JSON.parse(data), null, 2);
    }
    return JSON.stringify(data, null, 2);
  } catch (error) {
    return data;
  }
};
</script>

<style scoped>
.transaction-detail-modal {
  max-height: 70vh;
  overflow-y: auto;
}

.transaction-hash {
  margin-top: 8px;
  font-family: monospace;
  font-size: 14px;
}

.raw-data {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  max-height: 300px;
}
</style>
