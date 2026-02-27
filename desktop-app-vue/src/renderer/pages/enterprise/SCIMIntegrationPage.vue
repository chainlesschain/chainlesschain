<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) {return electronAPI.invoke(channel, ...args);}
  return Promise.reject(new Error('IPC not available'));
}

const loading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref('status');

const status = reactive({
  status: 'idle',
  lastSyncAt: null as number | null,
  connectorCount: 0,
  enabledConnectors: 0,
  recentHistory: [] as any[],
});

const connectors = ref<any[]>([]);
const users = ref<any[]>([]);
const totalUsers = ref(0);

const connectorForm = reactive({
  provider: 'azure_ad',
  endpoint: '',
  token: '',
  tenantId: '',
});

const providerOptions = [
  { label: 'Azure AD', value: 'azure_ad' },
  { label: 'Okta', value: 'okta' },
  { label: 'OneLogin', value: 'onelogin' },
  { label: 'Custom', value: 'custom' },
];

async function fetchStatus() {
  loading.value = true;
  try {
    const result = await invoke('scim:get-status');
    if (result?.success) {
      Object.assign(status, result);
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function fetchConnectors() {
  try {
    const result = await invoke('scim:get-connectors');
    if (result?.success) {
      connectors.value = result.connectors || [];
    }
  } catch (err: any) {
    error.value = err.message;
  }
}

async function fetchUsers() {
  loading.value = true;
  try {
    const result = await invoke('scim:list-users', {});
    if (result?.success) {
      users.value = result.Resources || [];
      totalUsers.value = result.totalResults || 0;
    }
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handleRegisterConnector() {
  loading.value = true;
  error.value = null;
  try {
    await invoke('scim:register-connector', {
      provider: connectorForm.provider,
      config: {
        endpoint: connectorForm.endpoint,
        token: connectorForm.token,
        tenantId: connectorForm.tenantId,
      },
    });
    await fetchConnectors();
    await fetchStatus();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function handleSync(provider: string) {
  loading.value = true;
  try {
    await invoke('scim:sync-provider', { provider });
    await fetchStatus();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await fetchStatus();
  await fetchConnectors();
});
</script>

<template>
  <div class="scim-integration-page">
    <a-page-header
      title="SCIM Integration"
      sub-title="SCIM 2.0 user and group synchronization"
    />

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane
        key="status"
        tab="Sync Status"
      >
        <a-row :gutter="16">
          <a-col :span="6">
            <a-statistic
              title="Status"
              :value="status.status"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Connectors"
              :value="status.connectorCount"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Active"
              :value="status.enabledConnectors"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="Last Sync"
              :value="status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Never'"
            />
          </a-col>
        </a-row>

        <a-card
          title="Recent Sync History"
          :bordered="false"
          style="margin-top: 16px"
        >
          <a-table
            :data-source="status.recentHistory"
            :columns="[
              { title: 'Operation', dataIndex: 'operation', key: 'operation' },
              { title: 'Provider', dataIndex: 'provider', key: 'provider' },
              { title: 'Status', dataIndex: 'status', key: 'status' },
              { title: 'Time', dataIndex: 'created_at', key: 'time' },
            ]"
            size="small"
            :pagination="false"
            row-key="id"
          />
        </a-card>
      </a-tab-pane>

      <a-tab-pane
        key="connectors"
        tab="Connectors"
      >
        <a-card
          title="Register Connector"
          :bordered="false"
        >
          <a-form layout="vertical">
            <a-row :gutter="16">
              <a-col :span="6">
                <a-form-item label="Provider">
                  <a-select
                    v-model:value="connectorForm.provider"
                    :options="providerOptions"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="Endpoint URL">
                  <a-input
                    v-model:value="connectorForm.endpoint"
                    placeholder="https://..."
                  />
                </a-form-item>
              </a-col>
              <a-col :span="5">
                <a-form-item label="Token">
                  <a-input-password
                    v-model:value="connectorForm.token"
                    placeholder="Bearer token"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="5">
                <a-form-item label=" ">
                  <a-button
                    type="primary"
                    :loading="loading"
                    @click="handleRegisterConnector"
                  >
                    Register
                  </a-button>
                </a-form-item>
              </a-col>
            </a-row>
          </a-form>
        </a-card>

        <a-list
          :data-source="connectors"
          style="margin-top: 16px"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta
                :title="item.provider"
                :description="item.endpoint"
              >
                <template #avatar>
                  <a-tag :color="item.enabled ? 'green' : 'red'">
                    {{ item.enabled ? 'Active' : 'Disabled' }}
                  </a-tag>
                </template>
              </a-list-item-meta>
              <template #actions>
                <a-button
                  size="small"
                  type="primary"
                  :loading="loading"
                  @click="handleSync(item.provider)"
                >
                  Sync
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane
        key="users"
        tab="Provisioned Users"
      >
        <a-button
          style="margin-bottom: 16px"
          @click="fetchUsers"
        >
          Load Users
        </a-button>
        <a-table
          :data-source="users"
          :columns="[
            { title: 'Username', dataIndex: 'userName', key: 'userName' },
            { title: 'Display Name', dataIndex: 'displayName', key: 'displayName' },
            { title: 'Active', dataIndex: 'active', key: 'active' },
          ]"
          :loading="loading"
          size="small"
          :pagination="{ total: totalUsers, pageSize: 20 }"
          row-key="id"
        />
      </a-tab-pane>
    </a-tabs>

    <a-alert
      v-if="error"
      :message="error"
      type="error"
      closable
      style="margin-top: 16px"
      @close="error = null"
    />
  </div>
</template>

<style lang="less" scoped>
.scim-integration-page {
  padding: 24px;
}
</style>
