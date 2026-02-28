<template>
  <div class="anti-censorship-page">
    <a-page-header
      title="Anti-Censorship"
      sub-title="Tor, domain fronting, and mesh networking"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic
          title="Tor Status"
          :value="store.torStatus?.running ? 'Running' : 'Stopped'"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Active Routes"
          :value="store.connectivityReport?.activeRoutes || 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Domain Fronting"
          :value="
            store.connectivityReport?.domainFrontingEnabled
              ? 'Enabled'
              : 'Disabled'
          "
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Avg Latency"
          :value="store.connectivityReport?.avgLatency || 0"
          suffix="ms"
        />
      </a-col>
    </a-row>
    <a-space>
      <a-button type="primary" :loading="store.loading" @click="handleStartTor">
        Start Tor
      </a-button>
      <a-button @click="handleEnableDomainFronting">
        Enable Domain Fronting
      </a-button>
      <a-button @click="handleStartMesh"> Start Mesh Network </a-button>
    </a-space>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { message } from "ant-design-vue";
import { useAntiCensorshipStore } from "../../stores/antiCensorship";

const store = useAntiCensorshipStore();

async function handleStartTor() {
  const r = await store.startTor();
  if (r.success) {
    message.success("Tor started");
  } else {
    message.error(r.error || "Failed");
  }
}

async function handleEnableDomainFronting() {
  const r = await store.enableDomainFronting();
  if (r.success) {
    message.success("Domain fronting enabled");
  } else {
    message.error(r.error || "Failed");
  }
}

async function handleStartMesh() {
  const r = await store.startMesh();
  if (r.success) {
    message.success("Mesh network started");
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchTorStatus();
  await store.fetchConnectivityReport();
});
</script>

<style lang="less" scoped>
.anti-censorship-page {
  padding: 24px;
}
</style>
