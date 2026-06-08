<template>
  <a-modal
    :open="open"
    :width="880"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="数据库性能"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <DatabaseOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      本地 SQLite
      性能监控：查询统计、缓存命中、慢查询与索引建议。可一键重置统计、清空查询缓存、运行优化（VACUUM/ANALYZE）以及应用索引建议。
    </p>

    <a-row :gutter="[12, 12]" class="stats-row">
      <a-col :span="6">
        <a-statistic
          title="总查询数"
          :value="stats.totalQueries || 0"
          :loading="store.loading"
        >
          <template #prefix><ThunderboltOutlined /></template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="平均查询时间"
          :value="stats.avgQueryTime || 0"
          suffix="ms"
          :precision="2"
          :value-style="{ color: avgQueryTimeColor(stats.avgQueryTime) }"
          :loading="store.loading"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="慢查询数"
          :value="stats.slowQueries || 0"
          :value-style="{ color: slowQueryCountColor(stats.slowQueries) }"
          :loading="store.loading"
        >
          <template #prefix><WarningOutlined /></template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="缓存命中率"
          :value="parseHitRate(stats.cache?.hitRate)"
          suffix="%"
          :precision="2"
          :value-style="{ color: hitRateColor(stats.cache?.hitRate) }"
          :loading="store.loading"
        />
      </a-col>
    </a-row>

    <div class="toolbar">
      <a-button size="small" :loading="store.loading" @click="refresh">
        <ReloadOutlined />
        刷新
      </a-button>
      <a-button size="small" :loading="busy === 'reset'" @click="onReset">
        重置统计
      </a-button>
      <a-button size="small" :loading="busy === 'cache'" @click="onClearCache">
        清空缓存
      </a-button>
      <a-button
        size="small"
        type="primary"
        ghost
        :loading="busy === 'optimize'"
        @click="onOptimize"
      >
        <ToolOutlined />
        优化数据库
      </a-button>
    </div>

    <a-tabs v-model:active-key="activeTab" class="dbperf-tabs" size="small">
      <a-tab-pane key="cache" tab="缓存详情">
        <a-descriptions :column="2" bordered size="small">
          <a-descriptions-item label="缓存条目">
            {{ stats.cache?.size || 0 }} / {{ stats.cache?.maxSize || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="命中率">
            {{ stats.cache?.hitRate || "0%" }}
          </a-descriptions-item>
          <a-descriptions-item label="命中">
            {{ stats.cache?.hits || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="未命中">
            {{ stats.cache?.misses || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="淘汰数">
            {{ stats.cache?.evictions || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="使用率">
            {{ cacheUsagePercent(stats.cache?.size, stats.cache?.maxSize) }}%
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="slow" tab="慢查询">
        <a-empty
          v-if="store.slowQueries.length === 0"
          description="暂无慢查询"
        />
        <a-list v-else size="small" :data-source="store.slowQueries">
          <template #renderItem="{ item }">
            <a-list-item>
              <div class="slow-row">
                <a-tooltip :title="item.sql">
                  <code class="sql-preview">{{ truncateSql(item.sql) }}</code>
                </a-tooltip>
                <div class="slow-meta">
                  <a-tag :color="durationColor(item.duration)">
                    {{ item.duration ?? 0 }}ms
                  </a-tag>
                  <span class="slow-time">
                    <ClockCircleOutlined />
                    {{ formatTimestamp(item.timestamp) }}
                  </span>
                </div>
              </div>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="suggestions" tab="索引建议">
        <div class="suggestions-toolbar">
          <span class="suggestions-count">
            共 {{ store.indexSuggestions.length }} 条建议
          </span>
          <a-button
            v-if="store.indexSuggestions.length > 0"
            size="small"
            type="primary"
            :loading="busy === 'apply-all'"
            @click="onApplyAll"
          >
            全部应用
          </a-button>
        </div>
        <a-empty
          v-if="store.indexSuggestions.length === 0"
          description="暂无索引建议"
        />
        <a-list v-else size="small" :data-source="store.indexSuggestions">
          <template #renderItem="{ item }">
            <a-list-item>
              <div class="suggestion-row">
                <div class="suggestion-main">
                  <a-tag color="purple">{{ suggestionLabel(item) }}</a-tag>
                  <span class="suggestion-reason">{{ item.reason }}</span>
                </div>
                <a-button size="small" @click="onApplyOne(item)">
                  应用
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
import { message } from "ant-design-vue";
import {
  ClockCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons-vue";
import {
  useDbPerformanceStore,
  type IndexSuggestion,
} from "../stores/dbPerformance";
import {
  avgQueryTimeColor,
  cacheUsagePercent,
  durationColor,
  formatTimestamp,
  hitRateColor,
  parseHitRate,
  slowQueryCountColor,
  suggestionLabel,
  truncateSql,
} from "./helpers/dbPerformanceHelpers";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();

defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const store = useDbPerformanceStore();
const activeTab = ref<string>("cache");
const busy = ref<"" | "reset" | "cache" | "optimize" | "apply-all">("");
const stats = computed(() => store.stats);

async function refresh(): Promise<void> {
  await store.refreshAll();
}

// Refresh whenever the panel opens (prefill arg routes to the matching tab).
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    const arg = (props.prefillText || "").trim().toLowerCase();
    if (arg === "slow" || arg === "suggestions" || arg === "cache") {
      activeTab.value = arg;
    }
    void refresh();
  },
  { immediate: true },
);

async function runAction(
  kind: "reset" | "cache" | "optimize",
  fn: () => Promise<{ success: boolean; error?: string }>,
  okMsg: string,
): Promise<void> {
  busy.value = kind;
  try {
    const r = await fn();
    if (r.success) {
      message.success(okMsg);
      await refresh();
    } else {
      message.error(r.error || "操作失败");
    }
  } finally {
    busy.value = "";
  }
}

const onReset = () =>
  runAction("reset", () => store.resetStats(), "统计信息已重置");
const onClearCache = () =>
  runAction("cache", () => store.clearCache(), "缓存已清空");
const onOptimize = () =>
  runAction("optimize", () => store.optimize(), "数据库优化完成");

async function onApplyOne(item: IndexSuggestion): Promise<void> {
  const r = await store.applyIndexSuggestion(item);
  if (r.success) {
    message.success(`已应用索引：${suggestionLabel(item)}`);
    await refresh();
  } else {
    message.error(r.error || "应用失败");
  }
}

async function onApplyAll(): Promise<void> {
  busy.value = "apply-all";
  try {
    const r = await store.applyAllIndexSuggestions();
    if (r.success) {
      message.success("已应用全部索引建议");
      await refresh();
    } else {
      message.error(r.error || "应用失败");
    }
  } finally {
    busy.value = "";
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

.slow-row,
.suggestion-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.slow-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.slow-time {
  color: var(--cc-shell-muted, #8c8c8c);
  font-size: 12px;
}

.sql-preview {
  font-size: 12px;
  color: var(--cc-shell-text, #1f1f1f);
  word-break: break-all;
}

.suggestions-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.suggestions-count {
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
}

.suggestion-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.suggestion-reason {
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
}
</style>
