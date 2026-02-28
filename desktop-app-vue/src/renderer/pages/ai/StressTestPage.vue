<template>
  <div class="stress-test-page">
    <a-page-header
      title="Federation Stress Test"
      sub-title="100-node federation stress testing"
    >
      <template #extra>
        <a-button type="primary" @click="handleStartTest">
          Start Test
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Total Runs" :value="store.runs.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Completed" :value="store.completedRuns.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Avg Latency"
          :value="store.currentResult?.avg_latency_ms?.toFixed(1) || 0"
          suffix="ms"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Throughput"
          :value="store.currentResult?.throughput_tps?.toFixed(1) || 0"
          suffix="TPS"
        />
      </a-col>
    </a-row>

    <a-table
      :columns="columns"
      :data-source="store.runs"
      :loading="store.loading"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-badge
            :status="
              record.status === 'complete'
                ? 'success'
                : record.status === 'running'
                  ? 'processing'
                  : 'default'
            "
            :text="record.status"
          />
        </template>
        <template v-if="column.key === 'actions'">
          <a-button
            size="small"
            type="link"
            @click="handleViewResults(record.id)"
          >
            Results
          </a-button>
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
import { useStressTestStore } from "../../stores/stressTest";

const store = useStressTestStore();

const columns = [
  { title: "Name", dataIndex: "name", width: 200 },
  { title: "Nodes", dataIndex: "node_count", width: 80 },
  { title: "Tasks", dataIndex: "concurrent_tasks", width: 80 },
  { title: "Status", key: "status", width: 100 },
  { title: "Actions", key: "actions", width: 100 },
];

async function handleStartTest() {
  const result = await store.startTest({ nodeCount: 10, concurrentTasks: 5 });
  if (result.success) {
    message.success("Stress test complete");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleViewResults(runId: string) {
  await store.fetchResults(runId);
  message.info(`Results loaded for run ${runId.slice(0, 8)}`);
}

onMounted(async () => {
  await store.fetchRuns();
});
</script>

<style lang="less" scoped>
.stress-test-page {
  padding: 24px;
}
</style>
