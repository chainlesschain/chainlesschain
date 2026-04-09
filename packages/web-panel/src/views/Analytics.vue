<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">使用分析</h2>
        <p class="page-sub">Token 用量 / 成本 / 缓存</p>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <a-radio-group v-model:value="period" button-style="solid" size="small">
          <a-radio-button value="today">今天</a-radio-button>
          <a-radio-button value="week">本周</a-radio-button>
          <a-radio-button value="month">本月</a-radio-button>
          <a-radio-button value="all">全部</a-radio-button>
        </a-radio-group>
        <a-button type="primary" ghost :loading="summaryLoading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </div>
    </div>

    <!-- Top row: 4 stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="总调用次数"
            :value="summary.totalCalls"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><BarChartOutlined /></template>
            <template #suffix>次</template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="总 Token 数"
            :value="summary.totalTokens"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="总费用"
            :value="summary.totalCost"
            :precision="4"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          >
            <template #prefix><DollarOutlined /></template>
            <template #suffix>USD</template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="平均响应时间"
            :value="summary.avgResponseTime"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          >
            <template #prefix><ThunderboltOutlined /></template>
            <template #suffix>ms</template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Section 2: Provider Breakdown -->
    <a-card
      title="Provider 分布"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <div v-if="breakdownLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
      <a-table
        v-else
        :columns="breakdownColumns"
        :data-source="breakdownData"
        :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
        size="small"
        style="background: var(--bg-card);"
        :row-class-name="() => 'analytics-row'"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'provider'">
            <a-tag color="blue">{{ record.provider }}</a-tag>
          </template>
          <template v-if="column.key === 'model'">
            <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">{{ record.model }}</span>
          </template>
          <template v-if="column.key === 'cost'">
            <span style="color: #faad14;">${{ (record.cost || 0).toFixed(4) }}</span>
          </template>
          <template v-if="column.key === 'avgResponseTime'">
            <span style="color: var(--text-secondary);">{{ record.avgResponseTime || 0 }} ms</span>
          </template>
        </template>
        <template #emptyText>
          <a-empty description="暂无调用记录" />
        </template>
      </a-table>
    </a-card>

    <!-- Section 3: Recent Calls -->
    <a-card
      title="最近调用记录"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <template #extra>
        <a-radio-group v-model:value="recentLimit" size="small" @change="loadRecent">
          <a-radio-button :value="10">10</a-radio-button>
          <a-radio-button :value="20">20</a-radio-button>
          <a-radio-button :value="50">50</a-radio-button>
        </a-radio-group>
      </template>

      <div v-if="recentLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
      <a-table
        v-else
        :columns="recentColumns"
        :data-source="recentData"
        :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
        size="small"
        style="background: var(--bg-card);"
        :row-class-name="() => 'analytics-row'"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'timestamp'">
            <span style="color: var(--text-secondary); font-size: 12px; font-family: monospace;">{{ record.timestamp }}</span>
          </template>
          <template v-if="column.key === 'provider'">
            <a-tag color="blue">{{ record.provider }}</a-tag>
          </template>
          <template v-if="column.key === 'model'">
            <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">{{ record.model }}</span>
          </template>
          <template v-if="column.key === 'cost'">
            <span style="color: #faad14;">${{ (record.cost || 0).toFixed(4) }}</span>
          </template>
          <template v-if="column.key === 'responseTime'">
            <span style="color: var(--text-secondary);">{{ record.responseTime || 0 }} ms</span>
          </template>
        </template>
        <template #emptyText>
          <a-empty description="暂无调用记录" />
        </template>
      </a-table>
    </a-card>

    <!-- Section 4: Cache Status -->
    <a-card
      title="缓存状态"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
      <template #extra>
        <a-space>
          <a-button
            size="small"
            :loading="cacheCleanupLoading"
            @click="cacheCleanup"
            style="background: var(--bg-card-hover); border-color: var(--border-color);"
          >
            <template #icon><DeleteOutlined /></template>
            清理过期
          </a-button>
          <a-button
            size="small"
            danger
            :loading="cacheClearLoading"
            @click="cacheClear"
            style="border-color: var(--border-color);"
          >
            <template #icon><DeleteOutlined /></template>
            清理缓存
          </a-button>
        </a-space>
      </template>

      <div v-if="cacheLoading" style="text-align: center; padding: 40px;"><a-spin /></div>
      <a-row v-else :gutter="[16, 16]">
        <a-col :xs="12" :sm="6">
          <a-statistic
            title="缓存条目"
            :value="cacheStats.entries"
            :value-style="{ color: '#1677ff', fontSize: '18px' }"
          >
            <template #prefix><DatabaseOutlined /></template>
          </a-statistic>
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic
            title="命中次数"
            :value="cacheStats.hits"
            :value-style="{ color: '#52c41a', fontSize: '18px' }"
          />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic
            title="节省 Token"
            :value="cacheStats.tokensSaved"
            :value-style="{ color: '#faad14', fontSize: '18px' }"
          />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic
            title="已过期"
            :value="cacheStats.expired"
            :value-style="{ color: '#ff4d4f', fontSize: '18px' }"
          />
        </a-col>
      </a-row>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import {
  BarChartOutlined,
  DollarOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

// --- State ---
const period = ref('all')
const summaryLoading = ref(false)
const breakdownLoading = ref(false)
const recentLoading = ref(false)
const cacheLoading = ref(false)
const cacheClearLoading = ref(false)
const cacheCleanupLoading = ref(false)
const recentLimit = ref(20)

const summary = reactive({
  totalCalls: 0,
  totalTokens: 0,
  totalCost: 0,
  avgResponseTime: 0,
})

const breakdownData = ref([])
const recentData = ref([])
const cacheStats = reactive({
  entries: 0,
  hits: 0,
  tokensSaved: 0,
  expired: 0,
})

// --- Table Columns ---
const breakdownColumns = [
  { title: 'Provider', key: 'provider', dataIndex: 'provider', width: '120px', sorter: (a, b) => (a.provider || '').localeCompare(b.provider || '') },
  { title: 'Model', key: 'model', dataIndex: 'model', ellipsis: true, sorter: (a, b) => (a.model || '').localeCompare(b.model || '') },
  { title: '调用次数', key: 'calls', dataIndex: 'calls', width: '100px', sorter: (a, b) => (a.calls || 0) - (b.calls || 0) },
  { title: 'Input Tokens', key: 'inputTokens', dataIndex: 'inputTokens', width: '120px', sorter: (a, b) => (a.inputTokens || 0) - (b.inputTokens || 0) },
  { title: 'Output Tokens', key: 'outputTokens', dataIndex: 'outputTokens', width: '130px', sorter: (a, b) => (a.outputTokens || 0) - (b.outputTokens || 0) },
  { title: 'Total Tokens', key: 'totalTokens', dataIndex: 'totalTokens', width: '120px', sorter: (a, b) => (a.totalTokens || 0) - (b.totalTokens || 0) },
  { title: '费用 (USD)', key: 'cost', dataIndex: 'cost', width: '110px', sorter: (a, b) => (a.cost || 0) - (b.cost || 0) },
  { title: '平均响应', key: 'avgResponseTime', dataIndex: 'avgResponseTime', width: '110px', sorter: (a, b) => (a.avgResponseTime || 0) - (b.avgResponseTime || 0) },
]

const recentColumns = [
  { title: '时间', key: 'timestamp', dataIndex: 'timestamp', width: '180px' },
  { title: 'Provider', key: 'provider', dataIndex: 'provider', width: '110px' },
  { title: 'Model', key: 'model', dataIndex: 'model', ellipsis: true },
  { title: 'Input', key: 'inputTokens', dataIndex: 'inputTokens', width: '90px' },
  { title: 'Output', key: 'outputTokens', dataIndex: 'outputTokens', width: '90px' },
  { title: '费用', key: 'cost', dataIndex: 'cost', width: '100px' },
  { title: '响应时间', key: 'responseTime', dataIndex: 'responseTime', width: '100px' },
]

// --- Helpers ---
function stripCommas(str) {
  return (str || '').replace(/,/g, '')
}

function tryParseJSON(output) {
  try {
    const trimmed = (output || '').trim()
    // Find first { or [ for JSON
    const jsonStart = trimmed.search(/[{[]/)
    if (jsonStart >= 0) {
      return JSON.parse(trimmed.slice(jsonStart))
    }
    return null
  } catch {
    return null
  }
}

function parseSummaryText(output) {
  const lines = (output || '').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()

    const callsMatch = trimmed.match(/total\s*calls?\s*[:：]\s*([\d,]+)/i)
    if (callsMatch) summary.totalCalls = parseInt(stripCommas(callsMatch[1]), 10) || 0

    const tokensMatch = trimmed.match(/total\s*tokens?\s*[:：]\s*([\d,]+)/i)
    if (tokensMatch) summary.totalTokens = parseInt(stripCommas(tokensMatch[1]), 10) || 0

    const costMatch = trimmed.match(/cost\s*[:：]\s*\$?([\d,.]+)/i)
    if (costMatch) summary.totalCost = parseFloat(stripCommas(costMatch[1])) || 0

    const avgMatch = trimmed.match(/(?:avg|average)\s*(?:response\s*)?time\s*[:：]\s*([\d,.]+)/i)
    if (avgMatch) summary.avgResponseTime = parseFloat(stripCommas(avgMatch[1])) || 0
  }
}

function parseSummaryJSON(data) {
  summary.totalCalls = data.totalCalls ?? data.total_calls ?? data.calls ?? 0
  summary.totalTokens = data.totalTokens ?? data.total_tokens ?? data.tokens ?? 0
  summary.totalCost = data.totalCost ?? data.total_cost ?? data.cost ?? 0
  summary.avgResponseTime = data.avgResponseTime ?? data.avg_response_time ?? data.avgTime ?? 0
}

function parseBreakdownJSON(data) {
  const arr = Array.isArray(data) ? data : (data.breakdown || data.providers || data.rows || [])
  return arr.map((item, idx) => ({
    key: idx,
    provider: item.provider || '-',
    model: item.model || '-',
    calls: item.calls || item.count || 0,
    inputTokens: item.inputTokens ?? item.input_tokens ?? 0,
    outputTokens: item.outputTokens ?? item.output_tokens ?? 0,
    totalTokens: item.totalTokens ?? item.total_tokens ?? (item.inputTokens ?? 0) + (item.outputTokens ?? 0),
    cost: item.cost ?? item.total_cost ?? 0,
    avgResponseTime: item.avgResponseTime ?? item.avg_response_time ?? 0,
  }))
}

function parseRecentJSON(data) {
  const arr = Array.isArray(data) ? data : (data.recent || data.records || data.rows || [])
  return arr.map((item, idx) => ({
    key: idx,
    timestamp: item.timestamp || item.time || item.created_at || '-',
    provider: item.provider || '-',
    model: item.model || '-',
    inputTokens: item.inputTokens ?? item.input_tokens ?? 0,
    outputTokens: item.outputTokens ?? item.output_tokens ?? 0,
    cost: item.cost ?? 0,
    responseTime: item.responseTime ?? item.response_time ?? 0,
  }))
}

function parseCacheJSON(data) {
  cacheStats.entries = data.entries ?? data.count ?? data.size ?? 0
  cacheStats.hits = data.hits ?? data.cacheHits ?? data.cache_hits ?? 0
  cacheStats.tokensSaved = data.tokensSaved ?? data.tokens_saved ?? 0
  cacheStats.expired = data.expired ?? data.expiredCount ?? data.expired_count ?? 0
}

function parseCacheText(output) {
  const lines = (output || '').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()

    const entriesMatch = trimmed.match(/entries?\s*[:：]\s*([\d,]+)/i)
    if (entriesMatch) cacheStats.entries = parseInt(stripCommas(entriesMatch[1]), 10) || 0

    const hitsMatch = trimmed.match(/hits?\s*[:：]\s*([\d,]+)/i)
    if (hitsMatch) cacheStats.hits = parseInt(stripCommas(hitsMatch[1]), 10) || 0

    const savedMatch = trimmed.match(/(?:tokens?\s*)?saved\s*[:：]\s*([\d,]+)/i)
    if (savedMatch) cacheStats.tokensSaved = parseInt(stripCommas(savedMatch[1]), 10) || 0

    const expiredMatch = trimmed.match(/expired?\s*[:：]\s*([\d,]+)/i)
    if (expiredMatch) cacheStats.expired = parseInt(stripCommas(expiredMatch[1]), 10) || 0
  }
}

// --- Data Loading ---
async function loadSummary() {
  summaryLoading.value = true
  try {
    const { output } = await ws.execute(`tokens show --period ${period.value} --json`, 15000)
    const json = tryParseJSON(output)
    if (json) {
      parseSummaryJSON(json)
    } else {
      parseSummaryText(output)
    }
  } catch (e) {
    console.error('loadSummary failed:', e)
  } finally {
    summaryLoading.value = false
  }
}

async function loadBreakdown() {
  breakdownLoading.value = true
  try {
    const { output } = await ws.execute('tokens breakdown --json', 15000)
    const json = tryParseJSON(output)
    if (json) {
      breakdownData.value = parseBreakdownJSON(json)
    } else {
      breakdownData.value = []
    }
  } catch (e) {
    console.error('loadBreakdown failed:', e)
    breakdownData.value = []
  } finally {
    breakdownLoading.value = false
  }
}

async function loadRecent() {
  recentLoading.value = true
  try {
    const { output } = await ws.execute(`tokens recent --limit ${recentLimit.value} --json`, 15000)
    const json = tryParseJSON(output)
    if (json) {
      recentData.value = parseRecentJSON(json)
    } else {
      recentData.value = []
    }
  } catch (e) {
    console.error('loadRecent failed:', e)
    recentData.value = []
  } finally {
    recentLoading.value = false
  }
}

async function loadCache() {
  cacheLoading.value = true
  try {
    const { output } = await ws.execute('tokens cache --json', 15000)
    const json = tryParseJSON(output)
    if (json) {
      parseCacheJSON(json)
    } else {
      parseCacheText(output)
    }
  } catch (e) {
    console.error('loadCache failed:', e)
  } finally {
    cacheLoading.value = false
  }
}

async function cacheClear() {
  cacheClearLoading.value = true
  try {
    const { output } = await ws.execute('tokens cache --clear --json', 15000)
    const json = tryParseJSON(output)
    if (json && json.error) {
      message.error('清理缓存失败: ' + json.error)
    } else {
      message.success('缓存已清理')
      await loadCache()
    }
  } catch (e) {
    message.error('清理缓存失败: ' + e.message)
  } finally {
    cacheClearLoading.value = false
  }
}

async function cacheCleanup() {
  cacheCleanupLoading.value = true
  try {
    const { output } = await ws.execute('tokens cache --cleanup --json', 15000)
    const json = tryParseJSON(output)
    if (json && json.error) {
      message.error('清理过期失败: ' + json.error)
    } else {
      message.success('过期缓存已清理')
      await loadCache()
    }
  } catch (e) {
    message.error('清理过期失败: ' + e.message)
  } finally {
    cacheCleanupLoading.value = false
  }
}

async function loadAll() {
  await Promise.all([
    loadSummary(),
    loadBreakdown(),
    loadRecent(),
    loadCache(),
  ])
}

// --- Watchers ---
watch(period, () => {
  loadSummary()
})

// --- Lifecycle ---
onMounted(loadAll)
</script>

<style scoped>
:deep(.analytics-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
:deep(.ant-radio-button-wrapper) {
  background: var(--bg-card) !important;
  border-color: var(--border-color) !important;
  color: var(--text-secondary) !important;
}
:deep(.ant-radio-button-wrapper-checked) {
  background: #1677ff !important;
  border-color: #1677ff !important;
  color: #fff !important;
}
</style>
