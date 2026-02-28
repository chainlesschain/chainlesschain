<template>
  <div class="satellite-comm-page">
    <a-page-header
      title="Satellite Communication"
      sub-title="LEO satellite messaging and emergency recovery"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Messages" :value="store.messages.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Pending Sync"
          :value="store.recoveryStatus?.pendingSync || 0"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Offline Sigs"
          :value="store.recoveryStatus?.offlineSignatures || 0"
        />
      </a-col>
    </a-row>
    <a-card title="Send Satellite Message">
      <a-form layout="vertical" style="max-width: 400px">
        <a-form-item label="Recipient DID">
          <a-input v-model:value="form.recipientDid" />
        </a-form-item>
        <a-form-item label="Content">
          <a-textarea v-model:value="form.content" />
        </a-form-item>
        <a-button type="primary" @click="handleSend">
          Send via Satellite
        </a-button>
      </a-form>
    </a-card>
    <a-table
      :columns="columns"
      :data-source="store.messages"
      :loading="store.loading"
      row-key="id"
      size="small"
      style="margin-top: 16px"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useSatelliteStore } from "../../stores/satellite";

const store = useSatelliteStore();
const form = ref({ recipientDid: "", content: "" });
const columns = [
  { title: "Status", dataIndex: "status", width: 100 },
  { title: "Provider", dataIndex: "satellite_provider", width: 100 },
  { title: "Recipient", dataIndex: "recipient_did", width: 150 },
];

async function handleSend() {
  if (!form.value.content) {
    message.warning("Content is required");
    return;
  }
  const r = await store.sendMessage(form.value);
  if (r.success) {
    message.success("Message sent");
    await store.fetchMessages();
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchMessages();
  await store.fetchRecoveryStatus();
});
</script>

<style lang="less" scoped>
.satellite-comm-page {
  padding: 24px;
}
</style>
