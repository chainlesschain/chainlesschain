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
                  <template #icon>
                    <link-outlined />
                  </template>
                  在区块链浏览器查看
                </a-button>
                <a-button :loading="refreshing" @click="handleRefresh">
                  <template #icon>
                    <reload-outlined />
                  </template>
                  刷新状态
                </a-button>
              </a-space>
            </template>
          </a-result>

          <a-divider />

          <!-- 交易信息 -->
          <a-descriptions title="基本信息" :column="2" bordered>
            <a-descriptions-item label="交易类型">
              <a-tag
                :color="getTypeColor(transaction.tx_type || transaction.type)"
              >
                {{ getTypeText(transaction.tx_type || transaction.type) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="交易状态">
              <a-tag :color="getStatusColor(transaction.status)">
                {{ getStatusText(transaction.status) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="发起时间" :span="2">
              {{
                formatDateTime(transaction.created_at || transaction.timestamp)
              }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="transaction.confirmed_at"
              label="确认时间"
              :span="2"
            >
              {{ formatDateTime(transaction.confirmed_at) }}
            </a-descriptions-item>
          </a-descriptions>

          <a-divider />

          <!-- 区块链信息 -->
          <a-descriptions
            v-if="transaction.chain_id"
            title="区块链信息"
            :column="2"
            bordered
          >
            <a-descriptions-item label="网络">
              {{ getNetworkName(transaction.chain_id) }}
            </a-descriptions-item>
            <a-descriptions-item label="链ID">
              {{ transaction.chain_id }}
            </a-descriptions-item>
            <a-descriptions-item v-if="transaction.block_number" label="区块号">
              {{ transaction.block_number }}
            </a-descriptions-item>
            <a-descriptions-item v-if="transaction.gas_used" label="Gas费用">
              {{ formatGas(transaction.gas_used, transaction.gas_price) }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="transaction.tx_hash"
              label="交易哈希"
              :span="2"
            >
              <a-typography-text copyable>
                {{ transaction.tx_hash }}
              </a-typography-text>
            </a-descriptions-item>
          </a-descriptions>

          <a-divider />

          <!-- 交易详情 -->
          <a-descriptions title="交易详情" :column="1" bordered>
            <a-descriptions-item
              v-if="transaction.from_address || transaction.from_did"
              label="发送方"
            >
              <a-typography-text copyable>
                {{ transaction.from_address || transaction.from_did }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="transaction.to_address || transaction.to_did"
              label="接收方"
            >
              <a-typography-text copyable>
                {{ transaction.to_address || transaction.to_did }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item v-if="transaction.amount" label="金额">
              {{ transaction.amount }} {{ transaction.asset_symbol || "" }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="transaction.memo || transaction.description"
              label="备注"
            >
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
          <a-collapse v-if="transaction.raw_data" style="margin-top: 16px">
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
import { logger } from "@/utils/logger";

import { ref } from "vue";
import { message } from "ant-design-vue";
import { LinkOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import {
  getBlockExplorerUrl,
  getNetworkName,
  getStatusIcon,
  getStatusTitle,
  getStatusColor,
  getStatusText,
  getTypeColor,
  getTypeText,
  formatDateTime,
  formatGas,
  formatJSON,
} from "./transactionDetailModalUtils";

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

const emit = defineEmits(["update:open", "refresh"]);

const loading = ref(false);
const refreshing = ref(false);

/**
 * 刷新交易状态
 */
const handleRefresh = async () => {
  refreshing.value = true;
  try {
    emit("refresh", props.transaction);
    message.success("刷新成功");
  } catch (error) {
    logger.error("刷新失败:", error);
    message.error("刷新失败");
  } finally {
    refreshing.value = false;
  }
};

/**
 * 在区块链浏览器查看
 */
const handleViewOnExplorer = () => {
  const txHash =
    props.transaction.tx_hash || props.transaction.transaction_hash;
  if (!txHash) {
    message.warning("交易哈希不存在");
    return;
  }

  const chainId = props.transaction.chain_id || props.chainId;
  const explorerUrl = getBlockExplorerUrl(chainId, "tx", txHash);

  if (explorerUrl) {
    window.open(explorerUrl, "_blank");
  } else {
    message.warning("当前网络不支持区块链浏览器");
  }
};

/**
 * 关闭对话框
 */
const handleClose = () => {
  emit("update:open", false);
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
