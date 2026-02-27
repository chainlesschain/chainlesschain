<template>
  <div class="terraform-provider-page">
    <a-page-header
      title="Terraform Provider"
      sub-title="Infrastructure as Code workspace management"
    >
      <template #extra>
        <a-button type="primary" @click="showCreateModal = true">
          New Workspace
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic
          title="Workspaces"
          :value="store.activeWorkspaces.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Recent Runs" :value="store.recentRuns.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Total Resources" :value="store.totalResources" />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="workspaces" tab="Workspaces">
        <a-empty
          v-if="store.workspaces.length === 0"
          description="No workspaces"
        />
        <a-table
          v-else
          :columns="workspaceColumns"
          :data-source="store.workspaces"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge
                :status="record.status === 'active' ? 'success' : 'default'"
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'providers'">
              <a-tag v-for="p in record.providers || []" :key="p">
                {{ p }}
              </a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <a-space>
                <a-button
                  size="small"
                  type="link"
                  @click="handlePlan(record.id)"
                >
                  Plan
                </a-button>
                <a-button
                  size="small"
                  type="link"
                  @click="handleApply(record.id)"
                >
                  Apply
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="runs" tab="Runs">
        <a-empty v-if="store.runs.length === 0" description="No runs yet" />
        <a-table
          v-else
          :columns="runColumns"
          :data-source="store.runs"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge
                :status="runStatusColor(record.status)"
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'resources'">
              <span style="color: green">+{{ record.resources_added }}</span>
              <span style="color: orange; margin: 0 4px"
                >~{{ record.resources_changed }}</span
              >
              <span style="color: red">-{{ record.resources_destroyed }}</span>
            </template>
            <template v-if="column.key === 'completed_at'">
              {{ formatDate(record.completed_at) }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- Create Workspace Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="Create Workspace"
      :confirm-loading="store.loading"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="Name">
          <a-input v-model:value="createForm.name" placeholder="my-workspace" />
        </a-form-item>
        <a-form-item label="Description">
          <a-input
            v-model:value="createForm.description"
            placeholder="Workspace description"
          />
        </a-form-item>
        <a-form-item label="Terraform Version">
          <a-select v-model:value="createForm.version">
            <a-select-option value="1.9.0"> 1.9.0 </a-select-option>
            <a-select-option value="1.8.0"> 1.8.0 </a-select-option>
            <a-select-option value="1.7.0"> 1.7.0 </a-select-option>
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
import { useTerraformStore } from "../../stores/terraform";

const store = useTerraformStore();
const activeTab = ref("workspaces");
const showCreateModal = ref(false);
const createForm = ref({ name: "", description: "", version: "1.9.0" });

const workspaceColumns = [
  { title: "Name", dataIndex: "name", width: 180 },
  { title: "Version", dataIndex: "terraform_version", width: 100 },
  { title: "Status", key: "status", width: 100 },
  { title: "State Version", dataIndex: "state_version", width: 120 },
  { title: "Providers", key: "providers" },
  { title: "Actions", key: "actions", width: 150 },
];

const runColumns = [
  { title: "Type", dataIndex: "run_type", width: 80 },
  { title: "Status", key: "status", width: 100 },
  { title: "Resources", key: "resources", width: 150 },
  { title: "Triggered By", dataIndex: "triggered_by", width: 120 },
  { title: "Completed", key: "completed_at", width: 180 },
];

function formatDate(ts: number | null) {
  return ts ? new Date(ts).toLocaleString() : "N/A";
}
function runStatusColor(
  s: string,
): "success" | "error" | "processing" | "default" {
  return (
    (
      {
        planned: "success",
        applied: "success",
        errored: "error",
        planning: "processing",
        applying: "processing",
      } as Record<string, "success" | "error" | "processing" | "default">
    )[s] || "default"
  );
}

async function handleCreate() {
  if (!createForm.value.name) {
    message.warning("Workspace name is required");
    return;
  }
  const { name, description, version } = createForm.value;
  const result = await store.createWorkspace(name, description, version);
  if (result.success) {
    message.success("Workspace created");
    showCreateModal.value = false;
    createForm.value.name = "";
  } else {
    message.error(result.error || "Failed");
  }
}

async function handlePlan(workspaceId: string) {
  const result = await store.planRun(workspaceId, "plan");
  if (result.success) {
    message.success("Plan complete");
    activeTab.value = "runs";
  } else {
    message.error(result.error || "Plan failed");
  }
}

async function handleApply(workspaceId: string) {
  const result = await store.planRun(workspaceId, "apply");
  if (result.success) {
    message.success("Apply complete");
    activeTab.value = "runs";
  } else {
    message.error(result.error || "Apply failed");
  }
}

onMounted(async () => {
  await store.fetchWorkspaces();
  await store.fetchRuns();
});
</script>

<style lang="less" scoped>
.terraform-provider-page {
  padding: 24px;
}
</style>
