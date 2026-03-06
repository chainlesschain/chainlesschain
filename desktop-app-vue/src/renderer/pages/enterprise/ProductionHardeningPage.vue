<template>
  <div class="production-hardening-page">
    <a-page-header
      title="Production Hardening"
      sub-title="Performance baselines and security auditing"
    >
      <template #extra>
        <a-space>
          <a-button type="primary" @click="handleCollectBaseline">
            Collect Baseline
          </a-button>
          <a-button @click="handleRunAudit"> Run Security Audit </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Baselines" :value="store.baselines.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Audit Reports" :value="store.auditReports.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Latest Risk Score"
          :value="store.latestAudit?.risk_score || 0"
          suffix="/ 100"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Regressions"
          :value="store.hasRegressions ? 'Yes' : 'No'"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="baselines" tab="Performance Baselines">
        <a-empty
          v-if="store.baselines.length === 0"
          description="No baselines collected"
        />
        <a-table
          v-else
          :columns="baselineColumns"
          :data-source="store.baselines"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge
                :status="
                  record.status === 'complete' ? 'success' : 'processing'
                "
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'created_at'">
              {{ formatDate(record.created_at) }}
            </template>
            <template v-if="column.key === 'actions'">
              <a-button
                size="small"
                type="link"
                @click="handleCompare(record.id)"
              >
                Compare
              </a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="audits" tab="Security Audits">
        <a-empty
          v-if="store.auditReports.length === 0"
          description="No audit reports"
        />
        <a-table
          v-else
          :columns="auditColumns"
          :data-source="store.auditReports"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'risk_score'">
              <a-tag :color="riskColor(record.risk_score)">
                {{ record.risk_score }}
              </a-tag>
            </template>
            <template v-if="column.key === 'created_at'">
              {{ formatDate(record.created_at) }}
            </template>
          </template>
        </a-table>
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
import { useHardeningStore } from "../../stores/hardening";

const store = useHardeningStore();
const activeTab = ref("baselines");

const baselineColumns = [
  { title: "Name", dataIndex: "name", width: 180 },
  { title: "Version", dataIndex: "version", width: 100 },
  { title: "Status", key: "status", width: 100 },
  { title: "Samples", dataIndex: "sample_count", width: 100 },
  { title: "Created", key: "created_at", width: 180 },
  { title: "Actions", key: "actions", width: 100 },
];

const auditColumns = [
  { title: "Name", dataIndex: "name", width: 200 },
  { title: "Risk Score", key: "risk_score", width: 120 },
  { title: "Status", dataIndex: "status", width: 100 },
  { title: "Created", key: "created_at", width: 180 },
];

function formatDate(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : "N/A";
}

function riskColor(score: number): string {
  if (score >= 70) {
    return "red";
  }
  if (score >= 40) {
    return "orange";
  }
  return "green";
}

async function handleCollectBaseline() {
  const name = `baseline-${new Date().toISOString().slice(0, 10)}`;
  const result = await store.collectBaseline(name);
  if (result.success) {
    message.success("Baseline collected");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleRunAudit() {
  const result = await store.runSecurityAudit();
  if (result.success) {
    message.success("Audit complete");
    activeTab.value = "audits";
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleCompare(baselineId: string) {
  const result = await store.compareBaseline(baselineId);
  if (result.success) {
    if (result.comparison?.hasRegressions) {
      message.warning(
        `Regressions detected: ${result.comparison.regressions.length}`,
      );
    } else {
      message.success("No regressions detected");
    }
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchBaselines();
  await store.fetchAuditReports();
});
</script>

<style lang="less" scoped>
.production-hardening-page {
  padding: 24px;
}
</style>
