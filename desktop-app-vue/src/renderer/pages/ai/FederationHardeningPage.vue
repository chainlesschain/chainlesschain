<template>
  <div class="federation-hardening-page">
    <a-page-header
      title="Federation Hardening"
      sub-title="Circuit breakers, connection pools, and health checks"
    >
      <template #extra>
        <a-button type="primary" @click="handleHealthCheck">
          Run Health Check
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic
          title="Circuit Breakers"
          :value="store.circuitBreakers.length"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Open Circuits" :value="store.openCircuits.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Healthy Nodes" :value="store.healthyNodes" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Pool Size"
          :value="store.status?.config?.maxPoolSize || 0"
        />
      </a-col>
    </a-row>

    <a-table
      :columns="columns"
      :data-source="store.circuitBreakers"
      :loading="store.loading"
      row-key="node_id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'state'">
          <a-badge :status="stateColor(record.state)" :text="record.state" />
        </template>
        <template v-if="column.key === 'actions'">
          <a-button
            size="small"
            type="link"
            @click="handleReset(record.node_id)"
          >
            Reset
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
import { useFederationHardeningStore } from "../../stores/federationHardening";

const store = useFederationHardeningStore();

const columns = [
  { title: "Node ID", dataIndex: "node_id", width: 200 },
  { title: "State", key: "state", width: 120 },
  { title: "Failures", dataIndex: "failure_count", width: 100 },
  { title: "Actions", key: "actions", width: 100 },
];

function stateColor(s: string): "success" | "error" | "warning" | "default" {
  return (
    (
      { closed: "success", open: "error", half_open: "warning" } as Record<
        string,
        "success" | "error" | "warning" | "default"
      >
    )[s] || "default"
  );
}

async function handleHealthCheck() {
  const result = await store.runHealthCheck();
  if (result.success) {
    message.success("Health check complete");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleReset(nodeId: string) {
  const result = await store.resetCircuit(nodeId);
  if (result.success) {
    message.success("Circuit reset");
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchStatus();
  await store.fetchCircuitBreakers();
});
</script>

<style lang="less" scoped>
.federation-hardening-page {
  padding: 24px;
}
</style>
