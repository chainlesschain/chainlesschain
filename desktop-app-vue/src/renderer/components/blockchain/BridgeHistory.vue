<template>
  <div class="bridge-history">
    <a-card title="跨链转移历史" :bordered="false">
      <!-- 过滤器 -->
      <div v-if="showFilters" class="filters">
        <a-space :size="12">
          <a-select
            v-model:value="filters.status"
            placeholder="状态"
            :style="{ width: '120px' }"
            allow-clear
            @change="handleFilterChange"
          >
            <a-select-option value=""> 全部状态 </a-select-option>
            <a-select-option value="pending"> 待处理 </a-select-option>
            <a-select-option value="locked"> 已锁定 </a-select-option>
            <a-select-option value="completed"> 已完成 </a-select-option>
            <a-select-option value="failed"> 失败 </a-select-option>
          </a-select>

          <chain-selector
            v-model="filters.from_chain_id"
            :width="'180px'"
            placeholder="源链"
            @switched="handleFilterChange"
          />

          <chain-selector
            v-model="filters.to_chain_id"
            :width="'180px'"
            placeholder="目标链"
            @switched="handleFilterChange"
          />

          <a-button :loading="loading" @click="handleRefresh">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </div>

      <!-- 历史列表 -->
      <a-list
        :data-source="displayedRecords"
        :loading="loading"
        :pagination="pagination"
        :locale="{ emptyText: '暂无跨链转移记录' }"
        :style="{ marginTop: '16px' }"
      >
        <template #renderItem="{ item }">
          <a-list-item class="bridge-item">
            <a-list-item-meta>
              <!-- 图标 -->
              <template #avatar>
                <a-avatar
                  :style="{ backgroundColor: getStatusColor(item.status) }"
                >
                  <component :is="getStatusIcon(item.status)" />
                </a-avatar>
              </template>

              <!-- 标题 -->
              <template #title>
                <div class="bridge-title">
                  <span class="bridge-route">
                    {{ getNetworkName(item.from_chain_id) }}
                    <arrow-right-outlined class="arrow-icon" />
                    {{ getNetworkName(item.to_chain_id) }}
                  </span>
                  <a-tag :color="getStatusTagColor(item.status)" size="small">
                    {{ getStatusText(item.status) }}
                  </a-tag>
                  <span class="bridge-time">{{
                    formatTime(item.created_at)
                  }}</span>
                </div>
              </template>

              <!-- 描述 -->
              <template #description>
                <div class="bridge-description">
                  <!-- 资产和数量 -->
                  <div class="bridge-info-row">
                    <span class="label">资产:</span>
                    <span class="value">{{ item.asset_id }}</span>
                    <span class="label" style="margin-left: 16px">数量:</span>
                    <span class="value amount">{{ item.amount }}</span>
                  </div>

                  <!-- 地址 -->
                  <div class="bridge-info-row">
                    <span class="label">从:</span>
                    <span class="value">{{
                      formatAddress(item.sender_address)
                    }}</span>
                    <span class="label" style="margin-left: 16px">到:</span>
                    <span class="value">{{
                      formatAddress(item.recipient_address)
                    }}</span>
                  </div>

                  <!-- 交易哈希 -->
                  <div v-if="item.from_tx_hash" class="bridge-info-row">
                    <span class="label">锁定交易:</span>
                    <span class="value tx-hash">
                      {{ formatAddress(item.from_tx_hash) }}
                      <copy-outlined
                        class="copy-icon"
                        @click="handleCopy(item.from_tx_hash)"
                      />
                    </span>
                  </div>

                  <div v-if="item.to_tx_hash" class="bridge-info-row">
                    <span class="label">铸造交易:</span>
                    <span class="value tx-hash">
                      {{ formatAddress(item.to_tx_hash) }}
                      <copy-outlined
                        class="copy-icon"
                        @click="handleCopy(item.to_tx_hash)"
                      />
                    </span>
                  </div>

                  <!-- 错误信息 -->
                  <div v-if="item.error_message" class="bridge-info-row error">
                    <span class="label">错误:</span>
                    <span class="value">{{ item.error_message }}</span>
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
    </a-card>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  ReloadOutlined,
  ArrowRightOutlined,
  CopyOutlined,
  SwapOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons-vue";
import { useBlockchainStore } from "@/stores/blockchain";
import ChainSelector from "./ChainSelector.vue";
import {
  getStatusText,
  getStatusTagColor,
  getStatusColor,
  formatAddress,
  formatTime,
} from "./bridgeHistoryUtils";

const props = defineProps({
  showFilters: {
    type: Boolean,
    default: true,
  },
  pageSize: {
    type: Number,
    default: 10,
  },
});

const emit = defineEmits(["view-details"]);

const blockchainStore = useBlockchainStore();

// 状态
const loading = ref(false);
const currentPage = ref(1);
const bridgeRecords = ref([]);
const filters = ref({
  status: "",
  from_chain_id: null,
  to_chain_id: null,
});

// 过滤后的记录列表
const filteredRecords = computed(() => {
  let result = [...bridgeRecords.value];

  if (filters.value.status) {
    result = result.filter((r) => r.status === filters.value.status);
  }

  if (filters.value.from_chain_id) {
    result = result.filter(
      (r) => r.from_chain_id === filters.value.from_chain_id,
    );
  }

  if (filters.value.to_chain_id) {
    result = result.filter((r) => r.to_chain_id === filters.value.to_chain_id);
  }

  return result;
});

// 显示的记录列表（分页后）
const displayedRecords = computed(() => {
  const start = (currentPage.value - 1) * props.pageSize;
  const end = start + props.pageSize;
  return filteredRecords.value.slice(start, end);
});

// 分页配置
const pagination = computed(() => ({
  current: currentPage.value,
  pageSize: props.pageSize,
  total: filteredRecords.value.length,
  onChange: (page) => {
    currentPage.value = page;
  },
  showSizeChanger: false,
  showTotal: (total) => `共 ${total} 条记录`,
}));

/**
 * 获取状态图标
 */
const getStatusIcon = (status) => {
  const iconMap = {
    pending: ClockCircleOutlined,
    locked: SyncOutlined,
    completed: CheckCircleOutlined,
    failed: CloseCircleOutlined,
  };
  return iconMap[status] || SwapOutlined;
};

/**
 * 获取网络名称
 */
const getNetworkName = (chainId) => {
  const network = blockchainStore.networks.find((n) => n.chainId === chainId);
  return network?.name || `Chain ${chainId}`;
};

/**
 * 复制哈希
 */
const handleCopy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    message.success("已复制到剪贴板");
  } catch (error) {
    logger.error("[BridgeHistory] 复制失败:", error);
    message.error("复制失败");
  }
};

/**
 * 查看详情
 */
const handleViewDetails = (record) => {
  emit("view-details", record);
};

/**
 * 刷新列表
 */
const handleRefresh = async () => {
  loading.value = true;
  try {
    const history = await window.electronAPI.bridge.getHistory(filters.value);
    bridgeRecords.value = history || [];
    message.success("刷新成功");
  } catch (error) {
    logger.error("[BridgeHistory] 刷新失败:", error);
    message.error("刷新失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

/**
 * 过滤器变化处理
 */
const handleFilterChange = () => {
  currentPage.value = 1; // 重置到第一页
  handleRefresh();
};

// 生命周期
onMounted(() => {
  handleRefresh();
});
</script>

<style scoped>
.bridge-history {
  width: 100%;
}

.filters {
  padding: 12px 16px;
  background-color: #fafafa;
  border-radius: 4px;
  margin-bottom: 16px;
}

.bridge-item {
  padding: 16px;
  transition: background-color 0.3s;
}

.bridge-item:hover {
  background-color: #fafafa;
}

.bridge-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bridge-route {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 8px;
}

.arrow-icon {
  color: #d9d9d9;
  font-size: 12px;
}

.bridge-time {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: auto;
}

.bridge-description {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bridge-info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.bridge-info-row.error {
  color: #ff4d4f;
}

.label {
  color: #8c8c8c;
  font-weight: 500;
  min-width: 70px;
}

.value {
  color: #595959;
  font-family: "Courier New", monospace;
}

.value.amount {
  color: #52c41a;
  font-weight: 500;
}

.value.tx-hash {
  color: #1890ff;
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy-icon {
  color: #1890ff;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 13px;
}

.copy-icon:hover {
  color: #40a9ff;
  transform: scale(1.1);
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
