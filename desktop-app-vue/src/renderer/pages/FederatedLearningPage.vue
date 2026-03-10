<template>
  <div class="federated-learning-page">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <ClusterOutlined />
          Federated Learning
        </h1>
        <p class="page-description">
          Manage federated learning tasks, participants, and model aggregation
        </p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button :loading="store.loading" @click="handleRefresh">
            <ReloadOutlined />
            Refresh
          </a-button>
          <a-button type="primary" @click="showCreateModal = true">
            <PlusOutlined />
            Create Task
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="stats-section">
      <a-row :gutter="16">
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="Total Tasks"
              :value="store.stats?.totalTasks ?? 0"
              :prefix="h(AppstoreOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="Active Tasks"
              :value="store.activeTasks.length"
              :prefix="h(ThunderboltOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="Completed"
              :value="store.completedTasks.length"
              :prefix="h(CheckCircleOutlined)"
              :value-style="{ color: '#722ed1' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="Total Participants"
              :value="store.stats?.totalParticipants ?? 0"
              :prefix="h(TeamOutlined)"
              :value-style="{ color: '#fa8c16' }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- Tasks Table -->
    <a-card title="Learning Tasks" class="tasks-table-card">
      <a-table
        :columns="columns"
        :data-source="store.tasks"
        :loading="store.loading"
        row-key="id"
        :pagination="{ pageSize: 10 }"
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
              <a-button
                size="small"
                type="link"
                @click="handleViewTask(record)"
              >
                View
              </a-button>
              <a-button
                v-if="
                  record.status === 'created' || record.status === 'recruiting'
                "
                size="small"
                type="primary"
                @click="handleStartTraining(record)"
              >
                Start
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- Create Task Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="Create Federated Learning Task"
      :confirm-loading="creating"
      @ok="handleCreateTask"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="Task Name" required>
          <a-input
            v-model:value="createForm.name"
            placeholder="Enter task name"
          />
        </a-form-item>
        <a-form-item label="Model Type" required>
          <a-select v-model:value="createForm.modelType">
            <a-select-option value="neural-net">
              Neural Network
            </a-select-option>
            <a-select-option value="cnn"> CNN </a-select-option>
            <a-select-option value="transformer"> Transformer </a-select-option>
            <a-select-option value="generic"> Generic </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="Aggregation Strategy">
          <a-select v-model:value="createForm.aggregationStrategy">
            <a-select-option value="fedavg"> FedAvg </a-select-option>
            <a-select-option value="fedprox"> FedProx </a-select-option>
            <a-select-option value="secure_agg">
              Secure Aggregation
            </a-select-option>
            <a-select-option value="krum"> Krum </a-select-option>
            <a-select-option value="trimmed_mean">
              Trimmed Mean
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="Min Participants">
          <a-input-number
            v-model:value="createForm.minParticipants"
            :min="2"
            :max="100"
          />
        </a-form-item>
        <a-form-item label="Max Rounds">
          <a-input-number
            v-model:value="createForm.maxRounds"
            :min="1"
            :max="10000"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from "vue";
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  ClusterOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useFederatedLearningStore } from "../stores/federatedLearning";

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

const columns = [
  { title: "Name", dataIndex: "name", key: "name" },
  { title: "Model Type", dataIndex: "modelType", key: "modelType" },
  {
    title: "Strategy",
    dataIndex: "aggregationStrategy",
    key: "aggregationStrategy",
  },
  { title: "Rounds", key: "rounds" },
  { title: "Participants", key: "participants" },
  { title: "Status", dataIndex: "status", key: "status" },
  { title: "Actions", key: "actions", width: 160 },
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

async function handleRefresh() {
  await Promise.all([store.loadTasks(), store.loadStats()]);
}

async function handleCreateTask() {
  if (!createForm.name) {
    message.warning("Please enter a task name");
    return;
  }
  creating.value = true;
  try {
    await store.createTask({ ...createForm });
    showCreateModal.value = false;
    createForm.name = "";
    message.success("Task created successfully");
  } catch (_err) {
    message.error("Failed to create task");
  } finally {
    creating.value = false;
  }
}

async function handleStartTraining(task: { id: string }) {
  try {
    await store.startTraining(task.id);
    message.success("Training started");
    await store.loadTasks();
  } catch (_err) {
    message.error("Failed to start training");
  }
}

function handleViewTask(task: { id: string; name: string }) {
  message.info(`Viewing task: ${task.name}`);
}

onMounted(async () => {
  await handleRefresh();
});
</script>

<style scoped>
.federated-learning-page {
  padding: 24px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}
.page-header h1 {
  margin: 0;
  font-size: 24px;
}
.page-description {
  margin: 4px 0 0;
  color: rgba(0, 0, 0, 0.45);
}
.stats-section {
  margin-bottom: 24px;
}
.tasks-table-card {
  margin-bottom: 24px;
}
</style>
