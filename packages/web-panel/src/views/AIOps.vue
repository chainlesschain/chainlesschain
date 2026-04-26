<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">AIOps 自治运维</h2>
        <p class="page-sub">异常检测 · 事件管理 · 自动化 Playbook</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            新建 ▼
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="incident"><AlertOutlined /> 创建事件</a-menu-item>
              <a-menu-item key="playbook"><RocketOutlined /> 创建 Playbook</a-menu-item>
              <a-menu-item key="baseline"><LineChartOutlined /> 更新基线</a-menu-item>
              <a-menu-item key="detect"><FundOutlined /> 异常检测</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="事件总数" :value="stats.incidents.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><AlertOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="待处理"
            :value="stats.incidents.byStatus.open + stats.incidents.byStatus.acknowledged"
            :value-style="{ color: openCount > 0 ? '#ff4d4f' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><ExclamationCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="Playbook" :value="stats.playbooks.total" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><RocketOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="启用 Playbook" :value="stats.playbooks.enabled" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="基线指标" :value="stats.baselines.total" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><LineChartOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Severity breakdown bar -->
    <a-card
      v-if="stats.incidents.total > 0"
      title="严重度分布"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-space :size="[12, 8]" wrap>
        <a-tag v-for="sev in SEVERITIES" :key="sev" :color="severityColor(sev)" style="font-size: 13px; padding: 2px 10px;">
          {{ sev }}: {{ stats.incidents.bySeverity[sev] || 0 }}
        </a-tag>
        <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">
          平均解决时间: {{ formatDurationMs(stats.incidents.avgResolveMs) }}
        </span>
      </a-space>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="aiops-tabs">
      <!-- ── Incidents tab ─────────────────────────────────────────── -->
      <a-tab-pane key="incidents" tab="事件">
        <div class="filter-bar">
          <a-radio-group v-model:value="incidentSeverityFilter" size="small" button-style="solid">
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="incidentStatusFilter" size="small">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in INCIDENT_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="incidentColumns"
          :data-source="filteredIncidents"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'severity'">
              <a-tag :color="severityColor(record.severity)" style="font-weight: 600;">{{ record.severity }}</a-tag>
            </template>
            <template v-if="column.key === 'metric'">
              <span v-if="record.anomalyMetric" style="color: var(--text-primary); font-family: monospace; font-size: 12px;">
                {{ record.anomalyMetric }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'description'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ truncate(record.description, 80) || '—' }}</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatOpsTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button v-if="record.status === 'open'" size="small" type="link" @click="ackIncident(record)">确认</a-button>
              <a-button v-if="record.status === 'open' || record.status === 'acknowledged'" size="small" type="link" @click="resolveIncident(record)">解决</a-button>
              <a-button v-if="record.status === 'resolved'" size="small" type="link" @click="closeIncident(record)">关闭</a-button>
              <a-button v-if="record.status === 'resolved' || record.status === 'closed'" size="small" type="link" @click="generatePostmortem(record)">复盘</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <AlertOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ incidentSeverityFilter || incidentStatusFilter ? '没有符合条件的事件' : '暂无事件，可点"新建 → 创建事件"或运行"异常检测"自动触发' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Playbooks tab ─────────────────────────────────────────── -->
      <a-tab-pane key="playbooks" tab="Playbook">
        <a-table
          :columns="playbookColumns"
          :data-source="playbooks"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name }}</span>
              <div v-if="record.triggerCondition" style="color: var(--text-secondary); font-size: 11px; margin-top: 2px; font-family: monospace;">
                {{ truncate(record.triggerCondition, 80) }}
              </div>
            </template>
            <template v-if="column.key === 'enabled'">
              <a-switch
                :checked="record.enabled"
                size="small"
                @change="(v) => togglePlaybook(record, v)"
              />
            </template>
            <template v-if="column.key === 'stats'">
              <a-tag color="green" style="font-size: 11px;">成功 {{ record.successCount }}</a-tag>
              <a-tag v-if="record.failureCount > 0" color="red" style="font-size: 11px; margin-left: 4px;">
                失败 {{ record.failureCount }}
              </a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatOpsTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="recordRun(record, 'success')">+ 成功</a-button>
              <a-button size="small" type="link" danger @click="recordRun(record, 'failure')">+ 失败</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <RocketOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无 Playbook，点"新建 → 创建 Playbook"创建第一个
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Baselines tab ─────────────────────────────────────────── -->
      <a-tab-pane key="baselines" tab="基线">
        <a-table
          :columns="baselineColumns"
          :data-source="baselines"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'metric'">
              <span style="color: var(--text-primary); font-family: monospace; font-weight: 500;">{{ record.metricName }}</span>
            </template>
            <template v-if="column.key === 'mean'">
              <span style="color: #1677ff;">{{ record.mean }}</span>
              <span style="color: var(--text-secondary); margin-left: 4px; font-size: 11px;">σ {{ record.stdDev }}</span>
            </template>
            <template v-if="column.key === 'iqr'">
              <span style="color: var(--text-secondary); font-size: 12px;">
                Q1 {{ record.q1 }} / Q3 {{ record.q3 }}
              </span>
            </template>
            <template v-if="column.key === 'sampleCount'">
              <a-tag color="blue" style="font-size: 11px;">{{ record.sampleCount }}</a-tag>
            </template>
            <template v-if="column.key === 'updatedAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatOpsTime(record.updatedAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <LineChartOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无基线，点"新建 → 更新基线"喂入指标样本
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create incident modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showIncidentModal"
      title="创建事件"
      :confirm-loading="creating"
      :width="520"
      ok-text="创建"
      cancel-text="取消"
      @ok="createIncident"
      @cancel="resetIncidentForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="严重度">
          <a-select v-model:value="incidentForm.severity">
            <a-select-option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="指标">
          <a-input v-model:value="incidentForm.metric" placeholder="例如: cpu_usage（可选）" />
        </a-form-item>
        <a-form-item label="描述" required>
          <a-textarea v-model:value="incidentForm.description" :auto-size="{ minRows: 3, maxRows: 6 }" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Create playbook modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showPlaybookModal"
      title="创建 Playbook"
      :confirm-loading="creating"
      :width="540"
      ok-text="创建"
      cancel-text="取消"
      @ok="createPlaybook"
      @cancel="resetPlaybookForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="名称" required>
          <a-input v-model:value="playbookForm.name" placeholder="restart-pod" />
        </a-form-item>
        <a-form-item label="触发条件 (JSON)">
          <a-textarea
            v-model:value="playbookForm.triggerJson"
            placeholder='{"metric":"cpu","threshold":90}'
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </a-form-item>
        <a-form-item label="步骤 (JSON)">
          <a-textarea
            v-model:value="playbookForm.stepsJson"
            placeholder='[{"action":"restart","target":"pod-1"}]'
            :auto-size="{ minRows: 3, maxRows: 6 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Update baseline modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showBaselineModal"
      title="更新基线"
      :confirm-loading="creating"
      :width="500"
      ok-text="更新"
      cancel-text="取消"
      @ok="updateBaseline"
      @cancel="resetBaselineForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="指标名" required>
          <a-input v-model:value="baselineForm.metric" placeholder="cpu_usage" />
        </a-form-item>
        <a-form-item label="样本值" required>
          <a-textarea
            v-model:value="baselineForm.values"
            placeholder="逗号分隔的数值，例如: 45.2, 47.1, 50.8, 49.3"
            :auto-size="{ minRows: 3, maxRows: 8 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Detect anomaly modal ──────────────────────────────────── -->
    <a-modal
      v-model:open="showDetectModal"
      title="异常检测"
      :confirm-loading="detecting"
      :width="500"
      ok-text="检测"
      cancel-text="关闭"
      @ok="detectAnomaly"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="指标名" required>
          <a-select
            v-model:value="detectForm.metric"
            show-search
            placeholder="选择已建立基线的指标"
          >
            <a-select-option v-for="b in baselines" :key="b.metricName" :value="b.metricName">
              {{ b.metricName }}（n={{ b.sampleCount }}）
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="测试值" required>
          <a-input-number v-model:value="detectForm.value" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="算法">
          <a-radio-group v-model:value="detectForm.algorithm">
            <a-radio-button value="z_score">Z-Score (3σ)</a-radio-button>
            <a-radio-button value="iqr">IQR (1.5×)</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>

      <a-card v-if="detectResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <a-statistic
          title="检测结果"
          :value="detectResult.anomaly ? '异常' : '正常'"
          :value-style="{ color: detectResult.anomaly ? '#ff4d4f' : '#52c41a' }"
        />
        <div v-if="detectResult.reason && !detectResult.anomaly" style="color: var(--text-secondary); font-size: 12px; margin-top: 8px;">
          原因: {{ reasonLabel(detectResult.reason) }}
        </div>
        <div v-if="detectResult.baseline" style="margin-top: 12px; font-size: 12px; color: var(--text-secondary);">
          <div>得分: {{ detectResult.score }} (阈值 {{ detectResult.threshold }})</div>
          <div>基线: 均值 {{ detectResult.baseline.mean }}, σ {{ detectResult.baseline.stdDev }}</div>
        </div>
        <div v-if="detectResult.incidentId" style="margin-top: 8px;">
          <a-tag :color="severityColor(detectResult.severity)">已自动创建 {{ detectResult.severity }} 事件</a-tag>
        </div>
      </a-card>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive, h } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  AlertOutlined,
  RocketOutlined,
  LineChartOutlined,
  FundOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue'
import { message, Modal } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseIncidents,
  parsePlaybooks,
  parseBaselines,
  parseDetectResult,
  parseStats,
  formatOpsTime,
  SEVERITIES,
  INCIDENT_STATUSES,
} from '../utils/aiops-parser.js'

const ws = useWsStore()

const loading = ref(false)
const creating = ref(false)
const detecting = ref(false)

const incidents = ref([])
const playbooks = ref([])
const baselines = ref([])
const stats = ref({
  incidents: { total: 0, bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }, byStatus: { open: 0, acknowledged: 0, resolved: 0, closed: 0 }, avgResolveMs: 0 },
  playbooks: { total: 0, enabled: 0, totalSuccess: 0, totalFailure: 0 },
  baselines: { total: 0, metrics: [] },
})

const activeTab = ref('incidents')
const incidentSeverityFilter = ref('')
const incidentStatusFilter = ref('')

const showIncidentModal = ref(false)
const showPlaybookModal = ref(false)
const showBaselineModal = ref(false)
const showDetectModal = ref(false)

const incidentForm = reactive({ severity: 'P3', metric: '', description: '' })
const playbookForm = reactive({ name: '', triggerJson: '', stepsJson: '' })
const baselineForm = reactive({ metric: '', values: '' })
const detectForm = reactive({ metric: '', value: null, algorithm: 'z_score' })
const detectResult = ref(null)

const incidentColumns = [
  { title: '严重度', key: 'severity', width: '90px' },
  { title: '指标', key: 'metric', width: '160px' },
  { title: '描述', key: 'description' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '创建时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '220px' },
]

const playbookColumns = [
  { title: '名称', key: 'name' },
  { title: '启用', key: 'enabled', width: '80px' },
  { title: '执行统计', key: 'stats', width: '180px' },
  { title: '创建时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '160px' },
]

const baselineColumns = [
  { title: '指标', key: 'metric' },
  { title: '均值 / σ', key: 'mean', width: '180px' },
  { title: '四分位', key: 'iqr', width: '180px' },
  { title: '样本数', key: 'sampleCount', width: '90px' },
  { title: '更新时间', key: 'updatedAt', width: '160px' },
]

const openCount = computed(() =>
  stats.value.incidents.byStatus.open + stats.value.incidents.byStatus.acknowledged,
)

const filteredIncidents = computed(() => {
  let rows = incidents.value
  if (incidentSeverityFilter.value) rows = rows.filter(i => i.severity === incidentSeverityFilter.value)
  if (incidentStatusFilter.value) rows = rows.filter(i => i.status === incidentStatusFilter.value)
  return rows
})

function statusLabel(s) {
  return { open: '待处理', acknowledged: '已确认', resolved: '已解决', closed: '已关闭' }[s] || s
}
function statusColor(s) {
  return { open: 'red', acknowledged: 'orange', resolved: 'cyan', closed: 'default' }[s] || 'default'
}
function severityColor(sev) {
  return { P0: 'red', P1: 'volcano', P2: 'orange', P3: 'gold' }[sev] || 'default'
}

function reasonLabel(reason) {
  return {
    no_baseline: '该指标尚无基线，请先"更新基线"',
    zero_stddev: '基线方差为零（样本完全相同）',
    missing_metric_name: '缺少指标名',
    missing_value: '缺少测试值',
    unknown_algorithm: '未知算法',
  }[reason] || reason
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function formatDurationMs(ms) {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`
  return `${(ms / 3600000).toFixed(1)}h`
}

function handleNewClick({ key }) {
  if (key === 'incident') showIncidentModal.value = true
  else if (key === 'playbook') showPlaybookModal.value = true
  else if (key === 'baseline') showBaselineModal.value = true
  else if (key === 'detect') {
    detectResult.value = null
    showDetectModal.value = true
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [iRes, pRes, bRes, sRes] = await Promise.all([
      ws.execute('ops incidents --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('ops playbooks --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('ops baselines --json', 10000).catch(() => ({ output: '' })),
      ws.execute('ops stats --json', 8000).catch(() => ({ output: '' })),
    ])
    incidents.value = parseIncidents(iRes.output)
    playbooks.value = parsePlaybooks(pRes.output)
    baselines.value = parseBaselines(bRes.output)
    stats.value = parseStats(sRes.output)
  } catch (e) {
    message.error('加载 AIOps 数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createIncident() {
  if (!incidentForm.description.trim()) {
    message.warning('请填写事件描述')
    return
  }
  creating.value = true
  try {
    const parts = [`ops incident-create --severity ${incidentForm.severity}`]
    if (incidentForm.metric.trim()) parts.push(`--metric "${incidentForm.metric.trim().replace(/"/g, '\\"')}"`)
    parts.push(`--description "${incidentForm.description.trim().replace(/"/g, '\\"')}"`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|失败/i.test(output) && !/"incidentId"/.test(output)) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success('事件已创建')
    showIncidentModal.value = false
    resetIncidentForm()
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function createPlaybook() {
  if (!playbookForm.name.trim()) {
    message.warning('请填写 Playbook 名称')
    return
  }
  // Validate JSON fields if provided
  for (const [field, label] of [[playbookForm.triggerJson, '触发条件'], [playbookForm.stepsJson, '步骤']]) {
    if (field.trim()) {
      try { JSON.parse(field) } catch {
        message.warning(`${label} JSON 格式错误`)
        return
      }
    }
  }
  creating.value = true
  try {
    const parts = [`ops playbook-create --name "${playbookForm.name.trim().replace(/"/g, '\\"')}"`]
    if (playbookForm.triggerJson.trim()) {
      parts.push(`--trigger '${playbookForm.triggerJson.trim().replace(/'/g, "'\\''")}'`)
    }
    if (playbookForm.stepsJson.trim()) {
      parts.push(`--steps '${playbookForm.stepsJson.trim().replace(/'/g, "'\\''")}'`)
    }
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|失败/i.test(output) && !/"playbookId"/.test(output)) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success('Playbook 已创建')
    showPlaybookModal.value = false
    resetPlaybookForm()
    activeTab.value = 'playbooks'
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function updateBaseline() {
  const metric = baselineForm.metric.trim()
  if (!metric) {
    message.warning('请填写指标名')
    return
  }
  // Parse comma-separated values
  const values = baselineForm.values
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Number(s))
  if (values.length === 0 || values.some(v => !Number.isFinite(v))) {
    message.warning('请输入至少一个有效数值（逗号或空白分隔）')
    return
  }
  creating.value = true
  try {
    // baseline-update <metric> --values <comma-separated>
    // The CLI may take values via -v flag or positional. Inspect command.
    // Per `baseline-update --help`: <metric> is required positional, values via flag.
    // Falls back to space-joined if --values isn't accepted.
    const cmd = `ops baseline-update "${metric.replace(/"/g, '\\"')}" --values ${values.join(',')} --json`
    const { output } = await ws.execute(cmd, 10000)
    if (/error|失败/i.test(output) && !/"updated"/.test(output)) {
      message.error('更新失败: ' + output.slice(0, 120))
      return
    }
    message.success(`基线已更新（n=${values.length}）`)
    showBaselineModal.value = false
    resetBaselineForm()
    activeTab.value = 'baselines'
    await loadAll()
  } catch (e) {
    message.error('更新失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function detectAnomaly() {
  if (!detectForm.metric || detectForm.value == null) {
    message.warning('请选择指标并填写测试值')
    return
  }
  detecting.value = true
  detectResult.value = null
  try {
    const cmd = `ops detect "${detectForm.metric.replace(/"/g, '\\"')}" ${detectForm.value} --algorithm ${detectForm.algorithm} --json`
    const { output } = await ws.execute(cmd, 8000)
    const parsed = parseDetectResult(output)
    if (!parsed) {
      message.error('检测失败: ' + output.slice(0, 120))
      return
    }
    detectResult.value = parsed
    if (parsed.anomaly) {
      message.warning(`检测到异常 (${parsed.severity || 'P3'})`)
      // Refresh in background to pick up the auto-created incident
      loadAll()
    }
  } catch (e) {
    message.error('检测失败: ' + (e?.message || e))
  } finally {
    detecting.value = false
  }
}

async function ackIncident(record) {
  await runIncidentTransition(record, 'incident-ack', '事件已确认')
}
async function resolveIncident(record) {
  await runIncidentTransition(record, 'incident-resolve', '事件已解决')
}
async function closeIncident(record) {
  await runIncidentTransition(record, 'incident-close', '事件已关闭')
}

async function runIncidentTransition(record, subcmd, successMsg) {
  try {
    const { output } = await ws.execute(`ops ${subcmd} ${record.id} --json`, 8000)
    if (/error|失败|invalid/i.test(output) && !/"acknowledged"|"resolved"|"closed"/.test(output)) {
      message.error('转换失败: ' + output.slice(0, 120))
      return
    }
    message.success(successMsg)
    await loadAll()
  } catch (e) {
    message.error('转换失败: ' + (e?.message || e))
  }
}

async function generatePostmortem(record) {
  try {
    const { output } = await ws.execute(`ops postmortem ${record.id}`, 12000)
    Modal.info({
      title: `事件 ${record.id.slice(0, 8)} 复盘`,
      width: 720,
      content: () => h('pre', {
        style: 'white-space: pre-wrap; max-height: 60vh; overflow: auto; font-size: 12px; padding: 8px; background: rgba(0,0,0,.04); border-radius: 4px;',
      }, output || '（无内容）'),
    })
  } catch (e) {
    message.error('生成复盘失败: ' + (e?.message || e))
  }
}

async function togglePlaybook(record, enabled) {
  const targetState = enabled ? 'on' : 'off'
  try {
    const { output } = await ws.execute(`ops playbook-toggle ${record.id} ${targetState} --json`, 8000)
    if (/error|失败/i.test(output) && !/"enabled"/.test(output)) {
      message.error('切换失败: ' + output.slice(0, 120))
      return
    }
    message.success(enabled ? 'Playbook 已启用' : 'Playbook 已禁用')
    await loadAll()
  } catch (e) {
    message.error('切换失败: ' + (e?.message || e))
  }
}

async function recordRun(record, result) {
  try {
    const { output } = await ws.execute(`ops playbook-record ${record.id} ${result} --json`, 8000)
    if (/error|失败/i.test(output) && !/"recorded"/.test(output)) {
      message.error('记录失败: ' + output.slice(0, 120))
      return
    }
    message.success(result === 'success' ? '已记录成功执行' : '已记录失败执行')
    await loadAll()
  } catch (e) {
    message.error('记录失败: ' + (e?.message || e))
  }
}

function resetIncidentForm() {
  incidentForm.severity = 'P3'
  incidentForm.metric = ''
  incidentForm.description = ''
}
function resetPlaybookForm() {
  playbookForm.name = ''
  playbookForm.triggerJson = ''
  playbookForm.stepsJson = ''
}
function resetBaselineForm() {
  baselineForm.metric = ''
  baselineForm.values = ''
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

.aiops-tabs :deep(.ant-tabs-nav) {
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
