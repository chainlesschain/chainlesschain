<template>
  <div class="pqc-ecosystem-page">
    <a-page-header
      title="PQC Full Migration"
      sub-title="Post-quantum cryptography ecosystem migration"
    />
    <a-card title="Subsystem Coverage" style="margin-bottom: 16px">
      <a-empty v-if="!store.coverage" description="No coverage data" />
      <a-descriptions v-else bordered size="small">
        <a-descriptions-item
          v-for="(v, k) in store.coverage"
          :key="k"
          :label="String(k)"
        >
          <a-progress :percent="v.percentage" size="small" />
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
    <a-space>
      <a-button type="primary" :loading="store.loading" @click="handleVerify">
        Verify Migration
      </a-button>
      <a-select
        v-model:value="selectedSubsystem"
        :options="subsystems"
        style="width: 150px"
      />
      <a-button @click="handleMigrate"> Migrate Subsystem </a-button>
    </a-space>
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
import { usePQCEcosystemStore } from "../../stores/pqcEcosystem";

const store = usePQCEcosystemStore();
const selectedSubsystem = ref("p2p");
const subsystems = ["p2p", "did", "storage", "messaging", "auth", "ukey"].map(
  (s) => ({ value: s, label: s }),
);

async function handleVerify() {
  const r = await store.verifyMigration();
  if (r.success) {
    message.success(r.verified ? "All migrated" : "Migration incomplete");
  } else {
    message.error(r.error || "Failed");
  }
}

async function handleMigrate() {
  const r = await store.migrateSubsystem({
    subsystem: selectedSubsystem.value,
  });
  if (r.success) {
    message.success(`${selectedSubsystem.value} migrated`);
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(() => store.fetchCoverage());
</script>

<style lang="less" scoped>
.pqc-ecosystem-page {
  padding: 24px;
}
</style>
