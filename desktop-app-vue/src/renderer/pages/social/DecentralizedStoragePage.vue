<template>
  <div class="decentralized-storage-page">
    <a-page-header
      title="Decentralized Storage"
      sub-title="Filecoin deals and P2P content distribution"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic
          title="Total Deals"
          :value="store.storageStats?.totalDeals || 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Active Deals" :value="store.activeDeals.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Total Size"
          :value="store.storageStats?.totalSizeBytes || 0"
          suffix="bytes"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Cost (FIL)"
          :value="store.storageStats?.totalCostFil || 0"
          :precision="4"
        />
      </a-col>
    </a-row>
    <a-card title="Store to Filecoin">
      <a-input-group compact>
        <a-input
          v-model:value="cid"
          placeholder="Content CID"
          style="width: 400px"
        />
        <a-button type="primary" @click="handleStore"> Store </a-button>
      </a-input-group>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useDecentralizedStorageStore } from "../../stores/decentralizedStorage";

const store = useDecentralizedStorageStore();
const cid = ref("");

async function handleStore() {
  if (!cid.value) {
    message.warning("CID is required");
    return;
  }
  const r = await store.storeToFilecoin({ cid: cid.value });
  if (r.success) {
    message.success("Stored to Filecoin");
    await store.fetchStorageStats();
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(() => store.fetchStorageStats());
</script>

<style lang="less" scoped>
.decentralized-storage-page {
  padding: 24px;
}
</style>
