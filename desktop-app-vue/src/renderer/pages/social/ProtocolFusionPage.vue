<template>
  <div class="protocol-fusion-page">
    <a-page-header
      title="Protocol Fusion"
      sub-title="Multi-protocol unified messaging"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Messages" :value="store.feed.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Identity Mappings"
          :value="store.identityMap.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Protocols"
          :value="Object.keys(store.protocolStatus || {}).length"
        />
      </a-col>
    </a-row>
    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="feed" tab="Unified Feed">
        <a-empty v-if="store.feed.length === 0" description="No messages" />
        <a-table
          v-else
          :columns="feedColumns"
          :data-source="store.feed"
          row-key="id"
          size="small"
        />
      </a-tab-pane>
      <a-tab-pane key="identity" tab="Identity Mapping">
        <a-table
          :columns="idColumns"
          :data-source="store.identityMap"
          row-key="id"
          size="small"
        />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useProtocolFusionStore } from "../../stores/protocolFusion";

const store = useProtocolFusionStore();
const activeTab = ref("feed");
const feedColumns = [
  { title: "Protocol", dataIndex: "source_protocol", width: 100 },
  { title: "Sender", dataIndex: "sender_id", width: 150 },
  { title: "Content", dataIndex: "content" },
];
const idColumns = [
  { title: "DID", dataIndex: "did_id", width: 200 },
  { title: "ActivityPub", dataIndex: "activitypub_id", width: 200 },
  { title: "Nostr", dataIndex: "nostr_pubkey", width: 200 },
  { title: "Matrix", dataIndex: "matrix_id", width: 200 },
];

onMounted(async () => {
  await store.fetchFeed();
  await store.fetchIdentityMap();
  await store.fetchProtocolStatus();
});
</script>

<style lang="less" scoped>
.protocol-fusion-page {
  padding: 24px;
}
</style>
