<template>
  <a-modal
    :open="open"
    :width="1000"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="错误监控仪表板"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BugOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="em-toolbar">
      <span class="em-sub">AI 智能诊断、自动修复和错误分析</span>
      <a-button size="small" :loading="loading" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-row :gutter="16" class="em-stats">
      <a-col :span="6">
        <a-statistic title="总错误数" :value="stats.total || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="严重/高优先级"
          :value="
            (stats.bySeverity?.critical || 0) + (stats.bySeverity?.high || 0)
          "
          :value-style="{ color: '#cf1322' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="自动修复率"
          :value="stats.autoFixRate || 0"
          suffix="%"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="解决率"
          :value="stats.resolutionRate || 0"
          suffix="%"
        />
      </a-col>
    </a-row>

    <a-card size="small" title="错误分类" class="em-section">
      <a-list
        :data-source="classificationStats"
        :loading="loading"
        size="small"
        :grid="{ gutter: 8, column: 3 }"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-tag :color="classificationColor(item.classification)">
              {{ classLabel(item.classification) }}
            </a-tag>
            {{ item.count }}
            <span class="em-dim">
              （修复 {{ item.auto_fixed_count || 0 }}）
            </span>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <a-card size="small" title="错误历史" class="em-section">
      <template #extra>
        <a-space>
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索错误"
            style="width: 180px"
            @search="loadHistory"
          />
          <a-select
            v-model:value="filterSeverity"
            placeholder="严重程度"
            style="width: 110px"
            allow-clear
            @change="loadHistory"
          >
            <a-select-option value="critical">Critical</a-select-option>
            <a-select-option value="high">High</a-select-option>
            <a-select-option value="medium">Medium</a-select-option>
            <a-select-option value="low">Low</a-select-option>
          </a-select>
        </a-space>
      </template>

      <a-table
        :columns="columns"
        :data-source="historyList"
        :pagination="pagination"
        :loading="historyLoading"
        row-key="id"
        size="small"
        :scroll="{ x: 900 }"
        @change="handleTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'classification'">
            <a-tag :color="classificationColor(record.classification)">
              {{ classLabel(record.classification) }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'severity'">
            <a-tag :color="severityColor(record.severity)">
              {{ record.severity }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">
              {{ statusLabels[record.status] || record.status }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'auto_fix'">
            <a-tag :color="record.auto_fixed ? 'success' : 'default'">
              {{ record.auto_fixed ? "是" : "否" }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'created_at'">
            {{ formatTime(record.created_at) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="showDetail(record as ErrRow)"
              >
                详情
              </a-button>
              <a-button
                type="link"
                size="small"
                @click="reanalyze(record as ErrRow)"
              >
                重新分析
              </a-button>
              <a-popconfirm
                v-if="record.status !== 'fixed'"
                title="标记为已修复?"
                @confirm="markFixed(record as ErrRow)"
              >
                <a-button type="link" size="small">已修复</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <p class="panel-desc">
      错误统计 / 分类 / 历史浏览 / 重新分析 /
      诊断报告在本面板；趋势图表与高级配置仍在 V5
      完整页（菜单「错误监控」），后续 phase 迁入。
    </p>

    <!-- detail drawer -->
    <a-drawer
      :open="detailVisible"
      title="错误详情"
      placement="right"
      :width="420"
      @close="detailVisible = false"
    >
      <a-descriptions v-if="currentError" :column="1" size="small" bordered>
        <a-descriptions-item label="消息">
          {{ currentError.error_message }}
        </a-descriptions-item>
        <a-descriptions-item label="分类">
          {{ classLabel(currentError.classification) }}
        </a-descriptions-item>
        <a-descriptions-item label="严重程度">
          <a-tag :color="severityColor(currentError.severity)">
            {{ currentError.severity }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          {{ statusLabels[currentError.status] || currentError.status }}
        </a-descriptions-item>
        <a-descriptions-item label="时间">
          {{ formatTime(currentError.created_at) }}
        </a-descriptions-item>
        <a-descriptions-item v-if="currentError.stack_trace" label="堆栈">
          <pre class="em-pre">{{ currentError.stack_trace }}</pre>
        </a-descriptions-item>
      </a-descriptions>
      <a-button
        type="primary"
        block
        style="margin-top: 16px"
        @click="generateReport(currentError)"
      >
        生成诊断报告
      </a-button>
    </a-drawer>

    <!-- report modal -->
    <a-modal
      v-model:open="reportVisible"
      title="诊断报告"
      :width="760"
      ok-text="复制"
      cancel-text="关闭"
      @ok="copyReport"
    >
      <pre class="em-report">{{ reportContent }}</pre>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import { BugOutlined, ReloadOutlined } from "@ant-design/icons-vue";

interface ErrRow {
  id: string;
  error_id?: string;
  error_message?: string;
  classification?: string;
  severity?: string;
  status?: string;
  auto_fixed?: boolean;
  created_at?: number;
  stack_trace?: string;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const w = window as unknown as {
    electronAPI?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> };
  };
  return w.electronAPI?.invoke
    ? w.electronAPI.invoke(channel, ...args)
    : Promise.reject(new Error("IPC unavailable"));
}

const loading = ref(false);
const historyLoading = ref(false);
const stats = ref<{
  total?: number;
  bySeverity?: { critical?: number; high?: number };
  autoFixRate?: number | string;
  resolutionRate?: number | string;
}>({});
const classificationStats = ref<
  { classification: string; count: number; auto_fixed_count?: number }[]
>([]);
const historyList = ref<ErrRow[]>([]);
const searchKeyword = ref("");
const filterSeverity = ref<string | undefined>(undefined);
const pagination = reactive({
  current: 1,
  pageSize: 10,
  total: 0,
  showTotal: (t: number) => `共 ${t} 条`,
});

const detailVisible = ref(false);
const currentError = ref<ErrRow | null>(null);
const reportVisible = ref(false);
const reportContent = ref("");

const trendDays = 7;

const columns = [
  {
    title: "错误消息",
    dataIndex: "error_message",
    key: "error_message",
    ellipsis: true,
    width: 280,
  },
  { title: "分类", key: "classification", width: 110 },
  { title: "严重程度", key: "severity", width: 100 },
  { title: "状态", key: "status", width: 90 },
  { title: "自动修复", key: "auto_fix", width: 80, align: "center" as const },
  { title: "时间", key: "created_at", width: 150 },
  { title: "操作", key: "action", width: 180, fixed: "right" as const },
];

const statusLabels: Record<string, string> = {
  new: "新建",
  analyzing: "分析中",
  analyzed: "已分析",
  fixing: "修复中",
  fixed: "已修复",
  ignored: "已忽略",
};
const classLabels: Record<string, string> = {
  DATABASE: "数据库",
  NETWORK: "网络",
  FILESYSTEM: "文件系统",
  TIMEOUT: "超时",
  MEMORY: "内存",
  PERMISSION: "权限",
  LLM_API_ERROR: "LLM API",
  LLM_MODEL_ERROR: "模型错误",
  TYPE_ERROR: "类型错误",
  REFERENCE_ERROR: "引用错误",
  SYNTAX_ERROR: "语法错误",
  VALIDATION: "验证错误",
  UNKNOWN: "未知",
};

function classLabel(c?: string): string {
  return (c && classLabels[c]) || c || "未知";
}
function severityColor(s?: string): string {
  return (
    { critical: "red", high: "orange", medium: "gold", low: "green" }[
      s || ""
    ] || "default"
  );
}
function statusColor(s?: string): string {
  return (
    {
      new: "blue",
      analyzing: "processing",
      analyzed: "cyan",
      fixing: "orange",
      fixed: "success",
      ignored: "default",
    }[s || ""] || "default"
  );
}
function classificationColor(c?: string): string {
  const map: Record<string, string> = {
    DATABASE: "blue",
    NETWORK: "purple",
    FILESYSTEM: "cyan",
    TIMEOUT: "gold",
    MEMORY: "red",
    PERMISSION: "orange",
    VALIDATION: "orange",
    TYPE_ERROR: "magenta",
  };
  return map[c || ""] || "default";
}
function formatTime(ts?: number): string {
  return ts ? new Date(ts).toLocaleString() : "N/A";
}

async function loadStats(): Promise<void> {
  loading.value = true;
  try {
    stats.value = (await invoke("error:get-stats", { days: trendDays })) || {};
    pagination.total = stats.value.total || 0;
  } catch {
    /* best-effort */
  } finally {
    loading.value = false;
  }
}

async function loadClassificationStats(): Promise<void> {
  try {
    classificationStats.value =
      (await invoke("error:get-classification-stats", trendDays)) || [];
  } catch {
    classificationStats.value = [];
  }
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true;
  try {
    historyList.value =
      (await invoke("error:get-analysis-history", {
        limit: pagination.pageSize,
        offset: (pagination.current - 1) * pagination.pageSize,
        severity: filterSeverity.value,
        search: searchKeyword.value,
      })) || [];
    pagination.total = stats.value.total || 0;
  } catch (e: unknown) {
    message.error(
      "加载历史失败：" + (e instanceof Error ? e.message : String(e)),
    );
  } finally {
    historyLoading.value = false;
  }
}

function refreshAll(): void {
  loadStats();
  loadClassificationStats();
  loadHistory();
}

function handleTableChange(pag: { current: number; pageSize: number }): void {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
  loadHistory();
}

function showDetail(record: ErrRow): void {
  currentError.value = record;
  detailVisible.value = true;
}

async function generateReport(record: ErrRow | null): Promise<void> {
  if (!record) {
    return;
  }
  try {
    reportContent.value =
      (await invoke("error:get-diagnosis-report", record.id)) || "";
    reportVisible.value = true;
  } catch {
    message.error("生成报告失败");
  }
}

function copyReport(): void {
  navigator.clipboard.writeText(reportContent.value);
  message.success("已复制到剪贴板");
  reportVisible.value = false;
}

async function markFixed(record: ErrRow): Promise<void> {
  try {
    await invoke("error:update-status", record.id, "fixed", "手动标记已修复");
    message.success("已标记为已修复");
    loadHistory();
    loadStats();
  } catch {
    message.error("更新状态失败");
  }
}

async function reanalyze(record: ErrRow): Promise<void> {
  try {
    message.loading({ content: "正在重新分析…", key: "reanalyze" });
    await invoke("error:reanalyze", record.error_id);
    message.success({ content: "重新分析完成", key: "reanalyze" });
    loadHistory();
  } catch {
    message.error({ content: "重新分析失败", key: "reanalyze" });
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !loading.value) {
      refreshAll();
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
.em-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.em-sub {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.em-stats {
  margin-bottom: 16px;
}
.em-section {
  margin-bottom: 16px;
}
.em-dim {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
.em-pre,
.em-report {
  max-height: 300px;
  overflow: auto;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  margin: 0;
}
</style>
