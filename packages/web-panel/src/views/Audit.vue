<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('audit.title') }}</h2>
        <p class="page-sub">{{ t('audit.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ t('audit.refresh') }}
        </a-button>
        <a-button @click="exportJson">
          <template #icon><DownloadOutlined /></template>
          {{ t('audit.exportJson') }}
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      :message="t('audit.noDb.message')"
      :description="t('audit.noDb.description')"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('audit.stats.total')" :value="stats.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FileSearchOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('audit.stats.failures')"
            :value="stats.failures"
            :value-style="{ color: stats.failures > 0 ? '#ff4d4f' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><CloseCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('audit.stats.highRisk')"
            :value="stats.highRisk"
            :value-style="{ color: stats.highRisk > 0 ? '#fa8c16' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('audit.stats.critical')"
            :value="stats.byRiskLevel.critical || 0"
            :value-style="{ color: (stats.byRiskLevel.critical || 0) > 0 ? '#ff4d4f' : '#888', fontSize: '20px' }"
          >
            <template #prefix><AlertOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('audit.stats.successRate')"
            :value="successRate"
            suffix="%"
            :precision="1"
            :value-style="{ color: successRate >= 95 ? '#52c41a' : successRate >= 80 ? '#faad14' : '#ff4d4f', fontSize: '20px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Event type catalogue -->
    <a-card
      :title="t('audit.typeCatalogueTitle')"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-row :gutter="[12, 12]">
        <a-col v-for="evt in EVENT_TYPES" :key="evt" :xs="12" :sm="8" :lg="3">
          <div class="type-pill" :style="{ borderLeftColor: typeBarColor(evt) }">
            <a-tag :color="typeColor(evt)" style="font-family: monospace; font-size: 11px;">{{ evt }}</a-tag>
            <div class="type-name">{{ typeLabel(evt) }}</div>
            <div class="type-count">{{ stats.byEventType[evt] || 0 }}</div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="audit-tabs">
      <!-- ── Events tab ──────────────────────────────────────────── -->
      <a-tab-pane key="events" :tab="t('audit.tabs.events')">
        <div class="filter-bar">
          <a-input-search
            v-model:value="searchInput"
            :placeholder="t('audit.filter.searchPlaceholder')"
            allow-clear
            style="max-width: 280px;"
            @search="runSearch"
            @input="onSearchInput"
          />
          <a-radio-group v-model:value="typeFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ t('audit.filter.allTypes') }}</a-radio-button>
            <a-radio-button v-for="evt in EVENT_TYPES" :key="evt" :value="evt">{{ typeLabel(evt) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="riskFilter" size="small">
            <a-radio-button value="">{{ t('audit.filter.allRisks') }}</a-radio-button>
            <a-radio-button v-for="r in RISK_LEVELS" :key="r" :value="r">{{ riskLabel(r) }}</a-radio-button>
          </a-radio-group>
          <a-checkbox v-model:checked="failuresOnly">{{ t('audit.filter.failuresOnly') }}</a-checkbox>
        </div>

        <a-table
          :columns="logColumns"
          :data-source="filteredLogs"
          :pagination="{ pageSize: 20, showTotal: (count) => t('audit.totals.rows', { count }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px; font-family: monospace;">{{ formatAuditTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'eventType'">
              <a-tag :color="typeColor(record.eventType)" style="font-family: monospace;">{{ record.eventType }}</a-tag>
            </template>
            <template v-if="column.key === 'operation'">
              <span style="color: var(--text-primary); font-weight: 500; font-family: monospace; font-size: 12px;">{{ record.operation }}</span>
              <div v-if="record.errorMessage" style="color: #ff4d4f; font-size: 11px; margin-top: 2px;">
                {{ record.errorMessage }}
              </div>
            </template>
            <template v-if="column.key === 'actor'">
              <span v-if="record.actor" style="color: var(--text-secondary); font-size: 12px;">{{ record.actor }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'target'">
              <span v-if="record.target" style="color: var(--text-secondary); font-size: 12px; font-family: monospace;">{{ truncate(record.target, 32) }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'riskLevel'">
              <a-tag :color="riskColor(record.riskLevel)">{{ riskLabel(record.riskLevel) }}</a-tag>
            </template>
            <template v-if="column.key === 'success'">
              <a-tag :color="record.success ? 'green' : 'red'">
                {{ record.success ? 'OK' : 'FAIL' }}
              </a-tag>
            </template>
            <template v-if="column.key === 'mtc'">
              <template v-if="classifyMtcStatus(record) === 'none'">
                <a-tooltip :title="t('audit.mtc.noneTooltip')">
                  <a-tag color="default">—</a-tag>
                </a-tooltip>
              </template>
              <template v-else>
                <a-tooltip :title="getMtcTooltip(record)">
                  <a-tag
                    :color="getMtcColor(record)"
                    style="cursor: pointer"
                    @click="checkMtcStatus(record)"
                  >
                    {{ getMtcLabel(record) }}
                  </a-tag>
                </a-tooltip>
              </template>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewLogDetails(record)">{{ t('audit.rowAction.details') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FileSearchOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ hasFilters ? t('audit.empty.filtered') : t('audit.empty.noEvents') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Breakdown tab ───────────────────────────────────────── -->
      <a-tab-pane key="breakdown" :tab="t('audit.tabs.breakdown')">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card :title="t('audit.breakdown.byType')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="evt in EVENT_TYPES" :key="evt" class="bd-row">
                <a-tag :color="typeColor(evt)" style="min-width: 80px; text-align: center; font-family: monospace;">{{ evt }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byEventType[evt] || 0, stats.total)"
                  :stroke-color="typeBarColor(evt)"
                  :format="() => `${stats.byEventType[evt] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card :title="t('audit.breakdown.byRisk')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="r in RISK_LEVELS" :key="r" class="bd-row">
                <a-tag :color="riskColor(r)" style="min-width: 80px; text-align: center;">{{ riskLabel(r) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byRiskLevel[r] || 0, stats.total)"
                  :stroke-color="riskBarColor(r)"
                  :format="() => `${stats.byRiskLevel[r] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Event details modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="t('audit.details.title', { id: currentLog?.id?.slice(0, 8) || '' })"
      :width="720"
      :footer="null"
    >
      <div v-if="currentLog" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="t('audit.details.id')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentLog.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.eventType')">
            <a-tag :color="typeColor(currentLog.eventType)" style="font-family: monospace;">{{ currentLog.eventType }}</a-tag>
            <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">{{ typeLabel(currentLog.eventType) }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.riskLevel')">
            <a-tag :color="riskColor(currentLog.riskLevel)">{{ riskLabel(currentLog.riskLevel) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.operation')" :span="2">
            <span style="font-family: monospace;">{{ currentLog.operation }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.status')">
            <a-tag :color="currentLog.success ? 'green' : 'red'">
              {{ currentLog.success ? t('audit.details.success') : t('audit.details.failure') }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.time')">{{ formatAuditTime(currentLog.createdAt) }}</a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.actor')">
            <span v-if="currentLog.actor" style="font-family: monospace; font-size: 12px;">{{ currentLog.actor }}</span>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('audit.details.target')">
            <span v-if="currentLog.target" style="font-family: monospace; font-size: 12px;">{{ currentLog.target }}</span>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.ipAddress" :label="t('audit.details.ip')">
            <span style="font-family: monospace; font-size: 12px;">{{ currentLog.ipAddress }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.userAgent" :label="t('audit.details.userAgent')">
            <span style="font-family: monospace; font-size: 11px;">{{ currentLog.userAgent }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.errorMessage" :label="t('audit.details.errorMessage')" :span="2">
            <span style="color: #ff4d4f;">{{ currentLog.errorMessage }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.details" :label="t('audit.details.details')" :span="2">
            <pre class="details-pre">{{ formatDetails(currentLog.details) }}</pre>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ReloadOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  AlertOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useFs } from '../composables/useFs.js'
import {
  parseLogs,
  parseStats,
  detectAuditError,
  formatAuditTime,
  classifyMtcStatus,
  EVENT_TYPES,
  RISK_LEVELS,
} from '../utils/audit-parser.js'

const { t } = useI18n()
const ws = useWsStore()
const fs = useFs()

const loading = ref(false)

const logs = ref([])
const stats = ref({
  total: 0,
  failures: 0,
  highRisk: 0,
  byEventType: {},
  byRiskLevel: {},
})
const errorState = ref({ noDb: false, error: '' })

const activeTab = ref('events')
const searchInput = ref('')
const searchTerm = ref('')
const typeFilter = ref('')
const riskFilter = ref('')
const failuresOnly = ref(false)

const showDetailsModal = ref(false)
const currentLog = ref(null)

const logColumns = computed(() => [
  { title: t('audit.logColumns.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('audit.logColumns.eventType'), key: 'eventType', width: '110px' },
  { title: t('audit.logColumns.operation'), key: 'operation' },
  { title: t('audit.logColumns.actor'), key: 'actor', width: '140px' },
  { title: t('audit.logColumns.target'), key: 'target', width: '180px' },
  { title: t('audit.logColumns.riskLevel'), key: 'riskLevel', width: '90px' },
  { title: t('audit.logColumns.success'), key: 'success', width: '80px' },
  { title: t('audit.logColumns.mtc'), key: 'mtc', width: '110px' },
  { title: t('audit.logColumns.action'), key: 'action', width: '80px' },
])

const mtcStatusCache = ref({})

function getMtcStatusEntry(record) {
  if (!record.auditMtcEventId) return null
  return mtcStatusCache.value[record.id] || null
}

function getMtcLabel(record) {
  const e = getMtcStatusEntry(record)
  if (!e) return t('audit.mtc.signedNotChecked')
  if (e.state === 'staging') return t('audit.mtc.stagingLabel')
  if (e.state === 'batched') return t('audit.mtc.batchedLabel', { batchId: e.batchId || '?' })
  return t('audit.mtc.unknownLabel')
}

function getMtcColor(record) {
  const e = getMtcStatusEntry(record)
  if (!e) return 'blue'
  if (e.state === 'staging') return 'orange'
  if (e.state === 'batched') return 'green'
  return 'default'
}

function getMtcTooltip(record) {
  if (!record.auditMtcEventId) return ''
  const e = getMtcStatusEntry(record)
  const base = t('audit.mtc.tooltipBase', { id: record.auditMtcEventId })
  if (!e) return t('audit.mtc.tooltipNotChecked', { base })
  if (e.state === 'staging') return t('audit.mtc.tooltipStaging', { base })
  if (e.state === 'batched') return t('audit.mtc.tooltipBatched', { base, batchId: e.batchId, treeHead: e.treeHeadId || '' })
  return base
}

async function checkMtcStatus(record) {
  if (!record.auditMtcEventId) return
  const id = record.auditMtcEventId.replace(/"/g, '\\"')
  try {
    const r = await ws.execute(`audit mtc reconcile-check "${id}" --json`, 8000)
    let parsed
    try {
      parsed = JSON.parse(r.output.trim())
    } catch {
      const m = r.output.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : null
    }
    if (!parsed) {
      message.warning(t('audit.mtc.noJson'))
      return
    }
    const entry = parsed.found
      ? { state: 'batched', batchId: parsed.batchId, treeHeadId: parsed.treeHeadId }
      : parsed.staging
        ? { state: 'staging' }
        : { state: 'unknown' }
    mtcStatusCache.value = { ...mtcStatusCache.value, [record.id]: entry }
  } catch (e) {
    message.error(t('audit.mtc.checkFailed', { err: e?.message || e }))
  }
}

const successRate = computed(() => {
  if (!stats.value.total) return 100
  return ((stats.value.total - stats.value.failures) / stats.value.total) * 100
})

const hasFilters = computed(() =>
  !!(searchTerm.value || typeFilter.value || riskFilter.value || failuresOnly.value)
)

const filteredLogs = computed(() => {
  let rows = logs.value
  if (typeFilter.value) rows = rows.filter(l => l.eventType === typeFilter.value)
  if (riskFilter.value) rows = rows.filter(l => l.riskLevel === riskFilter.value)
  if (failuresOnly.value) rows = rows.filter(l => !l.success)
  if (searchTerm.value) {
    const q = searchTerm.value.toLowerCase()
    rows = rows.filter(l =>
      (l.operation || '').toLowerCase().includes(q) ||
      (l.actor || '').toLowerCase().includes(q) ||
      (l.target || '').toLowerCase().includes(q)
    )
  }
  return rows
})

function typeLabel(evt) {
  const key = `audit.type.${evt}`
  const v = t(key)
  return v === key ? evt : v
}
function typeColor(evt) {
  return {
    auth: 'blue', permission: 'purple', data: 'cyan', system: 'default',
    file: 'green', did: 'gold', crypto: 'magenta', api: 'volcano',
  }[evt] || 'default'
}
function typeBarColor(evt) {
  return {
    auth: '#1677ff', permission: '#722ed1', data: '#13c2c2', system: '#888',
    file: '#52c41a', did: '#faad14', crypto: '#eb2f96', api: '#fa541c',
  }[evt] || '#888'
}

function riskLabel(r) {
  const key = `audit.risk.${r}`
  const v = t(key)
  return v === key ? r : v
}
function riskColor(r) {
  return { low: 'default', medium: 'gold', high: 'orange', critical: 'red' }[r] || 'default'
}
function riskBarColor(r) {
  return { low: '#888', medium: '#faad14', high: '#fa8c16', critical: '#ff4d4f' }[r] || '#888'
}

function pctOfTotal(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

function truncate(s, max) {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function formatDetails(d) {
  if (typeof d === 'string') return d
  try { return JSON.stringify(d, null, 2) } catch { return String(d) }
}

let searchDebounce = null
function onSearchInput() {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    searchTerm.value = searchInput.value.trim()
  }, 300)
}
function runSearch() {
  searchTerm.value = searchInput.value.trim()
}

async function loadAll() {
  loading.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const [logRes, statsRes] = await Promise.all([
      ws.execute('audit log --json -n 200', 12000).catch(() => ({ output: '' })),
      ws.execute('audit stats --json', 8000).catch(() => ({ output: '' })),
    ])
    const errs = [logRes, statsRes]
      .map(r => detectAuditError(r.output))
      .find(e => e.noDb)
    if (errs) {
      errorState.value = errs
    }
    logs.value = parseLogs(logRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('audit.messages.loadFailed', { err: e?.message || e }))
  } finally {
    loading.value = false
  }
}

function viewLogDetails(record) {
  currentLog.value = record
  showDetailsModal.value = true
}

async function exportJson() {
  try {
    const { output } = await ws.execute('audit export -f json -n 10000', 20000)
    const err = detectAuditError(output)
    if (err.noDb) {
      message.error(t('audit.messages.needInit'))
      return
    }
    if (!output.trim().startsWith('[')) {
      message.error(t('audit.messages.exportFailed', { err: output.slice(0, 120) }))
      return
    }
    const r = await fs.saveText(output.trim(), {
      defaultPath: `audit-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (r.canceled) return
    message.success(r.path
      ? t('audit.messages.exportOk', { path: r.path })
      : t('audit.messages.exportOkDefault'))
  } catch (e) {
    message.error(t('audit.messages.exportFailed', { err: e?.message || e }))
  }
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

.audit-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Type catalogue pills */
.type-pill {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(22,119,255,.04);
  border: 1px solid var(--border-color);
  border-left: 3px solid #1677ff;
  height: 100%;
  text-align: center;
}
.type-name {
  color: var(--text-primary);
  font-size: 12px;
  margin-top: 4px;
}
.type-count {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 600;
  margin-top: 2px;
}

/* Breakdown rows */
.bd-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

/* Details modal */
.details-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 11px;
  max-height: 300px;
  overflow: auto;
  color: var(--text-primary);
}
</style>
