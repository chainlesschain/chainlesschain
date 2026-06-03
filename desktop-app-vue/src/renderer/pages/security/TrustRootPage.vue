<template>
  <div class="trust-root-page">
    <a-page-header
      title="Trinity Trust Root"
      sub-title="U-Key + SIMKey + TEE unified trust"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Devices" :value="store.status?.totalDevices || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Verified" :value="store.status?.verified || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Boot Verified"
          :value="store.bootStatus?.bootVerified || 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Unverified"
          :value="store.status?.unverified || 0"
        />
      </a-col>
    </a-row>
    <a-card title="Verify Trust Chain">
      <a-input-group compact>
        <a-input
          v-model:value="deviceId"
          placeholder="Device ID"
          style="width: 300px"
        />
        <a-button type="primary" :loading="store.loading" @click="handleVerify">
          Verify Chain
        </a-button>
      </a-input-group>
    </a-card>
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
import { useTrustRootStore } from "../../stores/trustRoot";

const store = useTrustRootStore();
const deviceId = ref("");

async function handleVerify() {
  if (!deviceId.value) {
    message.warning("Device ID is required");
    return;
  }
  const r = await store.verifyChain(deviceId.value);
  if (r.success) {
    message.success("Trust chain verified");
    await store.fetchStatus();
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchStatus();
  await store.fetchBootStatus();
});
</script>

<style lang="less" scoped>
.trust-root-page {
  padding: 24px;
}
</style>
