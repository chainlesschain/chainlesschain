<template>
  <div class="bridge-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">
          <swap-outlined />
          跨链桥
        </h1>
        <p class="page-subtitle">在不同区块链网络间安全转移资产</p>
      </div>
      <div class="header-right">
        <a-tag color="warning">
          <experiment-outlined /> 测试版本
        </a-tag>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="page-content">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 跨链转移标签页 -->
        <a-tab-pane key="transfer" tab="跨链转移">
          <template #tab>
            <span>
              <swap-outlined />
              跨链转移
            </span>
          </template>
          <bridge-transfer />
        </a-tab-pane>

        <!-- 转移历史标签页 -->
        <a-tab-pane key="history" tab="转移历史">
          <template #tab>
            <span>
              <history-outlined />
              转移历史
            </span>
          </template>
          <bridge-history @view-details="handleViewDetails" />
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 详情对话框 -->
    <a-modal
      v-model:open="showDetailsModal"
      title="跨链转移详情"
      width="700px"
      :footer="null"
    >
      <a-descriptions v-if="selectedRecord" :column="2" bordered>
        <a-descriptions-item label="状态" :span="2">
          <a-tag :color="getStatusTagColor(selectedRecord.status)">
            {{ getStatusText(selectedRecord.status) }}
          </a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="源链">
          {{ getNetworkName(selectedRecord.from_chain_id) }}
        </a-descriptions-item>

        <a-descriptions-item label="目标链">
          {{ getNetworkName(selectedRecord.to_chain_id) }}
        </a-descriptions-item>

        <a-descriptions-item label="资产 ID" :span="2">
          {{ selectedRecord.asset_id }}
        </a-descriptions-item>

        <a-descriptions-item label="合约地址" :span="2">
          <span class="mono-text">{{ selectedRecord.asset_address }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="转移数量" :span="2">
          <span class="amount-text">{{ selectedRecord.amount }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="发送地址" :span="2">
          <span class="mono-text">{{ selectedRecord.sender_address }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="接收地址" :span="2">
          <span class="mono-text">{{ selectedRecord.recipient_address }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="锁定交易" :span="2" v-if="selectedRecord.from_tx_hash">
          <span class="mono-text">{{ selectedRecord.from_tx_hash }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="铸造交易" :span="2" v-if="selectedRecord.to_tx_hash">
          <span class="mono-text">{{ selectedRecord.to_tx_hash }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="创建时间" :span="2">
          {{ formatDateTime(selectedRecord.created_at) }}
        </a-descriptions-item>

        <a-descriptions-item label="完成时间" :span="2" v-if="selectedRecord.completed_at">
          {{ formatDateTime(selectedRecord.completed_at) }}
        </a-descriptions-item>

        <a-descriptions-item label="错误信息" :span="2" v-if="selectedRecord.error_message">
          <a-alert :message="selectedRecord.error_message" type="error" />
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  SwapOutlined,
  HistoryOutlined,
  ExperimentOutlined,
} from '@ant-design/icons-vue';
import { useBlockchainStore } from '@/stores/blockchain';
import BridgeTransfer from '@/components/blockchain/BridgeTransfer.vue';
import BridgeHistory from '@/components/blockchain/BridgeHistory.vue';

const blockchainStore = useBlockchainStore();

// 状态
const activeTab = ref('transfer');
const showDetailsModal = ref(false);
const selectedRecord = ref(null);

/**
 * 获取状态文本
 */
const getStatusText = (status) => {
  const statusMap = {
    pending: '待处理',
    locked: '已锁定',
    completed: '已完成',
    failed: '失败',
  };
  return statusMap[status] || status;
};

/**
 * 获取状态标签颜色
 */
const getStatusTagColor = (status) => {
  const colorMap = {
    pending: 'processing',
    locked: 'warning',
    completed: 'success',
    failed: 'error',
  };
  return colorMap[status] || 'default';
};

/**
 * 获取网络名称
 */
const getNetworkName = (chainId) => {
  const network = blockchainStore.networks.find(n => n.chainId === chainId);
  return network?.name || `Chain ${chainId}`;
};

/**
 * 格式化日期时间
 */
const formatDateTime = (timestamp) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN');
};

/**
 * 查看详情
 */
const handleViewDetails = (record) => {
  selectedRecord.value = record;
  showDetailsModal.value = true;
};
</script>

<style scoped>
.bridge-page {
  min-height: 100%;
  padding: 24px;
  background-color: #f5f5f5;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 16px 24px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.header-left {
  flex: 1;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-subtitle {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: #8c8c8c;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-content {
  background-color: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.mono-text {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #595959;
  word-break: break-all;
}

.amount-text {
  font-size: 16px;
  font-weight: 500;
  color: #52c41a;
}

:deep(.ant-tabs-nav) {
  margin-bottom: 24px;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
  background-color: #fafafa;
}
</style>
