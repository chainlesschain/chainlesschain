<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">Token 用量</h2>
        <p class="page-sub">LLM 调用追踪 · 成本核算 · 响应缓存</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      message="该模块需要项目级数据库"
      description="`cc tokens ...` 命令仅在 chainlesschain 项目目录下可用。请先运行 `cc init` 初始化项目，或在已初始化的目录启动 `cc serve`。"
      style="margin-bottom: 16px;"
    />

    <!-- Period selector -->
    <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;" :body-style="{ padding: '10px 16px' }">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <span style="color: var(--text-secondary); font-size: 12px;">时间范围:</span>
        <a-radio-group v-model:value="period" size="small" button-style="solid" @change="loadShow">
          <a-radio-button v-for="p in PERIOD_OPTIONS" :key="p" :value="p">{{ periodLabel(p) }}</a-radio-button>
        </a-radio-group>
      </div>
    </a-card>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="调用次数" :value="show.stats.totalCalls" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
          <div class="stat-sub">今日 {{ show.today.totalCalls }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="Token 总数"
            :value="show.stats.totalTokens"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          >
            <template #prefix><NumberOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ formatNumber(show.stats.totalInputTokens) }} 入 / {{ formatNumber(show.stats.totalOutputTokens) }} 出</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="累计成本"
            :value="show.stats.totalCostUsd"
            :precision="show.stats.totalCostUsd < 1 ? 4 : 2"
            prefix="$"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          />
          <div class="stat-sub">今日 {{ formatCost(show.today.totalCostUsd) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="平均响应"
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
            title="缓存命中"
            :value="cache.totalHits"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><DatabaseOutlined /></template>
          </a-statistic>
          <div class="stat-sub">省 {{ formatNumber(cache.totalTokensSaved) }} tokens</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="tokens-tabs">
      <!-- ── Breakdown tab ────────────────────────────────────── -->
      <a-tab-pane key="breakdown" tab="模型成本">
        <a-table
          :columns="breakdownColumns"
          :data-source="breakdown"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 个模型` }"
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
                {{ formatNumber(record.inputTokens) }} 入 / {{ formatNumber(record.outputTokens) }} 出
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
              暂无用量数据
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Recent tab ───────────────────────────────────────── -->
      <a-tab-pane key="recent" tab="最近调用">
        <a-table
          :columns="recentColumns"
          :data-source="recent"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
              暂无调用记录
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Cache tab ────────────────────────────────────────── -->
      <a-tab-pane key="cache" tab="响应缓存">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic title="缓存条目" :value="cache.totalEntries" :value-style="{ color: '#1677ff', fontSize: '18px' }" />
            </a-card>
          </a-col>
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic title="命中次数" :value="cache.totalHits" :value-style="{ color: '#52c41a', fontSize: '18px' }" />
            </a-card>
          </a-col>
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic title="节省 Tokens" :value="cache.totalTokensSaved" :value-style="{ color: '#13c2c2', fontSize: '18px' }" />
            </a-card>
          </a-col>
          <a-col :xs="12" :sm="6">
            <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic title="过期条目" :value="cache.expiredEntries" :value-style="{ color: cache.expiredEntries > 0 ? '#faad14' : '#888', fontSize: '18px' }" />
            </a-card>
          </a-col>
        </a-row>

        <a-card title="缓存维护" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
          <a-space>
            <a-popconfirm
              title="移除所有过期缓存？"
              ok-text="清理"
              cancel-text="取消"
              @confirm="cleanupExpired"
            >
              <a-button :disabled="cache.expiredEntries === 0">
                <template #icon><DeleteOutlined /></template>
                清理过期条目 ({{ cache.expiredEntries }})
              </a-button>
            </a-popconfirm>
            <a-popconfirm
              title="清空整个响应缓存？此操作不可撤销。"
              ok-text="清空"
              ok-type="danger"
              cancel-text="取消"
              @confirm="clearAllCache"
            >
              <a-button danger :disabled="cache.totalEntries === 0">
                <template #icon><DeleteOutlined /></template>
                清空全部缓存
              </a-button>
            </a-popconfirm>
          </a-space>
        </a-card>

        <a-card title="V2 预算治理" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;">
          <a-row :gutter="[16, 16]">
            <a-col :xs="24" :lg="12">
              <h5 style="font-size: 12px; color: var(--text-secondary); margin: 0 0 8px;">预算 (Budgets V2)</h5>
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
              <h5 style="font-size: 12px; color: var(--text-secondary); margin: 0 0 8px;">使用记录 (Records V2)</h5>
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

const breakdownColumns = [
  { title: '提供商', key: 'provider', width: '130px' },
  { title: '模型', key: 'model' },
  { title: '调用', key: 'calls', width: '90px' },
  { title: 'Token', key: 'totalTokens', width: '180px' },
  { title: '成本', key: 'costUsd', width: '180px' },
  { title: '均价/次', key: 'avgCost', width: '110px' },
]

const recentColumns = [
  { title: '时间', key: 'createdAt', width: '160px' },
  { title: '提供商', key: 'provider', width: '130px' },
  { title: '模型', key: 'model', width: '180px' },
  { title: 'Tokens', key: 'tokens', width: '160px' },
  { title: '成本', key: 'costUsd', width: '110px' },
  { title: '响应', key: 'responseTimeMs', width: '100px' },
  { title: '端点', key: 'endpoint' },
]

const totalCost = computed(() => breakdown.value.reduce((s, r) => s + r.costUsd, 0))

function periodLabel(p) {
  return { today: '今日', week: '近 7 日', month: '近 30 日', all: '全部' }[p] || p
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
  return { planning: '筹划', active: '活跃', suspended: '暂停', archived: '已归档' }[s] || s
}
function budgetStatusColor(s) {
  return { planning: 'default', active: 'green', suspended: 'orange', archived: 'default' }[s] || 'default'
}
function budgetBarColor(s) {
  return { planning: '#888', active: '#52c41a', suspended: '#faad14', archived: '#666' }[s] || '#888'
}

function recordStatusLabel(s) {
  return { pending: '待处理', recorded: '已记录', billed: '已结算', rejected: '已拒绝', refunded: '已退款' }[s] || s
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
    message.error('加载用量数据失败: ' + (e?.message || e))
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
    message.error('加载用量失败: ' + (e?.message || e))
  }
}

async function cleanupExpired() {
  try {
    const { output } = await ws.execute('tokens cache --cleanup', 8000)
    const err = detectTokensError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    message.success('过期条目已清理')
    await loadAll()
  } catch (e) {
    message.error('清理失败: ' + (e?.message || e))
  }
}

async function clearAllCache() {
  try {
    const { output } = await ws.execute('tokens cache --clear', 8000)
    const err = detectTokensError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    message.success('缓存已清空')
    await loadAll()
  } catch (e) {
    message.error('清空失败: ' + (e?.message || e))
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
