<template>
  <div class="hsm-adapter-page">
    <a-page-header
      title="HSM Adapters"
      sub-title="Unified hardware security module management"
    >
      <template #extra>
        <a-button type="primary" @click="showConnectModal = true">
          Connect Device
        </a-button>
      </template>
    </a-page-header>
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Adapters" :value="store.adapters.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Connected"
          :value="store.connectedAdapters.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Compliance"
          :value="store.complianceStatus?.complianceLevel || 'N/A'"
        />
      </a-col>
    </a-row>
    <a-table
      :columns="columns"
      :data-source="store.adapters"
      :loading="store.loading"
      row-key="id"
      size="small"
    />
    <a-modal
      v-model:open="showConnectModal"
      title="Connect HSM Device"
      @ok="handleConnect"
    >
      <a-form layout="vertical">
        <a-form-item label="Vendor">
          <a-select v-model:value="form.vendor" :options="vendors" />
        </a-form-item>
        <a-form-item label="Model">
          <a-input v-model:value="form.model" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useHsmAdapterStore } from "../../stores/hsmAdapter";

const store = useHsmAdapterStore();
const showConnectModal = ref(false);
const form = ref({ vendor: "yubikey", model: "" });
const vendors = [
  { value: "yubikey", label: "YubiKey" },
  { value: "ledger", label: "Ledger" },
  { value: "trezor", label: "Trezor" },
];
const columns = [
  { title: "Vendor", dataIndex: "vendor", width: 100 },
  { title: "Model", dataIndex: "model", width: 150 },
  { title: "Status", dataIndex: "status", width: 100 },
  { title: "FIPS", dataIndex: "fips_compliant", width: 80 },
];

async function handleConnect() {
  const r = await store.connectDevice(form.value);
  if (r.success) {
    message.success("Device connected");
    showConnectModal.value = false;
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchAdapters();
  await store.fetchComplianceStatus();
});
</script>

<style lang="less" scoped>
.hsm-adapter-page {
  padding: 24px;
}
</style>
