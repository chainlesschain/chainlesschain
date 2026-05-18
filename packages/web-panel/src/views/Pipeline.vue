<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('pipeline.title') }}</h2>
        <p class="page-sub">{{ $t('pipeline.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('pipeline.refresh') }}
        </a-button>
        <a-button type="primary" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          {{ $t('pipeline.create') }}
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      :message="$t('pipeline.noDb.message')"
      :description="$t('pipeline.noDb.description')"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('pipeline.stats.totalPipelines')" :value="stats.totalPipelines" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><ApartmentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('pipeline.stats.running')"
            :value="stats.pipelinesByStatus.running || 0"
            :value-style="{ color: (stats.pipelinesByStatus.running || 0) > 0 ? '#52c41a' : '#888', fontSize: '20px' }"
          >
            <template #prefix><PlayCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('pipeline.stats.totalStages')" :value="stats.totalStages" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><BlockOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('pipeline.stats.totalArtifacts')" :value="stats.totalArtifacts" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('pipeline.stats.totalDeploys')" :value="stats.totalDeploys" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><CloudUploadOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Stages catalogue -->
    <a-card
      :title="$t('pipeline.stagesCardTitle')"
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
      <a-tab-pane key="pipelines" :tab="$t('pipeline.tabs.pipelines')">
        <div class="filter-bar">
          <a-radio-group v-model:value="templateFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('pipeline.filters.allTemplates') }}</a-radio-button>
            <a-radio-button v-for="t in TEMPLATES" :key="t" :value="t">{{ templateLabel(t) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="statusFilter" size="small">
            <a-radio-button value="">{{ $t('pipeline.filters.allStatuses') }}</a-radio-button>
            <a-radio-button v-for="s in PIPELINE_STATUSES" :key="s" :value="s">{{ pipelineStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="pipelineColumns"
          :data-source="filteredPipelines"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('pipeline.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name || $t('pipeline.table.unnamed') }}</span>
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
              <a-button size="small" type="link" @click="viewPipelineDetails(record)">{{ $t('pipeline.table.actions.details') }}</a-button>
              <a-button v-if="record.status === 'pending'" size="small" type="link" @click="startPipeline(record)">{{ $t('pipeline.table.actions.start') }}</a-button>
              <a-button v-if="record.status === 'running'" size="small" type="link" @click="pausePipeline(record)">{{ $t('pipeline.table.actions.pause') }}</a-button>
              <a-button v-if="record.status === 'paused'" size="small" type="link" @click="resumePipeline(record)">{{ $t('pipeline.table.actions.resume') }}</a-button>
              <a-button v-if="needsApproval(record)" size="small" type="link" style="color: #52c41a;" @click="approveGate(record)">{{ $t('pipeline.table.actions.approveGate') }}</a-button>
              <a-popconfirm
                v-if="canCancel(record)"
                :title="$t('pipeline.table.cancelConfirm')"
                :ok-text="$t('pipeline.table.cancelOk')"
                :cancel-text="$t('pipeline.table.cancelBack')"
                @confirm="cancelPipeline(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('pipeline.table.actions.cancel') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ApartmentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ templateFilter || statusFilter ? $t('pipeline.table.emptyFiltered') : $t('pipeline.table.empty') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Deploys tab ───────────────────────────────────────────── -->
      <a-tab-pane key="deploys" :tab="$t('pipeline.tabs.deploys')">
        <a-table
          :columns="deployColumns"
          :data-source="deploys"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('pipeline.table.totalSuffix', { n: t }) }"
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
              {{ $t('pipeline.table.emptyDeploys') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Templates tab ─────────────────────────────────────────── -->
      <a-tab-pane key="templates" :tab="$t('pipeline.tabs.templates')">
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
      :title="$t('pipeline.create_modal.title')"
      :confirm-loading="creating"
      :width="540"
      :ok-text="$t('pipeline.create_modal.ok')"
      :cancel-text="$t('pipeline.create_modal.cancel')"
      @ok="createPipeline"
      @cancel="resetCreateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('pipeline.create_modal.templateLabel')" required>
          <a-select v-model:value="createForm.template">
            <a-select-option v-for="t in TEMPLATES" :key="t" :value="t">{{ templateLabel(t) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('pipeline.create_modal.nameLabel')">
          <a-input v-model:value="createForm.name" :placeholder="$t('pipeline.create_modal.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('pipeline.create_modal.configLabel')">
          <a-textarea
            v-model:value="createForm.configJson"
            :placeholder="$t('pipeline.create_modal.configPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Pipeline details modal ───────────────────────────────── -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="$t('pipeline.details.title', { label: currentPipeline?.name || currentPipeline?.id?.slice(0, 12) || '' })"
      :width="780"
      :footer="null"
    >
      <div v-if="currentPipeline" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="$t('pipeline.details.template')">
            <a-tag :color="templateColor(currentPipeline.template)">{{ templateLabel(currentPipeline.template) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('pipeline.details.status')">
            <a-tag :color="pipelineStatusColor(currentPipeline.status)">{{ pipelineStatusLabel(currentPipeline.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('pipeline.details.progress')" :span="2">
            <a-progress
              :percent="pipelineProgress(currentPipeline)"
              :status="currentPipeline.status === 'failed' ? 'exception' : currentPipeline.status === 'completed' ? 'success' : 'active'"
              size="small"
            />
          </a-descriptions-item>
          <a-descriptions-item :label="$t('pipeline.details.createdAt')">{{ formatPipelineTime(currentPipeline.createdAt) }}</a-descriptions-item>
          <a-descriptions-item :label="$t('pipeline.details.startedAt')">{{ formatPipelineTime(currentPipeline.startedAt) }}</a-descriptions-item>
        </a-descriptions>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 20px 0 10px;">{{ $t('pipeline.details.stagesHeader') }}</h4>
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
                <LockOutlined /> {{ $t('pipeline.details.needsApproval') }}
                <span v-if="stage.gateApproved" style="color: #52c41a; margin-left: 4px;">{{ $t('pipeline.details.approved') }}</span>
              </a-tag>
            </div>
            <div v-if="stage.errorMessage" style="color: #ff4d4f; font-size: 11px; margin-top: 4px;">
              {{ $t('pipeline.details.errorPrefix') }} {{ stage.errorMessage }}
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
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()

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

const pipelineColumns = computed(() => [
  { title: t('pipeline.cols.name'), key: 'name' },
  { title: t('pipeline.cols.template'), key: 'template', width: '110px' },
  { title: t('pipeline.cols.progress'), key: 'progress', width: '160px' },
  { title: t('pipeline.cols.currentStage'), key: 'currentStage', width: '140px' },
  { title: t('pipeline.cols.status'), key: 'status', width: '110px' },
  { title: t('pipeline.cols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('pipeline.cols.action'), key: 'action', width: '260px' },
])

const deployColumns = computed(() => [
  { title: t('pipeline.cols.pipeline'), key: 'pipeline', width: '180px' },
  { title: t('pipeline.cols.strategy'), key: 'strategy', width: '120px' },
  { title: t('pipeline.cols.status'), key: 'status', width: '110px' },
  { title: t('pipeline.cols.createdAt'), key: 'createdAt' },
])

const filteredPipelines = computed(() => {
  let rows = pipelines.value
  if (templateFilter.value) rows = rows.filter(p => p.template === templateFilter.value)
  if (statusFilter.value) rows = rows.filter(p => p.status === statusFilter.value)
  return rows
})

function templateLabel(name) {
  // i18n key shape mirrors the legacy enum so unknown values pass through.
  const key = `pipeline.templateLabels.${name}`
  const v = t(key)
  return v === key ? name : v
}
function templateColor(t) {
  return { feature: 'green', bugfix: 'red', refactor: 'purple', 'security-audit': 'volcano' }[t] || 'default'
}
function stageLabel(s) {
  const key = `pipeline.stageLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function pipelineStatusLabel(s) {
  const key = `pipeline.pipelineStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function pipelineStatusColor(s) {
  return { pending: 'default', running: 'processing', paused: 'orange', completed: 'green', failed: 'red', cancelled: 'default' }[s] || 'default'
}
function stageStatusLabel(s) {
  const key = `pipeline.stageStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function stageStatusColor(s) {
  return { pending: 'default', running: 'processing', 'gate-waiting': 'gold', completed: 'green', failed: 'red', skipped: 'default' }[s] || 'default'
}
function deployStatusLabel(s) {
  const key = `pipeline.deployStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
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
    message.error(t('pipeline.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function createPipeline() {
  if (!createForm.template) {
    message.warning(t('pipeline.msg.selectTemplate'))
    return
  }
  if (createForm.configJson.trim()) {
    try { JSON.parse(createForm.configJson) } catch {
      message.warning(t('pipeline.msg.badConfigJson'))
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
      message.error(t('pipeline.msg.needCcInit'))
      return
    }
    if (/error|Error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('pipeline.msg.createFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('pipeline.msg.createSuccess'))
    showCreateModal.value = false
    resetCreateForm()
    await loadAll()
  } catch (e) {
    message.error(t('pipeline.msg.createFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function startPipeline(record) {
  await runPipelineAction(record, `pipeline start ${record.id}`, t('pipeline.msg.started'))
}
async function pausePipeline(record) {
  await runPipelineAction(record, `pipeline pause ${record.id}`, t('pipeline.msg.paused'))
}
async function resumePipeline(record) {
  await runPipelineAction(record, `pipeline resume ${record.id}`, t('pipeline.msg.resumed'))
}
async function approveGate(record) {
  await runPipelineAction(record, `pipeline approve ${record.id}`, t('pipeline.msg.gateApproved'))
}
async function cancelPipeline(record) {
  await runPipelineAction(record, `pipeline cancel ${record.id}`, t('pipeline.msg.cancelled'))
}

async function runPipelineAction(record, command, successMsg) {
  try {
    const { output } = await ws.execute(command, 8000)
    if (/error|Error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('pipeline.msg.actionFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(successMsg)
    await loadAll()
  } catch (e) {
    message.error(t('pipeline.msg.actionFailed') + ': ' + (e?.message || e))
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
