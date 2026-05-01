<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('marketplace.title') }}</h2>
        <p class="page-sub">{{ $t('marketplace.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('marketplace.refresh') }}
        </a-button>
        <a-button type="primary" @click="showPublishModal = true">
          <template #icon><CloudUploadOutlined /></template>
          {{ $t('marketplace.publish') }}
        </a-button>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('marketplace.stats.total')" :value="services.length" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><AppstoreOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('marketplace.stats.published')" :value="publishedCount" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('marketplace.stats.invocations')" :value="stats.total" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('marketplace.stats.successRate')"
            :value="successRatePct"
            suffix="%"
            :precision="1"
            :value-style="{ color: stats.successRate >= 0.9 ? '#52c41a' : '#faad14', fontSize: '20px' }"
          >
            <template #prefix><RiseOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('marketplace.stats.avgDuration')"
            :value="stats.avgDurationMs"
            suffix="ms"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          >
            <template #prefix><ClockCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="market-tabs">
      <!-- ── Services tab ──────────────────────────────────────────── -->
      <a-tab-pane key="services" :tab="$t('marketplace.tabs.services')">
        <div class="filter-bar">
          <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('marketplace.filter.all') }}</a-radio-button>
            <a-radio-button v-for="s in SERVICE_STATUSES" :key="s" :value="s">
              {{ statusLabel(s) }}
            </a-radio-button>
          </a-radio-group>
          <a-input-search
            v-model:value="nameFilter"
            :placeholder="$t('marketplace.filter.namePlaceholder')"
            allow-clear
            style="max-width: 280px;"
          />
        </div>

        <a-table
          :columns="serviceColumns"
          :data-source="filteredServices"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('marketplace.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name }}</span>
              <a-tag v-if="record.version" color="blue" style="margin-left: 6px; font-size: 10px;">
                v{{ record.version }}
              </a-tag>
              <div v-if="record.description" style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">
                {{ truncate(record.description, 80) }}
              </div>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="serviceStatusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'invocationCount'">
              <span style="color: #722ed1; font-weight: 500;">{{ record.invocationCount }}</span>
            </template>
            <template v-if="column.key === 'owner'">
              <span v-if="record.owner" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ shortDid(record.owner) }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatMarketplaceTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="openRecord(record)">{{ $t('marketplace.table.actionRecord') }}</a-button>
              <a-dropdown :trigger="['click']">
                <a-button size="small" type="link">{{ $t('marketplace.table.statusDropdown') }}</a-button>
                <template #overlay>
                  <a-menu @click="(e) => transitionStatus(record, e.key)">
                    <a-menu-item v-for="s in SERVICE_STATUSES" :key="s" :disabled="s === record.status">
                      {{ statusLabel(s) }}
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <AppstoreOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ statusFilter || nameFilter ? $t('marketplace.table.emptyFiltered') : $t('marketplace.table.empty') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Invocations tab ───────────────────────────────────────── -->
      <a-tab-pane key="invocations" :tab="$t('marketplace.tabs.invocations')">
        <div class="filter-bar">
          <a-select
            v-model:value="invocationServiceFilter"
            :placeholder="$t('marketplace.filter.byService')"
            allow-clear
            style="width: 280px;"
            size="small"
          >
            <a-select-option v-for="s in services" :key="s.id" :value="s.id">
              {{ s.name }} ({{ statusLabel(s.status) }})
            </a-select-option>
          </a-select>
        </div>

        <a-table
          :columns="invocationColumns"
          :data-source="filteredInvocations"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('marketplace.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'service'">
              <span style="color: var(--text-primary);">{{ serviceName(record.serviceId) }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace;">
                {{ record.serviceId.slice(0, 8) }}
              </div>
            </template>
            <template v-if="column.key === 'caller'">
              <span v-if="record.callerId" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ shortDid(record.callerId) }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="invocationStatusColor(record.status)">{{ invocationStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'durationMs'">
              <span v-if="record.durationMs != null" style="color: var(--text-secondary); font-size: 12px;">
                {{ record.durationMs }} ms
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatMarketplaceTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ThunderboltOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('marketplace.table.emptyInvocations') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Publish service modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showPublishModal"
      :title="$t('marketplace.publish_modal.title')"
      :confirm-loading="publishing"
      :width="560"
      :ok-text="$t('marketplace.publish_modal.ok')"
      :cancel-text="$t('marketplace.publish_modal.cancel')"
      @ok="publishService"
      @cancel="resetPublishForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('marketplace.publish_modal.nameLabel')" required>
          <a-input v-model:value="publishForm.name" :placeholder="$t('marketplace.publish_modal.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('marketplace.publish_modal.versionLabel')">
          <a-input v-model:value="publishForm.version" :placeholder="$t('marketplace.publish_modal.versionPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('marketplace.publish_modal.descLabel')">
          <a-textarea v-model:value="publishForm.description" :auto-size="{ minRows: 2, maxRows: 5 }" />
        </a-form-item>
        <a-form-item :label="$t('marketplace.publish_modal.endpointLabel')">
          <a-input v-model:value="publishForm.endpoint" :placeholder="$t('marketplace.publish_modal.endpointPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('marketplace.publish_modal.ownerLabel')">
          <a-input v-model:value="publishForm.owner" :placeholder="$t('marketplace.publish_modal.ownerPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('marketplace.publish_modal.statusLabel')">
          <a-select v-model:value="publishForm.status">
            <a-select-option v-for="s in SERVICE_STATUSES" :key="s" :value="s">
              {{ statusLabel(s) }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Record invocation modal ───────────────────────────────── -->
    <a-modal
      v-model:open="showRecordModal"
      :title="$t('marketplace.record_modal.title', { name: recordTargetName })"
      :confirm-loading="recording"
      :width="520"
      :ok-text="$t('marketplace.record_modal.ok')"
      :cancel-text="$t('marketplace.record_modal.cancel')"
      @ok="recordInvocation"
      @cancel="resetRecordForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('marketplace.record_modal.callerLabel')">
          <a-input v-model:value="recordForm.caller" :placeholder="$t('marketplace.record_modal.callerPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('marketplace.record_modal.statusLabel')">
          <a-select v-model:value="recordForm.status">
            <a-select-option v-for="s in INVOCATION_STATUSES" :key="s" :value="s">
              {{ invocationStatusLabel(s) }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('marketplace.record_modal.durationLabel')">
          <a-input-number v-model:value="recordForm.durationMs" :min="0" :max="3600000" style="width: 100%;" />
        </a-form-item>
        <a-form-item v-if="recordForm.status === 'failed' || recordForm.status === 'timeout'" :label="$t('marketplace.record_modal.errorLabel')">
          <a-textarea v-model:value="recordForm.error" :auto-size="{ minRows: 2, maxRows: 4 }" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  CloudUploadOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  RiseOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parseServices,
  parseInvocations,
  parseStats,
  formatMarketplaceTime,
  SERVICE_STATUSES,
  INVOCATION_STATUSES,
} from '../utils/marketplace-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const loading = ref(false)
const publishing = ref(false)
const recording = ref(false)

const services = ref([])
const invocations = ref([])
const stats = ref({
  total: 0,
  counts: { success: 0, failed: 0, timeout: 0, pending: 0, running: 0 },
  successRate: 0,
  avgDurationMs: 0,
  scopedToService: null,
})

const activeTab = ref('services')
const statusFilter = ref('')
const nameFilter = ref('')
const invocationServiceFilter = ref(null)

const showPublishModal = ref(false)
const showRecordModal = ref(false)

const publishForm = reactive({
  name: '', version: '', description: '', endpoint: '', owner: '', status: 'published',
})
const recordForm = reactive({
  serviceId: '', caller: '', status: 'success', durationMs: null, error: '',
})
const recordTargetName = ref('')

const serviceColumns = computed(() => [
  { title: t('marketplace.serviceCols.name'), key: 'name' },
  { title: t('marketplace.serviceCols.status'), key: 'status', width: '120px' },
  { title: t('marketplace.serviceCols.invocationCount'), key: 'invocationCount', width: '110px' },
  { title: t('marketplace.serviceCols.owner'), key: 'owner', width: '180px' },
  { title: t('marketplace.serviceCols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('marketplace.serviceCols.action'), key: 'action', width: '180px' },
])

const invocationColumns = computed(() => [
  { title: t('marketplace.invocationCols.service'), key: 'service' },
  { title: t('marketplace.invocationCols.caller'), key: 'caller', width: '180px' },
  { title: t('marketplace.invocationCols.status'), key: 'status', width: '100px' },
  { title: t('marketplace.invocationCols.durationMs'), key: 'durationMs', width: '110px' },
  { title: t('marketplace.invocationCols.createdAt'), key: 'createdAt', width: '160px' },
])

const publishedCount = computed(() => services.value.filter(s => s.status === 'published').length)
const successRatePct = computed(() => stats.value.successRate * 100)

const filteredServices = computed(() => {
  let rows = services.value
  if (statusFilter.value) rows = rows.filter(s => s.status === statusFilter.value)
  if (nameFilter.value) {
    const needle = nameFilter.value.toLowerCase()
    rows = rows.filter(s => s.name.toLowerCase().includes(needle))
  }
  return rows
})

const filteredInvocations = computed(() => {
  if (!invocationServiceFilter.value) return invocations.value
  return invocations.value.filter(i => i.serviceId === invocationServiceFilter.value)
})

function statusLabel(s) {
  const key = `marketplace.serviceStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function serviceStatusColor(s) {
  return { draft: 'default', published: 'green', deprecated: 'orange', suspended: 'red' }[s] || 'default'
}

function invocationStatusLabel(s) {
  const key = `marketplace.invocationStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function invocationStatusColor(s) {
  return { pending: 'default', running: 'processing', success: 'green', failed: 'red', timeout: 'orange' }[s] || 'default'
}

function shortDid(did) {
  if (!did) return ''
  return did.length > 28 ? did.slice(0, 16) + '...' + did.slice(-8) : did
}
function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}
function serviceName(serviceId) {
  const s = services.value.find(x => x.id === serviceId)
  return s ? s.name : t('marketplace.deletedService')
}

async function loadAll() {
  loading.value = true
  try {
    const [svcRes, invRes, statsRes] = await Promise.all([
      ws.execute('marketplace list --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('marketplace invocations --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('marketplace stats --json', 10000).catch(() => ({ output: '' })),
    ])
    services.value = parseServices(svcRes.output)
    invocations.value = parseInvocations(invRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('marketplace.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function publishService() {
  const name = publishForm.name.trim()
  if (!name) {
    message.warning(t('marketplace.msg.publishEmpty'))
    return
  }
  publishing.value = true
  try {
    const parts = [`marketplace publish "${name.replace(/"/g, '\\"')}"`]
    if (publishForm.version.trim()) parts.push(`--version "${publishForm.version.trim().replace(/"/g, '\\"')}"`)
    if (publishForm.description.trim()) parts.push(`--description "${publishForm.description.trim().replace(/"/g, '\\"')}"`)
    if (publishForm.endpoint.trim()) parts.push(`--endpoint "${publishForm.endpoint.trim().replace(/"/g, '\\"')}"`)
    if (publishForm.owner.trim()) parts.push(`--owner "${publishForm.owner.trim().replace(/"/g, '\\"')}"`)
    parts.push(`--status ${publishForm.status}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 15000)
    if (/error|failed|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('marketplace.msg.publishFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('marketplace.msg.publishSuccess'))
    showPublishModal.value = false
    resetPublishForm()
    await loadAll()
  } catch (e) {
    message.error(t('marketplace.msg.publishFailed') + ': ' + (e?.message || e))
  } finally {
    publishing.value = false
  }
}

function openRecord(service) {
  if (service.status !== 'published') {
    message.warning(t('marketplace.msg.recordOnlyPublished'))
    return
  }
  recordForm.serviceId = service.id
  recordForm.caller = ''
  recordForm.status = 'success'
  recordForm.durationMs = null
  recordForm.error = ''
  recordTargetName.value = service.name
  showRecordModal.value = true
}

async function recordInvocation() {
  recording.value = true
  try {
    const parts = [`marketplace record ${recordForm.serviceId}`]
    if (recordForm.caller.trim()) parts.push(`--caller "${recordForm.caller.trim().replace(/"/g, '\\"')}"`)
    parts.push(`--status ${recordForm.status}`)
    if (recordForm.durationMs != null) parts.push(`--duration-ms ${recordForm.durationMs}`)
    if ((recordForm.status === 'failed' || recordForm.status === 'timeout') && recordForm.error.trim()) {
      parts.push(`--error "${recordForm.error.trim().replace(/"/g, '\\"')}"`)
    }
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 15000)
    if (/error|failed|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('marketplace.msg.recordFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('marketplace.msg.recordSuccess'))
    showRecordModal.value = false
    activeTab.value = 'invocations'
    await loadAll()
  } catch (e) {
    message.error(t('marketplace.msg.recordFailed') + ': ' + (e?.message || e))
  } finally {
    recording.value = false
  }
}

async function transitionStatus(service, newStatus) {
  if (newStatus === service.status) return
  try {
    const { output } = await ws.execute(`marketplace status ${service.id} ${newStatus} --json`, 10000)
    if (/error|invalid|失败/i.test(output) && !/"status"/.test(output)) {
      message.error(t('marketplace.msg.transitionFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('marketplace.msg.transitionSuccess', { label: statusLabel(newStatus) }))
    await loadAll()
  } catch (e) {
    message.error(t('marketplace.msg.transitionFailed') + ': ' + (e?.message || e))
  }
}

function resetPublishForm() {
  publishForm.name = ''
  publishForm.version = ''
  publishForm.description = ''
  publishForm.endpoint = ''
  publishForm.owner = ''
  publishForm.status = 'published'
}
function resetRecordForm() {
  recordForm.serviceId = ''
  recordForm.caller = ''
  recordForm.status = 'success'
  recordForm.durationMs = null
  recordForm.error = ''
  recordTargetName.value = ''
}

onMounted(loadAll)
</script>

<style scoped>
.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.market-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
</style>
