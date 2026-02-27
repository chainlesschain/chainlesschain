<template>
  <div class="nostr-bridge-page">
    <a-page-header title="Nostr Bridge" sub-title="NIP-01 relay management and event browser">
      <template #extra>
        <a-space>
          <a-button @click="showAddRelay = true">Add Relay</a-button>
          <a-button type="primary" @click="handleGenerateKey" :loading="store.loading">Generate Key</a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-tabs v-model:activeKey="activeTab">
      <!-- Relays Tab -->
      <a-tab-pane key="relays" tab="Relays">
        <a-empty v-if="store.relays.length === 0" description="No relays configured" />
        <a-table v-else :columns="relayColumns" :data-source="store.relays" :loading="store.loading" row-key="id" size="small">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-badge :status="record.status === 'connected' ? 'success' : 'default'" :text="record.status" />
            </template>
            <template v-if="column.key === 'permissions'">
              <a-space>
                <a-tag v-if="record.read_enabled" color="blue">Read</a-tag>
                <a-tag v-if="record.write_enabled" color="green">Write</a-tag>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Events Tab -->
      <a-tab-pane key="events" tab="Events">
        <a-space style="margin-bottom: 16px">
          <a-button @click="handleFetchEvents" :loading="store.loading">Refresh</a-button>
          <a-button type="primary" @click="showPublish = true">Publish Event</a-button>
        </a-space>
        <a-table :columns="eventColumns" :data-source="store.events" :loading="store.loading" row-key="id" size="small">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'kind'">
              <a-tag>{{ kindLabel(record.kind) }}</a-tag>
            </template>
            <template v-if="column.key === 'content'">
              <a-typography-paragraph :ellipsis="{ rows: 2 }" :content="record.content" />
            </template>
            <template v-if="column.key === 'created_at'">
              {{ formatDate(record.created_at) }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Identity Tab -->
      <a-tab-pane key="identity" tab="Identity">
        <a-card v-if="store.keyPair" title="Your Nostr Identity" size="small">
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="npub">
              <a-typography-text code copyable :content="store.keyPair.npub">{{ store.keyPair.npub }}</a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="Public Key (hex)">
              <a-typography-text code copyable :content="store.keyPair.publicKeyHex">{{ truncate(store.keyPair.publicKeyHex) }}</a-typography-text>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
        <a-empty v-else description="No key pair generated" />
      </a-tab-pane>
    </a-tabs>

    <!-- Add Relay Modal -->
    <a-modal v-model:open="showAddRelay" title="Add Relay" @ok="handleAddRelay" :confirm-loading="store.loading">
      <a-form-item label="Relay URL">
        <a-input v-model:value="newRelayUrl" placeholder="wss://relay.example.com" />
      </a-form-item>
    </a-modal>

    <!-- Publish Event Modal -->
    <a-modal v-model:open="showPublish" title="Publish Event" @ok="handlePublish" :confirm-loading="store.loading">
      <a-form layout="vertical">
        <a-form-item label="Kind">
          <a-select v-model:value="publishForm.kind">
            <a-select-option :value="1">Text Note</a-select-option>
            <a-select-option :value="0">Set Metadata</a-select-option>
            <a-select-option :value="3">Contacts</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="Content">
          <a-textarea v-model:value="publishForm.content" :rows="4" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-alert v-if="store.error" type="error" :message="store.error" closable @close="store.error = null" style="margin-top: 16px" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useNostrBridgeStore } from '../../stores/nostrBridge';

const store = useNostrBridgeStore();
const activeTab = ref('relays');
const showAddRelay = ref(false);
const showPublish = ref(false);
const newRelayUrl = ref('');
const publishForm = ref({ kind: 1, content: '' });

const relayColumns = [
  { title: 'URL', dataIndex: 'url', key: 'url' },
  { title: 'Status', key: 'status' },
  { title: 'Events', dataIndex: 'event_count', key: 'event_count' },
  { title: 'Permissions', key: 'permissions' },
];

const eventColumns = [
  { title: 'Kind', key: 'kind', width: 120 },
  { title: 'Content', key: 'content' },
  { title: 'Relay', dataIndex: 'relay_url', key: 'relay_url', width: 200 },
  { title: 'Time', key: 'created_at', width: 160 },
];

const kindMap: Record<number, string> = { 0: 'Metadata', 1: 'Text Note', 2: 'Recommend Relay', 3: 'Contacts', 4: 'Encrypted DM', 5: 'Delete', 6: 'Repost', 7: 'Reaction' };
function kindLabel(kind: number) { return kindMap[kind] || `Kind ${kind}`; }
function formatDate(ts: number) { return ts ? new Date(ts * 1000).toLocaleString() : '-'; }
function truncate(s: string) { return s && s.length > 32 ? s.slice(0, 32) + '...' : s; }

async function handleAddRelay() {
  if (!newRelayUrl.value) return;
  const result = await store.addRelay(newRelayUrl.value);
  if (result.success) { message.success('Relay added'); showAddRelay.value = false; newRelayUrl.value = ''; }
  else message.error(result.error || 'Failed');
}

async function handleFetchEvents() { await store.fetchEvents(); }

async function handlePublish() {
  if (!publishForm.value.content) return;
  const result = await store.publishEvent(publishForm.value.kind, publishForm.value.content);
  if (result.success) { message.success('Event published'); showPublish.value = false; publishForm.value.content = ''; await store.fetchEvents(); }
  else message.error(result.error || 'Failed');
}

async function handleGenerateKey() {
  const result = await store.generateKeyPair();
  if (result.success) message.success('Key pair generated');
  else message.error(result.error || 'Failed');
}

onMounted(async () => {
  await store.fetchRelays();
  await store.fetchEvents();
});
</script>

<style lang="less" scoped>
.nostr-bridge-page {
  padding: 24px;
}
</style>
