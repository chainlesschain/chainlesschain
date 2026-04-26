<template>
  <a-modal
    :open="open"
    :width="720"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="高级分析"
    @update:open="handleUpdateOpen"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BarChartOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      AI 调用、Token 使用、错误率、技能执行等指标的跨时段分析。 下方为实时 KPI
      摘要（完整仪表盘请访问 <code>/analytics</code>）。
    </p>

    <a-row :gutter="[12, 12]">
      <a-col v-for="group in groups" :key="group.id" :span="12">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">{{ group.label }}</span>
            <a-tag :color="group.tone">
              {{ group.tag }}
            </a-tag>
          </div>
          <div class="metric-value">
            {{ group.value }}
          </div>
          <p class="metric-desc">
            {{ group.desc }}
          </p>
        </div>
      </a-col>
    </a-row>

    <a-divider />

    <a-space>
      <a-button
        size="small"
        :loading="exporting === 'csv'"
        :disabled="store.loading"
        @click="exportAs('csv')"
      >
        导出 CSV
      </a-button>
      <a-button
        size="small"
        :loading="exporting === 'json'"
        :disabled="store.loading"
        @click="exportAs('json')"
      >
        导出 JSON
      </a-button>
      <a-button
        size="small"
        type="primary"
        :loading="store.loading"
        @click="refresh"
      >
        刷新指标
      </a-button>
    </a-space>

    <a-alert
      v-if="store.error"
      class="error-alert"
      :message="store.error"
      type="error"
      show-icon
      closable
      @close="store.clearError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { BarChartOutlined } from "@ant-design/icons-vue";
import { useAnalyticsDashboardStore } from "../stores/analytics-dashboard";

interface MetricGroup {
  id: string;
  label: string;
  tag: string;
  tone: string;
  desc: string;
  value: string;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useAnalyticsDashboardStore();
const exporting = ref<"csv" | "json" | null>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasData) {
      store.refreshAll();
    }
  },
);

function fmt(n: number | undefined): string {
  if (n == null) {
    return "—";
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}

const groups = computed<MetricGroup[]>(() => [
  {
    id: "ai",
    label: "AI 调用",
    tag: "LLM",
    tone: "blue",
    desc: "按模型/技能/时间查看调用次数与分布。",
    value: fmt(store.kpis?.totalAICalls),
  },
  {
    id: "tokens",
    label: "Token 用量",
    tag: "Cost",
    tone: "green",
    desc: "输入/输出 token 数、总成本、模型对比。",
    value: `${fmt(store.kpis?.totalTokens)} · ${store.tokenCostFormatted}`,
  },
  {
    id: "skills",
    label: "技能执行",
    tag: "Skills",
    tone: "purple",
    desc: "141 个内置技能的调用次数与耗时。",
    value: `${fmt(store.kpis?.skillExecutions)} · ${store.skillSuccessRateFormatted}`,
  },
  {
    id: "errors",
    label: "错误趋势",
    tag: "Errors",
    tone: "red",
    desc: "错误类型分布、错误率、可用性 SLO。",
    value: fmt(store.kpis?.errorCount),
  },
  {
    id: "uptime",
    label: "系统可用性",
    tag: "Uptime",
    tone: "cyan",
    desc: "进程健康、IPC 延迟、数据库时延。",
    value: store.kpis ? store.formattedUptime : "—",
  },
  {
    id: "automation",
    label: "自动化执行",
    tag: "Flow",
    tone: "orange",
    desc: "工作流/钩子/定时任务的执行统计。",
    value: fmt(store.kpis?.activePeers),
  },
]);

function handleUpdateOpen(v: boolean): void {
  emit("update:open", v);
}

async function refresh(): Promise<void> {
  await store.refreshAll();
  if (!store.error) {
    antMessage.success("指标已刷新");
  }
}

async function exportAs(format: "csv" | "json"): Promise<void> {
  exporting.value = format;
  try {
    const data =
      format === "csv" ? await store.exportCSV() : await store.exportJSON();
    if (data == null) {
      return;
    }
    const text =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([text], {
      type: format === "csv" ? "text/csv" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${store.selectedPeriod}-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    antMessage.success(`已导出 ${format.toUpperCase()}`);
  } finally {
    exporting.value = null;
  }
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
}

.panel-desc {
  margin: 0 0 16px 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  line-height: 1.6;
}

.panel-desc code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.metric-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.metric-label {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.metric-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  margin: 2px 0 6px;
  font-variant-numeric: tabular-nums;
}

.metric-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}

.error-alert {
  margin-top: 12px;
}
</style>
