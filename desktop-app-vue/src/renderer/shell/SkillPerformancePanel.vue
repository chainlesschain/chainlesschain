<template>
  <a-modal
    :open="open"
    :width="920"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="技能性能仪表板"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BarChartOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="sp-toolbar">
      <a-radio-group
        v-model:value="timeRange"
        size="small"
        @change="refreshData"
      >
        <a-radio-button value="hour">小时</a-radio-button>
        <a-radio-button value="day">天</a-radio-button>
        <a-radio-button value="week">周</a-radio-button>
      </a-radio-group>
      <a-button
        size="small"
        :loading="metricsStore.loading"
        @click="refreshData"
      >
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-row :gutter="16" class="sp-stats">
      <a-col :span="6">
        <a-statistic title="Top 技能执行次数" :value="topSkillExecCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="平均成功率"
          :value="avgSuccessRate"
          suffix="%"
          :precision="1"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="平均耗时" :value="avgDuration" suffix="ms" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="总 Token 消耗" :value="totalTokens" />
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :span="14">
        <a-card size="small" title="技能排行榜">
          <a-table
            :data-source="metricsStore.topSkills"
            :columns="columns"
            :loading="metricsStore.loading"
            :pagination="{ pageSize: 8 }"
            size="small"
            row-key="skillId"
          />
        </a-card>
      </a-col>
      <a-col :span="10">
        <a-card size="small" title="流水线统计">
          <a-list
            :data-source="metricsStore.pipelineMetrics"
            :locale="{ emptyText: '暂无流水线指标' }"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta :title="item.pipelineId">
                  <template #description>
                    {{ item.totalExecutions }} 次执行 · 成功率
                    {{ pipelineSuccessRate(item) }}% · 平均
                    {{ item.avgDurationMs }}ms
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>
    </a-row>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { BarChartOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import { useSkillMetricsStore } from "../stores/skill-metrics";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const metricsStore = useSkillMetricsStore();
const timeRange = ref<"hour" | "day" | "week">("day");

interface PipelineItem {
  pipelineId: string;
  totalExecutions: number;
  successCount: number;
  avgDurationMs: number;
}

const columns = [
  { title: "技能", dataIndex: "skillId", key: "skillId" },
  {
    title: "执行次数",
    dataIndex: "totalExecutions",
    key: "totalExecutions",
    sorter: (a: { totalExecutions: number }, b: { totalExecutions: number }) =>
      a.totalExecutions - b.totalExecutions,
  },
  {
    title: "成功率",
    dataIndex: "successRate",
    key: "successRate",
    customRender: ({ text }: { text: number }) => `${text}%`,
  },
  {
    title: "平均耗时",
    dataIndex: "avgDurationMs",
    key: "avgDurationMs",
    customRender: ({ text }: { text: number }) => `${text}ms`,
  },
  { title: "总Token", dataIndex: "totalTokens", key: "totalTokens" },
  {
    title: "总成本",
    dataIndex: "totalCost",
    key: "totalCost",
    customRender: ({ text }: { text: number }) => `$${(text || 0).toFixed(4)}`,
  },
];

const topSkillExecCount = computed(() =>
  metricsStore.topSkills.length > 0
    ? metricsStore.topSkills[0].totalExecutions
    : 0,
);

const avgSuccessRate = computed(() => {
  const skills = metricsStore.topSkills;
  if (skills.length === 0) {
    return 0;
  }
  return skills.reduce((sum, s) => sum + s.successRate, 0) / skills.length;
});

const avgDuration = computed(() => {
  const skills = metricsStore.topSkills;
  if (skills.length === 0) {
    return 0;
  }
  return Math.round(
    skills.reduce((sum, s) => sum + s.avgDurationMs, 0) / skills.length,
  );
});

const totalTokens = computed(() =>
  metricsStore.topSkills.reduce((sum, s) => sum + (s.totalTokens || 0), 0),
);

function pipelineSuccessRate(item: PipelineItem): number {
  return item.totalExecutions > 0
    ? Math.round((item.successCount / item.totalExecutions) * 100)
    : 0;
}

async function refreshData(): Promise<void> {
  metricsStore.timeRange = timeRange.value;
  await Promise.all([
    metricsStore.loadTopSkills(20, "executions"),
    metricsStore.loadPipelineMetrics(),
    metricsStore.loadTimeSeries(undefined, timeRange.value),
  ]);
}

// Load on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !metricsStore.loading) {
      refreshData();
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
.sp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.sp-stats {
  margin-bottom: 16px;
}
</style>
