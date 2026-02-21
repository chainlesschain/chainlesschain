<template>
  <div class="skill-performance-page">
    <a-page-header
      title="技能性能仪表板"
      sub-title="Skill Performance Dashboard"
    >
      <template #extra>
        <a-radio-group v-model:value="timeRange" @change="refreshData">
          <a-radio-button value="hour"> 小时 </a-radio-button>
          <a-radio-button value="day"> 天 </a-radio-button>
          <a-radio-button value="week"> 周 </a-radio-button>
        </a-radio-group>
        <a-button style="margin-left: 8px" @click="refreshData">
          刷新
        </a-button>
      </template>
    </a-page-header>

    <div style="padding: 16px">
      <!-- Summary cards -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="6">
          <a-card>
            <a-statistic title="Top 技能执行次数" :value="topSkillExecCount" />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="平均成功率"
              :value="avgSuccessRate"
              suffix="%"
              :precision="1"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic title="平均耗时" :value="avgDuration" suffix="ms" />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic title="总 Token 消耗" :value="totalTokens" />
          </a-card>
        </a-col>
      </a-row>

      <!-- Top Skills Table -->
      <a-row :gutter="16">
        <a-col :span="14">
          <a-card title="技能排行榜">
            <a-table
              :data-source="metricsStore.topSkills"
              :columns="columns"
              :pagination="{ pageSize: 10 }"
              size="small"
              row-key="skillId"
            />
          </a-card>
        </a-col>
        <a-col :span="10">
          <a-card title="流水线统计">
            <a-list
              :data-source="metricsStore.pipelineMetrics"
              :locale="{ emptyText: '暂无流水线指标' }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta :title="item.pipelineId">
                    <template #description>
                      {{ item.totalExecutions }} 次执行 · 成功率
                      {{
                        item.totalExecutions > 0
                          ? Math.round(
                              (item.successCount / item.totalExecutions) * 100,
                            )
                          : 0
                      }}% · 平均 {{ item.avgDurationMs }}ms
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useSkillMetricsStore } from "../stores/skill-metrics";

const metricsStore = useSkillMetricsStore();
const timeRange = ref("day");

const columns = [
  { title: "技能", dataIndex: "skillId", key: "skillId" },
  {
    title: "执行次数",
    dataIndex: "totalExecutions",
    key: "totalExecutions",
    sorter: (a, b) => a.totalExecutions - b.totalExecutions,
  },
  {
    title: "成功率",
    dataIndex: "successRate",
    key: "successRate",
    customRender: ({ text }) => `${text}%`,
  },
  {
    title: "平均耗时",
    dataIndex: "avgDurationMs",
    key: "avgDurationMs",
    customRender: ({ text }) => `${text}ms`,
  },
  { title: "总Token", dataIndex: "totalTokens", key: "totalTokens" },
  {
    title: "总成本",
    dataIndex: "totalCost",
    key: "totalCost",
    customRender: ({ text }) => `$${(text || 0).toFixed(4)}`,
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

async function refreshData() {
  metricsStore.timeRange = timeRange.value;
  await Promise.all([
    metricsStore.loadTopSkills(20, "executions"),
    metricsStore.loadPipelineMetrics(),
    metricsStore.loadTimeSeries(undefined, timeRange.value),
  ]);
}

onMounted(() => {
  refreshData();
});
</script>
