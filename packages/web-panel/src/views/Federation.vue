<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('federation.title') }}</h2>
        <p class="page-sub">{{ t('federation.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ t('federation.refresh') }}
        </a-button>
        <a-dropdown>
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ t('federation.newDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item key="register" @click="showRegisterModal = true">{{ t('federation.newMenu.register') }}</a-menu-item>
              <a-menu-item key="check" @click="showCheckModal = true">{{ t('federation.newMenu.check') }}</a-menu-item>
              <a-menu-item key="pool" @click="showPoolModal = true">{{ t('federation.newMenu.pool') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('federation.stats.breakers')"
            :value="stats.circuitBreakers.total"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><ClusterOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('federation.stats.breakerSub', { closed: stats.circuitBreakers.byState.closed || 0, open: stats.circuitBreakers.byState.open || 0 }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('federation.stats.checks')"
            :value="stats.healthChecks.total"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><HeartOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('federation.stats.checkSub', { healthy: stats.healthChecks.byStatus.healthy || 0, unhealthy: stats.healthChecks.byStatus.unhealthy || 0 }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('federation.stats.pools')"
            :value="stats.connectionPools.total"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('federation.stats.poolSub', { active: stats.connectionPools.totalActive, idle: stats.connectionPools.totalIdle }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('federation.stats.degraded')"
            :value="degradedCount"
            :value-style="{ color: degradedCount > 0 ? '#faad14' : '#8c8c8c', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('federation.stats.degradedSub', { halfOpen: stats.circuitBreakers.byState.half_open || 0 }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('federation.stats.availability')"
            :value="availabilityRate"
            suffix="%"
            :precision="0"
            :value-style="{ color: rateColor(availabilityRate), fontSize: '20px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs (4 surfaces) -->
    <a-tabs v-model:activeKey="activeTab" class="fed-tabs">
      <!-- ── Circuit breakers ──────────────────────────── -->
      <a-tab-pane key="breakers" :tab="t('federation.tabs.breakers')">
        <div class="filter-bar">
          <a-radio-group v-model:value="stateFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ t('federation.filter.allStates') }}</a-radio-button>
            <a-radio-button v-for="s in CIRCUIT_STATES" :key="s" :value="s">{{ stateLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="breakerColumns"
          :data-source="filteredBreakers"
          :pagination="{ pageSize: 20, showTotal: (count) => t('federation.totals.rows', { count }) }"
          size="small"
          :loading="loading"
          row-key="key"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'state'">
              <a-tag :color="stateColor(record.state)">{{ stateLabel(record.state) }}</a-tag>
            </template>
            <template v-else-if="column.key === 'failure'">
              <span>{{ record.failureCount }} / {{ record.failureThreshold }}</span>
            </template>
            <template v-else-if="column.key === 'success'">
              <span>{{ record.successCount }} / {{ record.successThreshold }}</span>
            </template>
            <template v-else-if="column.key === 'updatedAt'">
              <span class="muted">{{ formatFedTime(record.updatedAt) }}</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space :size="4">
                <a-button size="small" danger @click="recordTransition(record, 'failure')">{{ t('federation.breakerActions.failure') }}</a-button>
                <a-button size="small" @click="recordTransition(record, 'success')">{{ t('federation.breakerActions.success') }}</a-button>
                <a-button size="small" type="dashed" @click="recordTransition(record, 'half-open')">{{ t('federation.breakerActions.halfOpen') }}</a-button>
                <a-button size="small" @click="recordTransition(record, 'reset')">{{ t('federation.breakerActions.reset') }}</a-button>
                <a-popconfirm :title="t('federation.breakerActions.removeConfirm')" @confirm="removeNode(record)">
                  <a-button size="small" danger type="text">{{ t('federation.breakerActions.remove') }}</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>

          <template #emptyText>
            <a-empty :image="EMPTY_IMG" :description="t('federation.empty.breakers')" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Health checks ─────────────────────────────── -->
      <a-tab-pane key="checks" :tab="t('federation.tabs.checks')">
        <div class="filter-bar">
          <a-radio-group v-model:value="metricFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ t('federation.filter.allMetrics') }}</a-radio-button>
            <a-radio-button v-for="m in HEALTH_METRICS" :key="m" :value="m">{{ metricLabel(m) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="healthStatusFilter" size="small">
            <a-radio-button value="">{{ t('federation.filter.allStates') }}</a-radio-button>
            <a-radio-button v-for="s in HEALTH_STATUSES" :key="s" :value="s">{{ healthLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="checkColumns"
          :data-source="filteredChecks"
          :pagination="{ pageSize: 20, showTotal: (count) => t('federation.totals.rows', { count }) }"
          size="small"
          :loading="loading"
          row-key="key"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'checkId'">
              <span style="font-family: monospace; font-size: 12px;">{{ record.checkId.slice(0, 12) }}</span>
            </template>
            <template v-else-if="column.key === 'checkType'">
              <a-tag color="blue">{{ metricLabel(record.checkType) }}</a-tag>
            </template>
            <template v-else-if="column.key === 'status'">
              <a-tag :color="healthColor(record.status)">{{ healthLabel(record.status) }}</a-tag>
            </template>
            <template v-else-if="column.key === 'metrics'">
              <span class="muted" style="font-family: monospace; font-size: 11px;">{{ truncate(record.metrics || '', 50) }}</span>
            </template>
            <template v-else-if="column.key === 'checkedAt'">
              <span class="muted">{{ formatFedTime(record.checkedAt) }}</span>
            </template>
          </template>

          <template #emptyText>
            <a-empty :image="EMPTY_IMG" :description="t('federation.empty.checks')" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Connection pools ──────────────────────────── -->
      <a-tab-pane key="pools" :tab="t('federation.tabs.pools')">
        <a-table
          :columns="poolColumns"
          :data-source="pools"
          :pagination="{ pageSize: 20, showTotal: (count) => t('federation.totals.rows', { count }) }"
          size="small"
          :loading="loading"
          row-key="key"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'utilization'">
              <a-progress
                :percent="poolUtilization(record)"
                :stroke-color="rateColor(poolUtilization(record))"
                size="small"
              />
            </template>
            <template v-else-if="column.key === 'createdAt'">
              <span class="muted">{{ formatFedTime(record.createdAt) }}</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space :size="4">
                <a-button size="small" type="primary" @click="poolAction(record, 'acquire')">{{ t('federation.poolActions.acquire') }}</a-button>
                <a-button size="small" @click="poolAction(record, 'release')">{{ t('federation.poolActions.release') }}</a-button>
                <a-popconfirm :title="t('federation.poolActions.destroyConfirm')" @confirm="poolAction(record, 'destroy')">
                  <a-button size="small" danger type="text">{{ t('federation.poolActions.destroy') }}</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>

          <template #emptyText>
            <a-empty :image="EMPTY_IMG" :description="t('federation.empty.pools')" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Node health aggregate ────────────────────── -->
      <a-tab-pane key="node-health" :tab="t('federation.tabs.nodeHealth')">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-space>
            <a-input
              v-model:value="nodeHealthInput"
              :placeholder="t('federation.nodeHealth.inputPlaceholder')"
              style="width: 240px;"
              allow-clear
              @press-enter="queryNodeHealth"
            />
            <a-button type="primary" :loading="queryingHealth" @click="queryNodeHealth">
              <template #icon><SearchOutlined /></template>
              {{ t('federation.nodeHealth.query') }}
            </a-button>
          </a-space>
        </a-card>

        <a-card v-if="nodeHealth" style="background: var(--bg-card); border-color: var(--border-color);">
          <a-descriptions :column="3" size="small" bordered>
            <a-descriptions-item :label="t('federation.nodeHealth.node')">
              <span style="font-family: monospace;">{{ nodeHealth.nodeId }}</span>
            </a-descriptions-item>
            <a-descriptions-item :label="t('federation.nodeHealth.status')">
              <a-tag :color="healthColor(nodeHealth.status)">{{ healthLabel(nodeHealth.status) }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item :label="t('federation.nodeHealth.checkCount')">
              {{ nodeHealth.checks }}
            </a-descriptions-item>
          </a-descriptions>

          <div style="margin-top: 16px;">
            <h4 style="color: var(--text-primary); margin-bottom: 8px;">{{ t('federation.nodeHealth.latestTitle') }}</h4>
            <a-empty
              v-if="!nodeHealth.latestChecks.length"
              :image="EMPTY_IMG"
              :description="t('federation.empty.noLatest')"
            />
            <a-table
              v-else
              :columns="latestChecksColumns"
              :data-source="nodeHealth.latestChecks"
              :pagination="false"
              size="small"
              row-key="checkType"
              style="background: var(--bg-card);"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'checkType'">
                  <a-tag color="blue">{{ metricLabel(record.checkType) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'status'">
                  <a-tag :color="healthColor(record.status)">{{ healthLabel(record.status) }}</a-tag>
                </template>
                <template v-else-if="column.key === 'checkedAt'">
                  <span class="muted">{{ formatFedTime(record.checkedAt) }}</span>
                </template>
              </template>
            </a-table>
          </div>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- Modal: register node -->
    <a-modal v-model:open="showRegisterModal" :title="t('federation.register.title')" :confirm-loading="creating" @ok="submitRegister">
      <a-form layout="vertical">
        <a-form-item :label="t('federation.register.nodeIdLabel')" required>
          <a-input v-model:value="registerForm.nodeId" :placeholder="t('federation.register.nodeIdPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('federation.register.failureThresholdLabel')">
          <a-input-number v-model:value="registerForm.failureThreshold" :min="1" :max="100" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="t('federation.register.successThresholdLabel')">
          <a-input-number v-model:value="registerForm.successThreshold" :min="1" :max="100" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="t('federation.register.openTimeoutLabel')">
          <a-input-number v-model:value="registerForm.openTimeout" :min="1000" :step="1000" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Modal: record health check -->
    <a-modal v-model:open="showCheckModal" :title="t('federation.check.title')" :confirm-loading="creating" @ok="submitCheck">
      <a-form layout="vertical">
        <a-form-item :label="t('federation.check.nodeIdLabel')" required>
          <a-input v-model:value="checkForm.nodeId" :placeholder="t('federation.check.nodeIdPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('federation.check.metricLabel')" required>
          <a-select v-model:value="checkForm.checkType">
            <a-select-option v-for="m in HEALTH_METRICS" :key="m" :value="m">{{ metricLabel(m) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('federation.check.statusLabel')" required>
          <a-select v-model:value="checkForm.status">
            <a-select-option v-for="s in HEALTH_STATUSES" :key="s" :value="s">{{ healthLabel(s) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('federation.check.metricsLabel')">
          <a-textarea v-model:value="checkForm.metrics" :rows="3" :placeholder="t('federation.check.metricsPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Modal: init pool -->
    <a-modal v-model:open="showPoolModal" :title="t('federation.pool.title')" :confirm-loading="creating" @ok="submitPool">
      <a-form layout="vertical">
        <a-form-item :label="t('federation.pool.nodeIdLabel')" required>
          <a-input v-model:value="poolForm.nodeId" :placeholder="t('federation.pool.nodeIdPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('federation.pool.minLabel')">
          <a-input-number v-model:value="poolForm.min" :min="1" :max="500" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="t('federation.pool.maxLabel')">
          <a-input-number v-model:value="poolForm.max" :min="1" :max="500" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="t('federation.pool.idleTimeoutLabel')">
          <a-input-number v-model:value="poolForm.idleTimeout" :min="1000" :step="1000" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ReloadOutlined,
  PlusOutlined,
  ClusterOutlined,
  HeartOutlined,
  ApiOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseBreakers,
  parseChecks,
  parsePools,
  parseNodeHealth,
  parseRegisterResult,
  parseTransitionResult,
  parsePoolActionResult,
  parseRemoveResult,
  parseStats,
  formatFedTime,
  CIRCUIT_STATES,
  HEALTH_STATUSES,
  HEALTH_METRICS,
} from '../utils/federation-parser.js'

const { t } = useI18n()
const ws = useWsStore()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const creating = ref(false)
const queryingHealth = ref(false)

const breakers = ref([])
const checks = ref([])
const pools = ref([])
const stats = ref({
  circuitBreakers: { total: 0, byState: { closed: 0, open: 0, half_open: 0 } },
  healthChecks: { total: 0, byStatus: { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 } },
  connectionPools: { total: 0, totalActive: 0, totalIdle: 0, totalConnections: 0 },
})

const activeTab = ref('breakers')
const stateFilter = ref('')
const metricFilter = ref('')
const healthStatusFilter = ref('')

const showRegisterModal = ref(false)
const showCheckModal = ref(false)
const showPoolModal = ref(false)

const registerForm = reactive({ nodeId: '', failureThreshold: 5, successThreshold: 2, openTimeout: 60000 })
const checkForm = reactive({ nodeId: '', checkType: 'heartbeat', status: 'healthy', metrics: '' })
const poolForm = reactive({ nodeId: '', min: 5, max: 50, idleTimeout: 300000 })

const nodeHealthInput = ref('')
const nodeHealth = ref(null)

const breakerColumns = computed(() => [
  { title: t('federation.breakerColumns.node'), key: 'nodeId', dataIndex: 'nodeId', width: '200px' },
  { title: t('federation.breakerColumns.state'), key: 'state', width: '100px' },
  { title: t('federation.breakerColumns.failure'), key: 'failure', width: '120px' },
  { title: t('federation.breakerColumns.success'), key: 'success', width: '120px' },
  { title: t('federation.breakerColumns.openTimeout'), key: 'openTimeout', dataIndex: 'openTimeout', width: '110px' },
  { title: t('federation.breakerColumns.updatedAt'), key: 'updatedAt', width: '170px' },
  { title: t('federation.breakerColumns.action'), key: 'action', width: '340px' },
])

const checkColumns = computed(() => [
  { title: t('federation.checkColumns.id'), key: 'checkId', width: '130px' },
  { title: t('federation.checkColumns.node'), key: 'nodeId', dataIndex: 'nodeId', width: '180px' },
  { title: t('federation.checkColumns.metric'), key: 'checkType', width: '120px' },
  { title: t('federation.checkColumns.status'), key: 'status', width: '100px' },
  { title: t('federation.checkColumns.metrics'), key: 'metrics' },
  { title: t('federation.checkColumns.checkedAt'), key: 'checkedAt', width: '170px' },
])

const poolColumns = computed(() => [
  { title: t('federation.poolColumns.node'), key: 'nodeId', dataIndex: 'nodeId', width: '200px' },
  { title: t('federation.poolColumns.active'), key: 'activeConnections', dataIndex: 'activeConnections', width: '90px' },
  { title: t('federation.poolColumns.idle'), key: 'idleConnections', dataIndex: 'idleConnections', width: '90px' },
  { title: t('federation.poolColumns.max'), key: 'maxConnections', dataIndex: 'maxConnections', width: '90px' },
  { title: t('federation.poolColumns.utilization'), key: 'utilization', width: '160px' },
  { title: t('federation.poolColumns.waiting'), key: 'waitingRequests', dataIndex: 'waitingRequests', width: '90px' },
  { title: t('federation.poolColumns.totalCreated'), key: 'totalCreated', dataIndex: 'totalCreated', width: '90px' },
  { title: t('federation.poolColumns.createdAt'), key: 'createdAt', width: '170px' },
  { title: t('federation.poolColumns.action'), key: 'action', width: '240px' },
])

const latestChecksColumns = computed(() => [
  { title: t('federation.latestColumns.metric'), key: 'checkType', width: '160px' },
  { title: t('federation.latestColumns.status'), key: 'status', width: '120px' },
  { title: t('federation.latestColumns.checkedAt'), key: 'checkedAt' },
])

const filteredBreakers = computed(() => {
  if (!stateFilter.value) return breakers.value
  return breakers.value.filter(b => b.state === stateFilter.value)
})

const filteredChecks = computed(() => {
  let rows = checks.value
  if (metricFilter.value) rows = rows.filter(c => c.checkType === metricFilter.value)
  if (healthStatusFilter.value) rows = rows.filter(c => c.status === healthStatusFilter.value)
  return rows
})

const degradedCount = computed(() => {
  return (stats.value.circuitBreakers.byState.open || 0)
    + (stats.value.circuitBreakers.byState.half_open || 0)
})

const availabilityRate = computed(() => {
  const total = stats.value.circuitBreakers.total
  if (!total) return 100
  return ((stats.value.circuitBreakers.byState.closed || 0) / total) * 100
})

function poolUtilization(p) {
  if (!p.maxConnections) return 0
  return Math.round((p.activeConnections / p.maxConnections) * 100)
}

function stateLabel(s) {
  const key = `federation.state.${s}`
  const v = t(key)
  return v === key ? s : v
}
function stateColor(s) {
  return { closed: 'green', open: 'red', half_open: 'gold' }[s] || 'default'
}

function metricLabel(m) {
  const key = `federation.metric.${m}`
  const v = t(key)
  return v === key ? m : v
}

function healthLabel(s) {
  const key = `federation.health.${s}`
  const v = t(key)
  return v === key ? s : v
}
function healthColor(s) {
  return {
    healthy: 'green',
    degraded: 'gold',
    unhealthy: 'red',
    unknown: 'default',
  }[s] || 'default'
}

function rateColor(pct) {
  if (pct >= 95) return '#52c41a'
  if (pct >= 80) return '#1677ff'
  if (pct >= 60) return '#faad14'
  return '#ff4d4f'
}

function truncate(s, max) {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function shellQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`
}

async function loadAll() {
  loading.value = true
  try {
    const [bRes, cRes, pRes, sRes] = await Promise.all([
      ws.execute('federation breakers --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('federation checks --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('federation pools --json', 8000).catch(() => ({ output: '' })),
      ws.execute('federation stats --json', 8000).catch(() => ({ output: '' })),
    ])
    breakers.value = parseBreakers(bRes.output)
    checks.value = parseChecks(cRes.output)
    pools.value = parsePools(pRes.output)
    stats.value = parseStats(sRes.output)
  } catch (e) {
    message.error(t('federation.messages.loadFailed', { err: e?.message || e }))
  } finally {
    loading.value = false
  }
}

async function submitRegister() {
  if (!registerForm.nodeId.trim()) {
    message.warning(t('federation.messages.nodeIdRequired'))
    return
  }
  creating.value = true
  try {
    const parts = [`federation register ${shellQuote(registerForm.nodeId.trim())}`]
    if (registerForm.failureThreshold) parts.push(`-f ${registerForm.failureThreshold}`)
    if (registerForm.successThreshold) parts.push(`-s ${registerForm.successThreshold}`)
    if (registerForm.openTimeout) parts.push(`-t ${registerForm.openTimeout}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseRegisterResult(output)
    if (!r.ok) {
      message.error(t('federation.messages.registerFailed', { err: r.reason || output.slice(0, 120) }))
      return
    }
    message.success(t('federation.messages.registerOk', { id: r.id }))
    showRegisterModal.value = false
    resetRegisterForm()
    await loadAll()
  } catch (e) {
    message.error(t('federation.messages.registerFailed', { err: e?.message || e }))
  } finally {
    creating.value = false
  }
}

async function submitCheck() {
  if (!checkForm.nodeId.trim()) {
    message.warning(t('federation.messages.nodeIdRequired'))
    return
  }
  creating.value = true
  try {
    const parts = [`federation check ${shellQuote(checkForm.nodeId.trim())}`]
    parts.push(`-t ${checkForm.checkType}`)
    parts.push(`-s ${checkForm.status}`)
    if (checkForm.metrics.trim()) parts.push(`-m ${shellQuote(checkForm.metrics.trim())}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseRegisterResult(output)
    if (!r.ok) {
      message.error(t('federation.messages.checkFailed', { err: r.reason || output.slice(0, 120) }))
      return
    }
    message.success(t('federation.messages.checkOk', { id: r.id?.slice(0, 8) }))
    showCheckModal.value = false
    resetCheckForm()
    await loadAll()
  } catch (e) {
    message.error(t('federation.messages.checkFailed', { err: e?.message || e }))
  } finally {
    creating.value = false
  }
}

async function submitPool() {
  if (!poolForm.nodeId.trim()) {
    message.warning(t('federation.messages.nodeIdRequired'))
    return
  }
  creating.value = true
  try {
    const parts = [`federation pool-init ${shellQuote(poolForm.nodeId.trim())}`]
    if (poolForm.min) parts.push(`--min ${poolForm.min}`)
    if (poolForm.max) parts.push(`--max ${poolForm.max}`)
    if (poolForm.idleTimeout) parts.push(`--idle-timeout ${poolForm.idleTimeout}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseRegisterResult(output)
    if (!r.ok) {
      message.error(t('federation.messages.poolFailed', { err: r.reason || output.slice(0, 120) }))
      return
    }
    message.success(t('federation.messages.poolOk', { id: r.id }))
    showPoolModal.value = false
    resetPoolForm()
    await loadAll()
  } catch (e) {
    message.error(t('federation.messages.poolFailed', { err: e?.message || e }))
  } finally {
    creating.value = false
  }
}

async function recordTransition(record, kind) {
  try {
    const cmd = `federation ${kind} ${shellQuote(record.nodeId)} --json`
    const { output } = await ws.execute(cmd, 8000)
    const r = parseTransitionResult(output)
    if (!r.ok) {
      message.warning(r.remainingMs
        ? t('federation.messages.operationCooldown', { ms: r.remainingMs })
        : (r.reason || t('federation.messages.operationNoEffect')))
      return
    }
    if (r.previousState && r.state && r.previousState !== r.state) {
      message.success(t('federation.messages.transitionMsg', { from: stateLabel(r.previousState), to: stateLabel(r.state) }))
    } else {
      message.success(kind === 'reset' ? t('federation.messages.resetMsg') : t('federation.messages.recordedMsg'))
    }
    await loadAll()
  } catch (e) {
    message.error(t('federation.messages.operationFailed', { err: e?.message || e }))
  }
}

async function removeNode(record) {
  try {
    const { output } = await ws.execute(`federation remove ${shellQuote(record.nodeId)} --json`, 8000)
    const r = parseRemoveResult(output)
    if (!r.ok) {
      message.error(t('federation.messages.removeFailed', { err: r.reason || output.slice(0, 120) }))
      return
    }
    message.success(t('federation.messages.removeOk'))
    await loadAll()
  } catch (e) {
    message.error(t('federation.messages.removeFailed', { err: e?.message || e }))
  }
}

async function poolAction(record, kind) {
  try {
    const subcmd = { acquire: 'pool-acquire', release: 'pool-release', destroy: 'pool-destroy' }[kind]
    const { output } = await ws.execute(`federation ${subcmd} ${shellQuote(record.nodeId)} --json`, 8000)
    const r = parsePoolActionResult(output)
    if (!r.ok) {
      message.warning(r.reason || t('federation.messages.operationNoEffect'))
      return
    }
    if (kind === 'destroy') {
      message.success(t('federation.messages.destroyMsg'))
    } else {
      const tplKey = kind === 'acquire' ? 'federation.messages.acquireMsg' : 'federation.messages.releaseMsg'
      message.success(t(tplKey, { active: r.active, idle: r.idle }))
    }
    await loadAll()
  } catch (e) {
    message.error(t('federation.messages.operationFailed', { err: e?.message || e }))
  }
}

async function queryNodeHealth() {
  if (!nodeHealthInput.value.trim()) {
    message.warning(t('federation.messages.nodeIdRequired'))
    return
  }
  queryingHealth.value = true
  try {
    const { output } = await ws.execute(
      `federation node-health ${shellQuote(nodeHealthInput.value.trim())} --json`,
      8000,
    )
    nodeHealth.value = parseNodeHealth(output)
  } catch (e) {
    message.error(t('federation.messages.queryFailed', { err: e?.message || e }))
  } finally {
    queryingHealth.value = false
  }
}

function resetRegisterForm() {
  registerForm.nodeId = ''
  registerForm.failureThreshold = 5
  registerForm.successThreshold = 2
  registerForm.openTimeout = 60000
}
function resetCheckForm() {
  checkForm.nodeId = ''
  checkForm.checkType = 'heartbeat'
  checkForm.status = 'healthy'
  checkForm.metrics = ''
}
function resetPoolForm() {
  poolForm.nodeId = ''
  poolForm.min = 5
  poolForm.max = 50
  poolForm.idleTimeout = 300000
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

.fed-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.stat-sub {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.muted {
  color: var(--text-muted);
}
</style>
