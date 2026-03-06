<template>
  <div class="siem-integration-page">
    <a-page-header
      title="SIEM Integration"
      sub-title="Log export to Splunk HEC, Elasticsearch, Azure Sentinel"
    >
      <template #extra>
        <a-space>
          <a-button
            :loading="store.loading"
            @click="handleExportAll"
          >
            Export Now
          </a-button>
          <a-button
            type="primary"
            @click="showAddModal = true"
          >
            Add Target
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-row
      :gutter="16"
      style="margin-bottom: 16px"
    >
      <a-col :span="8">
        <a-statistic
          title="Active Targets"
          :value="store.activeTargets.length"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Total Exported"
          :value="store.totalExported"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="Formats"
          value="JSON / CEF / LEEF"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <!-- Targets Tab -->
      <a-tab-pane
        key="targets"
        tab="Export Targets"
      >
        <a-empty
          v-if="store.targets.length === 0"
          description="No SIEM targets configured"
        />
        <a-table
          v-else
          :columns="targetColumns"
          :data-source="store.targets"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <a-tag :color="typeColor(record.target_type)">
                {{ record.target_type }}
              </a-tag>
            </template>
            <template v-if="column.key === 'format'">
              <a-tag>{{ record.format?.toUpperCase() }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-badge
                :status="record.status === 'active' ? 'success' : 'default'"
                :text="record.status"
              />
            </template>
            <template v-if="column.key === 'last_export'">
              {{ formatDate(record.last_export_at) }}
            </template>
            <template v-if="column.key === 'actions'">
              <a-button
                size="small"
                type="link"
                @click="handleExport(record.id)"
              >
                Export
              </a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Stats Tab -->
      <a-tab-pane
        key="stats"
        tab="Export Stats"
      >
        <a-card size="small">
          <a-empty
            v-if="!store.stats"
            description="No export stats"
          />
          <a-list
            v-else
            :data-source="store.stats.targets"
            item-layout="horizontal"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.type"
                  :description="`${item.exported_count} logs exported`"
                />
                <template #actions>
                  <span>Last: {{ formatDate(item.last_export_at) }}</span>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- Add Target Modal -->
    <a-modal
      v-model:open="showAddModal"
      title="Add SIEM Target"
      :confirm-loading="store.loading"
      @ok="handleAddTarget"
    >
      <a-form layout="vertical">
        <a-form-item label="Target Type">
          <a-select v-model:value="addForm.type">
            <a-select-option value="splunk_hec">
              Splunk HEC
            </a-select-option>
            <a-select-option value="elasticsearch">
              Elasticsearch
            </a-select-option>
            <a-select-option value="azure_sentinel">
              Azure Sentinel
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="URL">
          <a-input
            v-model:value="addForm.url"
            placeholder="https://splunk.example.com:8088/services/collector"
          />
        </a-form-item>
        <a-form-item label="Format">
          <a-select v-model:value="addForm.format">
            <a-select-option value="json">
              JSON
            </a-select-option>
            <a-select-option value="cef">
              CEF
            </a-select-option>
            <a-select-option value="leef">
              LEEF
            </a-select-option>
          </a-select>
        </a-form-item>
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
import { useSiemStore } from '../../stores/siem';

const store = useSiemStore();
const activeTab = ref('targets');
const showAddModal = ref(false);

const addForm = ref({ type: 'splunk_hec', url: '', format: 'json' });

const targetColumns = [
  { title: 'Type', key: 'type', width: 150 },
  { title: 'URL', dataIndex: 'target_url', key: 'target_url' },
  { title: 'Format', key: 'format', width: 80 },
  { title: 'Exported', dataIndex: 'exported_count', key: 'exported_count', width: 100 },
  { title: 'Last Export', key: 'last_export', width: 160 },
  { title: 'Status', key: 'status', width: 100 },
  { title: '', key: 'actions', width: 80 },
];

function formatDate(ts: number | null) { return ts ? new Date(ts * 1000).toLocaleString() : 'Never'; }
function typeColor(t: string) { return { splunk_hec: 'green', elasticsearch: 'blue', azure_sentinel: 'purple' }[t] || 'default'; }

async function handleAddTarget() {
  if (!addForm.value.url) { message.warning('URL is required'); return; }
  const result = await store.addTarget(addForm.value.type, addForm.value.url, addForm.value.format);
  if (result.success) { message.success('Target added'); showAddModal.value = false; addForm.value.url = ''; }
  else {message.error(result.error || 'Failed');}
}

async function handleExport(targetId: string) {
  const result = await store.exportLogs(targetId);
  if (result.success) {message.success(`Exported ${result.exported || 0} logs`);}
  else {message.error(result.error || 'Export failed');}
}

async function handleExportAll() {
  const result = await store.exportLogs();
  if (result.success) {message.success('Export complete');}
  else {message.error(result.error || 'Export failed');}
}

onMounted(async () => {
  await store.fetchTargets();
  await store.fetchStats();
});
</script>

<style lang="less" scoped>
.siem-integration-page {
  padding: 24px;
}
</style>
