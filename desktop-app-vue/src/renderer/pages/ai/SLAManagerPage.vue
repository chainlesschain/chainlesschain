<template>
  <div class="sla-manager-page">
    <a-page-header
      title="Cross-Org SLA Manager"
      sub-title="Service Level Agreement contracts and compliance"
    >
      <template #extra>
        <a-button type="primary" @click="showCreateModal = true">
          New Contract
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Contracts" :value="store.contracts.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Active" :value="store.activeContracts.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Violations" :value="store.violationCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Unresolved"
          :value="store.unresolvedViolations.length"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="contracts" tab="Contracts">
        <a-empty
          v-if="store.contracts.length === 0"
          description="No contracts"
        />
        <a-table
          v-else
          :columns="contractColumns"
          :data-source="store.contracts"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge
                :status="
                  record.status === 'active'
                    ? 'success'
                    : record.status === 'violated'
                      ? 'error'
                      : 'default'
                "
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'actions'">
              <a-button
                size="small"
                type="link"
                @click="handleCheckCompliance(record.id)"
              >
                Check
              </a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="violations" tab="Violations">
        <a-empty
          v-if="store.violations.length === 0"
          description="No violations"
        />
        <a-table
          v-else
          :columns="violationColumns"
          :data-source="store.violations"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'severity'">
              <a-tag
                :color="
                  record.severity === 'critical'
                    ? 'red'
                    : record.severity === 'major'
                      ? 'orange'
                      : 'blue'
                "
              >
                {{ record.severity }}
              </a-tag>
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <a-modal
      v-model:open="showCreateModal"
      title="Create SLA Contract"
      :confirm-loading="store.loading"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="Name">
          <a-input
            v-model:value="createForm.name"
            placeholder="Contract name"
          />
        </a-form-item>
        <a-form-item label="Partner Organization">
          <a-input
            v-model:value="createForm.partnerOrgId"
            placeholder="Partner org ID"
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
import { useSLAManagerStore } from "../../stores/slaManager";

const store = useSLAManagerStore();
const activeTab = ref("contracts");
const showCreateModal = ref(false);
const createForm = ref({ name: "", partnerOrgId: "" });

const contractColumns = [
  { title: "Name", dataIndex: "name", width: 200 },
  { title: "Status", key: "status", width: 100 },
  { title: "Partner", dataIndex: "partner_org_id", width: 150 },
  { title: "Actions", key: "actions", width: 100 },
];

const violationColumns = [
  { title: "Metric", dataIndex: "metric", width: 150 },
  { title: "Severity", key: "severity", width: 100 },
  { title: "Expected", dataIndex: "expected_value", width: 120 },
  { title: "Actual", dataIndex: "actual_value", width: 120 },
  { title: "Description", dataIndex: "description" },
];

async function handleCreate() {
  if (!createForm.value.name) {
    message.warning("Contract name is required");
    return;
  }
  const result = await store.createContract(
    createForm.value.name,
    undefined,
    undefined,
    createForm.value.partnerOrgId,
  );
  if (result.success) {
    message.success("Contract created");
    showCreateModal.value = false;
    createForm.value.name = "";
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleCheckCompliance(contractId: string) {
  const result = await store.checkCompliance(contractId);
  if (result.success) {
    if (result.isCompliant) {
      message.success("Compliant");
    } else {
      message.warning("Violations detected");
    }
    activeTab.value = "violations";
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchContracts();
  await store.fetchViolations();
});
</script>

<style lang="less" scoped>
.sla-manager-page {
  padding: 24px;
}
</style>
