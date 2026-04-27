<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">联邦强化</h2>
        <p class="page-sub">熔断器 FSM · 健康检查 · 连接池模拟</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-dropdown>
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            新建 ▼
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item key="register" @click="showRegisterModal = true">注册节点</a-menu-item>
              <a-menu-item key="check" @click="showCheckModal = true">记录健康检查</a-menu-item>
              <a-menu-item key="pool" @click="showPoolModal = true">新建连接池</a-menu-item>
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
            title="熔断器节点"
            :value="stats.circuitBreakers.total"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><ClusterOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ stats.circuitBreakers.byState.closed || 0 }} 闭合 · {{ stats.circuitBreakers.byState.open || 0 }} 开</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="健康检查"
            :value="stats.healthChecks.total"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><HeartOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ stats.healthChecks.byStatus.healthy || 0 }} 健康 · {{ stats.healthChecks.byStatus.unhealthy || 0 }} 不可用</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="连接池"
            :value="stats.connectionPools.total"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><ApiOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ stats.connectionPools.totalActive }} 活跃 · {{ stats.connectionPools.totalIdle }} 空闲</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="降级节点"
            :value="degradedCount"
            :value-style="{ color: degradedCount > 0 ? '#faad14' : '#8c8c8c', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ stats.circuitBreakers.byState.half_open || 0 }} 半开</div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="可用率"
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
      <a-tab-pane key="breakers" tab="熔断器">
        <div class="filter-bar">
          <a-radio-group v-model:value="stateFilter" size="small" button-style="solid">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in CIRCUIT_STATES" :key="s" :value="s">{{ stateLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="breakerColumns"
          :data-source="filteredBreakers"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
                <a-button size="small" danger @click="recordTransition(record, 'failure')">失败</a-button>
                <a-button size="small" @click="recordTransition(record, 'success')">成功</a-button>
                <a-button size="small" type="dashed" @click="recordTransition(record, 'half-open')">半开</a-button>
                <a-button size="small" @click="recordTransition(record, 'reset')">重置</a-button>
                <a-popconfirm title="移除该节点？所有相关熔断器与健康检查会被删除" @confirm="removeNode(record)">
                  <a-button size="small" danger type="text">移除</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>

          <template #emptyText>
            <a-empty :image="EMPTY_IMG" description="暂无熔断器" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Health checks ─────────────────────────────── -->
      <a-tab-pane key="checks" tab="健康检查">
        <div class="filter-bar">
          <a-radio-group v-model:value="metricFilter" size="small" button-style="solid">
            <a-radio-button value="">全部指标</a-radio-button>
            <a-radio-button v-for="m in HEALTH_METRICS" :key="m" :value="m">{{ metricLabel(m) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="healthStatusFilter" size="small">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in HEALTH_STATUSES" :key="s" :value="s">{{ healthLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="checkColumns"
          :data-source="filteredChecks"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
            <a-empty :image="EMPTY_IMG" description="暂无健康检查记录" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Connection pools ──────────────────────────── -->
      <a-tab-pane key="pools" tab="连接池">
        <a-table
          :columns="poolColumns"
          :data-source="pools"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
                <a-button size="small" type="primary" @click="poolAction(record, 'acquire')">取连接</a-button>
                <a-button size="small" @click="poolAction(record, 'release')">还连接</a-button>
                <a-popconfirm title="销毁该连接池？" @confirm="poolAction(record, 'destroy')">
                  <a-button size="small" danger type="text">销毁</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>

          <template #emptyText>
            <a-empty :image="EMPTY_IMG" description="暂无连接池" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Node health aggregate ────────────────────── -->
      <a-tab-pane key="node-health" tab="节点健康聚合">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-space>
            <a-input
              v-model:value="nodeHealthInput"
              placeholder="节点 ID"
              style="width: 240px;"
              allow-clear
              @press-enter="queryNodeHealth"
            />
            <a-button type="primary" :loading="queryingHealth" @click="queryNodeHealth">
              <template #icon><SearchOutlined /></template>
              查询
            </a-button>
          </a-space>
        </a-card>

        <a-card v-if="nodeHealth" style="background: var(--bg-card); border-color: var(--border-color);">
          <a-descriptions :column="3" size="small" bordered>
            <a-descriptions-item label="节点">
              <span style="font-family: monospace;">{{ nodeHealth.nodeId }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="聚合状态">
              <a-tag :color="healthColor(nodeHealth.status)">{{ healthLabel(nodeHealth.status) }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="检查总数">
              {{ nodeHealth.checks }}
            </a-descriptions-item>
          </a-descriptions>

          <div style="margin-top: 16px;">
            <h4 style="color: var(--text-primary); margin-bottom: 8px;">最近各指标状态</h4>
            <a-empty
              v-if="!nodeHealth.latestChecks.length"
              :image="EMPTY_IMG"
              description="无最近检查"
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
    <a-modal v-model:open="showRegisterModal" title="注册联邦节点" :confirm-loading="creating" @ok="submitRegister">
      <a-form layout="vertical">
        <a-form-item label="节点 ID" required>
          <a-input v-model:value="registerForm.nodeId" placeholder="如 node-shanghai-01" />
        </a-form-item>
        <a-form-item label="失败阈值（默认 5）">
          <a-input-number v-model:value="registerForm.failureThreshold" :min="1" :max="100" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="成功阈值（默认 2）">
          <a-input-number v-model:value="registerForm.successThreshold" :min="1" :max="100" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="开路超时 (ms)（默认 60000）">
          <a-input-number v-model:value="registerForm.openTimeout" :min="1000" :step="1000" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Modal: record health check -->
    <a-modal v-model:open="showCheckModal" title="记录健康检查" :confirm-loading="creating" @ok="submitCheck">
      <a-form layout="vertical">
        <a-form-item label="节点 ID" required>
          <a-input v-model:value="checkForm.nodeId" placeholder="必须先注册节点" />
        </a-form-item>
        <a-form-item label="指标类型" required>
          <a-select v-model:value="checkForm.checkType">
            <a-select-option v-for="m in HEALTH_METRICS" :key="m" :value="m">{{ metricLabel(m) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="健康状态" required>
          <a-select v-model:value="checkForm.status">
            <a-select-option v-for="s in HEALTH_STATUSES" :key="s" :value="s">{{ healthLabel(s) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="指标 JSON（可选，如 {&quot;latencyMs&quot;:42}）">
          <a-textarea v-model:value="checkForm.metrics" :rows="3" placeholder='{"latencyMs": 42, "cpu": 0.4}' />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Modal: init pool -->
    <a-modal v-model:open="showPoolModal" title="新建连接池" :confirm-loading="creating" @ok="submitPool">
      <a-form layout="vertical">
        <a-form-item label="节点 ID" required>
          <a-input v-model:value="poolForm.nodeId" placeholder="如 node-shanghai-01" />
        </a-form-item>
        <a-form-item label="最小连接数（默认 5）">
          <a-input-number v-model:value="poolForm.min" :min="1" :max="500" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="最大连接数（默认 50）">
          <a-input-number v-model:value="poolForm.max" :min="1" :max="500" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="空闲超时 (ms)（默认 300000）">
          <a-input-number v-model:value="poolForm.idleTimeout" :min="1000" :step="1000" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
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

const breakerColumns = [
  { title: '节点', key: 'nodeId', dataIndex: 'nodeId', width: '200px' },
  { title: '状态', key: 'state', width: '100px' },
  { title: '失败计数', key: 'failure', width: '120px' },
  { title: '成功计数', key: 'success', width: '120px' },
  { title: '超时 (ms)', key: 'openTimeout', dataIndex: 'openTimeout', width: '110px' },
  { title: '更新时间', key: 'updatedAt', width: '170px' },
  { title: '操作', key: 'action', width: '340px' },
]

const checkColumns = [
  { title: 'ID', key: 'checkId', width: '130px' },
  { title: '节点', key: 'nodeId', dataIndex: 'nodeId', width: '180px' },
  { title: '指标', key: 'checkType', width: '120px' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '指标值', key: 'metrics' },
  { title: '采集时间', key: 'checkedAt', width: '170px' },
]

const poolColumns = [
  { title: '节点', key: 'nodeId', dataIndex: 'nodeId', width: '200px' },
  { title: '活跃', key: 'activeConnections', dataIndex: 'activeConnections', width: '90px' },
  { title: '空闲', key: 'idleConnections', dataIndex: 'idleConnections', width: '90px' },
  { title: '上限', key: 'maxConnections', dataIndex: 'maxConnections', width: '90px' },
  { title: '使用率', key: 'utilization', width: '160px' },
  { title: '排队中', key: 'waitingRequests', dataIndex: 'waitingRequests', width: '90px' },
  { title: '已创建', key: 'totalCreated', dataIndex: 'totalCreated', width: '90px' },
  { title: '创建时间', key: 'createdAt', width: '170px' },
  { title: '操作', key: 'action', width: '240px' },
]

const latestChecksColumns = [
  { title: '指标', key: 'checkType', width: '160px' },
  { title: '状态', key: 'status', width: '120px' },
  { title: '采集时间', key: 'checkedAt' },
]

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
  return { closed: '闭合', open: '开路', half_open: '半开' }[s] || s
}
function stateColor(s) {
  return { closed: 'green', open: 'red', half_open: 'gold' }[s] || 'default'
}

function metricLabel(m) {
  return {
    heartbeat: '心跳',
    latency: '延迟',
    success_rate: '成功率',
    cpu_usage: 'CPU',
    memory_usage: '内存',
  }[m] || m
}

function healthLabel(s) {
  return {
    healthy: '健康',
    degraded: '降级',
    unhealthy: '不可用',
    unknown: '未知',
  }[s] || s
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
    message.error('加载数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function submitRegister() {
  if (!registerForm.nodeId.trim()) {
    message.warning('请填写节点 ID')
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
      message.error('注册失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(`节点已注册：${r.id}`)
    showRegisterModal.value = false
    resetRegisterForm()
    await loadAll()
  } catch (e) {
    message.error('注册失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function submitCheck() {
  if (!checkForm.nodeId.trim()) {
    message.warning('请填写节点 ID')
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
      message.error('记录失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(`检查已记录：${r.id?.slice(0, 8)}`)
    showCheckModal.value = false
    resetCheckForm()
    await loadAll()
  } catch (e) {
    message.error('记录失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function submitPool() {
  if (!poolForm.nodeId.trim()) {
    message.warning('请填写节点 ID')
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
      message.error('创建失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(`连接池已创建：${r.id}`)
    showPoolModal.value = false
    resetPoolForm()
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
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
      message.warning((r.reason || '操作未生效')
        + (r.remainingMs ? ` (还需 ${r.remainingMs}ms)` : ''))
      return
    }
    if (r.previousState && r.state && r.previousState !== r.state) {
      message.success(`${stateLabel(r.previousState)} → ${stateLabel(r.state)}`)
    } else {
      message.success(kind === 'reset' ? '熔断器已重置' : '已记录')
    }
    await loadAll()
  } catch (e) {
    message.error('操作失败: ' + (e?.message || e))
  }
}

async function removeNode(record) {
  try {
    const { output } = await ws.execute(`federation remove ${shellQuote(record.nodeId)} --json`, 8000)
    const r = parseRemoveResult(output)
    if (!r.ok) {
      message.error('移除失败: ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success('节点已移除')
    await loadAll()
  } catch (e) {
    message.error('移除失败: ' + (e?.message || e))
  }
}

async function poolAction(record, kind) {
  try {
    const subcmd = { acquire: 'pool-acquire', release: 'pool-release', destroy: 'pool-destroy' }[kind]
    const { output } = await ws.execute(`federation ${subcmd} ${shellQuote(record.nodeId)} --json`, 8000)
    const r = parsePoolActionResult(output)
    if (!r.ok) {
      message.warning(r.reason || '操作未生效')
      return
    }
    if (kind === 'destroy') {
      message.success('连接池已销毁')
    } else {
      message.success(`${kind === 'acquire' ? '已获取' : '已释放'}（活跃 ${r.active} · 空闲 ${r.idle}）`)
    }
    await loadAll()
  } catch (e) {
    message.error('操作失败: ' + (e?.message || e))
  }
}

async function queryNodeHealth() {
  if (!nodeHealthInput.value.trim()) {
    message.warning('请填写节点 ID')
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
    message.error('查询失败: ' + (e?.message || e))
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
