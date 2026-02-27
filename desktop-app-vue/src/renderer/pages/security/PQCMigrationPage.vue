<template>
  <div class="pqc-migration-page">
    <a-page-header
      title="Post-Quantum Cryptography"
      sub-title="ML-KEM / ML-DSA key management and migration"
    >
      <template #extra>
        <a-space>
          <a-button :loading="store.loading" @click="showGenerateModal = true">
            Generate Key
          </a-button>
          <a-button type="primary" @click="showMigrateModal = true">
            Start Migration
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Active Keys" :value="store.activeKeys.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Hybrid Keys" :value="store.hybridKeys.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Completed Migrations"
          :value="store.completedMigrations.length"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="keys" tab="PQC Keys">
        <a-empty
          v-if="store.keys.length === 0"
          description="No PQC keys generated"
        />
        <a-table
          v-else
          :columns="keyColumns"
          :data-source="store.keys"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'algorithm'">
              <a-tag color="blue">
                {{ record.algorithm }}
              </a-tag>
            </template>
            <template v-if="column.key === 'purpose'">
              <a-tag>{{ record.purpose }}</a-tag>
            </template>
            <template v-if="column.key === 'hybrid'">
              <a-badge
                :status="record.hybrid_mode ? 'success' : 'default'"
                :text="record.hybrid_mode ? 'Hybrid' : 'Pure PQC'"
              />
            </template>
            <template v-if="column.key === 'status'">
              <a-badge
                :status="record.status === 'active' ? 'success' : 'default'"
                :text="record.status"
              />
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="migrations" tab="Migration Plans">
        <a-empty
          v-if="store.migrationPlans.length === 0"
          description="No migration plans"
        />
        <a-table
          v-else
          :columns="migrationColumns"
          :data-source="store.migrationPlans"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge
                :status="migrationStatusColor(record.status)"
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'progress'">
              {{ record.migrated_keys }} / {{ record.total_keys }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="algorithms" tab="Algorithm Info">
        <a-card size="small">
          <a-descriptions title="Supported PQC Algorithms" bordered :column="1">
            <a-descriptions-item label="ML-KEM-768">
              Key Encapsulation (NIST FIPS 203)
            </a-descriptions-item>
            <a-descriptions-item label="ML-KEM-1024">
              Key Encapsulation (Higher Security)
            </a-descriptions-item>
            <a-descriptions-item label="ML-DSA-65">
              Digital Signature (NIST FIPS 204)
            </a-descriptions-item>
            <a-descriptions-item label="ML-DSA-87">
              Digital Signature (Higher Security)
            </a-descriptions-item>
            <a-descriptions-item label="X25519-ML-KEM-768">
              Hybrid Key Exchange
            </a-descriptions-item>
            <a-descriptions-item label="Ed25519-ML-DSA-65">
              Hybrid Signature
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- Generate Key Modal -->
    <a-modal
      v-model:open="showGenerateModal"
      title="Generate PQC Key"
      :confirm-loading="store.loading"
      @ok="handleGenerateKey"
    >
      <a-form layout="vertical">
        <a-form-item label="Algorithm">
          <a-select v-model:value="generateForm.algorithm">
            <a-select-option value="ML-KEM-768"> ML-KEM-768 </a-select-option>
            <a-select-option value="ML-KEM-1024"> ML-KEM-1024 </a-select-option>
            <a-select-option value="ML-DSA-65"> ML-DSA-65 </a-select-option>
            <a-select-option value="ML-DSA-87"> ML-DSA-87 </a-select-option>
            <a-select-option value="X25519-ML-KEM-768">
              X25519-ML-KEM-768 (Hybrid)
            </a-select-option>
            <a-select-option value="Ed25519-ML-DSA-65">
              Ed25519-ML-DSA-65 (Hybrid)
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="Purpose">
          <a-select v-model:value="generateForm.purpose">
            <a-select-option value="encryption"> Encryption </a-select-option>
            <a-select-option value="signing"> Signing </a-select-option>
            <a-select-option value="key_exchange">
              Key Exchange
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Migration Modal -->
    <a-modal
      v-model:open="showMigrateModal"
      title="Start Migration"
      :confirm-loading="store.loading"
      @ok="handleMigration"
    >
      <a-form layout="vertical">
        <a-form-item label="Plan Name">
          <a-input
            v-model:value="migrateForm.planName"
            placeholder="e.g., Migrate RSA to ML-KEM"
          />
        </a-form-item>
        <a-form-item label="Source Algorithm">
          <a-input
            v-model:value="migrateForm.sourceAlgorithm"
            placeholder="e.g., RSA-2048"
          />
        </a-form-item>
        <a-form-item label="Target Algorithm">
          <a-select v-model:value="migrateForm.targetAlgorithm">
            <a-select-option value="ML-KEM-768"> ML-KEM-768 </a-select-option>
            <a-select-option value="ML-KEM-1024"> ML-KEM-1024 </a-select-option>
            <a-select-option value="ML-DSA-65"> ML-DSA-65 </a-select-option>
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
import { usePqcMigrationStore } from "../../stores/pqcMigration";

const store = usePqcMigrationStore();
const activeTab = ref("keys");
const showGenerateModal = ref(false);
const showMigrateModal = ref(false);

const generateForm = ref({ algorithm: "ML-KEM-768", purpose: "encryption" });
const migrateForm = ref({
  planName: "",
  sourceAlgorithm: "",
  targetAlgorithm: "ML-KEM-768",
});

const keyColumns = [
  { title: "Algorithm", key: "algorithm", width: 180 },
  { title: "Purpose", key: "purpose", width: 120 },
  { title: "Key Size", dataIndex: "key_size", width: 100 },
  { title: "Mode", key: "hybrid", width: 120 },
  { title: "Status", key: "status", width: 100 },
];

const migrationColumns = [
  { title: "Plan Name", dataIndex: "plan_name" },
  { title: "Source", dataIndex: "source_algorithm", width: 150 },
  { title: "Target", dataIndex: "target_algorithm", width: 150 },
  { title: "Progress", key: "progress", width: 120 },
  { title: "Status", key: "status", width: 120 },
];

function migrationStatusColor(
  status: string,
): "success" | "processing" | "error" | "default" {
  return (
    (
      {
        completed: "success",
        in_progress: "processing",
        failed: "error",
        pending: "default",
      } as Record<string, "success" | "processing" | "error" | "default">
    )[status] || "default"
  );
}

async function handleGenerateKey() {
  const { algorithm, purpose } = generateForm.value;
  const isHybrid =
    algorithm.includes("X25519") || algorithm.includes("Ed25519");
  const result = await store.generateKey(algorithm, purpose, isHybrid);
  if (result.success) {
    message.success("Key generated");
    showGenerateModal.value = false;
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleMigration() {
  if (!migrateForm.value.planName) {
    message.warning("Plan name is required");
    return;
  }
  const { planName, sourceAlgorithm, targetAlgorithm } = migrateForm.value;
  const result = await store.executeMigration(
    planName,
    sourceAlgorithm,
    targetAlgorithm,
  );
  if (result.success) {
    message.success("Migration completed");
    showMigrateModal.value = false;
    migrateForm.value.planName = "";
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchKeys();
  await store.fetchMigrationStatus();
});
</script>

<style lang="less" scoped>
.pqc-migration-page {
  padding: 24px;
}
</style>
