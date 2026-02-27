<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

const loading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref('status');

// Status
const syncStatus = reactive({
  initialized: false,
  domain: '',
  actorCount: 0,
  activityCount: 0,
  published: 0,
  received: 0,
  pending: 0,
});

// Actor creation
const actorForm = reactive({
  did: '',
  username: '',
  displayName: '',
  bio: '',
});

// WebFinger lookup
const webfingerAddress = ref('');
const webfingerResult = ref<any>(null);

// Publish post
const publishForm = reactive({
  actorDid: '',
  content: '',
});

async function fetchStatus() {
  loading.value = true;
  try {
    const result = await invoke('ap:sync-status');
    if (result && result.success !== false) {
      Object.assign(syncStatus, result);
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handleCreateActor() {
  loading.value = true;
  error.value = null;
  try {
    await invoke('ap:create-actor', {
      did: actorForm.did,
      profile: {
        username: actorForm.username,
        displayName: actorForm.displayName,
        bio: actorForm.bio,
      },
    });
    await fetchStatus();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handleWebFingerLookup() {
  if (!webfingerAddress.value.trim()) return;
  loading.value = true;
  error.value = null;
  try {
    webfingerResult.value = await invoke('ap:webfinger-lookup', { address: webfingerAddress.value });
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handlePublishPost() {
  if (!publishForm.content.trim()) return;
  loading.value = true;
  error.value = null;
  try {
    await invoke('ap:publish-post', {
      actorDid: publishForm.actorDid,
      post: { content: publishForm.content, id: Date.now().toString() },
    });
    publishForm.content = '';
    await fetchStatus();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handleSyncNow() {
  loading.value = true;
  try {
    await invoke('ap:sync-now');
    await fetchStatus();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchStatus);
</script>

<template>
  <div class="activitypub-bridge-page">
    <a-page-header title="ActivityPub Bridge" sub-title="Federated social network integration" />

    <a-tabs v-model:activeKey="activeTab">
      <a-tab-pane key="status" tab="Bridge Status">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-statistic title="Local Actors" :value="syncStatus.actorCount" />
          </a-col>
          <a-col :span="6">
            <a-statistic title="Published" :value="syncStatus.published" />
          </a-col>
          <a-col :span="6">
            <a-statistic title="Received" :value="syncStatus.received" />
          </a-col>
          <a-col :span="6">
            <a-statistic title="Pending Sync" :value="syncStatus.pending" />
          </a-col>
        </a-row>

        <a-space style="margin-top: 16px">
          <a-button :loading="loading" @click="fetchStatus">Refresh</a-button>
          <a-button type="primary" :loading="loading" @click="handleSyncNow">Sync Now</a-button>
        </a-space>

        <a-descriptions style="margin-top: 16px" :column="2" bordered size="small">
          <a-descriptions-item label="Domain">{{ syncStatus.domain || 'Not configured' }}</a-descriptions-item>
          <a-descriptions-item label="Initialized">
            <a-tag :color="syncStatus.initialized ? 'green' : 'red'">{{ syncStatus.initialized ? 'Yes' : 'No' }}</a-tag>
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="actor" tab="Actor Management">
        <a-card title="Create Local Actor" :bordered="false">
          <a-form layout="vertical">
            <a-form-item label="DID">
              <a-input v-model:value="actorForm.did" placeholder="did:chainlesschain:..." />
            </a-form-item>
            <a-form-item label="Username">
              <a-input v-model:value="actorForm.username" placeholder="preferred_username" />
            </a-form-item>
            <a-form-item label="Display Name">
              <a-input v-model:value="actorForm.displayName" placeholder="Display Name" />
            </a-form-item>
            <a-form-item label="Bio">
              <a-textarea v-model:value="actorForm.bio" placeholder="Bio / summary" :rows="2" />
            </a-form-item>
            <a-button type="primary" :loading="loading" @click="handleCreateActor">Create Actor</a-button>
          </a-form>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="discover" tab="User Discovery">
        <a-card title="WebFinger Lookup" :bordered="false">
          <a-input-search
            v-model:value="webfingerAddress"
            placeholder="user@mastodon.social"
            enter-button="Lookup"
            :loading="loading"
            @search="handleWebFingerLookup"
          />
          <a-card v-if="webfingerResult" style="margin-top: 16px" size="small">
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="Address">{{ webfingerResult.address }}</a-descriptions-item>
              <a-descriptions-item label="Actor URL">{{ webfingerResult.actorUrl || 'N/A' }}</a-descriptions-item>
              <a-descriptions-item label="Aliases">
                <a-tag v-for="alias in (webfingerResult.aliases || [])" :key="alias">{{ alias }}</a-tag>
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-card>
      </a-tab-pane>

      <a-tab-pane key="publish" tab="Publish">
        <a-card title="Publish to Federation" :bordered="false">
          <a-form layout="vertical">
            <a-form-item label="Actor DID">
              <a-input v-model:value="publishForm.actorDid" placeholder="did:chainlesschain:..." />
            </a-form-item>
            <a-form-item label="Content">
              <a-textarea v-model:value="publishForm.content" placeholder="Write your post..." :rows="4" />
            </a-form-item>
            <a-button type="primary" :loading="loading" @click="handlePublishPost">Publish</a-button>
          </a-form>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <a-alert v-if="error" :message="error" type="error" closable style="margin-top: 16px" @close="error = null" />
  </div>
</template>

<style lang="less" scoped>
.activitypub-bridge-page {
  padding: 24px;
}
</style>
