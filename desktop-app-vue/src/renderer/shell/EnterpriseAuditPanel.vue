<template>
  <a-modal
    :open="open"
    :width="1080"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="企业审计日志"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <FileSearchOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="ea-toolbar">
      <span class="ea-subtitle">查看和分析企业操作审计记录</span>
      <a-button
        type="primary"
        size="small"
        :loading="exporting"
        @click="handleExport"
      >
        <template #icon><ExportOutlined /></template>
        导出日志
      </a-button>
    </div>

    <a-card :bordered="false" class="filter-card" size="small">
      <a-row :gutter="[12, 12]" align="middle">
        <a-col :span="5">
          <a-select
            v-model:value="filters.eventType"
            placeholder="事件类型"
            style="width: 100%"
            allow-clear
            @change="handleFilterChange"
          >
            <a-select-option value="">全部</a-select-option>
            <a-select-option value="login">登录</a-select-option>
            <a-select-option value="permission_change">
              权限变更
            </a-select-option>
            <a-select-option value="data_access">数据访问</a-select-option>
            <a-select-option value="data_modify">数据修改</a-select-option>
            <a-select-option value="data_delete">数据删除</a-select-option>
            <a-select-option value="config_change">配置变更</a-select-option>
            <a-select-option value="export">数据导出</a-select-option>
            <a-select-option value="system">系统事件</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="4">
          <a-select
            v-model:value="filters.riskLevel"
            placeholder="风险等级"
            style="width: 100%"
            allow-clear
            @change="handleFilterChange"
          >
            <a-select-option value="">全部</a-select-option>
            <a-select-option value="low">低风险</a-select-option>
            <a-select-option value="medium">中风险</a-select-option>
            <a-select-option value="high">高风险</a-select-option>
            <a-select-option value="critical">严重</a-select-option>
          </a-select>
        </a-col>
        <a-col :span="7">
          <a-range-picker
            v-model:value="filters.dateRange"
            style="width: 100%"
            :placeholder="['开始日期', '结束日期']"
            @change="handleFilterChange"
          />
        </a-col>
        <a-col :span="5">
          <a-input
            v-model:value="filters.actor"
            placeholder="搜索操作者 DID"
            allow-clear
            @press-enter="handleSearch"
          />
        </a-col>
        <a-col :span="3">
          <a-button type="primary" style="width: 100%" @click="handleSearch">
            <template #icon><SearchOutlined /></template>
            搜索
          </a-button>
        </a-col>
      </a-row>
    </a-card>

    <a-row :gutter="16" class="stats-row">
      <a-col :span="6">
        <a-statistic
          title="总日志数"
          :value="stats.totalLogs"
          :value-style="{ color: '#1890ff' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="严重事件"
          :value="stats.criticalCount"
          :value-style="{ color: '#cf1322' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="高风险操作"
          :value="stats.highRiskCount"
          :value-style="{ color: '#fa8c16' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="已拦截操作"
          :value="stats.blockedCount"
          :value-style="{ color: '#722ed1' }"
        />
      </a-col>
    </a-row>

    <a-table
      :columns="columns"
      :data-source="auditStore.logs"
      :loading="auditStore.loading"
      :pagination="false"
      row-key="id"
      size="small"
      :scroll="{ x: 1000 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'timestamp'">
          {{ formatTime(record.timestamp) }}
        </template>
        <template v-else-if="column.key === 'event_type'">
          <a-tag :color="getEventTypeColor(record.event_type)">
            {{ getEventTypeLabel(record.event_type) }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'actor_did'">
          <a-tooltip :title="record.actor_did">
            {{ truncateDid(record.actor_did) }}
          </a-tooltip>
        </template>
        <template v-else-if="column.key === 'risk_level'">
          <a-tag :color="getRiskLevelColor(record.risk_level)">
            {{ getRiskLevelLabel(record.risk_level) }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'outcome'">
          <a-tag :color="getOutcomeColor(record.outcome)">
            {{ getOutcomeLabel(record.outcome) }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="showDetail(record)">
            详情
          </a-button>
        </template>
      </template>
    </a-table>

    <div class="pagination-wrapper">
      <a-pagination
        v-model:current="currentPage"
        v-model:page-size="pageSize"
        :total="auditStore.totalLogs"
        size="small"
        show-size-changer
        show-quick-jumper
        :show-total="(total: number) => `共 ${total} 条`"
        @change="handlePageChange"
        @show-size-change="handlePageSizeChange"
      />
    </div>

    <a-modal
      v-model:open="detailVisible"
      title="审计日志详情"
      width="700px"
      :footer="null"
    >
      <a-descriptions v-if="selectedLog" :column="2" bordered size="small">
        <a-descriptions-item label="日志ID" :span="2">
          {{ selectedLog.id }}
        </a-descriptions-item>
        <a-descriptions-item label="时间戳" :span="2">
          {{ formatTime(selectedLog.timestamp) }}
        </a-descriptions-item>
        <a-descriptions-item label="事件类型">
          <a-tag :color="getEventTypeColor(selectedLog.event_type)">
            {{ getEventTypeLabel(selectedLog.event_type) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="风险等级">
          <a-tag :color="getRiskLevelColor(selectedLog.risk_level)">
            {{ getRiskLevelLabel(selectedLog.risk_level) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="操作者 DID" :span="2">
          {{ selectedLog.actor_did }}
        </a-descriptions-item>
        <a-descriptions-item label="操作" :span="2">
          {{ selectedLog.operation }}
        </a-descriptions-item>
        <a-descriptions-item label="结果">
          <a-tag :color="getOutcomeColor(selectedLog.outcome)">
            {{ getOutcomeLabel(selectedLog.outcome) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="IP 地址">
          {{ selectedLog.ip_address || "-" }}
        </a-descriptions-item>
        <a-descriptions-item label="详细信息" :span="2">
          <pre class="detail-json">{{
            formatDetails(selectedLog.details)
          }}</pre>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  ExportOutlined,
  SearchOutlined,
  FileSearchOutlined,
} from "@ant-design/icons-vue";
import { useAuditStore } from "../stores/audit";
import {
  formatTime,
  truncateDid,
  formatDetails,
  getEventTypeColor,
  getEventTypeLabel,
  getRiskLevelColor,
  getRiskLevelLabel,
  getOutcomeColor,
  getOutcomeLabel,
} from "./enterpriseAuditPanelUtils";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const auditStore = useAuditStore();

const filters = reactive({
  eventType: "" as string,
  riskLevel: "" as string,
  dateRange: null as any,
  actor: "" as string,
});

const currentPage = ref(1);
const pageSize = ref(20);
const exporting = ref(false);
const detailVisible = ref(false);
const selectedLog = ref<any>(null);

// Derive stat cards from the store's real AuditStatistics shape
// ({ totalLogs, byEventType, byRiskLevel, byOutcome }).
const stats = computed(() => {
  const s = auditStore.statistics;
  return {
    totalLogs: s?.totalLogs ?? 0,
    criticalCount: s?.byRiskLevel?.critical ?? 0,
    highRiskCount: s?.byRiskLevel?.high ?? 0,
    blockedCount: s?.byOutcome?.blocked ?? 0,
  };
});

const columns = [
  {
    title: "时间",
    key: "timestamp",
    dataIndex: "timestamp",
    width: 170,
    sorter: (a: any, b: any) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  },
  { title: "事件类型", key: "event_type", dataIndex: "event_type", width: 120 },
  {
    title: "操作者",
    key: "actor_did",
    dataIndex: "actor_did",
    width: 170,
    ellipsis: true,
  },
  { title: "操作", key: "operation", dataIndex: "operation", ellipsis: true },
  { title: "风险等级", key: "risk_level", dataIndex: "risk_level", width: 90 },
  { title: "结果", key: "outcome", dataIndex: "outcome", width: 90 },
  { title: "详情", key: "actions", width: 70, fixed: "right" as const },
];

async function fetchLogs() {
  const params: Record<string, any> = {
    page: currentPage.value,
    pageSize: pageSize.value,
  };
  if (filters.eventType) {
    params.eventType = filters.eventType;
  }
  if (filters.riskLevel) {
    params.riskLevel = filters.riskLevel;
  }
  if (filters.dateRange && filters.dateRange.length === 2) {
    params.startTime = filters.dateRange[0].valueOf();
    params.endTime = filters.dateRange[1].valueOf();
  }
  if (filters.actor) {
    params.actor = filters.actor;
  }
  await auditStore.fetchLogs(params);
}

async function fetchStatistics() {
  try {
    await auditStore.fetchStatistics();
  } catch (error) {
    console.error("[EnterpriseAuditPanel] 获取统计信息失败:", error);
  }
}

function handleFilterChange() {
  currentPage.value = 1;
  fetchLogs();
}

function handleSearch() {
  currentPage.value = 1;
  fetchLogs();
}

function handlePageChange(page: number, size: number) {
  currentPage.value = page;
  pageSize.value = size;
  fetchLogs();
}

function handlePageSizeChange(_current: number, size: number) {
  currentPage.value = 1;
  pageSize.value = size;
  fetchLogs();
}

async function handleExport() {
  exporting.value = true;
  try {
    await auditStore.exportLogs({
      eventType: filters.eventType || undefined,
      riskLevel: filters.riskLevel || undefined,
      actorDid: filters.actor || undefined,
    });
    message.success("审计日志导出成功");
  } catch (error) {
    console.error("[EnterpriseAuditPanel] 导出失败:", error);
    message.error("导出失败");
  } finally {
    exporting.value = false;
  }
}

function showDetail(record: any) {
  selectedLog.value = record;
  detailVisible.value = true;
}

// Load logs + statistics on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      fetchLogs();
      fetchStatistics();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.ea-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ea-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.filter-card {
  margin-bottom: 16px;
}
.stats-row {
  margin-bottom: 16px;
  text-align: center;
}
.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.detail-json {
  margin: 0;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 4px;
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
