<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">声誉优化</h2>
        <p class="page-sub">观察记录 · 衰减模型 · 异常检测 · 贝叶斯参数优化</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button @click="openAnomaliesModal">
          <template #icon><WarningOutlined /></template>
          异常检测
        </a-button>
        <a-button type="primary" @click="showOptimizeModal = true">
          <template #icon><ThunderboltOutlined /></template>
          启动优化
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      message="该模块需要项目级数据库"
      description="`cc reputation ...` 命令仅在 chainlesschain 项目目录下可用。请先运行 `cc init` 初始化项目，或在已初始化的目录启动 `cc serve`。"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="跟踪 DID" :value="stats.observations.totalDids" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="观察总数" :value="stats.observations.totalObservations" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><EyeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="优化运行" :value="stats.totalRuns" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><ExperimentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="进行中"
            :value="stats.activeRuns"
            :value-style="{ color: stats.activeRuns > 0 ? '#1677ff' : '#888', fontSize: '20px' }"
            :suffix="`/ ${stats.maxConcurrentOptimizations}`"
          >
            <template #prefix><LoadingOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="历史最佳"
            :value="stats.bestScoreEver"
            :precision="3"
            :value-style="{ color: '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><TrophyOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="reputation-tabs">
      <!-- ── Scores tab ──────────────────────────────────────────── -->
      <a-tab-pane key="scores" tab="评分排行">
        <div class="filter-bar">
          <span style="color: var(--text-secondary); font-size: 12px;">衰减模型:</span>
          <a-radio-group v-model:value="decayFilter" size="small" button-style="solid" @change="loadScores">
            <a-radio-button v-for="d in DECAY_MODELS" :key="d" :value="d">{{ decayLabel(d) }}</a-radio-button>
          </a-radio-group>
          <a-button size="small" @click="showObserveModal = true">
            <template #icon><PlusOutlined /></template>
            添加观察
          </a-button>
        </div>

        <a-table
          :columns="scoreColumns"
          :data-source="scores"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 个 DID` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record, index }">
            <template v-if="column.key === 'rank'">
              <span :class="['rank-pill', rankClass(index)]">{{ index + 1 }}</span>
            </template>
            <template v-if="column.key === 'did'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.did }}</span>
            </template>
            <template v-if="column.key === 'score'">
              <a-progress
                :percent="Math.round(record.score * 100)"
                :stroke-color="scoreColor(record.score)"
                size="small"
                :format="() => record.score.toFixed(4)"
              />
            </template>
            <template v-if="column.key === 'observations'">
              <span style="color: var(--text-secondary);">{{ record.observations }}</span>
            </template>
            <template v-if="column.key === 'weightTotal'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.weightTotal.toFixed(2) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <UserOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无声誉数据，点"添加观察"记录第一条
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Runs tab ────────────────────────────────────────────── -->
      <a-tab-pane key="runs" tab="优化运行">
        <a-table
          :columns="runColumns"
          :data-source="runs"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'runId'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.runId.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'objective'">
              <a-tag :color="objectiveColor(record.objective)" style="font-family: monospace;">{{ objectiveLabel(record.objective) }}</a-tag>
            </template>
            <template v-if="column.key === 'iterations'">
              <span style="color: var(--text-secondary);">{{ record.iterations }}</span>
            </template>
            <template v-if="column.key === 'bestScore'">
              <span :style="{ color: scoreColor(record.bestScore), fontWeight: 500, fontFamily: 'monospace' }">
                {{ record.bestScore.toFixed(4) }}
              </span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatReputationTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewRunAnalytics(record)">分析</a-button>
              <a-button v-if="record.status === 'complete'" size="small" type="link" style="color: #52c41a;" @click="applyRun(record)">应用</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ExperimentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无优化运行，点"启动优化"开始第一次
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Breakdown tab ───────────────────────────────────────── -->
      <a-tab-pane key="breakdown" tab="分布统计">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card title="按状态" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="s in RUN_STATUSES" :key="s" class="bd-row">
                <a-tag :color="statusColor(s)" style="min-width: 80px; text-align: center;">{{ statusLabel(s) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byStatus[s] || 0, stats.totalRuns)"
                  :stroke-color="statusBarColor(s)"
                  :format="() => `${stats.byStatus[s] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card title="按目标" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
              <div v-for="o in OPTIMIZATION_OBJECTIVES" :key="o" class="bd-row">
                <a-tag :color="objectiveColor(o)" style="min-width: 100px; text-align: center; font-family: monospace;">{{ objectiveLabel(o) }}</a-tag>
                <a-progress
                  :percent="pctOfTotal(stats.byObjective[o] || 0, stats.totalRuns)"
                  :stroke-color="objectiveBarColor(o)"
                  :format="() => `${stats.byObjective[o] || 0}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Add observation modal ──────────────────────────────── -->
    <a-modal
      v-model:open="showObserveModal"
      title="添加观察记录"
      :confirm-loading="observing"
      :width="540"
      ok-text="记录"
      cancel-text="取消"
      @ok="submitObservation"
      @cancel="resetObserveForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="DID" required>
          <a-input v-model:value="observeForm.did" placeholder="did:key:..." />
        </a-form-item>
        <a-form-item label="评分" required>
          <a-input-number v-model:value="observeForm.score" :min="0" :max="1" :step="0.05" style="width: 160px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">范围 0.0 ~ 1.0</span>
        </a-form-item>
        <a-form-item label="种类">
          <a-select v-model:value="observeForm.kind">
            <a-select-option v-for="k in OBSERVATION_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="权重">
          <a-input-number v-model:value="observeForm.weight" :min="0.1" :step="0.1" style="width: 120px;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Optimize modal ─────────────────────────────────────── -->
    <a-modal
      v-model:open="showOptimizeModal"
      title="启动优化"
      :confirm-loading="optimizing"
      :width="540"
      ok-text="启动"
      cancel-text="取消"
      @ok="submitOptimization"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="目标" required>
          <a-select v-model:value="optimizeForm.objective">
            <a-select-option v-for="o in OPTIMIZATION_OBJECTIVES" :key="o" :value="o">{{ objectiveLabel(o) }}</a-select-option>
          </a-select>
          <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">{{ objectiveDesc(optimizeForm.objective) }}</div>
        </a-form-item>
        <a-form-item label="迭代次数">
          <a-input-number v-model:value="optimizeForm.iterations" :min="1" :max="1000" :step="10" style="width: 160px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">范围 1 ~ 1000，默认 50</span>
        </a-form-item>
      </a-form>
      <a-alert
        type="info"
        show-icon
        message="同步执行"
        description="优化将运行所有迭代后立即返回最佳参数与建议（CLI lib 内置启发式 Bayesian 模拟）。"
        style="margin-top: 12px;"
      />
    </a-modal>

    <!-- ── Anomaly detection modal ────────────────────────────── -->
    <a-modal
      v-model:open="showAnomaliesModal"
      title="异常评分检测"
      :width="640"
      :footer="null"
    >
      <div style="padding-top: 8px;">
        <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }">
          <a-form-item label="检测方法">
            <a-radio-group v-model:value="anomalyForm.method" button-style="solid">
              <a-radio-button v-for="m in ANOMALY_METHODS" :key="m" :value="m">{{ m === 'z_score' ? 'Z 分数 (3σ)' : 'IQR (1.5×)' }}</a-radio-button>
            </a-radio-group>
          </a-form-item>
          <a-form-item label="阈值">
            <a-input-number v-model:value="anomalyForm.threshold" :min="0.5" :step="0.1" style="width: 120px;" />
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">默认 z_score=2.5 / iqr=1.5</span>
          </a-form-item>
          <a-form-item label="衰减模型">
            <a-select v-model:value="anomalyForm.decay" style="width: 200px;">
              <a-select-option v-for="d in DECAY_MODELS" :key="d" :value="d">{{ decayLabel(d) }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :wrapper-col="{ offset: 5, span: 19 }">
            <a-button type="primary" :loading="detectingAnomalies" @click="runAnomalyDetection">
              <template #icon><WarningOutlined /></template>
              开始检测
            </a-button>
          </a-form-item>
        </a-form>

        <a-divider />

        <a-empty v-if="!anomalyResult" description="尚未检测" :image="EMPTY_IMG" />
        <div v-else>
          <a-row :gutter="12" style="margin-bottom: 12px;">
            <a-col :span="8"><a-statistic title="样本数" :value="anomalyResult.totalSamples" :value-style="{ fontSize: '16px' }" /></a-col>
            <a-col :span="8"><a-statistic title="阈值" :value="anomalyResult.threshold" :precision="2" :value-style="{ fontSize: '16px' }" /></a-col>
            <a-col :span="8"><a-statistic title="异常数" :value="anomalyResult.anomalies.length" :value-style="{ color: anomalyResult.anomalies.length > 0 ? '#ff4d4f' : '#52c41a', fontSize: '16px' }" /></a-col>
          </a-row>
          <a-alert
            v-if="anomalyResult.message"
            :message="anomalyResult.message"
            type="warning"
            show-icon
            style="margin-bottom: 12px;"
          />
          <a-list v-if="anomalyResult.anomalies.length" size="small" :data-source="anomalyResult.anomalies">
            <template #renderItem="{ item }">
              <a-list-item>
                <span style="font-family: monospace; font-size: 12px; color: var(--text-primary);">{{ item.did }}</span>
                <a-tag color="red" style="margin-left: 8px;">score: {{ item.score.toFixed(4) }}</a-tag>
                <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">{{ item.reason }}</span>
                <span v-if="item.zScore !== null" style="margin-left: 8px; color: var(--text-muted); font-size: 11px;">z={{ item.zScore.toFixed(2) }}</span>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </div>
    </a-modal>

    <!-- ── Run analytics / details modal ──────────────────────── -->
    <a-modal
      v-model:open="showAnalyticsModal"
      :title="`运行详情：${currentRun?.runId?.slice(0, 12) || ''}`"
      :width="780"
      :footer="null"
    >
      <div v-if="currentRun" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="目标">
            <a-tag :color="objectiveColor(currentRun.objective)">{{ objectiveLabel(currentRun.objective) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(currentRun.status)">{{ statusLabel(currentRun.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="迭代次数">{{ currentRun.iterations }}</a-descriptions-item>
          <a-descriptions-item label="最佳分数">
            <span :style="{ color: scoreColor(currentRun.bestScore), fontWeight: 500, fontFamily: 'monospace' }">
              {{ currentRun.bestScore.toFixed(4) }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">{{ formatReputationTime(currentRun.createdAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentRun.completedAt" label="完成时间">{{ formatReputationTime(currentRun.completedAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentRun.bestParams" label="最佳参数" :span="2">
            <pre class="params-pre">{{ formatParams(currentRun.bestParams) }}</pre>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentRun.errorMessage" label="错误信息" :span="2">
            <span style="color: #ff4d4f;">{{ currentRun.errorMessage }}</span>
          </a-descriptions-item>
        </a-descriptions>

        <a-spin :spinning="loadingAnalytics">
          <div v-if="currentAnalytics" style="margin-top: 16px;">
            <h4 style="color: var(--text-primary); font-size: 13px; margin: 0 0 10px;">声誉分布</h4>
            <a-card size="small" style="margin-bottom: 12px;">
              <div v-for="b in currentAnalytics.reputationDistribution.buckets" :key="b.label" class="bucket-row">
                <span class="bucket-label">{{ b.label }}</span>
                <a-progress
                  :percent="bucketPct(b)"
                  :stroke-color="b.count > 0 ? '#1677ff' : '#d9d9d9'"
                  :format="() => `${b.count}`"
                  size="small"
                  style="flex: 1; margin-left: 12px;"
                />
              </div>
              <div v-if="currentAnalytics.reputationDistribution.mean !== null" style="margin-top: 8px; color: var(--text-secondary); font-size: 12px;">
                平均: {{ currentAnalytics.reputationDistribution.mean.toFixed(4) }}
                <span v-if="currentAnalytics.reputationDistribution.stdDev !== null" style="margin-left: 12px;">
                  标准差: {{ currentAnalytics.reputationDistribution.stdDev.toFixed(4) }}
                </span>
              </div>
            </a-card>

            <a-card v-if="currentAnalytics.recommendations.length" title="建议" size="small">
              <a-list size="small" :data-source="currentAnalytics.recommendations">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <ArrowRightOutlined style="color: #faad14; margin-right: 8px;" />
                    {{ item }}
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </div>
        </a-spin>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  UserOutlined,
  EyeOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  TrophyOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons-vue'
import { message, Modal, Empty } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseScores,
  parseAnomalies,
  parseRun,
  parseRuns,
  parseAnalytics,
  parseStatsV2,
  detectReputationError,
  formatReputationTime,
  OPTIMIZATION_OBJECTIVES,
  DECAY_MODELS,
  ANOMALY_METHODS,
  RUN_STATUSES,
  OBSERVATION_KINDS,
} from '../utils/reputation-parser.js'

const ws = useWsStore()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const observing = ref(false)
const optimizing = ref(false)
const detectingAnomalies = ref(false)
const loadingAnalytics = ref(false)

const scores = ref([])
const runs = ref([])
const stats = ref({
  totalRuns: 0,
  activeRuns: 0,
  maxConcurrentOptimizations: 0,
  byStatus: {},
  byObjective: {},
  observations: { totalObservations: 0, totalDids: 0 },
  bestScoreEver: 0,
})
const errorState = ref({ noDb: false, error: '' })

const activeTab = ref('scores')
const decayFilter = ref('none')

const showObserveModal = ref(false)
const showOptimizeModal = ref(false)
const showAnomaliesModal = ref(false)
const showAnalyticsModal = ref(false)

const observeForm = reactive({ did: '', score: 0.8, kind: 'generic', weight: 1.0 })
const optimizeForm = reactive({ objective: 'accuracy', iterations: 50 })
const anomalyForm = reactive({ method: 'z_score', threshold: 2.5, decay: 'none' })

const currentRun = ref(null)
const currentAnalytics = ref(null)
const anomalyResult = ref(null)

const scoreColumns = [
  { title: '排名', key: 'rank', width: '60px' },
  { title: 'DID', key: 'did' },
  { title: '声誉分数', key: 'score', width: '220px' },
  { title: '观察数', key: 'observations', width: '100px' },
  { title: '权重和', key: 'weightTotal', width: '100px' },
]

const runColumns = [
  { title: 'Run ID', key: 'runId', width: '140px' },
  { title: '目标', key: 'objective', width: '140px' },
  { title: '迭代', key: 'iterations', width: '80px' },
  { title: '最佳分数', key: 'bestScore', width: '110px' },
  { title: '状态', key: 'status', width: '100px' },
  { title: '创建时间', key: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '160px' },
]

function decayLabel(d) {
  return { none: '无', exponential: '指数', linear: '线性', step: '步进' }[d] || d
}
function kindLabel(k) {
  return { generic: '通用', task: '任务', review: '评审', vote: '投票' }[k] || k
}
function objectiveLabel(o) {
  return {
    accuracy: '准确性',
    fairness: '公平性',
    resilience: '抗扰动',
    convergence_speed: '收敛速度',
  }[o] || o
}
function objectiveColor(o) {
  return {
    accuracy: 'blue',
    fairness: 'green',
    resilience: 'purple',
    convergence_speed: 'orange',
  }[o] || 'default'
}
function objectiveBarColor(o) {
  return { accuracy: '#1677ff', fairness: '#52c41a', resilience: '#722ed1', convergence_speed: '#fa8c16' }[o] || '#888'
}
function objectiveDesc(o) {
  return {
    accuracy: '最大化对真实声誉的拟合',
    fairness: '降低衰减强度，平等对待各 DID',
    resilience: '提高对异常值的容忍度',
    convergence_speed: '尽量少迭代获得稳定结果',
  }[o] || ''
}

function statusLabel(s) {
  return { running: '运行中', complete: '已完成', applied: '已应用', failed: '失败', cancelled: '已取消' }[s] || s
}
function statusColor(s) {
  return { running: 'processing', complete: 'blue', applied: 'green', failed: 'red', cancelled: 'default' }[s] || 'default'
}
function statusBarColor(s) {
  return { running: '#1677ff', complete: '#13c2c2', applied: '#52c41a', failed: '#ff4d4f', cancelled: '#888' }[s] || '#888'
}

function rankClass(idx) {
  if (idx === 0) return 'gold'
  if (idx === 1) return 'silver'
  if (idx === 2) return 'bronze'
  return ''
}

function scoreColor(s) {
  if (s >= 0.8) return '#52c41a'
  if (s >= 0.5) return '#1677ff'
  if (s >= 0.3) return '#faad14'
  return '#ff4d4f'
}

function pctOfTotal(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

function bucketPct(b) {
  const total = currentAnalytics.value?.reputationDistribution.buckets
    .reduce((s, x) => s + x.count, 0) || 0
  if (!total) return 0
  return Math.round((b.count / total) * 100)
}

function formatParams(p) {
  if (typeof p === 'string') return p
  try { return JSON.stringify(p, null, 2) } catch { return String(p) }
}

async function loadAll() {
  loading.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const [scoresRes, runsRes, statsRes] = await Promise.all([
      ws.execute(`reputation list --decay ${decayFilter.value} --json`, 10000).catch(() => ({ output: '' })),
      ws.execute('reputation runs --limit 50 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('reputation stats-v2 --json', 8000).catch(() => ({ output: '' })),
    ])
    const errs = [scoresRes, runsRes, statsRes]
      .map(r => detectReputationError(r.output))
      .find(e => e.noDb)
    if (errs) {
      errorState.value = errs
    }
    scores.value = parseScores(scoresRes.output)
    runs.value = parseRuns(runsRes.output)
    stats.value = parseStatsV2(statsRes.output)
  } catch (e) {
    message.error('加载声誉数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function loadScores() {
  try {
    const { output } = await ws.execute(
      `reputation list --decay ${decayFilter.value} --json`,
      10000,
    )
    const err = detectReputationError(output)
    if (err.noDb) {
      errorState.value = err
      return
    }
    scores.value = parseScores(output)
  } catch (e) {
    message.error('加载评分失败: ' + (e?.message || e))
  }
}

async function submitObservation() {
  if (!observeForm.did.trim()) {
    message.warning('请填写 DID')
    return
  }
  if (observeForm.score < 0 || observeForm.score > 1) {
    message.warning('评分必须在 0 ~ 1 之间')
    return
  }
  observing.value = true
  try {
    const parts = [
      `reputation observe "${observeForm.did.trim().replace(/"/g, '\\"')}"`,
      String(observeForm.score),
      `-k ${observeForm.kind}`,
      `-w ${observeForm.weight}`,
      '--json',
    ]
    const { output } = await ws.execute(parts.join(' '), 10000)
    const err = detectReputationError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    if (!/"did"/.test(output)) {
      message.error('记录失败: ' + output.slice(0, 120))
      return
    }
    message.success('观察已记录')
    showObserveModal.value = false
    resetObserveForm()
    await loadAll()
  } catch (e) {
    message.error('记录失败: ' + (e?.message || e))
  } finally {
    observing.value = false
  }
}

async function submitOptimization() {
  optimizing.value = true
  try {
    const parts = [
      `reputation optimize`,
      `-o ${optimizeForm.objective}`,
      `-i ${optimizeForm.iterations}`,
      '--json',
    ]
    const { output } = await ws.execute(parts.join(' '), 60000)
    const err = detectReputationError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    const run = parseRun(output)
    if (!run) {
      message.error('优化失败: ' + output.slice(0, 120))
      return
    }
    showOptimizeModal.value = false
    message.success(`优化完成，最佳分数 ${run.bestScore.toFixed(4)}`)
    await loadAll()
    // Auto-open analytics for the just-completed run
    currentRun.value = run
    showAnalyticsModal.value = true
    await loadAnalyticsForCurrentRun()
  } catch (e) {
    message.error('优化失败: ' + (e?.message || e))
  } finally {
    optimizing.value = false
  }
}

async function applyRun(record) {
  Modal.confirm({
    title: '应用本次优化结果？',
    content: `Run ${record.runId.slice(0, 12)} 的最佳参数将被标记为已应用。`,
    okText: '应用',
    cancelText: '取消',
    onOk: async () => {
      try {
        const { output } = await ws.execute(`reputation apply ${record.runId}`, 8000)
        const err = detectReputationError(output)
        if (err.noDb) {
          message.error('需要先 cc init 初始化项目')
          return
        }
        if (/Failed|Error/i.test(output) && !/Applied/i.test(output)) {
          message.error('应用失败: ' + output.slice(0, 120))
          return
        }
        message.success('已应用')
        await loadAll()
      } catch (e) {
        message.error('应用失败: ' + (e?.message || e))
      }
    },
  })
}

async function viewRunAnalytics(record) {
  currentRun.value = record
  currentAnalytics.value = null
  showAnalyticsModal.value = true
  await loadAnalyticsForCurrentRun()
}

async function loadAnalyticsForCurrentRun() {
  if (!currentRun.value) return
  loadingAnalytics.value = true
  try {
    const { output } = await ws.execute(
      `reputation analytics ${currentRun.value.runId} --json`,
      8000,
    )
    const err = detectReputationError(output)
    if (err.noDb) return
    currentAnalytics.value = parseAnalytics(output)
  } catch (e) {
    void e
  } finally {
    loadingAnalytics.value = false
  }
}

function openAnomaliesModal() {
  anomalyResult.value = null
  showAnomaliesModal.value = true
}

async function runAnomalyDetection() {
  detectingAnomalies.value = true
  try {
    const parts = [
      `reputation anomalies`,
      `-m ${anomalyForm.method}`,
      `-t ${anomalyForm.threshold}`,
      `-d ${anomalyForm.decay}`,
      '--json',
    ]
    const { output } = await ws.execute(parts.join(' '), 10000)
    const err = detectReputationError(output)
    if (err.noDb) {
      message.error('需要先 cc init 初始化项目')
      return
    }
    anomalyResult.value = parseAnomalies(output)
  } catch (e) {
    message.error('检测失败: ' + (e?.message || e))
  } finally {
    detectingAnomalies.value = false
  }
}

function resetObserveForm() {
  observeForm.did = ''
  observeForm.score = 0.8
  observeForm.kind = 'generic'
  observeForm.weight = 1.0
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

.reputation-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* Rank pill (top 3 medal colors) */
.rank-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bg-base);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 12px;
}
.rank-pill.gold {
  background: linear-gradient(135deg, #faad14, #d48806);
  color: #fff;
}
.rank-pill.silver {
  background: linear-gradient(135deg, #d9d9d9, #8c8c8c);
  color: #fff;
}
.rank-pill.bronze {
  background: linear-gradient(135deg, #d4a373, #ad7d4a);
  color: #fff;
}

/* Breakdown rows */
.bd-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

/* Distribution buckets */
.bucket-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.bucket-label {
  min-width: 100px;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-secondary);
}

/* Params modal */
.params-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
}
</style>
