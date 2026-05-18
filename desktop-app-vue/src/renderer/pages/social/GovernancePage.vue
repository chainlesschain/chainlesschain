<template>
  <div class="governance-page">
    <a-page-header
      title="AI Community Governance"
      sub-title="Proposal management, impact analysis, and voting prediction"
    >
      <template #extra>
        <a-button type="primary" @click="showCreateModal = true">
          New Proposal
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Total Proposals" :value="store.proposalCount" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Active" :value="store.activeProposals.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Drafts" :value="store.draftProposals.length" />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="proposals" tab="Proposals">
        <a-empty
          v-if="store.proposals.length === 0"
          description="No proposals yet"
        />
        <a-table
          v-else
          :columns="proposalColumns"
          :data-source="store.proposals"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <a-tag :color="typeColor(record.type)">
                {{ record.type }}
              </a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-badge
                :status="statusColor(record.status)"
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'impact'">
              <a-tag
                v-if="record.impact_level"
                :color="impactColor(record.impact_level)"
              >
                {{ record.impact_level }}
              </a-tag>
              <span v-else>-</span>
            </template>
            <template v-if="column.key === 'actions'">
              <a-space>
                <a-button
                  size="small"
                  type="link"
                  @click="handleAnalyze(record.id)"
                >
                  Analyze
                </a-button>
                <a-button
                  size="small"
                  type="link"
                  @click="handlePredict(record.id)"
                >
                  Predict
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="analysis" tab="Impact Analysis">
        <a-empty
          v-if="!store.currentAnalysis"
          description="Select a proposal to analyze"
        />
        <a-card v-else size="small">
          <a-descriptions title="Impact Analysis" bordered :column="2">
            <a-descriptions-item label="Impact Level">
              <a-tag :color="impactColor(store.currentAnalysis.impact_level)">
                {{ store.currentAnalysis.impact_level }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="Risk Score">
              {{ (store.currentAnalysis.risk_score * 100).toFixed(0) }}%
            </a-descriptions-item>
            <a-descriptions-item label="Benefit Score">
              {{ (store.currentAnalysis.benefit_score * 100).toFixed(0) }}%
            </a-descriptions-item>
            <a-descriptions-item label="Effort">
              {{ store.currentAnalysis.estimated_effort }}
            </a-descriptions-item>
            <a-descriptions-item label="Sentiment">
              {{ store.currentAnalysis.community_sentiment }}
            </a-descriptions-item>
            <a-descriptions-item label="Components">
              {{ store.currentAnalysis.affected_components?.join(", ") }}
            </a-descriptions-item>
          </a-descriptions>
          <a-divider />
          <h4>Recommendations</h4>
          <a-list
            size="small"
            :data-source="store.currentAnalysis.recommendations || []"
          >
            <template #renderItem="{ item }">
              <a-list-item>{{ item }}</a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- Create Proposal Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="Create Proposal"
      :confirm-loading="store.loading"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="Title">
          <a-input
            v-model:value="createForm.title"
            placeholder="Proposal title"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="createForm.description"
            :rows="3"
            placeholder="Describe the proposal"
          />
        </a-form-item>
        <a-form-item label="Type">
          <a-select v-model:value="createForm.type">
            <a-select-option value="feature_request">
              Feature Request
            </a-select-option>
            <a-select-option value="parameter_change">
              Parameter Change
            </a-select-option>
            <a-select-option value="policy_update">
              Policy Update
            </a-select-option>
            <a-select-option value="budget_allocation">
              Budget Allocation
            </a-select-option>
          </a-select>
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
import { useGovernanceStore } from "../../stores/governance";

const store = useGovernanceStore();
const activeTab = ref("proposals");
const showCreateModal = ref(false);
const createForm = ref({ title: "", description: "", type: "feature_request" });

const proposalColumns = [
  { title: "Title", dataIndex: "title" },
  { title: "Type", key: "type", width: 150 },
  { title: "Status", key: "status", width: 100 },
  { title: "Impact", key: "impact", width: 100 },
  {
    title: "Votes (Y/N)",
    customRender: ({ record }: any) => `${record.vote_yes}/${record.vote_no}`,
    width: 100,
  },
  { title: "Actions", key: "actions", width: 160 },
];

function typeColor(t: string) {
  return (
    {
      feature_request: "blue",
      parameter_change: "orange",
      policy_update: "green",
      budget_allocation: "purple",
    }[t] || "default"
  );
}
function statusColor(
  s: string,
): "processing" | "success" | "error" | "default" | "warning" {
  return (
    (
      {
        active: "processing",
        passed: "success",
        rejected: "error",
        draft: "default",
        expired: "warning",
      } as Record<
        string,
        "processing" | "success" | "error" | "default" | "warning"
      >
    )[s] || "default"
  );
}
function impactColor(l: string) {
  return (
    { low: "green", medium: "orange", high: "red", critical: "red" }[l] ||
    "default"
  );
}

async function handleCreate() {
  if (!createForm.value.title) {
    message.warning("Title is required");
    return;
  }
  const { title, description, type } = createForm.value;
  const result = await store.createProposal(title, description, type);
  if (result.success) {
    message.success("Proposal created");
    showCreateModal.value = false;
    createForm.value.title = "";
    createForm.value.description = "";
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleAnalyze(proposalId: string) {
  const result = await store.analyzeImpact(proposalId);
  if (result.success) {
    activeTab.value = "analysis";
    message.success("Analysis complete");
  } else {
    message.error(result.error || "Analysis failed");
  }
}

async function handlePredict(proposalId: string) {
  const result = await store.predictVote(proposalId);
  if (result.success) {
    message.success(
      `Predicted outcome: ${result.prediction?.predicted_outcome}`,
    );
  } else {
    message.error(result.error || "Prediction failed");
  }
}

onMounted(async () => {
  await store.fetchProposals();
});
</script>

<style lang="less" scoped>
.governance-page {
  padding: 24px;
}
</style>
