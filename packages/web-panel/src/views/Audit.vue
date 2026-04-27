<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">审计日志</h2>
        <p class="page-sub">安全事件追踪 · 风险评估 · 合规导出</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button @click="exportJson">
          <template #icon><DownloadOutlined /></template>
          导出 JSON
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      message="该模块需要项目级数据库"
      description="`cc audit ...` 命令仅在 chainlesschain 项目目录下可用。请先运行 `cc init` 初始化项目，或在已初始化的目录启动 `cc serve`。"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="事件总数" :value="stats.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FileSearchOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="失败次数"
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
            title="高风险"
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
            title="关键事件"
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
            title="成功率"
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
      title="事件类型"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-row :gutter="[12, 12]">
        <a-col v-for="t in EVENT_TYPES" :key="t" :xs="12" :sm="8" :lg="3">
          <div class="type-pill" :style="{ borderLeftColor: typeBarColor(t) }">
            <a-tag :color="typeColor(t)" style="font-family: monospace; font-size: 11px;">{{ t }}</a-tag>
            <div class="type-name">{{ typeLabel(t) }}</div>
            <div class="type-count">{{ stats.byEventType[t] || 0 }}</div>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="audit-tabs">
      <!-- ── Events tab ──────────────────────────────────────────── -->
      <a-tab-pane key="events" tab="事件流">
        <div class="filter-bar">
          <a-input-search
            v-model:value="searchInput"
            placeholder="搜索操作 / 角色 / 目标..."
            allow-clear
            style="max-width: 280px;"
            @search="runSearch"
            @input="onSearchInput"
          />
          <a-radio-group v-model:value="typeFilter" size="small" button-style="solid">
            <a-radio-button value="">全部类型</a-radio-button>
            <a-radio-button v-for="t in EVENT_TYPES" :key="t" :value="t">{{ typeLabel(t) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="riskFilter" size="small">
            <a-radio-button value="">全部风险</a-radio-button>
            <a-radio-button v-for="r in RISK_LEVELS" :key="r" :value="r">{{ riskLabel(r) }}</a-radio-button>
          </a-radio-group>
          <a-checkbox v-model:checked="failuresOnly">仅失败</a-checkbox>
        </div>

        <a-table
          :columns="logColumns"
          :data-source="filteredLogs"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewLogDetails(record)">详情</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <FileSearchOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ hasFilters ? '没有符合条件的事件' : '暂无审计事件' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Breakdown tab ───────────────────────────────────────── -->
      <a-tab-pane key="breakdown" tab="分布统计">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card title="按事件类型" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="t in EVENT_TYPES" :key="t" class="bd-row">
                <a-tag :color="typeColor(t)" style="min-width: 80px; text-align: center; font-family: monospace;">{{ t }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byEventType[t] || 0, stats.total)"
                  :stroke-color="typeBarColor(t)"
                  :format="() => `${stats.byEventType[t] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card title="按风险等级" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
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
      :title="`事件详情：${currentLog?.id?.slice(0, 8) || ''}`"
      :width="720"
      :footer="null"
    >
      <div v-if="currentLog" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="ID" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentLog.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="事件类型">
            <a-tag :color="typeColor(currentLog.eventType)" style="font-family: monospace;">{{ currentLog.eventType }}</a-tag>
            <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">{{ typeLabel(currentLog.eventType) }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="风险等级">
            <a-tag :color="riskColor(currentLog.riskLevel)">{{ riskLabel(currentLog.riskLevel) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="操作" :span="2">
            <span style="font-family: monospace;">{{ currentLog.operation }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="currentLog.success ? 'green' : 'red'">
              {{ currentLog.success ? '成功' : '失败' }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="时间">{{ formatAuditTime(currentLog.createdAt) }}</a-descriptions-item>
          <a-descriptions-item label="角色">
            <span v-if="currentLog.actor" style="font-family: monospace; font-size: 12px;">{{ currentLog.actor }}</span>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item label="目标">
            <span v-if="currentLog.target" style="font-family: monospace; font-size: 12px;">{{ currentLog.target }}</span>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.ipAddress" label="IP">
            <span style="font-family: monospace; font-size: 12px;">{{ currentLog.ipAddress }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.userAgent" label="User-Agent">
            <span style="font-family: monospace; font-size: 11px;">{{ currentLog.userAgent }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.errorMessage" label="错误信息" :span="2">
            <span style="color: #ff4d4f;">{{ currentLog.errorMessage }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentLog.details" label="详细信息" :span="2">
            <pre class="details-pre">{{ formatDetails(currentLog.details) }}</pre>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
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
import {
  parseLogs,
  parseStats,
  detectAuditError,
  formatAuditTime,
  EVENT_TYPES,
  RISK_LEVELS,
} from '../utils/audit-parser.js'

const ws = useWsStore()

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

const logColumns = [
  { title: '时间', key: 'createdAt', width: '160px' },
  { title: '类型', key: 'eventType', width: '110px' },
  { title: '操作', key: 'operation' },
  { title: '角色', key: 'actor', width: '140px' },
  { title: '目标', key: 'target', width: '180px' },
  { title: '风险', key: 'riskLevel', width: '90px' },
  { title: '状态', key: 'success', width: '80px' },
  { title: '操作', key: 'action', width: '80px' },
]

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

function typeLabel(t) {
  return {
    auth: '认证', permission: '权限', data: '数据', system: '系统',
    file: '文件', did: 'DID', crypto: '加密', api: 'API',
  }[t] || t
}
function typeColor(t) {
  return {
    auth: 'blue', permission: 'purple', data: 'cyan', system: 'default',
    file: 'green', did: 'gold', crypto: 'magenta', api: 'volcano',
  }[t] || 'default'
}
function typeBarColor(t) {
  return {
    auth: '#1677ff', permission: '#722ed1', data: '#13c2c2', system: '#888',
    file: '#52c41a', did: '#faad14', crypto: '#eb2f96', api: '#fa541c',
  }[t] || '#888'
}

function riskLabel(r) {
  return { low: '低', medium: '中', high: '高', critical: '关键' }[r] || r
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
    message.error('加载审计日志失败: ' + (e?.message || e))
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
      message.error('需要先 cc init 初始化项目')
      return
    }
    // The lib emits the raw JSON to stdout when no -o is provided.
    if (!output.trim().startsWith('[')) {
      message.error('导出失败: ' + output.slice(0, 120))
      return
    }
    const blob = new Blob([output.trim()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    message.success('已导出到下载文件夹')
  } catch (e) {
    message.error('导出失败: ' + (e?.message || e))
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
