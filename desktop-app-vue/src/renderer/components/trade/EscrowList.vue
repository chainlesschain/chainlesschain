<template>
  <div class="escrow-list">
    <a-card :bordered="false">
      <template #title>
        <a-space>
          <lock-outlined />
          <span>托管管理</span>
        </a-space>
      </template>

      <template #extra>
        <a-space>
          <a-button @click="loadEscrows">
            <template #icon><reload-outlined /></template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 统计卡片 -->
      <escrow-statistics style="margin-bottom: 24px" />

      <!-- 筛选器 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="12">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索托管记录..."
            allow-clear
          >
            <template #prefix><search-outlined /></template>
          </a-input-search>
        </a-col>
        <a-col :span="12">
          <a-space>
            <span>状态:</span>
            <a-radio-group v-model:value="filterStatus" button-style="solid" size="small">
              <a-radio-button value="">全部</a-radio-button>
              <a-radio-button value="locked">锁定中</a-radio-button>
              <a-radio-button value="released">已释放</a-radio-button>
              <a-radio-button value="refunded">已退款</a-radio-button>
              <a-radio-button value="disputed">有争议</a-radio-button>
            </a-radio-group>
          </a-space>
        </a-col>
      </a-row>

      <!-- 托管列表 -->
      <a-spin :spinning="loading">
        <a-table
          :columns="columns"
          :data-source="filteredEscrows"
          :pagination="pagination"
          :row-key="(record) => record.id"
          @change="handleTableChange"
        >
          <!-- 托管ID列 -->
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <a-typography-text copyable :ellipsis="{ tooltip: record.id }">
                {{ formatId(record.id) }}
              </a-typography-text>
            </template>

            <!-- 交易信息列 -->
            <template v-else-if="column.key === 'transaction'">
              <div class="transaction-info-cell">
                <div class="transaction-id">
                  交易: {{ formatId(record.transaction_id) }}
                </div>
                <div v-if="record.order_id" class="order-id">
                  订单: {{ formatId(record.order_id) }}
                </div>
              </div>
            </template>

            <!-- 金额列 -->
            <template v-else-if="column.key === 'amount'">
              <div class="amount-cell">
                <div class="amount">{{ formatAmount(record.amount) }}</div>
                <div class="asset-symbol">{{ record.asset_symbol || 'CC' }}</div>
              </div>
            </template>

            <!-- 买家列 -->
            <template v-else-if="column.key === 'buyer'">
              <a-space direction="vertical" size="small">
                <a-typography-text copyable :ellipsis="{ tooltip: record.buyer_did }">
                  {{ formatDid(record.buyer_did) }}
                </a-typography-text>
                <a-tag v-if="isCurrentUser(record.buyer_did)" color="blue" size="small">
                  我
                </a-tag>
              </a-space>
            </template>

            <!-- 卖家列 -->
            <template v-else-if="column.key === 'seller'">
              <a-space direction="vertical" size="small">
                <a-typography-text copyable :ellipsis="{ tooltip: record.seller_did }">
                  {{ formatDid(record.seller_did) }}
                </a-typography-text>
                <a-tag v-if="isCurrentUser(record.seller_did)" color="green" size="small">
                  我
                </a-tag>
              </a-space>
            </template>

            <!-- 状态列 -->
            <template v-else-if="column.key === 'status'">
              <status-badge :status="record.status" type="escrow" show-icon />
            </template>

            <!-- 时间列 -->
            <template v-else-if="column.key === 'created_at'">
              <a-tooltip :title="formatFullTime(record.created_at)">
                {{ formatTime(record.created_at) }}
              </a-tooltip>
            </template>

            <!-- 操作列 -->
            <template v-else-if="column.key === 'action'">
              <a-space>
                <a-button type="link" size="small" @click="handleViewDetail(record)">
                  查看详情
                </a-button>

                <a-button
                  v-if="canDispute(record)"
                  danger
                  size="small"
                  @click="handleDispute(record)"
                >
                  发起争议
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>

        <!-- 空状态 -->
        <a-empty
          v-if="!loading && filteredEscrows.length === 0"
          :description="searchKeyword || filterStatus ? '没有找到匹配的托管记录' : '暂无托管记录'"
        />
      </a-spin>
    </a-card>

    <!-- 托管详情抽屉 -->
    <escrow-detail
      :visible="showDetailDrawer"
      :escrow="selectedEscrow"
      @close="showDetailDrawer = false"
      @dispute="handleDisputeFromDetail"
    />

    <!-- 争议发起对话框 -->
    <escrow-dispute
      v-model:visible="showDisputeModal"
      :escrow="selectedEscrow"
      @disputed="handleDisputed"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  LockOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import StatusBadge from './common/StatusBadge.vue';
import EscrowStatistics from './EscrowStatistics.vue';
import EscrowDetail from './EscrowDetail.vue';
import EscrowDispute from './EscrowDispute.vue';

// Store
const tradeStore = useTradeStore();

// 状态
const searchKeyword = ref('');
const filterStatus = ref('');
const pagination = ref({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条记录`,
});
const currentUserDid = ref('');
const showDetailDrawer = ref(false);
const showDisputeModal = ref(false);
const selectedEscrow = ref(null);

// 从 store 获取数据
const loading = computed(() => tradeStore.escrow.loading);
const escrows = computed(() => tradeStore.escrow.escrows);

// 过滤后的托管记录
const filteredEscrows = computed(() => {
  let result = escrows.value;

  // 状态筛选
  if (filterStatus.value) {
    result = result.filter((e) => e.status === filterStatus.value);
  }

  // 搜索筛选
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      (e) =>
        e.id.toLowerCase().includes(keyword) ||
        e.transaction_id?.toLowerCase().includes(keyword) ||
        e.order_id?.toLowerCase().includes(keyword) ||
        e.buyer_did.toLowerCase().includes(keyword) ||
        e.seller_did.toLowerCase().includes(keyword)
    );
  }

  // 更新分页总数
  pagination.value.total = result.length;

  return result;
});

// 表格列配置
const columns = [
  {
    title: '托管ID',
    dataIndex: 'id',
    key: 'id',
    width: 150,
  },
  {
    title: '交易信息',
    key: 'transaction',
    width: 180,
  },
  {
    title: '金额',
    key: 'amount',
    width: 120,
  },
  {
    title: '买家',
    key: 'buyer',
    width: 150,
  },
  {
    title: '卖家',
    key: 'seller',
    width: 150,
  },
  {
    title: '状态',
    key: 'status',
    width: 120,
  },
  {
    title: '创建时间',
    dataIndex: 'created_at',
    key: 'created_at',
    width: 150,
  },
  {
    title: '操作',
    key: 'action',
    width: 180,
    fixed: 'right',
  },
];

// 工具函数

// 格式化 ID
const formatId = (id) => {
  if (!id) return '-';
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
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

// 格式化完整时间
const formatFullTime = (timestamp) => {
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

// 判断是否为当前用户
const isCurrentUser = (did) => {
  return currentUserDid.value && did === currentUserDid.value;
};

// 是否可以发起争议
const canDispute = (escrow) => {
  return (
    escrow.status === 'locked' &&
    (isCurrentUser(escrow.buyer_did) || isCurrentUser(escrow.seller_did))
  );
};

// 加载托管列表
const loadEscrows = async () => {
  try {
    await tradeStore.loadEscrows();
    console.log('[EscrowList] 托管记录已加载:', escrows.value.length);
  } catch (error) {
    console.error('[EscrowList] 加载托管记录失败:', error);
    message.error('加载托管记录失败: ' + error.message);
  }
};

// 表格变化处理
const handleTableChange = (pag, filters, sorter) => {
  pagination.value.current = pag.current;
  pagination.value.pageSize = pag.pageSize;
};

// 查看详情
const handleViewDetail = (escrow) => {
  selectedEscrow.value = escrow;
  showDetailDrawer.value = true;
};

// 发起争议
const handleDispute = (escrow) => {
  selectedEscrow.value = escrow;
  showDisputeModal.value = true;
};

// 从详情页发起争议
const handleDisputeFromDetail = (escrow) => {
  showDetailDrawer.value = false;
  selectedEscrow.value = escrow;
  showDisputeModal.value = true;
};

// 争议发起成功
const handleDisputed = async () => {
  await loadEscrows();
  message.success('争议已发起');
};

// 获取当前用户 DID
const loadCurrentUserDid = async () => {
  try {
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentUserDid.value = identity.did;
    }
  } catch (error) {
    console.error('[EscrowList] 获取当前用户 DID 失败:', error);
  }
};

// 生命周期
onMounted(async () => {
  await loadCurrentUserDid();
  await loadEscrows();
});
</script>

<style scoped>
.escrow-list {
  padding: 20px;
}

.transaction-info-cell {
  font-size: 13px;
}

.transaction-id {
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
}

.order-id {
  font-size: 12px;
  color: #8c8c8c;
}

.amount-cell {
  text-align: right;
}

.amount {
  font-weight: 600;
  color: #faad14;
  margin-bottom: 2px;
  font-size: 15px;
}

.asset-symbol {
  font-size: 12px;
  color: #8c8c8c;
}

:deep(.ant-table-cell) {
  vertical-align: middle;
}
</style>
