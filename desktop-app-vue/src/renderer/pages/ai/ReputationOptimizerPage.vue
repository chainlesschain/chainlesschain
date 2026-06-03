<template>
  <div class="reputation-optimizer-page">
    <a-page-header
      title="Reputation Optimizer"
      sub-title="Bayesian optimization and anomaly detection"
    >
      <template #extra>
        <a-button type="primary" @click="handleOptimize">
          Run Optimization
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Optimizations" :value="store.history.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Best Improvement"
          :value="store.bestImprovement.toFixed(1)"
          suffix="%"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Anomalies" :value="store.anomalyCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Latest"
          :value="store.latestOptimization?.improvement?.toFixed(1) || 0"
          suffix="%"
        />
      </a-col>
    </a-row>

    <a-table
      :columns="columns"
      :data-source="store.history"
      :loading="store.loading"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'improvement'">
          <a-tag color="green"> +{{ record.improvement?.toFixed(1) }}% </a-tag>
        </template>
        <template v-if="column.key === 'created_at'">
          {{ new Date(record.created_at).toLocaleString() }}
        </template>
      </template>
    </a-table>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { message } from "ant-design-vue";
import { useReputationOptimizerStore } from "../../stores/reputationOptimizer";

const store = useReputationOptimizerStore();

const columns = [
  { title: "Status", dataIndex: "status", width: 100 },
  { title: "Iterations", dataIndex: "iterations", width: 100 },
  { title: "Improvement", key: "improvement", width: 120 },
  { title: "Created", key: "created_at", width: 180 },
];

async function handleOptimize() {
  const result = await store.runOptimization();
  if (result.success) {
    message.success("Optimization complete");
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchHistory();
  await store.fetchAnalytics();
});
</script>

<style lang="less" scoped>
.reputation-optimizer-page {
  padding: 24px;
}
</style>
