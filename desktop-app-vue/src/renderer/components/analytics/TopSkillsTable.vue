<template>
  <a-card
    title="Top Skills"
    class="top-skills-table"
  >
    <a-table
      :data-source="tableData"
      :columns="columns"
      :loading="loading"
      :pagination="false"
      size="middle"
      row-key="rank"
    >
      <!-- Rank Column -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'rank'">
          <a-tag
            v-if="record.rank <= 3"
            :color="rankColor(record.rank)"
          >
            #{{ record.rank }}
          </a-tag>
          <span v-else>#{{ record.rank }}</span>
        </template>

        <!-- Success Rate Column -->
        <template v-if="column.dataIndex === 'successRate'">
          <a-tag :color="successRateColor(record.successRate)">
            {{ formatPercent(record.successRate) }}
          </a-tag>
        </template>

        <!-- Avg Duration Column -->
        <template v-if="column.dataIndex === 'avgDuration'">
          {{ formatDuration(record.avgDuration) }}
        </template>

        <!-- Executions Column -->
        <template v-if="column.dataIndex === 'executions'">
          {{ formatNumber(record.executions) }}
        </template>
      </template>
    </a-table>
  </a-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface TopItem {
  name: string;
  count?: number;
  calls?: number;
  successRate?: number;
  avgDuration?: number;
  totalExecutions?: number;
  [key: string]: any;
}

const props = defineProps<{
  data: TopItem[];
  loading: boolean;
}>();

// ==================== Columns ====================

const columns = [
  {
    title: 'Rank',
    dataIndex: 'rank',
    key: 'rank',
    width: 70,
    align: 'center' as const,
  },
  {
    title: 'Skill Name',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
  },
  {
    title: 'Executions',
    dataIndex: 'executions',
    key: 'executions',
    width: 110,
    align: 'right' as const,
    sorter: (a: any, b: any) => a.executions - b.executions,
    defaultSortOrder: 'descend' as const,
  },
  {
    title: 'Success Rate',
    dataIndex: 'successRate',
    key: 'successRate',
    width: 120,
    align: 'center' as const,
    sorter: (a: any, b: any) => a.successRate - b.successRate,
  },
  {
    title: 'Avg Duration',
    dataIndex: 'avgDuration',
    key: 'avgDuration',
    width: 120,
    align: 'right' as const,
    sorter: (a: any, b: any) => a.avgDuration - b.avgDuration,
  },
];

// ==================== Computed ====================

const tableData = computed(() => {
  return props.data.map((item, index) => ({
    rank: index + 1,
    name: item.name || 'Unknown',
    executions: item.count || item.calls || item.totalExecutions || 0,
    successRate: item.successRate ?? 1,
    avgDuration: item.avgDuration || 0,
  }));
});

// ==================== Formatters ====================

function rankColor(rank: number): string {
  switch (rank) {
    case 1:
      return 'gold';
    case 2:
      return '#c0c0c0';
    case 3:
      return '#cd7f32';
    default:
      return 'default';
  }
}

function successRateColor(rate: number): string {
  const percent = rate > 1 ? rate : rate * 100;
  if (percent >= 90) {return 'green';}
  if (percent >= 70) {return 'orange';}
  return 'red';
}

function formatPercent(rate: number): string {
  // Handle both 0-1 and 0-100 ranges
  const percent = rate > 1 ? rate : rate * 100;
  return `${percent.toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) {return '-';}
  if (ms < 1000) {return `${Math.round(ms)}ms`;}
  if (ms < 60000) {return `${(ms / 1000).toFixed(1)}s`;}
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {return `${(num / 1000000).toFixed(1)}M`;}
  if (num >= 1000) {return `${(num / 1000).toFixed(1)}K`;}
  return String(num);
}
</script>

<style lang="less" scoped>
.top-skills-table {
  margin-bottom: 16px;

  :deep(.ant-table-thead > tr > th) {
    font-weight: 600;
    background: #fafafa;
  }

  :deep(.ant-table-tbody > tr) {
    transition: background-color 0.2s;

    &:hover > td {
      background: #f0f5ff;
    }
  }

  :deep(.ant-tag) {
    margin: 0;
    font-size: 12px;
  }
}
</style>
