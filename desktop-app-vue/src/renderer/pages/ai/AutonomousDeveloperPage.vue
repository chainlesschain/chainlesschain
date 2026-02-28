<template>
  <div class="autonomous-developer-page">
    <a-page-header
      title="Autonomous Developer"
      sub-title="End-to-end autonomous code generation and review"
    >
      <template #extra>
        <a-button type="primary" @click="showCreateModal = true">
          New Session
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Sessions" :value="store.sessionCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Completed"
          :value="store.completedSessions.length"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Active" :value="store.activeSessions.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Quality Score"
          :value="
            store.currentSession?.review_result?.overallScore?.toFixed(2) ||
            'N/A'
          "
        />
      </a-col>
    </a-row>

    <a-table
      :columns="columns"
      :data-source="store.sessions"
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
                : record.status === 'failed'
                  ? 'error'
                  : 'processing'
            "
            :text="record.status"
          />
        </template>
        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button
              v-if="record.status === 'intent' || record.status === 'prd'"
              size="small"
              type="link"
              @click="handleGenerate(record.id)"
            >
              Generate
            </a-button>
            <a-button
              v-if="record.status === 'complete'"
              size="small"
              type="link"
              @click="handleReview(record.id)"
            >
              Review
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="showCreateModal"
      title="New Development Session"
      :confirm-loading="store.loading"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="Intent">
          <a-textarea
            v-model:value="createForm.intent"
            placeholder="Describe what you want to build..."
            :rows="4"
          />
        </a-form-item>
        <a-form-item label="Title (optional)">
          <a-input
            v-model:value="createForm.title"
            placeholder="Session title"
          />
        </a-form-item>
      </a-form>
    </a-modal>

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
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useAutonomousDevStore } from "../../stores/autonomousDev";

const store = useAutonomousDevStore();
const showCreateModal = ref(false);
const createForm = ref({ intent: "", title: "" });

const columns = [
  { title: "Title", dataIndex: "title", width: 250 },
  { title: "Status", key: "status", width: 120 },
  { title: "Turns", dataIndex: "turn_count", width: 80 },
  { title: "Actions", key: "actions", width: 150 },
];

async function handleCreate() {
  if (!createForm.value.intent) {
    message.warning("Intent is required");
    return;
  }
  const result = await store.startSession(
    createForm.value.intent,
    createForm.value.title,
  );
  if (result.success) {
    message.success("Session started");
    showCreateModal.value = false;
    createForm.value = { intent: "", title: "" };
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleGenerate(sessionId: string) {
  const result = await store.generateCode(sessionId);
  if (result.success) {
    message.success("Code generated");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleReview(sessionId: string) {
  const result = await store.reviewCode(sessionId);
  if (result.success) {
    message.success("Review complete");
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchSessions();
});
</script>

<style lang="less" scoped>
.autonomous-developer-page {
  padding: 24px;
}
</style>
