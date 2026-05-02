<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('tokens.title') }}</h2>
        <p class="page-sub">{{ t('tokens.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ t('tokens.refresh') }}
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      :message="t('tokens.noDb.message')"
      :description="t('tokens.noDb.description')"
      style="margin-bottom: 16px;"
    />

    <!-- Period selector -->
    <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;" :body-style="{ padding: '10px 16px' }">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <span style="color: var(--text-secondary); font-size: 12px;">{{ t('tokens.periodLabel') }}</span>
        <a-radio-group v-model:value="period" size="small" button-style="solid" @change="loadShow">
          <a-radio-button v-for="p in PERIOD_OPTIONS" :key="p" :value="p">{{ periodLabel(p) }}</a-radio-button>
        </a-radio-group>
      </div>
    </a-card>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('tokens.stats.calls')" :value="show.stats.totalCalls" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('tokens.stats.callsToday', { count: show.today.totalCalls }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('tokens.stats.totalTokens')"
            :value="show.stats.totalTokens"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          >
            <template #prefix><NumberOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('tokens.stats.tokensInOut', { inputs: formatNumber(show.stats.totalInputTokens), outputs: formatNumber(show.stats.totalOutputTokens) }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('tokens.stats.totalCost')"
            :value="show.stats.totalCostUsd"
            :precision="show.stats.totalCostUsd < 1 ? 4 : 2"
            prefix="$"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          />
          <div class="stat-sub">{{ t('tokens.stats.costToday', { amount: formatCost(show.today.totalCostUsd) }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('tokens.stats.avgResponse')"
            :value="show.stats.avgResponseTimeMs"
            suffix="ms"
            :precision="0"
            :value-style="{ color: respColor(show.stats.avgResponseTimeMs), fontSize: '20px' }"
          >
            <template #prefix><ClockCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('tokens.stats.cacheHits')"
            :value="cache.totalHits"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><DatabaseOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ t('tokens.stats.cacheTokensSaved', { count: formatNumber(cache.totalTokensSaved) }) }}</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="tokens-tabs">
      <!-- ── Breakdown tab ────────────────────────────────────── -->
      <a-tab-pane key="breakdown" :tab="t('tokens.tabs.breakdown')">
        <a-table
          :columns="breakdownColumns"
          :data-source="breakdown"
          :pagination="{ pageSize: 20, showTotal: (count) => t('tokens.totals.models', { count }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'provider'">
              <a-tag :color="providerColor(record.provider)" style="font-family: monospace;">{{ record.provider }}</a-tag>
            </template>
            <template v-if="column.key === 'model'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.model }}</span>
            </template>
            <template v-if="column.key === 'calls'">
              <span style="color: var(--text-secondary);">{{ formatNumber(record.calls) }}</span>
            </template>
            <template v-if="column.key === 'totalTokens'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ formatNumber(record.totalTokens) }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace;">
                {{ t('tokens.breakdownDetails.tokensInOut', { inputs: formatNumber(record.inputTokens), outputs: formatNumber(record.outputTokens) }) }}
              </div>
            </template>
            <template v-if="column.key === 'costUsd'">
              <span style="color: #faad14; font-weight: 500; font-family: monospace;">{{ formatCost(record.costUsd) }}</span>
              <a-progress
                :percent="costPct(record.costUsd)"
                :show-info="false"
                :stroke-color="'#faad14'"
                size="small"
                style="margin-top: 2px;"
              />
            </template>
            <template v-if="column.key === 'avgCost'">
              <span style="color: var(--text-muted); font-family: monospace; font-size: 12px;">{{ record.calls > 0 ? formatCost(record.costUsd / record.calls) : '—' }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <NumberOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ t('tokens.empty.breakdown') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Recent tab ───────────────────────────────────────── -->
      <a-tab-pane key="recent" :tab="t('tokens.tabs.recent')">
        <a-table
          :columns="recentColumns"
          :data-source="recent"
          :pagination="{ pageSize: 20, showTotal: (count) => t('tokens.totals.rows', { count }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px; font-family: monospace;">{{ formatTokensTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'provider'">
              <a-tag :color="providerColor(record.provider)" style="font-family: monospace;">{{ record.provider }}</a-tag>
            </template>
            <template v-if="column.key === 'model'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.model }}</span>
            </template>
            <template v-if="column.key === 'tokens'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ formatNumber(record.totalTokens) }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace;">
                {{ formatNumber(record.inputTokens) }} / {{ formatNumber(record.outputTokens) }}
              </div>
            </template>
            <template v-if="column.key === 'costUsd'">
              <span style="color: #faad14; font-weight: 500; font-family: monospace;">{{ formatCost(record.costUsd) }}</span>
            </template>
            <template v-if="column.key === 'responseTimeMs'">
              <a-tag :color="respTagColor(record.responseTimeMs)">{{ record.responseTimeMs }}ms</a-tag>
            </template>
            <template v-if="column.key === 'endpoint'">
              <span v-if="record.endpoint" style="color: var(--text-muted); font-family: monospace; font-size: 11px;">{{ record.endpoint }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ClockCircleOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ t('tokens.empty.recent') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Cache tab ────────────────────────────────────────── -->
      <a-tab-pane key="cache" :tab="t('tokens.tabs.cache')">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('tokens.cache.totalEntries')" :value="cache.totalEntries" :value-style="{ color: '#1677ff', fontSize: '18px' }" />
            </a-card>
          </a-col>
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('tokens.cache.totalHits')" :value="cache.totalHits" :value-style="{ color: '#52c41a', fontSize: '18px' }" />
            </a-card>
          </a-col>
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('tokens.cache.totalTokensSaved')" :value="cache.totalTokensSaved" :value-style="{ color: '#13c2c2', fontSize: '18px' }" />
            </a-card>
          </a-col>
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('tokens.cache.expiredEntries')" :value="cache.expiredEntries" :value-style="{ color: cache.expiredEntries > 0 ? '#faad14' : '#888', fontSize: '18px' }" />
            </a-card>
          </a-col>
        </a-row>

        <a-card :title="t('tokens.cache.maintenanceTitle')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
          <a-space>
            <a-popconfirm
              :title="t('tokens.cache.cleanupConfirm')"
              :ok-text="t('tokens.cache.cleanupOk')"
              :cancel-text="t('common.cancel')"
              @confirm="cleanupExpired"
            >
              <a-button :disabled="cache.expiredEntries === 0">
                <template #icon><DeleteOutlined /></template>
                {{ t('tokens.cache.cleanupButton', { count: cache.expiredEntries }) }}
              </a-button>
            </a-popconfirm>
            <a-popconfirm
              :title="t('tokens.cache.clearConfirm')"
              :ok-text="t('tokens.cache.clearOk')"
              ok-type="danger"
              :cancel-text="t('common.cancel')"
              @confirm="clearAllCache"
            >
              <a-button danger :disabled="cache.totalEntries === 0">
                <template #icon><DeleteOutlined /></template>
                {{ t('tokens.cache.clearButton') }}
              </a-button>
            </a-popconfirm>
          </a-space>
        </a-card>

        <a-card :title="t('tokens.v2.cardTitle')" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;">
          <a-row :gutter="[16, 16]">
            <a-col :xs="24" :lg="12">
              <h5 style="font-size: 12px; color: var(--text-secondary); margin: 0 0 8px;">{{ t('tokens.v2.budgetsTitle') }}</h5>
              <div v-for="s in BUDGET_MATURITIES_V2" :key="s" class="bd-row">
                <a-tag :color="budgetStatusColor(s)" style="min-width: 80px; text-align: center;">{{ budgetStatusLabel(s) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(statsV2.budgetsByStatus[s] || 0, statsV2.totalBudgetsV2)"
                  :stroke-color="budgetBarColor(s)"
                  :format="() => `${statsV2.budgetsByStatus[s] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-col>
            <a-col :xs="24" :lg="12">
              <h5 style="font-size: 12px; color: var(--text-secondary); margin: 0 0 8px;">{{ t('tokens.v2.recordsTitle') }}</h5>
              <div v-for="s in USAGE_RECORD_LIFECYCLES_V2" :key="s" class="bd-row">
                <a-tag :color="recordStatusColor(s)" style="min-width: 80px; text-align: center;">{{ recordStatusLabel(s) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(statsV2.recordsByStatus[s] || 0, statsV2.totalRecordsV2)"
                  :stroke-color="recordBarColor(s)"
                  :format="() => `${statsV2.recordsByStatus[s] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-col>
          </a-row>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ReloadOutlined,
  ApiOutlined,
  NumberOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseShowResult,
  parseBreakdown,
  parseRecent,
  parseCacheStats,
  parseStatsV2,
  detectTokensError,
  formatTokensTime,
  formatCost,
  PERIOD_OPTIONS,
  BUDGET_MATURITIES_V2,
  USAGE_RECORD_LIFECYCLES_V2,
} from '../utils/tokens-parser.js'

const { t } = useI18n()
const ws = useWsStore()

const loading = ref(false)

const period = ref('all')
const show = ref({
  stats: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCostUsd: 0, avgResponseTimeMs: 0 },
  today: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCostUsd: 0, avgResponseTimeMs: 0 },
})
const breakdown = ref([])
const recent = ref([])
const cache = ref({ totalEntries: 0, totalHits: 0, totalTokensSaved: 0, expiredEntries: 0 })
const statsV2 = ref({
  totalBudgetsV2: 0, totalRecordsV2: 0,
  maxActiveBudgetsPerOwner: 0, maxPendingRecordsPerBudget: 0,
  budgetIdleMs: 0, recordStuckMs: 0,
  budgetsByStatus: {}, recordsByStatus: {},
})
const errorState = ref({ noDb: false, error: '' })

const activeTab = ref('breakdown')

const breakdownColumns = computed(() => [
  { title: t('tokens.breakdownColumns.provider'), key: 'provider', width: '130px' },
  { title: t('tokens.breakdownColumns.model'), key: 'model' },
  { title: t('tokens.breakdownColumns.calls'), key: 'calls', width: '90px' },
  { title: t('tokens.breakdownColumns.totalTokens'), key: 'totalTokens', width: '180px' },
  { title: t('tokens.breakdownColumns.costUsd'), key: 'costUsd', width: '180px' },
  { title: t('tokens.breakdownColumns.avgCost'), key: 'avgCost', width: '110px' },
])

const recentColumns = computed(() => [
  { title: t('tokens.recentColumns.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('tokens.recentColumns.provider'), key: 'provider', width: '130px' },
  { title: t('tokens.recentColumns.model'), key: 'model', width: '180px' },
  { title: t('tokens.recentColumns.tokens'), key: 'tokens', width: '160px' },
  { title: t('tokens.recentColumns.costUsd'), key: 'costUsd', width: '110px' },
  { title: t('tokens.recentColumns.responseTimeMs'), key: 'responseTimeMs', width: '100px' },
  { title: t('tokens.recentColumns.endpoint'), key: 'endpoint' },
])

const totalCost = computed(() => breakdown.value.reduce((s, r) => s + r.costUsd, 0))

function periodLabel(p) {
  const key = `tokens.period.${p}`
  const v = t(key)
  return v === key ? p : v
}

function providerColor(p) {
  const palette = ['blue', 'green', 'purple', 'orange', 'cyan', 'magenta', 'gold', 'volcano']
  let h = 0
  for (let i = 0; i < (p || '').length; i++) h = (h * 31 + p.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function respColor(ms) {
  if (ms <= 500) return '#52c41a'
  if (ms <= 1500) return '#1677ff'
  if (ms <= 3000) return '#faad14'
  return '#ff4d4f'
}

function respTagColor(ms) {
  if (ms <= 500) return 'green'
  if (ms <= 1500) return 'blue'
  if (ms <= 3000) return 'gold'
  return 'red'
}

function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
}

function costPct(cost) {
  if (!totalCost.value || cost <= 0) return 0
  return Math.min(100, Math.round((cost / totalCost.value) * 100))
}

function pctOfTotal(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

function budgetStatusLabel(s) {
  const key = `tokens.budgetStatus.${s}`
  const v = t(key)
  return v === key ? s : v
}
function budgetStatusColor(s) {
  return { planning: 'default', active: 'green', suspended: 'orange', archived: 'default' }[s] || 'default'
}
function budgetBarColor(s) {
  return { planning: '#888', active: '#52c41a', suspended: '#faad14', archived: '#666' }[s] || '#888'
}

function recordStatusLabel(s) {
  const key = `tokens.recordStatus.${s}`
  const v = t(key)
  return v === key ? s : v
}
function recordStatusColor(s) {
  return { pending: 'default', recorded: 'blue', billed: 'green', rejected: 'red', refunded: 'orange' }[s] || 'default'
}
function recordBarColor(s) {
  return { pending: '#888', recorded: '#1677ff', billed: '#52c41a', rejected: '#ff4d4f', refunded: '#faad14' }[s] || '#888'
}

async function loadAll() {
  loading.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const [showRes, brkRes, recRes, cacheRes, v2Res] = await Promise.all([
      ws.execute(`tokens show --period ${period.value} --json`, 8000).catch(() => ({ output: '' })),
      ws.execute('tokens breakdown --json', 8000).catch(() => ({ output: '' })),
      ws.execute('tokens recent -n 100 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('tokens cache --json', 6000).catch(() => ({ output: '' })),
      ws.execute('tokens stats-v2', 6000).catch(() => ({ output: '' })),
    ])
    const errs = [showRes, brkRes, recRes, cacheRes]
      .map(r => detectTokensError(r.output))
      .find(e => e.noDb)
    if (errs) {
      errorState.value = errs
    }
    show.value = parseShowResult(showRes.output)
    breakdown.value = parseBreakdown(brkRes.output)
    recent.value = parseRecent(recRes.output)
    cache.value = parseCacheStats(cacheRes.output)
    statsV2.value = parseStatsV2(v2Res.output)
  } catch (e) {
    message.error(t('tokens.messages.loadFailed', { err: e?.message || e }))
  } finally {
    loading.value = false
  }
}

async function loadShow() {
  try {
    const { output } = await ws.execute(`tokens show --period ${period.value} --json`, 8000)
    const err = detectTokensError(output)
    if (err.noDb) {
      errorState.value = err
      return
    }
    show.value = parseShowResult(output)
  } catch (e) {
    message.error(t('tokens.messages.loadShowFailed', { err: e?.message || e }))
  }
}

async function cleanupExpired() {
  try {
    const { output } = await ws.execute('tokens cache --cleanup', 8000)
    const err = detectTokensError(output)
    if (err.noDb) {
      message.error(t('tokens.messages.needInit'))
      return
    }
    message.success(t('tokens.messages.cleanupOk'))
    await loadAll()
  } catch (e) {
    message.error(t('tokens.messages.cleanupFailed', { err: e?.message || e }))
  }
}

async function clearAllCache() {
  try {
    const { output } = await ws.execute('tokens cache --clear', 8000)
    const err = detectTokensError(output)
    if (err.noDb) {
      message.error(t('tokens.messages.needInit'))
      return
    }
    message.success(t('tokens.messages.clearOk'))
    await loadAll()
  } catch (e) {
    message.error(t('tokens.messages.clearFailed', { err: e?.message || e }))
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

.tokens-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.stat-sub {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.bd-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
</style>
