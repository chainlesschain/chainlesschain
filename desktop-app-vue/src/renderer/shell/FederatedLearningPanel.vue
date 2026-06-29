<template>
  <a-modal
    :open="open"
    :width="880"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="联邦学习"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ClusterOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="fl-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.error = null"
    />

    <a-row :gutter="16" class="fl-stats">
      <a-col :span="6">
        <a-statistic title="总任务数" :value="store.stats?.totalTasks ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="活跃任务" :value="store.activeTasks.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="已完成" :value="store.completedTasks.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="参与方"
          :value="store.stats?.totalParticipants ?? 0"
        />
      </a-col>
    </a-row>

    <a-card size="small" title="学习任务" :loading="store.loading">
      <template #extra>
        <a-space>
          <a-button size="small" :loading="store.loading" @click="refresh">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button type="primary" size="small" @click="showCreateModal = true">
            新建任务
          </a-button>
        </a-space>
      </template>
      <a-table
        :columns="columns"
        :data-source="store.tasks"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 8 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <strong>{{ record.name }}</strong>
          </template>
          <template v-if="column.key === 'status'">
            <a-tag :color="statusColor(record.status)">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'rounds'">
            {{ record.currentRound }} / {{ record.maxRounds }}
          </template>
          <template v-if="column.key === 'participants'">
            {{ record.participantsCount ?? "-" }}
          </template>
          <template v-if="column.key === 'actions'">
            <a-space>
              <a-button size="small" type="link" @click="openDetail(record)">
                详情
              </a-button>
              <a-button
                v-if="
                  record.status === 'created' || record.status === 'recruiting'
                "
                size="small"
                type="primary"
                @click="handleStart(record)"
              >
                开始
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- create modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="新建联邦学习任务"
      :confirm-loading="creating"
      @ok="handleCreate"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="任务名称" required>
          <a-input v-model:value="createForm.name" placeholder="输入任务名称" />
        </a-form-item>
        <a-form-item label="模型类型" required>
          <a-select v-model:value="createForm.modelType">
            <a-select-option value="neural-net">神经网络</a-select-option>
            <a-select-option value="cnn">CNN</a-select-option>
            <a-select-option value="transformer">Transformer</a-select-option>
            <a-select-option value="generic">通用</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="聚合策略">
          <a-select v-model:value="createForm.aggregationStrategy">
            <a-select-option value="fedavg">FedAvg</a-select-option>
            <a-select-option value="fedprox">FedProx</a-select-option>
            <a-select-option value="secure_agg">安全聚合</a-select-option>
            <a-select-option value="krum">Krum</a-select-option>
            <a-select-option value="trimmed_mean">Trimmed Mean</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="最少参与方">
          <a-input-number
            v-model:value="createForm.minParticipants"
            :min="2"
            :max="100"
          />
        </a-form-item>
        <a-form-item label="最大轮次">
          <a-input-number
            v-model:value="createForm.maxRounds"
            :min="1"
            :max="10000"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- detail drawer -->
    <a-drawer
      :open="detailOpen"
      title="任务详情"
      placement="right"
      :width="380"
      @close="detailOpen = false"
    >
      <a-descriptions v-if="detailTask" :column="1" size="small" bordered>
        <a-descriptions-item label="名称">
          {{ detailTask.name }}
        </a-descriptions-item>
        <a-descriptions-item label="模型类型">
          {{ detailTask.modelType }}
        </a-descriptions-item>
        <a-descriptions-item label="聚合策略">
          {{ detailTask.aggregationStrategy }}
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="statusColor(detailTask.status)">
            {{ detailTask.status }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="轮次">
          {{ detailTask.currentRound }} / {{ detailTask.maxRounds }}
        </a-descriptions-item>
        <a-descriptions-item label="最少参与方">
          {{ detailTask.minParticipants }}
        </a-descriptions-item>
        <a-descriptions-item label="参与方数">
          {{ detailTask.participantsCount ?? "-" }}
        </a-descriptions-item>
        <a-descriptions-item label="隐私预算 ε">
          {{ detailTask.privacyBudget }}
        </a-descriptions-item>
        <a-descriptions-item label="模型版本">
          {{ detailTask.globalModelVersion }}
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ formatTime(detailTask.createdAt) }}
        </a-descriptions-item>
      </a-descriptions>
    </a-drawer>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import { ClusterOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import {
  useFederatedLearningStore,
  type FLTask,
} from "../stores/federatedLearning";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useFederatedLearningStore();

const showCreateModal = ref(false);
const creating = ref(false);
const createForm = reactive({
  name: "",
  modelType: "neural-net",
  aggregationStrategy: "fedavg",
  minParticipants: 2,
  maxRounds: 100,
});

const detailOpen = ref(false);
const detailTask = ref<FLTask | null>(null);

const columns = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "模型类型", dataIndex: "modelType", key: "modelType" },
  {
    title: "策略",
    dataIndex: "aggregationStrategy",
    key: "aggregationStrategy",
  },
  { title: "轮次", key: "rounds" },
  { title: "参与方", key: "participants" },
  { title: "状态", dataIndex: "status", key: "status" },
  { title: "操作", key: "actions", width: 130 },
];

function statusColor(status: string): string {
  const map: Record<string, string> = {
    created: "default",
    recruiting: "blue",
    training: "green",
    aggregating: "orange",
    completed: "purple",
    failed: "red",
    cancelled: "gray",
  };
  return map[status] || "default";
}

function formatTime(ts?: string): string {
  if (!ts) {
    return "—";
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

// Load on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      Promise.all([store.loadTasks(), store.loadStats()]);
    }
  },
  { immediate: true },
);

function refresh(): void {
  Promise.all([store.loadTasks(), store.loadStats()]);
}

async function handleCreate(): Promise<void> {
  if (!createForm.name.trim()) {
    message.warning("请输入任务名称");
    return;
  }
  creating.value = true;
  try {
    await store.createTask({ ...createForm });
    message.success("任务创建成功");
    showCreateModal.value = false;
    createForm.name = "";
  } catch {
    message.error("任务创建失败");
  } finally {
    creating.value = false;
  }
}

async function handleStart(task: FLTask): Promise<void> {
  try {
    await store.startTraining(task.id);
    message.success("训练已启动");
    await store.loadTasks();
  } catch {
    message.error("启动训练失败");
  }
}

function openDetail(task: FLTask): void {
  detailTask.value = task;
  detailOpen.value = true;
}
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
.fl-error {
  margin-bottom: 12px;
}
.fl-stats {
  margin-bottom: 16px;
}
</style>
