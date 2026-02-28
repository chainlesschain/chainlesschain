<template>
  <div class="inference-network-page">
    <a-page-header
      title="Inference Network"
      sub-title="Decentralized AI inference"
    >
      <template #extra>
        <a-button type="primary" @click="showRegisterModal = true">
          Register Node
        </a-button>
      </template>
    </a-page-header>
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Nodes" :value="store.nodeCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Online" :value="store.onlineNodes.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Total Tasks"
          :value="store.networkStats?.totalTasks || 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Avg Latency"
          :value="store.networkStats?.avgLatencyMs || 0"
          suffix="ms"
        />
      </a-col>
    </a-row>
    <a-table
      :columns="columns"
      :data-source="store.nodes"
      :loading="store.loading"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-badge
            :status="record.status === 'online' ? 'success' : 'default'"
            :text="record.status"
          />
        </template>
      </template>
    </a-table>
    <a-modal
      v-model:open="showRegisterModal"
      title="Register Node"
      @ok="handleRegister"
    >
      <a-form layout="vertical">
        <a-form-item label="Name">
          <a-input v-model:value="form.name" />
        </a-form-item>
        <a-form-item label="Endpoint">
          <a-input v-model:value="form.endpoint" />
        </a-form-item>
        <a-form-item label="GPU Model">
          <a-input v-model:value="form.gpuModel" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useInferenceNetworkStore } from "../../stores/inferenceNetwork";

const store = useInferenceNetworkStore();
const showRegisterModal = ref(false);
const form = ref({ name: "", endpoint: "", gpuModel: "" });
const columns = [
  { title: "Name", dataIndex: "name", width: 150 },
  { title: "Status", key: "status", width: 100 },
  { title: "GPU", dataIndex: "gpu_model", width: 150 },
  { title: "Benchmark", dataIndex: "benchmark_score", width: 100 },
  { title: "Load", dataIndex: "current_load", width: 80 },
];

async function handleRegister() {
  if (!form.value.name) {
    message.warning("Name is required");
    return;
  }
  const r = await store.registerNode(form.value);
  if (r.success) {
    message.success("Node registered");
    showRegisterModal.value = false;
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchNodes();
  await store.fetchNetworkStats();
});
</script>

<style lang="less" scoped>
.inference-network-page {
  padding: 24px;
}
</style>
