<template>
  <a-modal
    :open="open"
    :width="980"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="命令日志"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <FileTextOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="cl-toolbar">
      <span class="cl-sub">远程命令执行日志与统计</span>
      <a-space>
        <a-button size="small" @click="refreshData">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button size="small" @click="exportModal.visible = true">
          <template #icon><DownloadOutlined /></template>
          导出
        </a-button>
        <a-switch
          v-model:checked="autoRefresh"
          checked-children="自动"
          un-checked-children="手动"
          @change="toggleAutoRefresh"
        />
      </a-space>
    </div>

    <a-row :gutter="16" class="cl-stats">
      <a-col :span="6">
        <a-statistic
          title="总命令数"
          :value="rt.totalCommands"
          :loading="loading.stats"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="成功率"
          :value="rt.successRate"
          suffix="%"
          :value-style="{ color: '#3f8600' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="失败命令"
          :value="rt.failureCount"
          :value-style="{ color: '#cf1322' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="平均耗时" :value="rt.avgDuration" suffix="ms" />
      </a-col>
    </a-row>

    <a-card size="small" title="命令日志" :loading="loading.logs">
      <template #extra>
        <a-space>
          <a-input-search
            v-model:value="searchQuery"
            placeholder="搜索（设备/命令/错误）"
            style="width: 220px"
            @search="handleSearch"
          />
          <a-select
            v-model:value="filter.namespace"
            style="width: 110px"
            placeholder="命名空间"
            allow-clear
            @change="handleFilterChange"
          >
            <a-select-option value="ai">AI 命令</a-select-option>
            <a-select-option value="system">系统命令</a-select-option>
          </a-select>
          <a-select
            v-model:value="filter.status"
            style="width: 90px"
            placeholder="状态"
            allow-clear
            @change="handleFilterChange"
          >
            <a-select-option value="success">成功</a-select-option>
            <a-select-option value="failure">失败</a-select-option>
            <a-select-option value="warning">警告</a-select-option>
          </a-select>
        </a-space>
      </template>

      <a-table
        :columns="logColumns"
        :data-source="logs"
        :pagination="pagination"
        :loading="loading.logs"
        row-key="id"
        size="small"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'command'">
            <a-tag color="blue">{{ record.namespace }}</a-tag>
            <span style="font-weight: 500">{{ record.action }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">
              {{ statusText(record.status) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'device'">
            <a-tooltip :title="record.deviceDid">
              {{ truncate(record.deviceDid, 20) }}
            </a-tooltip>
          </template>
          <template v-else-if="column.key === 'duration'">
            <a-tag :color="durationColor(record.duration)">
              {{ record.duration }}ms
            </a-tag>
          </template>
          <template v-else-if="column.key === 'timestamp'">
            {{ formatTime(record.timestamp) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button type="link" size="small" @click="viewDetail(record)">
              详情
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>

    <p class="panel-desc">
      快速查看 / 搜索 /
      导出命令日志；执行趋势、状态分布、命令排行、设备活跃度等图表仍在 V5
      完整页（菜单「命令日志」），后续 phase 迁入。
    </p>

    <!-- detail modal -->
    <a-modal
      v-model:open="detail.visible"
      title="日志详情"
      :width="760"
      :footer="null"
    >
      <a-descriptions v-if="detail.log" bordered :column="2" size="small">
        <a-descriptions-item label="请求 ID" :span="2">
          {{ detail.log.requestId }}
        </a-descriptions-item>
        <a-descriptions-item label="设备 DID" :span="2">
          {{ detail.log.deviceDid }}
        </a-descriptions-item>
        <a-descriptions-item label="命令">
          {{ detail.log.namespace }}.{{ detail.log.action }}
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="statusColor(detail.log.status)">
            {{ statusText(detail.log.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="执行耗时">
          {{ detail.log.duration }}ms
        </a-descriptions-item>
        <a-descriptions-item label="时间">
          {{ formatTime(detail.log.timestamp) }}
        </a-descriptions-item>
        <a-descriptions-item label="参数" :span="2">
          <pre class="cl-pre">{{ formatJSON(detail.log.params) }}</pre>
        </a-descriptions-item>
        <a-descriptions-item v-if="detail.log.result" label="结果" :span="2">
          <pre class="cl-pre">{{ formatJSON(detail.log.result) }}</pre>
        </a-descriptions-item>
        <a-descriptions-item v-if="detail.log.error" label="错误" :span="2">
          <a-alert :message="detail.log.error" type="error" show-icon />
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- export modal -->
    <a-modal
      v-model:open="exportModal.visible"
      title="导出日志"
      :confirm-loading="exportModal.loading"
      @ok="handleExport"
    >
      <a-form layout="vertical">
        <a-form-item label="导出格式">
          <a-radio-group v-model:value="exportModal.format">
            <a-radio value="json">JSON</a-radio>
            <a-radio value="csv">CSV</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="时间范围">
          <a-range-picker v-model:value="exportModal.timeRange" show-time />
        </a-form-item>
        <a-form-item label="最大条数">
          <a-input-number
            v-model:value="exportModal.limit"
            :min="1"
            :max="10000"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import {
  ReloadOutlined,
  DownloadOutlined,
  FileTextOutlined,
} from "@ant-design/icons-vue";
import dayjs from "dayjs";

interface LogRow {
  id: string;
  requestId?: string;
  deviceDid?: string;
  namespace?: string;
  action?: string;
  status?: string;
  duration?: number;
  timestamp?: number;
  params?: unknown;
  result?: unknown;
  error?: string;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const w = window as unknown as {
    electronAPI?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> };
    electron?: {
      ipcRenderer?: {
        invoke?: (c: string, ...a: unknown[]) => Promise<unknown>;
      };
    };
  };
  const fn = w.electronAPI?.invoke || w.electron?.ipcRenderer?.invoke;
  return fn
    ? fn(channel, ...args)
    : Promise.reject(new Error("IPC unavailable"));
}

const loading = reactive({ logs: false, stats: false });
const rt = reactive({
  totalCommands: 0,
  successCount: 0,
  failureCount: 0,
  warningCount: 0,
  successRate: 0,
  avgDuration: 0,
});

const logs = ref<LogRow[]>([]);
const searchQuery = ref("");
const filter = reactive<{ namespace?: string; status?: string }>({
  namespace: undefined,
  status: undefined,
});
const pagination = reactive({
  current: 1,
  pageSize: 10,
  total: 0,
  showTotal: (t: number) => `共 ${t} 条`,
});

const autoRefresh = ref(false);
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

const detail = reactive<{ visible: boolean; log: LogRow | null }>({
  visible: false,
  log: null,
});
const exportModal = reactive<{
  visible: boolean;
  loading: boolean;
  format: string;
  timeRange: unknown;
  limit: number;
}>({
  visible: false,
  loading: false,
  format: "json",
  timeRange: null,
  limit: 1000,
});

const logColumns = [
  { title: "命令", key: "command", width: 150 },
  { title: "状态", key: "status", width: 90 },
  { title: "设备", key: "device", width: 180 },
  { title: "耗时", key: "duration", width: 90 },
  { title: "时间", key: "timestamp", width: 160 },
  { title: "操作", key: "action", width: 80 },
];

async function fetchDashboard(): Promise<void> {
  loading.stats = true;
  try {
    const res = await invoke("remote:logs:dashboard", { days: 7 });
    if (res?.success && res.data?.realTime) {
      Object.assign(rt, res.data.realTime);
    }
  } catch {
    /* best-effort stats */
  } finally {
    loading.stats = false;
  }
}

async function fetchLogs(): Promise<void> {
  loading.logs = true;
  try {
    const res = await invoke("remote:logs:query", {
      page: pagination.current,
      pageSize: pagination.pageSize,
      search: searchQuery.value || undefined,
      namespace: filter.namespace,
      status: filter.status,
    });
    if (res?.success) {
      logs.value = res.data.logs || [];
      pagination.total = res.data.total || 0;
    } else {
      message.error("获取日志失败：" + (res?.error || ""));
    }
  } catch (e: unknown) {
    message.error(
      "获取日志失败：" + (e instanceof Error ? e.message : String(e)),
    );
  } finally {
    loading.logs = false;
  }
}

function refreshData(): void {
  fetchDashboard();
  fetchLogs();
}

function stopAutoRefresh(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}
function toggleAutoRefresh(enabled: boolean): void {
  stopAutoRefresh();
  if (enabled) {
    autoRefreshTimer = setInterval(refreshData, 10000);
  }
}

function handleSearch(): void {
  pagination.current = 1;
  fetchLogs();
}
function handleFilterChange(): void {
  pagination.current = 1;
  fetchLogs();
}
function handleTableChange(pag: { current: number; pageSize: number }): void {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
  fetchLogs();
}

function viewDetail(log: LogRow): void {
  detail.log = log;
  detail.visible = true;
}

async function handleExport(): Promise<void> {
  exportModal.loading = true;
  try {
    const options: Record<string, unknown> = {
      format: exportModal.format,
      limit: exportModal.limit,
    };
    const tr = exportModal.timeRange as { valueOf: () => number }[] | null;
    if (tr && tr.length === 2) {
      options.startTime = tr[0].valueOf();
      options.endTime = tr[1].valueOf();
    }
    const res = await invoke("remote:logs:export", options);
    if (res?.success) {
      message.success(`已导出 ${res.data.count} 条到：${res.data.filePath}`);
      exportModal.visible = false;
    } else {
      message.error("导出失败：" + (res?.error || ""));
    }
  } catch (e: unknown) {
    message.error("导出失败：" + (e instanceof Error ? e.message : String(e)));
  } finally {
    exportModal.loading = false;
  }
}

function statusColor(s?: string): string {
  return (
    { success: "success", failure: "error", warning: "warning" }[s || ""] ||
    "default"
  );
}
function statusText(s?: string): string {
  return (
    { success: "成功", failure: "失败", warning: "警告" }[s || ""] || s || ""
  );
}
function durationColor(d?: number): string {
  if ((d ?? 0) < 500) {
    return "success";
  }
  if ((d ?? 0) < 2000) {
    return "warning";
  }
  return "error";
}
function truncate(str?: string, maxLen = 20): string {
  if (!str) {
    return "";
  }
  return str.length <= maxLen ? str : str.slice(0, maxLen) + "…";
}
function formatTime(ts?: number): string {
  return ts ? dayjs(ts).format("YYYY-MM-DD HH:mm:ss") : "—";
}
function formatJSON(data: unknown): string {
  if (!data) {
    return "";
  }
  if (typeof data === "string") {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  return JSON.stringify(data, null, 2);
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      refreshData();
    } else {
      autoRefresh.value = false;
      stopAutoRefresh();
    }
  },
  { immediate: true },
);

onUnmounted(stopAutoRefresh);
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
.cl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.cl-sub {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.cl-stats {
  margin-bottom: 16px;
}
.cl-pre {
  max-height: 200px;
  overflow: auto;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  margin: 0;
  font-size: 12px;
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
