<template>
  <a-modal
    :open="open"
    :width="900"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="LLM 性能与成本"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ThunderboltOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      LLM
      调用的用量、成本、缓存命中、预算与告警监控。可切换时间范围、清理过期缓存、导出成本报告，并查看
      / 关闭告警。
    </p>

    <a-row :gutter="[12, 12]" class="stats-row">
      <a-col :span="6">
        <a-statistic
          title="总调用"
          :value="stats.totalCalls || 0"
          :loading="store.loading"
        >
          <template #prefix><ApiOutlined /></template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic title="总 Tokens" :loading="store.loading">
          <template #formatter>{{ formatTokens(stats.totalTokens) }}</template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic title="总成本" :loading="store.loading">
          <template #formatter>{{ formatUsd(stats.totalCostUsd) }}</template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="缓存命中率"
          :value="asPercent(stats.cacheHitRate)"
          suffix="%"
          :precision="1"
          :value-style="{ color: hitRateColor(stats.cacheHitRate) }"
          :loading="store.loading"
        />
      </a-col>
    </a-row>

    <div class="toolbar">
      <a-radio-group v-model:value="rangeDays" size="small" @change="refresh">
        <a-radio-button :value="1">24h</a-radio-button>
        <a-radio-button :value="7">7天</a-radio-button>
        <a-radio-button :value="30">30天</a-radio-button>
      </a-radio-group>
      <a-button size="small" :loading="store.loading" @click="refresh">
        <ReloadOutlined />
        刷新
      </a-button>
      <a-button size="small" :loading="busy === 'cache'" @click="onClearCache">
        清理过期缓存
      </a-button>
      <a-button
        size="small"
        type="primary"
        ghost
        :loading="busy === 'export'"
        @click="onExport"
      >
        <ExportOutlined />
        导出成本报告
      </a-button>
    </div>

    <a-tabs v-model:active-key="activeTab" class="llmperf-tabs" size="small">
      <a-tab-pane key="budget" tab="预算">
        <div v-for="b in budgetBars" :key="b.label" class="budget-row">
          <div class="budget-head">
            <span>{{ b.label }}</span>
            <span class="budget-figure">
              {{ formatUsd(b.spend) }} / {{ formatUsd(b.limit) }}
            </span>
          </div>
          <a-progress
            :percent="Math.round(b.percent)"
            :status="budgetStatus(b.percent, warn, crit)"
            :stroke-color="budgetColor(b.percent, warn, crit)"
          />
        </div>
      </a-tab-pane>

      <a-tab-pane key="cache" tab="缓存">
        <a-descriptions :column="2" bordered size="small">
          <a-descriptions-item label="缓存条目">
            {{ store.cacheStats.totalEntries || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="过期条目">
            {{ store.cacheStats.expiredEntries || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="命中次数">
            {{ store.cacheStats.totalHits || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="命中率">
            {{ asPercent(store.cacheStats.hitRate) }}%
          </a-descriptions-item>
          <a-descriptions-item label="节省 Tokens">
            {{ formatTokens(store.cacheStats.totalTokensSaved) }}
          </a-descriptions-item>
          <a-descriptions-item label="节省成本">
            {{ formatUsd(store.cacheStats.totalCostSaved) }}
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="breakdown" tab="成本拆分">
        <div class="breakdown-cols">
          <div class="breakdown-col">
            <h4>按提供商</h4>
            <a-empty
              v-if="store.costBreakdown.byProvider.length === 0"
              :image="simpleEmpty"
              description="无数据"
            />
            <a-list
              v-else
              size="small"
              :data-source="store.costBreakdown.byProvider"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <span>{{ breakdownLabel(item) }}</span>
                  <a-tag color="blue">{{ formatUsd(item.cost) }}</a-tag>
                </a-list-item>
              </template>
            </a-list>
          </div>
          <div class="breakdown-col">
            <h4>按模型</h4>
            <a-empty
              v-if="store.costBreakdown.byModel.length === 0"
              :image="simpleEmpty"
              description="无数据"
            />
            <a-list
              v-else
              size="small"
              :data-source="store.costBreakdown.byModel"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <span>{{ breakdownLabel(item) }}</span>
                  <a-tag color="purple">{{ formatUsd(item.cost) }}</a-tag>
                </a-list-item>
              </template>
            </a-list>
          </div>
        </div>
      </a-tab-pane>

      <a-tab-pane key="alerts" tab="告警">
        <div class="alerts-toolbar">
          <span class="alerts-count">
            共 {{ store.alertHistory.length }} 条告警
          </span>
          <a-button
            v-if="store.alertHistory.length > 0"
            size="small"
            danger
            :loading="busy === 'clear-alerts'"
            @click="onClearAlerts"
          >
            清空告警
          </a-button>
        </div>
        <a-empty
          v-if="store.alertHistory.length === 0"
          description="暂无告警"
        />
        <a-list v-else size="small" :data-source="store.alertHistory">
          <template #renderItem="{ item }">
            <a-list-item>
              <div class="alert-row">
                <div class="alert-main">
                  <a-tag :color="alertLevelColor(item.level)">
                    {{ item.level || "info" }}
                  </a-tag>
                  <span class="alert-msg">{{ item.message }}</span>
                </div>
                <a-button size="small" type="text" @click="onDismiss(item)">
                  关闭
                </a-button>
              </div>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { message, Empty } from "ant-design-vue";
import {
  ApiOutlined,
  ExportOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons-vue";
import {
  useLlmPerformanceStore,
  type LlmAlert,
} from "../stores/llmPerformance";
import {
  alertLevelColor,
  asPercent,
  breakdownLabel,
  budgetColor,
  budgetPercent,
  budgetStatus,
  dateRangeFromDays,
  formatTokens,
  formatUsd,
  hitRateColor,
} from "./helpers/llmPerformanceHelpers";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();

defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const store = useLlmPerformanceStore();
const activeTab = ref<string>("budget");
const rangeDays = ref<number>(7);
const busy = ref<"" | "cache" | "export" | "clear-alerts">("");
const simpleEmpty = Empty.PRESENTED_IMAGE_SIMPLE;

const stats = computed(() => store.stats);
const warn = computed(() => Number(store.budget.warningThreshold) || 80);
const crit = computed(() => Number(store.budget.criticalThreshold) || 95);

const budgetBars = computed(() => {
  const b = store.budget;
  return [
    {
      label: "今日",
      spend: b.dailySpend,
      limit: b.dailyLimit,
      percent: budgetPercent(b.dailySpend, b.dailyLimit),
    },
    {
      label: "本周",
      spend: b.weeklySpend,
      limit: b.weeklyLimit,
      percent: budgetPercent(b.weeklySpend, b.weeklyLimit),
    },
    {
      label: "本月",
      spend: b.monthlySpend,
      limit: b.monthlyLimit,
      percent: budgetPercent(b.monthlySpend, b.monthlyLimit),
    },
  ];
});

async function refresh(): Promise<void> {
  await store.refreshAll(dateRangeFromDays(rangeDays.value, Date.now()));
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    const arg = (props.prefillText || "").trim().toLowerCase();
    if (["budget", "cache", "breakdown", "alerts"].includes(arg)) {
      activeTab.value = arg;
    }
    void refresh();
  },
  { immediate: true },
);

async function onClearCache(): Promise<void> {
  busy.value = "cache";
  try {
    const r = await store.clearCache(true);
    if (r.success) {
      message.success(`已清理 ${r.clearedCount ?? 0} 条过期缓存`);
    } else {
      message.warning(r.error || "没有需要清理的过期缓存");
    }
  } finally {
    busy.value = "";
  }
}

async function onExport(): Promise<void> {
  busy.value = "export";
  try {
    const r = await store.exportCostReport({
      ...dateRangeFromDays(rangeDays.value, Date.now()),
      format: "csv",
    });
    message.success(r.success ? "成本报告已导出" : r.error || "导出失败");
  } finally {
    busy.value = "";
  }
}

async function onClearAlerts(): Promise<void> {
  busy.value = "clear-alerts";
  try {
    const r = await store.clearAlertHistory();
    message.success(r.success ? "告警已清空" : r.error || "清空失败");
  } finally {
    busy.value = "";
  }
}

async function onDismiss(item: LlmAlert): Promise<void> {
  if (!item.id) {
    return;
  }
  const r = await store.dismissAlert(item.id);
  if (!r.success) {
    message.error(r.error || "关闭失败");
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
  border-radius: 6px;
  font-size: 13px;
}

.panel-desc {
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  margin-bottom: 16px;
}

.stats-row {
  margin-bottom: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.budget-row {
  margin-bottom: 14px;
}

.budget-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 4px;
}

.budget-figure {
  color: var(--cc-shell-muted, #595959);
}

.breakdown-cols {
  display: flex;
  gap: 16px;
}

.breakdown-col {
  flex: 1;
  min-width: 0;
}

.breakdown-col h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.alerts-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.alerts-count {
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
}

.alert-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.alert-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.alert-msg {
  font-size: 13px;
  word-break: break-word;
}
</style>
