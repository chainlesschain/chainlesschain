<template>
  <div class="dlp-policies-page">
    <a-page-header
      title="Data Loss Prevention"
      sub-title="Content detection policies and incident management"
    >
      <template #extra>
        <a-button
          type="primary"
          @click="showCreateModal = true"
        >
          Create Policy
        </a-button>
      </template>
    </a-page-header>

    <a-row
      :gutter="16"
      style="margin-bottom: 16px"
    >
      <a-col :span="8">
        <a-statistic
          title="Active Policies"
          :value="store.activePolicies.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Unresolved Incidents"
          :value="store.unresolvedIncidents.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Total Scanned"
          :value="store.stats?.scanned || 0"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <!-- Policies Tab -->
      <a-tab-pane
        key="policies"
        tab="Policies"
      >
        <a-table
          :columns="policyColumns"
          :data-source="store.policies"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'enabled'">
              <a-switch
                :checked="record.enabled"
                size="small"
                @change="(v: boolean) => handleToggle(record.id, v)"
              />
            </template>
            <template v-if="column.key === 'action'">
              <a-tag :color="actionColor(record.action)">
                {{ record.action }}
              </a-tag>
            </template>
            <template v-if="column.key === 'severity'">
              <a-tag :color="severityColor(record.severity)">
                {{ record.severity }}
              </a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <a-popconfirm
                title="Delete this policy?"
                @confirm="handleDelete(record.id)"
              >
                <a-button
                  size="small"
                  type="link"
                  danger
                >
                  Delete
                </a-button>
              </a-popconfirm>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Incidents Tab -->
      <a-tab-pane
        key="incidents"
        tab="Incidents"
      >
        <a-space style="margin-bottom: 16px">
          <a-button
            :loading="store.loading"
            @click="handleFetchIncidents"
          >
            Refresh
          </a-button>
        </a-space>
        <a-table
          :columns="incidentColumns"
          :data-source="store.incidents"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'severity'">
              <a-tag :color="severityColor(record.severity)">
                {{ record.severity }}
              </a-tag>
            </template>
            <template v-if="column.key === 'resolved'">
              <a-tag
                v-if="record.resolved_at"
                color="green"
              >
                Resolved
              </a-tag>
              <a-button
                v-else
                size="small"
                type="link"
                @click="handleResolve(record.id)"
              >
                Resolve
              </a-button>
            </template>
            <template v-if="column.key === 'created_at'">
              {{ formatDate(record.created_at) }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- Create Policy Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="Create DLP Policy"
      :confirm-loading="store.loading"
      width="600px"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="Name">
          <a-input
            v-model:value="createForm.name"
            placeholder="Policy name"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="createForm.description"
            :rows="2"
          />
        </a-form-item>
        <a-form-item label="Channels">
          <a-checkbox-group
            v-model:value="createForm.channels"
            :options="channelOptions"
          />
        </a-form-item>
        <a-form-item label="Patterns (one regex per line)">
          <a-textarea
            v-model:value="createForm.patternsText"
            :rows="3"
            placeholder="\b\d{3}-\d{2}-\d{4}\b"
          />
        </a-form-item>
        <a-form-item label="Keywords (comma separated)">
          <a-input
            v-model:value="createForm.keywordsText"
            placeholder="confidential, secret, classified"
          />
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="Action">
              <a-select v-model:value="createForm.action">
                <a-select-option value="alert">
                  Alert
                </a-select-option>
                <a-select-option value="block">
                  Block
                </a-select-option>
                <a-select-option value="quarantine">
                  Quarantine
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="Severity">
              <a-select v-model:value="createForm.severity">
                <a-select-option value="low">
                  Low
                </a-select-option>
                <a-select-option value="medium">
                  Medium
                </a-select-option>
                <a-select-option value="high">
                  High
                </a-select-option>
                <a-select-option value="critical">
                  Critical
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>

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
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useDlpStore } from '../../stores/dlp';

const store = useDlpStore();
const activeTab = ref('policies');
const showCreateModal = ref(false);

const createForm = ref({
  name: '',
  description: '',
  channels: [] as string[],
  patternsText: '',
  keywordsText: '',
  action: 'alert',
  severity: 'medium',
});

const channelOptions = [
  { label: 'Email', value: 'email' },
  { label: 'Chat', value: 'chat' },
  { label: 'File Transfer', value: 'file_transfer' },
  { label: 'Clipboard', value: 'clipboard' },
  { label: 'Export', value: 'export' },
];

const policyColumns = [
  { title: 'Name', dataIndex: 'name', key: 'name' },
  { title: 'Enabled', key: 'enabled', width: 80 },
  { title: 'Action', key: 'action', width: 100 },
  { title: 'Severity', key: 'severity', width: 100 },
  { title: '', key: 'actions', width: 80 },
];

const incidentColumns = [
  { title: 'Channel', dataIndex: 'channel', key: 'channel' },
  { title: 'Action Taken', dataIndex: 'action_taken', key: 'action_taken' },
  { title: 'Severity', key: 'severity', width: 100 },
  { title: 'Time', key: 'created_at', width: 160 },
  { title: 'Status', key: 'resolved', width: 100 },
];

function formatDate(ts: number) { return ts ? new Date(ts * 1000).toLocaleString() : '-'; }
function actionColor(a: string) { return { alert: 'orange', block: 'red', quarantine: 'purple', allow: 'green' }[a] || 'default'; }
function severityColor(s: string) { return { critical: 'red', high: 'orange', medium: 'gold', low: 'blue' }[s] || 'default'; }

async function handleCreate() {
  if (!createForm.value.name) { message.warning('Name is required'); return; }
  const patterns = createForm.value.patternsText.split('\n').filter(Boolean);
  const keywords = createForm.value.keywordsText.split(',').map(k => k.trim()).filter(Boolean);
  const result = await store.createPolicy({ ...createForm.value, patterns, keywords });
  if (result.success) { message.success('Policy created'); showCreateModal.value = false; }
  else {message.error(result.error || 'Failed');}
}

async function handleToggle(id: string, enabled: boolean) {
  await store.updatePolicy(id, { enabled } as any);
}

async function handleDelete(id: string) {
  await store.deletePolicy(id);
  message.success('Policy deleted');
}

async function handleFetchIncidents() { await store.fetchIncidents(); }

async function handleResolve(id: string) {
  await store.resolveIncident(id, 'manually_resolved');
  message.success('Incident resolved');
}

onMounted(async () => {
  await store.fetchPolicies();
  await store.fetchIncidents();
  await store.fetchStats();
});
</script>

<style lang="less" scoped>
.dlp-policies-page {
  padding: 24px;
}
</style>
