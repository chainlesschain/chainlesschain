<template>
  <div class="collaboration-governance-page">
    <a-page-header
      title="Collaboration Governance"
      sub-title="Human-AI decision approval and progressive autonomy"
    />

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Pending Decisions" :value="store.pendingCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Autonomy Level"
          :value="store.currentLevel"
          suffix="/ 10"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Track Record"
          :value="(store.trackRecord * 100).toFixed(0)"
          suffix="%"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="decisions" tab="Pending Decisions">
        <a-empty
          v-if="store.pendingDecisions.length === 0"
          description="No pending decisions"
        />
        <a-table
          v-else
          :columns="decisionColumns"
          :data-source="store.pendingDecisions"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'confidence'">
              <a-progress
                :percent="Math.round(record.confidence * 100)"
                size="small"
              />
            </template>
            <template v-if="column.key === 'decision_type'">
              <a-tag :color="typeColor(record.decision_type)">
                {{ record.decision_type }}
              </a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <a-space>
                <a-button
                  size="small"
                  type="primary"
                  @click="handleApprove(record.id)"
                >
                  Approve
                </a-button>
                <a-button size="small" danger @click="handleReject(record.id)">
                  Reject
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="policy" tab="Autonomy Policy">
        <a-card title="Current Policy" style="max-width: 600px">
          <a-form layout="vertical">
            <a-form-item label="Autonomy Level">
              <a-slider
                v-model:value="policyForm.level"
                :min="0"
                :max="10"
                :marks="{
                  0: 'None',
                  2: 'Minimal',
                  5: 'Medium',
                  8: 'High',
                  10: 'Full',
                }"
              />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="handleUpdatePolicy">
                Update Policy
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>
    </a-tabs>

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
import { useCollaborationGovernanceStore } from "../../stores/collaborationGovernance";

const store = useCollaborationGovernanceStore();
const activeTab = ref("decisions");
const policyForm = ref({ level: 2 });

const decisionColumns = [
  { title: "Title", dataIndex: "title", width: 200 },
  { title: "Type", key: "decision_type", width: 120 },
  { title: "Confidence", key: "confidence", width: 150 },
  { title: "Actions", key: "actions", width: 180 },
];

function typeColor(type: string): string {
  return (
    (
      {
        architecture: "blue",
        security: "red",
        migration: "orange",
        deployment: "green",
      } as Record<string, string>
    )[type] || "default"
  );
}

async function handleApprove(decisionId: string) {
  const result = await store.approveDecision(decisionId);
  if (result.success) {
    message.success("Decision approved");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleReject(decisionId: string) {
  const result = await store.rejectDecision(decisionId);
  if (result.success) {
    message.success("Decision rejected");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleUpdatePolicy() {
  const result = await store.setAutonomyPolicy({
    level: policyForm.value.level,
  });
  if (result.success) {
    message.success("Policy updated");
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchPendingDecisions();
  await store.fetchAutonomyLevel();
  if (store.autonomyLevel) {
    policyForm.value.level = store.autonomyLevel.level;
  }
});
</script>

<style lang="less" scoped>
.collaboration-governance-page {
  padding: 24px;
}
</style>
