<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">推理网络</h2>
        <p class="page-sub">去中心化推理节点 · 任务调度 · 隐私模式</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            操作 ▼
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="register"><CloudServerOutlined /> 注册节点</a-menu-item>
              <a-menu-item key="submit"><ThunderboltOutlined /> 提交推理任务</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="节点总数" :value="stats.nodes.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><CloudServerOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="在线节点"
            :value="stats.nodes.online"
            :value-style="{ color: stats.nodes.online > 0 ? '#52c41a' : '#888', fontSize: '20px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="任务总数" :value="stats.tasks.total" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="排队中"
            :value="stats.tasks.queued"
            :value-style="{ color: stats.tasks.queued > 0 ? '#faad14' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><ClockCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="平均耗时"
            :value="stats.tasks.avgDurationMs"
            suffix="ms"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Node status breakdown -->
    <a-card
      v-if="stats.nodes.total > 0"
      title="节点状态分布"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-space :size="[12, 8]" wrap>
        <a-tag color="green">在线 {{ stats.nodes.online }}</a-tag>
        <a-tag color="orange">忙碌 {{ stats.nodes.busy }}</a-tag>
        <a-tag color="default">离线 {{ stats.nodes.offline }}</a-tag>
        <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">
          完成: {{ stats.tasks.completed }} · 失败: {{ stats.tasks.failed }}
        </span>
      </a-space>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="inference-tabs">
      <!-- ── Nodes tab ─────────────────────────────────────────────── -->
      <a-tab-pane key="nodes" tab="节点">
        <div class="filter-bar">
          <a-radio-group v-model:value="nodeStatusFilter" size="small" button-style="solid">
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button v-for="s in NODE_STATUSES" :key="s" :value="s">{{ nodeStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="nodeColumns"
          :data-source="filteredNodes"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'nodeId'">
              <span style="color: var(--text-primary); font-family: monospace; font-weight: 500;">{{ record.nodeId }}</span>
              <div v-if="record.endpoint" style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">
                {{ truncate(record.endpoint, 50) }}
              </div>
            </template>
            <template v-if="column.key === 'capabilities'">
              <a-tag v-for="c in record.capabilities.slice(0, 4)" :key="c" color="blue" style="font-size: 10px; margin: 1px;">{{ c }}</a-tag>
              <a-tag v-if="record.capabilities.length > 4" color="default" style="font-size: 10px;">+{{ record.capabilities.length - 4 }}</a-tag>
              <span v-if="!record.capabilities.length" style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'gpu'">
              <span v-if="record.gpuMemoryMb > 0" style="color: var(--text-secondary); font-family: monospace;">
                {{ formatGpuMemory(record.gpuMemoryMb) }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="nodeStatusColor(record.status)">{{ nodeStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'taskCount'">
              <a-tag color="purple" style="font-size: 11px;">{{ record.taskCount }}</a-tag>
            </template>
            <template v-if="column.key === 'lastHeartbeat'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatInferenceTime(record.lastHeartbeat) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" :loading="heartbeatId === record.id" @click="sendHeartbeat(record)">心跳</a-button>
              <a-dropdown :trigger="['click']">
                <a-button size="small" type="link">状态 ▼</a-button>
                <template #overlay>
                  <a-menu @click="(e) => transitionStatus(record, e.key)">
                    <a-menu-item v-for="s in NODE_STATUSES" :key="s" :disabled="s === record.status">
                      {{ nodeStatusLabel(s) }}
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-popconfirm title="注销该节点？" ok-text="注销" cancel-text="取消" @confirm="unregisterNode(record)">
                <a-button size="small" type="link" danger>注销</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <CloudServerOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ nodeStatusFilter ? '没有符合条件的节点' : '暂无节点，点"操作 → 注册节点"添加第一个' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Tasks tab ─────────────────────────────────────────────── -->
      <a-tab-pane key="tasks" tab="任务">
        <div class="filter-bar">
          <a-radio-group v-model:value="taskStatusFilter" size="small">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in TASK_STATUSES" :key="s" :value="s">{{ taskStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="taskPrivacyFilter" size="small">
            <a-radio-button value="">全部模式</a-radio-button>
            <a-radio-button v-for="m in PRIVACY_MODES" :key="m" :value="m">{{ privacyLabel(m) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="taskColumns"
          :data-source="filteredTasks"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'model'">
              <span style="color: var(--text-primary); font-family: monospace; font-weight: 500;">{{ record.model }}</span>
              <div v-if="record.input" style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">
                {{ truncate(record.input, 60) }}
              </div>
            </template>
            <template v-if="column.key === 'privacyMode'">
              <a-tag :color="privacyColor(record.privacyMode)">{{ privacyLabel(record.privacyMode) }}</a-tag>
            </template>
            <template v-if="column.key === 'priority'">
              <span :style="{ color: priorityColor(record.priority), fontWeight: 500 }">{{ record.priority }}</span>
            </template>
            <template v-if="column.key === 'assignedNode'">
              <span v-if="record.assignedNode" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ nodeShortName(record.assignedNode) }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="taskStatusColor(record.status)">{{ taskStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'duration'">
              <span v-if="record.durationMs != null" style="font-family: monospace; color: var(--text-secondary); font-size: 12px;">
                {{ record.durationMs }} ms
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatInferenceTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button
                v-if="canComplete(record)"
                size="small"
                type="link"
                :loading="completingId === record.id"
                @click="completeTask(record)"
              >
                完成
              </a-button>
              <a-popconfirm
                v-if="canFail(record)"
                title="标记任务失败？"
                ok-text="确认"
                cancel-text="取消"
                @confirm="failTask(record)"
              >
                <a-button size="small" type="link" danger>失败</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ThunderboltOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ taskStatusFilter || taskPrivacyFilter ? '没有符合条件的任务' : '暂无任务，点"操作 → 提交推理任务"创建第一个' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Register node modal ──────────────────────────────────── -->
    <a-modal
      v-model:open="showRegisterModal"
      title="注册推理节点"
      :confirm-loading="registering"
      :width="520"
      ok-text="注册"
      cancel-text="取消"
      @ok="registerNode"
      @cancel="resetRegisterForm"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="节点 ID" required>
          <a-input v-model:value="registerForm.nodeId" placeholder="例如: gpu-host-1" />
        </a-form-item>
        <a-form-item label="端点 URL">
          <a-input v-model:value="registerForm.endpoint" placeholder="https://node.example.com（可选）" />
        </a-form-item>
        <a-form-item label="能力列表">
          <a-input v-model:value="registerForm.capabilities" placeholder="逗号分隔，例如: llama2,mistral,gpt-4" />
        </a-form-item>
        <a-form-item label="GPU 内存 (MB)">
          <a-input-number v-model:value="registerForm.gpuMemory" :min="0" :max="200000" style="width: 100%;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Submit task modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showSubmitModal"
      title="提交推理任务"
      :confirm-loading="submitting"
      :width="520"
      ok-text="提交"
      cancel-text="取消"
      @ok="submitTask"
      @cancel="resetSubmitForm"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="模型" required>
          <a-input v-model:value="submitForm.model" placeholder="例如: llama2-7b" />
        </a-form-item>
        <a-form-item label="输入">
          <a-textarea v-model:value="submitForm.input" :auto-size="{ minRows: 3, maxRows: 6 }" />
        </a-form-item>
        <a-form-item label="优先级">
          <a-input-number v-model:value="submitForm.priority" :min="1" :max="10" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="隐私模式">
          <a-radio-group v-model:value="submitForm.mode">
            <a-radio-button v-for="m in PRIVACY_MODES" :key="m" :value="m">{{ privacyLabel(m) }}</a-radio-button>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  CloudServerOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseNodes,
  parseTasks,
  parseStats,
  formatInferenceTime,
  NODE_STATUSES,
  TASK_STATUSES,
  PRIVACY_MODES,
} from '../utils/inference-parser.js'

const ws = useWsStore()

const loading = ref(false)
const registering = ref(false)
const submitting = ref(false)
const heartbeatId = ref('')
const completingId = ref('')

const nodes = ref([])
const tasks = ref([])
const stats = ref({
  nodes: { total: 0, online: 0, offline: 0, busy: 0 },
  tasks: { total: 0, queued: 0, completed: 0, failed: 0, avgDurationMs: 0 },
})

const activeTab = ref('nodes')
const nodeStatusFilter = ref('')
const taskStatusFilter = ref('')
const taskPrivacyFilter = ref('')

const showRegisterModal = ref(false)
const showSubmitModal = ref(false)

const registerForm = reactive({ nodeId: '', endpoint: '', capabilities: '', gpuMemory: null })
const submitForm = reactive({ model: '', input: '', priority: 5, mode: 'standard' })

const nodeColumns = [
  { title: '节点 ID', key: 'nodeId' },
  { title: '能力', key: 'capabilities', width: '220px' },
  { title: 'GPU', key: 'gpu', width: '100px' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '任务数', key: 'taskCount', width: '90px' },
  { title: '最近心跳', key: 'lastHeartbeat', width: '160px' },
  { title: '操作', key: 'action', width: '210px' },
]

const taskColumns = [
  { title: '模型', key: 'model' },
  { title: '隐私', key: 'privacyMode', width: '110px' },
  { title: '优先级', key: 'priority', width: '80px' },
  { title: '执行节点', key: 'assignedNode', width: '140px' },
  { title: '状态', key: 'status', width: '110px' },
  { title: '耗时', key: 'duration', width: '110px' },
  { title: '提交时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '140px' },
]

const filteredNodes = computed(() => {
  if (!nodeStatusFilter.value) return nodes.value
  return nodes.value.filter(n => n.status === nodeStatusFilter.value)
})

const filteredTasks = computed(() => {
  let rows = tasks.value
  if (taskStatusFilter.value) rows = rows.filter(t => t.status === taskStatusFilter.value)
  if (taskPrivacyFilter.value) rows = rows.filter(t => t.privacyMode === taskPrivacyFilter.value)
  return rows
})

function nodeStatusLabel(s) {
  return { online: '在线', offline: '离线', busy: '忙碌', degraded: '降级' }[s] || s
}
function nodeStatusColor(s) {
  return { online: 'green', offline: 'default', busy: 'orange', degraded: 'red' }[s] || 'default'
}
function taskStatusLabel(s) {
  return { queued: '排队中', dispatched: '已派发', running: '运行中', complete: '已完成', failed: '失败' }[s] || s
}
function taskStatusColor(s) {
  return { queued: 'default', dispatched: 'processing', running: 'cyan', complete: 'green', failed: 'red' }[s] || 'default'
}
function privacyLabel(m) {
  return { standard: '标准', encrypted: '加密', federated: '联邦' }[m] || m
}
function privacyColor(m) {
  return { standard: 'default', encrypted: 'purple', federated: 'cyan' }[m] || 'default'
}
function priorityColor(p) {
  if (p >= 8) return '#ff4d4f'
  if (p >= 5) return '#faad14'
  return '#52c41a'
}

function nodeShortName(nodeId) {
  const n = nodes.value.find(x => x.id === nodeId)
  return n ? n.nodeId : nodeId.slice(0, 8)
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function formatGpuMemory(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function canComplete(record) {
  return record.status === 'queued' || record.status === 'dispatched' || record.status === 'running'
}
function canFail(record) {
  return record.status !== 'complete' && record.status !== 'failed'
}

function handleNewClick({ key }) {
  if (key === 'register') showRegisterModal.value = true
  else if (key === 'submit') showSubmitModal.value = true
}

async function loadAll() {
  loading.value = true
  try {
    const [nodesRes, tasksRes, statsRes] = await Promise.all([
      ws.execute('inference nodes --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('inference tasks --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('inference stats --json', 8000).catch(() => ({ output: '' })),
    ])
    nodes.value = parseNodes(nodesRes.output)
    tasks.value = parseTasks(tasksRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error('加载推理网络数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function registerNode() {
  const nodeId = registerForm.nodeId.trim()
  if (!nodeId) {
    message.warning('请填写节点 ID')
    return
  }
  registering.value = true
  try {
    const parts = [`inference register "${nodeId.replace(/"/g, '\\"')}"`]
    if (registerForm.endpoint.trim()) parts.push(`--endpoint "${registerForm.endpoint.trim().replace(/"/g, '\\"')}"`)
    if (registerForm.capabilities.trim()) {
      const caps = registerForm.capabilities.split(/[,\s]+/).filter(Boolean).join(',')
      if (caps) parts.push(`--capabilities "${caps}"`)
    }
    if (registerForm.gpuMemory != null) parts.push(`--gpu ${registerForm.gpuMemory}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    if (/error|failed|失败/i.test(output) && !/"nodeId"/.test(output)) {
      message.error('注册失败: ' + output.slice(0, 120))
      return
    }
    message.success('节点已注册')
    showRegisterModal.value = false
    resetRegisterForm()
    await loadAll()
  } catch (e) {
    message.error('注册失败: ' + (e?.message || e))
  } finally {
    registering.value = false
  }
}

async function submitTask() {
  const model = submitForm.model.trim()
  if (!model) {
    message.warning('请填写模型名')
    return
  }
  submitting.value = true
  try {
    const parts = [`inference submit "${model.replace(/"/g, '\\"')}"`]
    if (submitForm.input.trim()) parts.push(`--input "${submitForm.input.trim().replace(/"/g, '\\"')}"`)
    if (submitForm.priority != null) parts.push(`--priority ${submitForm.priority}`)
    parts.push(`--mode ${submitForm.mode}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 12000)
    if (/error|failed|失败/i.test(output) && !/"taskId"/.test(output)) {
      message.error('提交失败: ' + output.slice(0, 120))
      return
    }
    message.success('任务已提交')
    showSubmitModal.value = false
    resetSubmitForm()
    activeTab.value = 'tasks'
    await loadAll()
  } catch (e) {
    message.error('提交失败: ' + (e?.message || e))
  } finally {
    submitting.value = false
  }
}

async function sendHeartbeat(record) {
  heartbeatId.value = record.id
  try {
    const { output } = await ws.execute(`inference heartbeat ${record.id} --json`, 8000)
    if (/error/i.test(output) && !/"updated"/.test(output)) {
      message.error('心跳失败: ' + output.slice(0, 120))
      return
    }
    message.success('心跳已更新')
    await loadAll()
  } catch (e) {
    message.error('心跳失败: ' + (e?.message || e))
  } finally {
    heartbeatId.value = ''
  }
}

async function transitionStatus(record, newStatus) {
  if (newStatus === record.status) return
  try {
    const { output } = await ws.execute(`inference node-status ${record.id} ${newStatus} --json`, 8000)
    if (/error|invalid/i.test(output) && !/"updated"/.test(output)) {
      message.error('状态转换失败: ' + output.slice(0, 120))
      return
    }
    message.success(`节点状态已更新为 ${nodeStatusLabel(newStatus)}`)
    await loadAll()
  } catch (e) {
    message.error('状态转换失败: ' + (e?.message || e))
  }
}

async function unregisterNode(record) {
  try {
    const { output } = await ws.execute(`inference unregister ${record.id} --json`, 8000)
    if (/error/i.test(output) && !/"removed"/.test(output)) {
      message.error('注销失败: ' + output.slice(0, 120))
      return
    }
    message.success('节点已注销')
    await loadAll()
  } catch (e) {
    message.error('注销失败: ' + (e?.message || e))
  }
}

async function completeTask(record) {
  completingId.value = record.id
  try {
    const { output } = await ws.execute(`inference complete ${record.id} --json`, 10000)
    if (/error|failed/i.test(output) && !/"completed"/.test(output)) {
      message.error('完成失败: ' + output.slice(0, 120))
      return
    }
    message.success('任务已完成')
    await loadAll()
  } catch (e) {
    message.error('完成失败: ' + (e?.message || e))
  } finally {
    completingId.value = ''
  }
}

async function failTask(record) {
  try {
    const { output } = await ws.execute(`inference fail-task ${record.id} --json`, 8000)
    if (/error/i.test(output) && !/"failed"/.test(output)) {
      message.error('标记失败: ' + output.slice(0, 120))
      return
    }
    message.success('已标记为失败')
    await loadAll()
  } catch (e) {
    message.error('标记失败: ' + (e?.message || e))
  }
}

function resetRegisterForm() {
  registerForm.nodeId = ''
  registerForm.endpoint = ''
  registerForm.capabilities = ''
  registerForm.gpuMemory = null
}
function resetSubmitForm() {
  submitForm.model = ''
  submitForm.input = ''
  submitForm.priority = 5
  submitForm.mode = 'standard'
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

.inference-tabs :deep(.ant-tabs-nav) {
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
