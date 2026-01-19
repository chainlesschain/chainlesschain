<template>
  <a-drawer
    :open="open"
    :title="`${asset ? asset.name : '资产'} - 转账历史`"
    width="700px"
    placement="right"
    @close="handleClose"
  >
    <div class="asset-history">
      <!-- 资产信息卡片 -->
      <a-card
        v-if="asset"
        size="small"
        style="margin-bottom: 24px"
      >
        <a-space>
          <a-avatar
            :size="48"
            :style="{ backgroundColor: getAssetColor(asset.asset_type) }"
          >
            <template #icon>
              <component :is="getAssetIcon(asset.asset_type)" />
            </template>
          </a-avatar>
          <div>
            <div class="asset-name">
              {{ asset.name }}
            </div>
            <a-tag
              v-if="asset.symbol"
              color="blue"
            >
              {{ asset.symbol }}
            </a-tag>
            <a-tag :color="getTypeColor(asset.asset_type)">
              {{ getTypeLabel(asset.asset_type) }}
            </a-tag>
          </div>
        </a-space>
      </a-card>

      <!-- 筛选器 -->
      <a-card
        size="small"
        style="margin-bottom: 16px"
      >
        <a-space>
          <span>类型:</span>
          <a-radio-group
            v-model:value="filterType"
            button-style="solid"
            size="small"
            @change="applyFilter"
          >
            <a-radio-button value="">
              全部
            </a-radio-button>
            <a-radio-button value="transfer">
              转账
            </a-radio-button>
            <a-radio-button value="mint">
              铸造
            </a-radio-button>
            <a-radio-button value="burn">
              销毁
            </a-radio-button>
            <a-radio-button value="trade">
              交易
            </a-radio-button>
          </a-radio-group>

          <a-button
            type="link"
            size="small"
            @click="loadHistory"
          >
            <reload-outlined /> 刷新
          </a-button>
        </a-space>
      </a-card>

      <!-- 历史记录时间线 -->
      <a-spin :spinning="loading">
        <a-timeline
          v-if="filteredHistory.length > 0"
          mode="left"
        >
          <a-timeline-item
            v-for="(item, index) in filteredHistory"
            :key="index"
            :color="getTimelineColor(item.transaction_type)"
          >
            <template #dot>
              <component
                :is="getTransactionIcon(item.transaction_type)"
                :style="{ fontSize: '16px', color: getIconColor(item.transaction_type) }"
              />
            </template>

            <template #label>
              <div class="timeline-label">
                {{ formatTime(item.created_at) }}
              </div>
            </template>

            <a-card
              size="small"
              hoverable
              class="history-card"
            >
              <div class="history-header">
                <a-tag :color="getTransactionTypeColor(item.transaction_type)">
                  {{ getTransactionTypeName(item.transaction_type) }}
                </a-tag>
                <span class="history-amount">
                  {{ formatAmount(item.amount, asset?.decimals) }}
                  <span class="symbol">{{ asset?.symbol || asset?.name }}</span>
                </span>
              </div>

              <a-descriptions
                :column="1"
                size="small"
                style="margin-top: 12px"
              >
                <a-descriptions-item label="发送者">
                  <a-typography-text copyable>
                    {{ formatDid(item.from_did) }}
                  </a-typography-text>
                  <a-tag
                    v-if="isCurrentUser(item.from_did)"
                    color="blue"
                    size="small"
                    style="margin-left: 8px"
                  >
                    我
                  </a-tag>
                </a-descriptions-item>

                <a-descriptions-item label="接收者">
                  <a-typography-text copyable>
                    {{ formatDid(item.to_did) }}
                  </a-typography-text>
                  <a-tag
                    v-if="isCurrentUser(item.to_did)"
                    color="blue"
                    size="small"
                    style="margin-left: 8px"
                  >
                    我
                  </a-tag>
                </a-descriptions-item>

                <a-descriptions-item
                  v-if="item.memo"
                  label="备注"
                >
                  <div class="memo-text">
                    {{ item.memo }}
                  </div>
                </a-descriptions-item>

                <a-descriptions-item
                  v-if="item.transaction_hash"
                  label="交易哈希"
                >
                  <a-typography-text
                    copyable
                    :ellipsis="{ tooltip: item.transaction_hash }"
                  >
                    {{ formatHash(item.transaction_hash) }}
                  </a-typography-text>
                </a-descriptions-item>
              </a-descriptions>

              <!-- 交易方向指示 -->
              <div class="transaction-direction">
                <a-tag
                  v-if="isIncoming(item)"
                  color="success"
                >
                  <arrow-down-outlined /> 收入
                </a-tag>
                <a-tag
                  v-else-if="isOutgoing(item)"
                  color="error"
                >
                  <arrow-up-outlined /> 支出
                </a-tag>
                <a-tag
                  v-else
                  color="default"
                >
                  <swap-outlined /> 其他
                </a-tag>
              </div>
            </a-card>
          </a-timeline-item>
        </a-timeline>

        <!-- 空状态 -->
        <a-empty
          v-else
          :description="filterType ? '没有找到匹配的历史记录' : '暂无历史记录'"
        >
          <a-button
            v-if="filterType"
            size="small"
            @click="filterType = ''"
          >
            清除筛选
          </a-button>
        </a-empty>

        <!-- 加载更多 -->
        <div
          v-if="hasMore && filteredHistory.length > 0"
          class="load-more"
        >
          <a-button
            block
            @click="loadMore"
          >
            加载更多
          </a-button>
        </div>
      </a-spin>
    </div>
  </a-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  WalletOutlined,
  PictureOutlined,
  ReadOutlined,
  FileProtectOutlined,
  SwapOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlusCircleOutlined,
  FireOutlined,
  ShoppingOutlined,
  ReloadOutlined,
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
  currentUserDid: {
    type: String,
    default: '',
  },
});

// Emits
const emit = defineEmits(['close']);

// 状态
const loading = ref(false);
const history = ref([]);
const filterType = ref('');
const currentLimit = ref(20);
const hasMore = ref(false);

// 过滤后的历史记录
const filteredHistory = computed(() => {
  if (!filterType.value) {
    return history.value;
  }
  return history.value.filter(item => item.transaction_type === filterType.value);
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

// 交易类型图标
const getTransactionIcon = (type) => {
  const iconMap = {
    transfer: SwapOutlined,
    mint: PlusCircleOutlined,
    burn: FireOutlined,
    trade: ShoppingOutlined,
  };
  return iconMap[type] || SwapOutlined;
};

// 交易类型颜色
const getTransactionTypeColor = (type) => {
  const colorMap = {
    transfer: 'blue',
    mint: 'green',
    burn: 'red',
    trade: 'orange',
  };
  return colorMap[type] || 'default';
};

// 交易类型名称
const getTransactionTypeName = (type) => {
  const nameMap = {
    transfer: '转账',
    mint: '铸造',
    burn: '销毁',
    trade: '交易',
  };
  return nameMap[type] || type;
};

// 时间线颜色
const getTimelineColor = (type) => {
  const colorMap = {
    transfer: 'blue',
    mint: 'green',
    burn: 'red',
    trade: 'orange',
  };
  return colorMap[type] || 'gray';
};

// 图标颜色
const getIconColor = (type) => {
  const colorMap = {
    transfer: '#1890ff',
    mint: '#52c41a',
    burn: '#ff4d4f',
    trade: '#faad14',
  };
  return colorMap[type] || '#999';
};

// 格式化金额
const formatAmount = (amount, decimals = 0) => {
  if (!amount && amount !== 0) {return '0';}

  const num = parseFloat(amount);
  if (isNaN(num)) {return '0';}

  if (decimals > 0) {
    const divisor = Math.pow(10, decimals);
    return (num / divisor).toLocaleString('en-US', { maximumFractionDigits: decimals });
  }

  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

// 格式化 DID
const formatDid = (did) => {
  if (!did) {return '-';}
  if (did === 'SYSTEM') {return 'SYSTEM（系统）';}
  if (did === 'BURNED') {return 'BURNED（已销毁）';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 格式化哈希
const formatHash = (hash) => {
  if (!hash) {return '-';}
  return hash.length > 20 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '-';}
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 1小时内显示分钟
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return minutes > 0 ? `${minutes}分钟前` : '刚刚';
  }

  // 24小时内显示小时
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}小时前`;
  }

  // 7天内显示天数
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天前`;
  }

  // 超过7天显示完整日期
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

// 判断是否为收入
const isIncoming = (item) => {
  return item.to_did === props.currentUserDid && item.from_did !== props.currentUserDid;
};

// 判断是否为支出
const isOutgoing = (item) => {
  return item.from_did === props.currentUserDid && item.to_did !== props.currentUserDid;
};

// 加载历史记录
const loadHistory = async () => {
  if (!props.asset) {
    message.warning('资产信息不存在');
    return;
  }

  try {
    loading.value = true;

    const assetId = props.asset.id || props.asset.asset_id;
    const result = await window.electronAPI.asset.getHistory(assetId, currentLimit.value);

    history.value = result || [];
    hasMore.value = result && result.length >= currentLimit.value;

    console.log('[AssetHistory] 历史记录已加载:', history.value.length);
  } catch (error) {
    console.error('[AssetHistory] 加载历史记录失败:', error);
    message.error('加载历史记录失败: ' + error.message);
    history.value = [];
  } finally {
    loading.value = false;
  }
};

// 加载更多
const loadMore = () => {
  currentLimit.value += 20;
  loadHistory();
};

// 应用筛选
const applyFilter = () => {
  // 筛选已通过 computed 自动处理
};

// 关闭抽屉
const handleClose = () => {
  emit('close');
};

// 监听抽屉打开
watch(() => props.open, (newVal) => {
  if (newVal && props.asset) {
    // 重置状态
    filterType.value = '';
    currentLimit.value = 20;
    // 加载历史记录
    loadHistory();
  }
});
</script>

<style scoped>
.asset-history {
  padding-bottom: 24px;
}

.asset-name {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 4px;
}

.timeline-label {
  font-size: 12px;
  color: #8c8c8c;
  text-align: right;
  width: 120px;
}

.history-card {
  margin-bottom: 8px;
  transition: all 0.3s;
}

.history-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-amount {
  font-size: 18px;
  font-weight: 600;
  color: #262626;
}

.history-amount .symbol {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 4px;
  font-weight: 400;
}

.memo-text {
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #595959;
  font-size: 13px;
  line-height: 1.5;
}

.transaction-direction {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #f0f0f0;
}

.load-more {
  margin-top: 24px;
  text-align: center;
}

:deep(.ant-timeline-item-label) {
  width: 120px !important;
}

:deep(.ant-timeline-item-tail) {
  border-left: 2px solid #e8e8e8;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
  color: #595959;
}

:deep(.ant-descriptions-item-content) {
  color: #262626;
}
</style>
