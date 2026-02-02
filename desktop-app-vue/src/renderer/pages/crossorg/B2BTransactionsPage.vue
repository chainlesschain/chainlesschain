<template>
  <div class="b2b-transactions-page">
    <a-page-header title="B2B 数据交换" sub-title="管理跨组织数据交易">
      <template #extra>
        <a-button type="primary" @click="showInitiate = true">
          <template #icon><SwapOutlined /></template>
          发起交易
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" class="stats-row">
      <a-col :span="6">
        <a-card>
          <a-statistic title="发出交易" :value="stats.outgoingCount" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic title="收到交易" :value="stats.incomingCount" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic title="待处理" :value="stats.pendingCount" :value-style="{ color: '#faad14' }" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card>
          <a-statistic title="已完成" :value="stats.completedCount" :value-style="{ color: '#52c41a' }" />
        </a-card>
      </a-col>
    </a-row>

    <a-card title="交易列表">
      <template #extra>
        <a-radio-group v-model:value="transactionFilter" button-style="solid" size="small">
          <a-radio-button value="all">全部</a-radio-button>
          <a-radio-button value="incoming">收到</a-radio-button>
          <a-radio-button value="outgoing">发出</a-radio-button>
          <a-radio-button value="pending">待处理</a-radio-button>
        </a-radio-group>
      </template>

      <a-table
        :columns="columns"
        :data-source="filteredTransactions"
        :loading="loading"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'direction'">
            <a-tag :color="record.senderOrgId === currentOrgId ? 'blue' : 'green'">
              {{ record.senderOrgId === currentOrgId ? '发出' : '收到' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="getStatusColor(record.status)">
              {{ getStatusLabel(record.status) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <template v-if="record.status === 'pending' && record.receiverOrgId === currentOrgId">
                <a-button type="primary" size="small" @click="acceptTransaction(record.id)">
                  接受
                </a-button>
                <a-button danger size="small" @click="rejectTransaction(record.id)">
                  拒绝
                </a-button>
              </template>
              <a-button type="link" size="small" @click="viewDetails(record)">
                详情
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 发起交易对话框 -->
    <a-modal
      v-model:open="showInitiate"
      title="发起数据交易"
      @ok="handleInitiate"
      :confirm-loading="initiating"
    >
      <a-form :model="initiateForm" layout="vertical">
        <a-form-item label="接收组织" required>
          <a-select v-model:value="initiateForm.receiverOrgId" placeholder="选择合作伙伴">
            <a-select-option v-for="partner in partnerOrgs" :key="partner.orgId" :value="partner.orgId">
              {{ partner.orgName }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="交易类型">
          <a-select v-model:value="initiateForm.transactionType">
            <a-select-option value="data_transfer">数据传输</a-select-option>
            <a-select-option value="data_sync">数据同步</a-select-option>
            <a-select-option value="api_access">API访问</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="数据类型">
          <a-input v-model:value="initiateForm.dataType" placeholder="例如: customer_data, reports" />
        </a-form-item>
        <a-form-item label="数据大小 (字节)">
          <a-input-number v-model:value="initiateForm.dataSize" :min="0" style="width: 100%" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="initiateForm.notes" placeholder="交易说明..." />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 交易详情对话框 -->
    <a-modal v-model:open="showDetails" :title="`交易详情 - ${selectedTransaction?.id}`" :footer="null" width="600px">
      <template v-if="selectedTransaction">
        <a-descriptions :column="2" bordered>
          <a-descriptions-item label="发送方">{{ selectedTransaction.senderOrgId }}</a-descriptions-item>
          <a-descriptions-item label="接收方">{{ selectedTransaction.receiverOrgId }}</a-descriptions-item>
          <a-descriptions-item label="交易类型">{{ selectedTransaction.transactionType }}</a-descriptions-item>
          <a-descriptions-item label="数据类型">{{ selectedTransaction.dataType }}</a-descriptions-item>
          <a-descriptions-item label="数据大小">{{ formatSize(selectedTransaction.dataSize) }}</a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="getStatusColor(selectedTransaction.status)">
              {{ getStatusLabel(selectedTransaction.status) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="数据哈希" :span="2">
            <a-typography-paragraph copyable :content="selectedTransaction.dataHash">
              {{ selectedTransaction.dataHash?.substring(0, 32) }}...
            </a-typography-paragraph>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ formatTime(selectedTransaction.createdAt) }}</a-descriptions-item>
          <a-descriptions-item label="完成时间">{{ selectedTransaction.completedAt ? formatTime(selectedTransaction.completedAt) : '-' }}</a-descriptions-item>
        </a-descriptions>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { SwapOutlined } from '@ant-design/icons-vue';
import { useCrossOrgStore } from '@/stores/crossOrg';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const crossOrgStore = useCrossOrgStore();
const authStore = useAuthStore();

const currentOrgId = computed(() => authStore.currentOrg?.id);
const loading = ref(false);
const initiating = ref(false);
const showInitiate = ref(false);
const showDetails = ref(false);
const transactionFilter = ref('all');
const selectedTransaction = ref(null);

const transactions = computed(() => crossOrgStore.transactions);
const partnerOrgs = computed(() => crossOrgStore.partnerOrgs);

const filteredTransactions = computed(() => {
  if (transactionFilter.value === 'all') return transactions.value;
  if (transactionFilter.value === 'incoming') return transactions.value.filter(t => t.receiverOrgId === currentOrgId.value);
  if (transactionFilter.value === 'outgoing') return transactions.value.filter(t => t.senderOrgId === currentOrgId.value);
  if (transactionFilter.value === 'pending') return transactions.value.filter(t => t.status === 'pending');
  return transactions.value;
});

const stats = computed(() => ({
  outgoingCount: transactions.value.filter(t => t.senderOrgId === currentOrgId.value).length,
  incomingCount: transactions.value.filter(t => t.receiverOrgId === currentOrgId.value).length,
  pendingCount: transactions.value.filter(t => t.status === 'pending').length,
  completedCount: transactions.value.filter(t => t.status === 'completed').length,
}));

const initiateForm = ref({
  receiverOrgId: '',
  transactionType: 'data_transfer',
  dataType: '',
  dataSize: 0,
  notes: '',
});

const columns = [
  { title: '方向', key: 'direction', width: 80 },
  { title: '对方组织', dataIndex: 'receiverOrgId', key: 'partner' },
  { title: '交易类型', dataIndex: 'transactionType', key: 'type' },
  { title: '数据类型', dataIndex: 'dataType', key: 'dataType' },
  { title: '状态', key: 'status' },
  { title: '时间', dataIndex: 'createdAt', key: 'time', customRender: ({ text }) => formatTime(text) },
  { title: '操作', key: 'action' },
];

const formatTime = (timestamp) => dayjs(timestamp).format('YYYY-MM-DD HH:mm');
const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getStatusColor = (status) => {
  const colors = { pending: 'orange', accepted: 'blue', completed: 'green', rejected: 'red', failed: 'gray' };
  return colors[status] || 'default';
};

const getStatusLabel = (status) => {
  const labels = { pending: '待处理', accepted: '已接受', completed: '已完成', rejected: '已拒绝', failed: '失败' };
  return labels[status] || status;
};

const acceptTransaction = async (transactionId) => {
  try {
    await crossOrgStore.acceptTransaction(transactionId, authStore.currentUser?.did);
    message.success('已接受');
  } catch (error) {
    message.error('操作失败');
  }
};

const rejectTransaction = async (transactionId) => {
  try {
    await crossOrgStore.rejectTransaction(transactionId, authStore.currentUser?.did);
    message.success('已拒绝');
  } catch (error) {
    message.error('操作失败');
  }
};

const viewDetails = (transaction) => {
  selectedTransaction.value = transaction;
  showDetails.value = true;
};

const handleInitiate = async () => {
  if (!initiateForm.value.receiverOrgId || !initiateForm.value.dataType) {
    message.warning('请填写必要信息');
    return;
  }

  initiating.value = true;
  try {
    await crossOrgStore.initiateTransaction({
      senderOrgId: currentOrgId.value,
      ...initiateForm.value,
      initiatedByDid: authStore.currentUser?.did,
    });
    message.success('交易已发起');
    showInitiate.value = false;
  } catch (error) {
    message.error('发起失败');
  } finally {
    initiating.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([
      crossOrgStore.loadTransactions(currentOrgId.value),
      crossOrgStore.loadPartnerOrgs(currentOrgId.value),
    ]);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.b2b-transactions-page {
  padding: 0 24px 24px;
}

.stats-row {
  margin-bottom: 24px;
}
</style>
