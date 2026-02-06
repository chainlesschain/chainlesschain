<template>
  <div class="transaction-list">
    <a-card :bordered="false">
      <template #title>
        <a-space>
          <history-outlined />
          <span>交易记录</span>
        </a-space>
      </template>

      <template #extra>
        <a-space>
          <a-button @click="loadTransactions">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 筛选器 -->
      <a-row
        :gutter="16"
        style="margin-bottom: 16px"
      >
        <a-col :span="12">
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索交易记录..."
            allow-clear
          >
            <template #prefix>
              <search-outlined />
            </template>
          </a-input-search>
        </a-col>
        <a-col :span="12">
          <a-space>
            <span>状态:</span>
            <a-radio-group
              v-model:value="filterStatus"
              button-style="solid"
              size="small"
            >
              <a-radio-button value="">
                全部
              </a-radio-button>
              <a-radio-button value="pending">
                待处理
              </a-radio-button>
              <a-radio-button value="escrowed">
                托管中
              </a-radio-button>
              <a-radio-button value="completed">
                已完成
              </a-radio-button>
              <a-radio-button value="cancelled">
                已取消
              </a-radio-button>
              <a-radio-button value="disputed">
                有争议
              </a-radio-button>
            </a-radio-group>
          </a-space>
        </a-col>
      </a-row>

      <!-- 交易列表 -->
      <a-spin :spinning="loading">
        <a-table
          :columns="columns"
          :data-source="filteredTransactions"
          :pagination="pagination"
          :row-key="record => record.id"
          @change="handleTableChange"
        >
          <!-- 交易ID列 -->
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <a-typography-text
                copyable
                :ellipsis="{ tooltip: record.id }"
              >
                {{ formatId(record.id) }}
              </a-typography-text>
            </template>

            <!-- 订单信息列 -->
            <template v-else-if="column.key === 'order'">
              <div class="order-info-cell">
                <div class="order-title">
                  {{ record.order_title || '-' }}
                </div>
                <div class="order-id">
                  订单: {{ formatId(record.order_id) }}
                </div>
              </div>
            </template>

            <!-- 买家列 -->
            <template v-else-if="column.key === 'buyer'">
              <a-space
                direction="vertical"
                size="small"
              >
                <a-typography-text copyable>
                  {{ formatDid(record.buyer_did) }}
                </a-typography-text>
                <a-tag
                  v-if="isCurrentUser(record.buyer_did)"
                  color="blue"
                  size="small"
                >
                  我
                </a-tag>
              </a-space>
            </template>

            <!-- 卖家列 -->
            <template v-else-if="column.key === 'seller'">
              <a-space
                direction="vertical"
                size="small"
              >
                <a-typography-text copyable>
                  {{ formatDid(record.seller_did) }}
                </a-typography-text>
                <a-tag
                  v-if="isCurrentUser(record.seller_did)"
                  color="green"
                  size="small"
                >
                  我
                </a-tag>
              </a-space>
            </template>

            <!-- 金额列 -->
            <template v-else-if="column.key === 'amount'">
              <div class="amount-cell">
                <div class="amount">
                  {{ formatAmount(record.payment_amount) }}
                </div>
                <div class="quantity">
                  x {{ record.quantity }}
                </div>
              </div>
            </template>

            <!-- 状态列 -->
            <template v-else-if="column.key === 'status'">
              <status-badge
                :status="record.status"
                type="transaction"
                show-icon
              />
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
                <a-button
                  type="link"
                  size="small"
                  @click="handleViewDetail(record)"
                >
                  查看详情
                </a-button>

                <a-button
                  v-if="canConfirmDelivery(record)"
                  type="primary"
                  size="small"
                  @click="handleConfirmDelivery(record)"
                >
                  确认收货
                </a-button>

                <a-button
                  v-if="canRequestRefund(record)"
                  danger
                  size="small"
                  @click="handleRequestRefund(record)"
                >
                  申请退款
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>

        <!-- 空状态 -->
        <a-empty
          v-if="!loading && filteredTransactions.length === 0"
          :description="searchKeyword || filterStatus ? '没有找到匹配的交易记录' : '暂无交易记录'"
        />
      </a-spin>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, h } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  HistoryOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import StatusBadge from './common/StatusBadge.vue';

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

// 从 store 获取数据
const loading = computed(() => tradeStore.marketplace.loading);
const transactions = computed(() => tradeStore.marketplace.transactions);

// 过滤后的交易记录
const filteredTransactions = computed(() => {
  let result = transactions.value;

  // 状态筛选
  if (filterStatus.value) {
    result = result.filter(t => t.status === filterStatus.value);
  }

  // 搜索筛选
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(t =>
      t.id.toLowerCase().includes(keyword) ||
      t.order_id?.toLowerCase().includes(keyword) ||
      t.order_title?.toLowerCase().includes(keyword) ||
      t.buyer_did.toLowerCase().includes(keyword) ||
      t.seller_did.toLowerCase().includes(keyword)
    );
  }

  // 更新分页总数
  pagination.value.total = result.length;

  return result;
});

// 表格列配置
const columns = [
  {
    title: '交易ID',
    dataIndex: 'id',
    key: 'id',
    width: 150,
  },
  {
    title: '订单信息',
    key: 'order',
    width: 200,
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
    title: '金额 x 数量',
    key: 'amount',
    width: 120,
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
    width: 200,
    fixed: 'right',
  },
];

// 工具函数

// 格式化 ID
const formatId = (id) => {
  if (!id) {return '-';}
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-8)}` : id;
};

// 格式化 DID
const formatDid = (did) => {
  if (!did) {return '-';}
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

// 格式化金额
const formatAmount = (amount) => {
  if (!amount && amount !== 0) {return '0';}
  const num = parseFloat(amount);
  if (isNaN(num)) {return '0';}
  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
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

  // 超过24小时显示日期
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

// 格式化完整时间
const formatFullTime = (timestamp) => {
  if (!timestamp) {return '-';}
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

// 是否可以确认收货
const canConfirmDelivery = (transaction) => {
  return transaction.status === 'escrowed' && isCurrentUser(transaction.buyer_did);
};

// 是否可以申请退款
const canRequestRefund = (transaction) => {
  return transaction.status === 'escrowed' && isCurrentUser(transaction.buyer_did);
};

// 加载交易记录
const loadTransactions = async () => {
  try {
    await tradeStore.loadTransactions();
    logger.info('[TransactionList] 交易记录已加载:', transactions.value.length);
  } catch (error) {
    logger.error('[TransactionList] 加载交易记录失败:', error);
    message.error('加载交易记录失败: ' + error.message);
  }
};

// 表格变化处理
const handleTableChange = (pag, filters, sorter) => {
  pagination.value.current = pag.current;
  pagination.value.pageSize = pag.pageSize;
};

// 查看详情
const handleViewDetail = (transaction) => {
  // 打开交易详情模态框
  Modal.info({
    title: '交易详情',
    width: 600,
    content: h('div', { style: 'max-height: 400px; overflow-y: auto;' }, [
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '交易ID: '),
        h('span', transaction.id)
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '订单ID: '),
        h('span', transaction.order_id || '-')
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '订单标题: '),
        h('span', transaction.order_title || '-')
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '金额: '),
        h('span', `${transaction.amount} ${transaction.currency || 'CNY'}`)
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '状态: '),
        h('span', getStatusText(transaction.status))
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '买家DID: '),
        h('span', { style: 'word-break: break-all;' }, transaction.buyer_did)
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '卖家DID: '),
        h('span', { style: 'word-break: break-all;' }, transaction.seller_did)
      ]),
      h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '创建时间: '),
        h('span', new Date(transaction.created_at).toLocaleString())
      ]),
      transaction.completed_at && h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '完成时间: '),
        h('span', new Date(transaction.completed_at).toLocaleString())
      ]),
      transaction.description && h('div', { style: 'margin-bottom: 12px;' }, [
        h('strong', '描述: '),
        h('span', transaction.description)
      ])
    ]),
    okText: '关闭'
  });
};

// 获取状态文本
const getStatusText = (status) => {
  const statusMap = {
    pending: '待处理',
    escrowed: '托管中',
    completed: '已完成',
    refunded: '已退款',
    cancelled: '已取消',
    disputed: '争议中'
  };
  return statusMap[status] || status;
};

// 确认收货
const handleConfirmDelivery = async (transaction) => {
  try {
    await tradeStore.confirmDelivery(transaction.id);
    message.success('已确认收货');
    await loadTransactions();
  } catch (error) {
    logger.error('[TransactionList] 确认收货失败:', error);
    message.error(error.message || '确认收货失败');
  }
};

// 申请退款
const handleRequestRefund = async (transaction) => {
  try {
    await tradeStore.requestRefund(transaction.id, '买家申请退款');
    message.success('已申请退款');
    await loadTransactions();
  } catch (error) {
    logger.error('[TransactionList] 申请退款失败:', error);
    message.error(error.message || '申请退款失败');
  }
};

// 获取当前用户 DID
const loadCurrentUserDid = async () => {
  try {
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentUserDid.value = identity.did;
    }
  } catch (error) {
    logger.error('[TransactionList] 获取当前用户 DID 失败:', error);
  }
};

// 生命周期
onMounted(async () => {
  await loadCurrentUserDid();
  await loadTransactions();
});
</script>

<style scoped>
.transaction-list {
  padding: 20px;
}

.order-info-cell {
  font-size: 13px;
}

.order-title {
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
  color: #52c41a;
  margin-bottom: 2px;
}

.quantity {
  font-size: 12px;
  color: #8c8c8c;
}

:deep(.ant-table-cell) {
  vertical-align: middle;
}
</style>
