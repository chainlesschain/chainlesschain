<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">开发流水线</h2>
        <p class="page-sub">7 阶段 AI 开发流水线 · 质量门 · 部署策略</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          创建流水线
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      message="该模块需要项目级数据库"
      description="`cc pipeline ...` 命令仅在 chainlesschain 项目目录下可用。请先运行 `cc init` 初始化项目，或在已初始化的目录启动 `cc serve`。"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="流水线总数" :value="stats.totalPipelines" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><ApartmentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="运行中"
            :value="stats.pipelinesByStatus.running || 0"
            :value-style="{ color: (stats.pipelinesByStatus.running || 0) > 0 ? '#52c41a' : '#888', fontSize: '20px' }"
          >
            <template #prefix><PlayCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="阶段总数" :value="stats.totalStages" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><BlockOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="制品" :value="stats.totalArtifacts" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="部署" :value="stats.totalDeploys" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><CloudUploadOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Stages catalogue -->
    <a-card
      title="7 阶段流水线"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <div class="stage-flow">
        <template v-for="(s, idx) in STAGE_NAMES" :key="s">
          <span class="stage-pill" :class="{ 'is-gate': GATE_STAGES.includes(s) }">
            <span class="stage-idx">{{ idx + 1 }}</span>
            {{ stageLabel(s) }}
            <LockOutlined v-if="GATE_STAGES.includes(s)" class="gate-icon" />
          </span>
          <ArrowRightOutlined v-if="idx < STAGE_NAMES.length - 1" class="stage-arrow" />
        </template>
      </div>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="pipeline-tabs">
      <!-- ── Pipelines tab ─────────────────────────────────────────── -->
      <a-tab-pane key="pipelines" tab="流水线">
        <div class="filter-bar">
          <a-radio-group v-model:value="templateFilter" size="small" button-style="solid">
            <a-radio-button value="">全部模板</a-radio-button>
            <a-radio-button v-for="t in TEMPLATES" :key="t" :value="t">{{ templateLabel(t) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="statusFilter" size="small">
            <a-radio-button value="">全部状态</a-radio-button>
            <a-radio-button v-for="s in PIPELINE_STATUSES" :key="s" :value="s">{{ pipelineStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="pipelineColumns"
          :data-source="filteredPipelines"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name || '(未命名)' }}</span>
              <div style="color: var(--text-secondary); font-size: 11px; font-family: monospace; margin-top: 2px;">
                {{ record.id.slice(0, 16) }}
              </div>
            </template>
            <template v-if="column.key === 'template'">
              <a-tag :color="templateColor(record.template)">{{ templateLabel(record.template) }}</a-tag>
            </template>
            <template v-if="column.key === 'progress'">
              <a-progress
                :percent="pipelineProgress(record)"
                size="small"
                :status="record.status === 'failed' ? 'exception' : record.status === 'completed' ? 'success' : 'active'"
                :format="() => `${record.currentStage}/${record.stages.length}`"
              />
            </template>
            <template v-if="column.key === 'currentStage'">
              <a-tag v-if="currentStageRecord(record)" :color="stageStatusColor(currentStageRecord(record).status)">
                {{ stageLabel(currentStageRecord(record).name) }}
              </a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="pipelineStatusColor(record.status)">{{ pipelineStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatPipelineTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewPipelineDetails(record)">详情</a-button>
              <a-button v-if="record.status === 'pending'" size="small" type="link" @click="startPipeline(record)">启动</a-button>
              <a-button v-if="record.status === 'running'" size="small" type="link" @click="pausePipeline(record)">暂停</a-button>
              <a-button v-if="record.status === 'paused'" size="small" type="link" @click="resumePipeline(record)">继续</a-button>
              <a-button v-if="needsApproval(record)" size="small" type="link" style="color: #52c41a;" @click="approveGate(record)">批准门</a-button>
              <a-popconfirm
                v-if="canCancel(record)"
                title="取消该流水线？"
                ok-text="取消"
                cancel-text="返回"
                @confirm="cancelPipeline(record)"
              >
                <a-button size="small" type="link" danger>取消</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ApartmentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ templateFilter || statusFilter ? '没有符合条件的流水线' : '暂无流水线，点"创建流水线"创建第一条' }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Deploys tab ───────────────────────────────────────────── -->
      <a-tab-pane key="deploys" tab="部署">
        <a-table
          :columns="deployColumns"
          :data-source="deploys"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'pipeline'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.pipelineId.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'strategy'">
              <a-tag :color="strategyColor(record.strategy)" style="font-family: monospace;">{{ record.strategy }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="deployStatusColor(record.status)">{{ deployStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatPipelineTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <CloudUploadOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无部署记录
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Templates tab ─────────────────────────────────────────── -->
      <a-tab-pane key="templates" tab="模板">
        <a-row :gutter="[16, 16]">
          <a-col v-for="tpl in templates" :key="tpl.name" :xs="24" :sm="12" :lg="12">
            <a-card :title="templateLabel(tpl.name)" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <template #extra>
                <a-tag :color="templateColor(tpl.name)">{{ tpl.name }}</a-tag>
              </template>
              <p style="color: var(--text-secondary); font-size: 12px; margin: 0 0 10px;">{{ tpl.description }}</p>
              <div class="tpl-stages">
                <template v-for="(s, idx) in tpl.stages" :key="s">
                  <a-tag :color="tpl.gateStages.includes(s) ? 'gold' : 'blue'" style="font-size: 11px;">
                    {{ idx + 1 }}. {{ stageLabel(s) }}
                    <LockOutlined v-if="tpl.gateStages.includes(s)" style="font-size: 10px; margin-left: 2px;" />
                  </a-tag>
                </template>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Create pipeline modal ────────────────────────────────── -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建流水线"
      :confirm-loading="creating"
      :width="540"
      ok-text="创建"
      cancel-text="取消"
      @ok="createPipeline"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="模板" required>
          <a-select v-model:value="createForm.template">
            <a-select-option v-for="t in TEMPLATES" :key="t" :value="t">{{ templateLabel(t) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="名称">
          <a-input v-model:value="createForm.name" placeholder="可选，例如: 修复登录 Bug" />
        </a-form-item>
        <a-form-item label="配置 (JSON)">
          <a-textarea
            v-model:value="createForm.configJson"
            placeholder='例如 {"repo":"web","ticket":"PROJ-123"}'
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Pipeline details modal ───────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="`流水线详情：${currentPipeline?.name || currentPipeline?.id?.slice(0, 12) || ''}`"
      :width="780"
      :footer="null"
    >
      <div v-if="currentPipeline" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="模板">
            <a-tag :color="templateColor(currentPipeline.template)">{{ templateLabel(currentPipeline.template) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="pipelineStatusColor(currentPipeline.status)">{{ pipelineStatusLabel(currentPipeline.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="进度" :span="2">
            <a-progress
              :percent="pipelineProgress(currentPipeline)"
              :status="currentPipeline.status === 'failed' ? 'exception' : currentPipeline.status === 'completed' ? 'success' : 'active'"
              size="small"
            />
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ formatPipelineTime(currentPipeline.createdAt) }}</a-descriptions-item>
          <a-descriptions-item label="开始时间">{{ formatPipelineTime(currentPipeline.startedAt) }}</a-descriptions-item>
        </a-descriptions>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 20px 0 10px;">阶段详情</h4>
        <a-timeline mode="left">
          <a-timeline-item
            v-for="stage in currentPipeline.stages"
            :key="stage.id"
            :color="timelineColor(stage.status)"
          >
            <template #dot>
              <CheckCircleOutlined v-if="stage.status === 'completed'" :style="{ color: '#52c41a' }" />
              <LoadingOutlined v-else-if="stage.status === 'running'" :style="{ color: '#1677ff' }" />
              <CloseCircleOutlined v-else-if="stage.status === 'failed'" :style="{ color: '#ff4d4f' }" />
              <LockOutlined v-else-if="stage.status === 'gate-waiting'" :style="{ color: '#faad14' }" />
              <ClockCircleOutlined v-else :style="{ color: 'var(--text-muted)' }" />
            </template>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="color: var(--text-primary); font-weight: 500;">{{ stage.stageIndex + 1 }}. {{ stageLabel(stage.name) }}</span>
              <a-tag :color="stageStatusColor(stage.status)" style="font-size: 11px;">{{ stageStatusLabel(stage.status) }}</a-tag>
              <a-tag v-if="stage.gateRequired" color="gold" style="font-size: 10px;">
                <LockOutlined /> 需要审批
                <span v-if="stage.gateApproved" style="color: #52c41a; margin-left: 4px;">(已批准)</span>
              </a-tag>
            </div>
            <div v-if="stage.errorMessage" style="color: #ff4d4f; font-size: 11px; margin-top: 4px;">
              错误: {{ stage.errorMessage }}
            </div>
            <div v-if="stage.startedAt" style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">
              {{ formatPipelineTime(stage.startedAt) }}
              <span v-if="stage.completedAt"> → {{ formatPipelineTime(stage.completedAt) }}</span>
            </div>
          </a-timeline-item>
        </a-timeline>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  ApartmentOutlined,
  PlayCircleOutlined,
  BlockOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  ArrowRightOutlined,
  LockOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parsePipelines,
  parseDeploys,
  parseTemplates,
  parseStats,
  detectPipelineError,
  formatPipelineTime,
  PIPELINE_STATUSES,
  STAGE_NAMES,
  TEMPLATES,
  GATE_STAGES,
} from '../utils/pipeline-parser.js'

const ws = useWsStore()

const loading = ref(false)
const creating = ref(false)

const pipelines = ref([])
const deploys = ref([])
const templates = ref([])
const stats = ref({
  totalPipelines: 0,
  pipelinesByTemplate: {},
  pipelinesByStatus: {},
  totalStages: 0,
  stagesByStatus: {},
  totalArtifacts: 0,
  totalDeploys: 0,
  deploysByStrategy: {},
})
const errorState = ref({ noDb: false, error: '' })

const activeTab = ref('pipelines')
const templateFilter = ref('')
const statusFilter = ref('')

const showCreateModal = ref(false)
const showDetailsModal = ref(false)

const createForm = reactive({ template: 'feature', name: '', configJson: '' })
const currentPipeline = ref(null)

const pipelineColumns = [
  { title: '名称', key: 'name' },
  { title: '模板', key: 'template', width: '110px' },
  { title: '进度', key: 'progress', width: '160px' },
  { title: '当前阶段', key: 'currentStage', width: '140px' },
  { title: '状态', key: 'status', width: '110px' },
  { title: '创建时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '260px' },
]

const deployColumns = [
  { title: '流水线', key: 'pipeline', width: '180px' },
  { title: '策略', key: 'strategy', width: '120px' },
  { title: '状态', key: 'status', width: '110px' },
  { title: '创建时间', key: 'createdAt' },
]

const filteredPipelines = computed(() => {
  let rows = pipelines.value
  if (templateFilter.value) rows = rows.filter(p => p.template === templateFilter.value)
  if (statusFilter.value) rows = rows.filter(p => p.status === statusFilter.value)
  return rows
})

function templateLabel(t) {
  return { feature: '功能开发', bugfix: '缺陷修复', refactor: '重构', 'security-audit': '安全审计' }[t] || t
}
function templateColor(t) {
  return { feature: 'green', bugfix: 'red', refactor: 'purple', 'security-audit': 'volcano' }[t] || 'default'
}
function stageLabel(s) {
  return {
    requirement: '需求', architecture: '架构', 'code-generation': '代码生成',
    testing: '测试', 'code-review': '代码评审', deploy: '部署', monitoring: '监控',
  }[s] || s
}
function pipelineStatusLabel(s) {
  return { pending: '待启动', running: '运行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[s] || s
}
function pipelineStatusColor(s) {
  return { pending: 'default', running: 'processing', paused: 'orange', completed: 'green', failed: 'red', cancelled: 'default' }[s] || 'default'
}
function stageStatusLabel(s) {
  return { pending: '待处理', running: '运行中', 'gate-waiting': '等待审批', completed: '已完成', failed: '失败', skipped: '跳过' }[s] || s
}
function stageStatusColor(s) {
  return { pending: 'default', running: 'processing', 'gate-waiting': 'gold', completed: 'green', failed: 'red', skipped: 'default' }[s] || 'default'
}
function deployStatusLabel(s) {
  return { pending: '待部署', running: '部署中', succeeded: '成功', failed: '失败', 'rolled-back': '已回滚' }[s] || s
}
function deployStatusColor(s) {
  return { pending: 'default', running: 'processing', succeeded: 'green', failed: 'red', 'rolled-back': 'orange' }[s] || 'default'
}
function strategyColor(s) {
  return {
    'git-pr': 'blue', docker: 'cyan', 'npm-publish': 'magenta',
    local: 'default', staging: 'orange', custom: 'purple',
  }[s] || 'default'
}
function timelineColor(s) {
  return { pending: 'gray', running: 'blue', 'gate-waiting': 'gold', completed: 'green', failed: 'red', skipped: 'gray' }[s] || 'gray'
}

function pipelineProgress(p) {
  if (!p.stages.length) return 0
  const completed = p.stages.filter(s => s.status === 'completed').length
  return Math.round(100 * completed / p.stages.length)
}
function currentStageRecord(p) {
  if (!p.stages.length) return null
  const idx = Math.min(p.currentStage, p.stages.length - 1)
  return p.stages[idx] || null
}
function needsApproval(p) {
  if (p.status !== 'running') return false
  const cur = currentStageRecord(p)
  return cur && cur.status === 'gate-waiting' && cur.gateRequired && !cur.gateApproved
}
function canCancel(p) {
  return p.status === 'pending' || p.status === 'running' || p.status === 'paused'
}

async function loadAll() {
  loading.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const [listRes, deploysRes, tplsRes, statsRes] = await Promise.all([
      ws.execute('pipeline list', 10000).catch(() => ({ output: '' })),
      ws.execute('pipeline deploys', 10000).catch(() => ({ output: '' })),
      ws.execute('pipeline templates', 8000).catch(() => ({ output: '' })),
      ws.execute('pipeline stats', 8000).catch(() => ({ output: '' })),
    ])
    // Detect noDb on any of the DB-backed commands
    const errs = [listRes, deploysRes, statsRes]
      .map(r => detectPipelineError(r.output))
      .find(e => e.noDb)
    if (errs) {
      errorState.value = errs
    }
    pipelines.value = parsePipelines(listRes.output)
    deploys.value = parseDeploys(deploysRes.output)
    templates.value = parseTemplates(tplsRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error('加载流水线数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createPipeline() {
  if (!createForm.template) {
    message.warning('请选择模板')
    return
  }
  if (createForm.configJson.trim()) {
    try { JSON.parse(createForm.configJson) } catch {
      message.warning('配置 JSON 格式错误')
      return
    }
  }
  creating.value = true
  try {
    const parts = [`pipeline create --template ${createForm.template}`]
    if (createForm.name.trim()) parts.push(`--name "${createForm.name.trim().replace(/"/g, '\\"')}"`)
    if (createForm.configJson.trim()) {
      parts.push(`--config '${createForm.configJson.trim().replace(/'/g, "'\\''")}'`)
    }
    const { output } = await ws.execute(parts.join(' '), 10000)
    const err = detectPipelineError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (/error|Error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error('创建失败: ' + output.slice(0, 120))
      return
    }
    message.success('流水线已创建')
    showCreateModal.value = false
    resetCreateForm()
    await loadAll()
  } catch (e) {
    message.error('创建失败: ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function startPipeline(record) {
  await runPipelineAction(record, `pipeline start ${record.id}`, '已启动')
}
async function pausePipeline(record) {
  await runPipelineAction(record, `pipeline pause ${record.id}`, '已暂停')
}
async function resumePipeline(record) {
  await runPipelineAction(record, `pipeline resume ${record.id}`, '已恢复')
}
async function approveGate(record) {
  await runPipelineAction(record, `pipeline approve ${record.id}`, '门已批准')
}
async function cancelPipeline(record) {
  await runPipelineAction(record, `pipeline cancel ${record.id}`, '已取消')
}

async function runPipelineAction(record, command, successMsg) {
  try {
    const { output } = await ws.execute(command, 8000)
    if (/error|Error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error('操作失败: ' + output.slice(0, 120))
      return
    }
    message.success(successMsg)
    await loadAll()
  } catch (e) {
    message.error('操作失败: ' + (e?.message || e))
  }
}

function viewPipelineDetails(record) {
  currentPipeline.value = record
  showDetailsModal.value = true
}

function resetCreateForm() {
  createForm.template = 'feature'
  createForm.name = ''
  createForm.configJson = ''
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

.pipeline-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Stage flow */
.stage-flow {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.stage-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 14px;
  background: rgba(22,119,255,.12);
  color: #1677ff;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid rgba(22,119,255,.25);
}
.stage-pill.is-gate {
  background: rgba(250,173,20,.15);
  color: #faad14;
  border-color: rgba(250,173,20,.3);
}
.stage-idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: currentColor;
  color: #fff !important;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
}
.stage-pill.is-gate .stage-idx {
  background: #faad14;
}
.stage-arrow {
  color: var(--text-muted);
  font-size: 11px;
}
.gate-icon {
  font-size: 11px;
}

/* Template card stage list */
.tpl-stages {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
