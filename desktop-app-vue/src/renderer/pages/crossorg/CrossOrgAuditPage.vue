<template>
  <div class="cross-org-audit-page">
    <a-page-header title="跨组织审计日志" sub-title="查看所有跨组织操作记录">
      <template #extra>
        <a-button @click="exportLogs">
          <template #icon>
            <DownloadOutlined />
          </template>
          导出日志
        </a-button>
      </template>
    </a-page-header>

    <!-- 筛选器 -->
    <a-card class="filter-card" size="small">
      <a-form layout="inline">
        <a-form-item label="操作类型">
          <a-select
            v-model:value="filters.action"
            placeholder="全部"
            allow-clear
            style="width: 150px"
          >
            <a-select-option value="partnership_created">
              创建合作
            </a-select-option>
            <a-select-option value="partnership_accepted">
              接受合作
            </a-select-option>
            <a-select-option value="partnership_terminated">
              终止合作
            </a-select-option>
            <a-select-option value="resource_shared">
              共享资源
            </a-select-option>
            <a-select-option value="resource_accessed">
              访问资源
            </a-select-option>
            <a-select-option value="transaction_initiated">
              发起交易
            </a-select-option>
            <a-select-option value="transaction_completed">
              完成交易
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="合作伙伴">
          <a-select
            v-model:value="filters.partnerOrgId"
            placeholder="全部"
            allow-clear
            style="width: 150px"
          >
            <a-select-option
              v-for="partner in partnerOrgs"
              :key="partner.orgId"
              :value="partner.orgId"
            >
              {{ partner.orgName }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="时间范围">
          <a-range-picker v-model:value="filters.dateRange" />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" @click="searchLogs"> 查询 </a-button>
            <a-button @click="resetFilters"> 重置 </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 日志列表 -->
    <a-card title="审计日志">
      <a-table
        :columns="columns"
        :data-source="auditLogs"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-tag :color="getActionColor(record.action)">
              {{ getActionLabel(record.action) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'details'">
            <a-button type="link" size="small" @click="viewDetails(record)">
              查看详情
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 详情对话框 -->
    <a-modal
      v-model:open="showDetails"
      title="审计详情"
      :footer="null"
      width="600px"
    >
      <template v-if="selectedLog">
        <a-descriptions :column="1" bordered>
          <a-descriptions-item label="操作ID">
            {{ selectedLog.id }}
          </a-descriptions-item>
          <a-descriptions-item label="操作类型">
            <a-tag :color="getActionColor(selectedLog.action)">
              {{ getActionLabel(selectedLog.action) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="操作者">
            {{ selectedLog.actorDid }}
          </a-descriptions-item>
          <a-descriptions-item label="源组织">
            {{ selectedLog.sourceOrgId }}
          </a-descriptions-item>
          <a-descriptions-item label="目标组织">
            {{ selectedLog.targetOrgId }}
          </a-descriptions-item>
          <a-descriptions-item label="资源类型">
            {{ selectedLog.resourceType || "-" }}
          </a-descriptions-item>
          <a-descriptions-item label="资源ID">
            {{ selectedLog.resourceId || "-" }}
          </a-descriptions-item>
          <a-descriptions-item label="IP地址">
            {{ selectedLog.ipAddress || "-" }}
          </a-descriptions-item>
          <a-descriptions-item label="时间">
            {{ formatTime(selectedLog.createdAt) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider />

        <h4>详细信息</h4>
        <a-typography-paragraph>
          <pre>{{ JSON.stringify(selectedLog.details, null, 2) }}</pre>
        </a-typography-paragraph>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { DownloadOutlined } from "@ant-design/icons-vue";
import { useCrossOrgStore } from "@/stores/crossOrg";
import { useAuthStore } from "@/stores/auth";
import dayjs from "dayjs";

const crossOrgStore = useCrossOrgStore();
const authStore = useAuthStore();

const loading = ref(false);
const showDetails = ref(false);
const selectedLog = ref(null);

const auditLogs = computed(() => crossOrgStore.auditLogs);
const partnerOrgs = computed(() => crossOrgStore.partnerOrgs);

const filters = ref({
  action: null,
  partnerOrgId: null,
  dateRange: null,
});

const pagination = ref({
  current: 1,
  pageSize: 20,
  total: 0,
});

const columns = [
  {
    title: "时间",
    dataIndex: "createdAt",
    key: "time",
    customRender: ({ text }) => formatTime(text),
    width: 180,
  },
  { title: "操作", key: "action", width: 150 },
  { title: "操作者", dataIndex: "actorDid", key: "actor", ellipsis: true },
  { title: "源组织", dataIndex: "sourceOrgId", key: "source", ellipsis: true },
  {
    title: "目标组织",
    dataIndex: "targetOrgId",
    key: "target",
    ellipsis: true,
  },
  { title: "资源", dataIndex: "resourceType", key: "resource" },
  { title: "详情", key: "details" },
];

const formatTime = (timestamp) =>
  dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");

const getActionColor = (action) => {
  const colors = {
    partnership_created: "blue",
    partnership_accepted: "green",
    partnership_terminated: "red",
    resource_shared: "purple",
    resource_accessed: "cyan",
    transaction_initiated: "orange",
    transaction_completed: "green",
    transaction_rejected: "red",
  };
  return colors[action] || "default";
};

const getActionLabel = (action) => {
  const labels = {
    partnership_created: "创建合作",
    partnership_accepted: "接受合作",
    partnership_rejected: "拒绝合作",
    partnership_terminated: "终止合作",
    trust_level_changed: "调整信任级别",
    resource_shared: "共享资源",
    resource_unshared: "取消共享",
    resource_accessed: "访问资源",
    share_permissions_updated: "更新共享权限",
    transaction_initiated: "发起交易",
    transaction_accepted: "接受交易",
    transaction_completed: "完成交易",
    transaction_rejected: "拒绝交易",
  };
  return labels[action] || action;
};

const searchLogs = async () => {
  loading.value = true;
  try {
    const options = {};
    if (filters.value.action) {
      options.action = filters.value.action;
    }
    if (filters.value.partnerOrgId) {
      options.partnerOrgId = filters.value.partnerOrgId;
    }
    if (filters.value.dateRange) {
      options.dateFrom = filters.value.dateRange[0].valueOf();
      options.dateTo = filters.value.dateRange[1].valueOf();
    }
    options.limit = pagination.value.pageSize;

    await crossOrgStore.loadAuditLog(authStore.currentOrg?.id, options);
  } finally {
    loading.value = false;
  }
};

const resetFilters = () => {
  filters.value = { action: null, partnerOrgId: null, dateRange: null };
  searchLogs();
};

const handleTableChange = (pag) => {
  pagination.value.current = pag.current;
  pagination.value.pageSize = pag.pageSize;
  searchLogs();
};

const viewDetails = (log) => {
  selectedLog.value = log;
  showDetails.value = true;
};

const exportLogs = () => {
  const data = JSON.stringify(auditLogs.value, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-logs-${dayjs().format("YYYY-MM-DD")}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.success("导出成功");
};

onMounted(async () => {
  await Promise.all([
    searchLogs(),
    crossOrgStore.loadPartnerOrgs(authStore.currentOrg?.id),
  ]);
});
</script>

<style scoped>
.cross-org-audit-page {
  padding: 0 24px 24px;
}

.filter-card {
  margin-bottom: 16px;
}

pre {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}
</style>
