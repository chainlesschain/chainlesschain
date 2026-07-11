<template>
  <a-modal
    :open="open"
    :width="900"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="推理网络"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="in-prefill-banner">
      <ClusterOutlined />
      <span class="in-prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="in-toolbar">
      <span class="in-subtitle">去中心化 AI 推理节点网络</span>
      <a-space>
        <a-button size="small" :loading="store.loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" size="small" @click="showRegisterModal = true">
          <template #icon><PlusOutlined /></template>
          注册节点
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="12" style="margin-bottom: 12px">
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="节点数" :value="store.nodeCount" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="在线" :value="store.onlineNodes.length" />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="总任务数"
            :value="store.networkStats?.totalTasks || 0"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="平均延迟"
            :value="store.networkStats?.avgLatencyMs || 0"
            suffix="ms"
          />
        </a-card>
      </a-col>
    </a-row>

    <a-table
      :columns="columns"
      :data-source="store.nodes"
      :loading="store.loading"
      :pagination="{ pageSize: 10 }"
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
      title="注册推理节点"
      @ok="handleRegister"
    >
      <a-form layout="vertical">
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="节点名称" />
        </a-form-item>
        <a-form-item label="端点">
          <a-input
            v-model:value="form.endpoint"
            placeholder="http://host:port"
          />
        </a-form-item>
        <a-form-item label="GPU 型号">
          <a-input v-model:value="form.gpuModel" placeholder="如 RTX 4090" />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  ClusterOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { useInferenceNetworkStore } from "@/stores/inferenceNetwork";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();
defineEmits(["update:open"]);

const store = useInferenceNetworkStore();
const showRegisterModal = ref(false);
const form = ref({ name: "", endpoint: "", gpuModel: "" });

const columns = [
  { title: "名称", dataIndex: "name", width: 150 },
  { title: "状态", key: "status", width: 100 },
  { title: "GPU", dataIndex: "gpu_model", width: 150 },
  { title: "基准分", dataIndex: "benchmark_score", width: 100 },
  { title: "负载", dataIndex: "current_load", width: 80 },
];

async function handleRegister() {
  if (!form.value.name) {
    message.warning("请输入节点名称");
    return;
  }
  const r = await store.registerNode(form.value);
  if (r.success) {
    message.success("节点注册成功");
    showRegisterModal.value = false;
    form.value = { name: "", endpoint: "", gpuModel: "" };
  } else {
    message.error(r.error || "注册失败");
  }
}

async function loadAll() {
  await store.fetchNodes();
  await store.fetchNetworkStats();
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadAll();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.in-prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.in-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.in-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
