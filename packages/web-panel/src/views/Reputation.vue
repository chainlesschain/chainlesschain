<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('reputation.title') }}</h2>
        <p class="page-sub">{{ t('reputation.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ t('reputation.refresh') }}
        </a-button>
        <a-button @click="openAnomaliesModal">
          <template #icon><WarningOutlined /></template>
          {{ t('reputation.actions.anomalies') }}
        </a-button>
        <a-button type="primary" @click="showOptimizeModal = true">
          <template #icon><ThunderboltOutlined /></template>
          {{ t('reputation.actions.optimize') }}
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      :message="t('reputation.noDb.message')"
      :description="t('reputation.noDb.description')"
      style="margin-bottom: 16px;"
    />

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('reputation.stats.trackedDids')" :value="stats.observations.totalDids" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('reputation.stats.totalObservations')" :value="stats.observations.totalObservations" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><EyeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('reputation.stats.optimizationRuns')" :value="stats.totalRuns" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><ExperimentOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('reputation.stats.active')"
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
            :title="t('reputation.stats.bestEver')"
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
      <a-tab-pane key="scores" :tab="t('reputation.tabs.scores')">
        <div class="filter-bar">
          <span style="color: var(--text-secondary); font-size: 12px;">{{ t('reputation.filter.decayLabel') }}</span>
          <a-radio-group v-model:value="decayFilter" size="small" button-style="solid" @change="loadScores">
            <a-radio-button v-for="d in DECAY_MODELS" :key="d" :value="d">{{ decayLabel(d) }}</a-radio-button>
          </a-radio-group>
          <a-button size="small" @click="showObserveModal = true">
            <template #icon><PlusOutlined /></template>
            {{ t('reputation.filter.addObservation') }}
          </a-button>
        </div>

        <a-table
          :columns="scoreColumns"
          :data-source="scores"
          :pagination="{ pageSize: 20, showTotal: (count) => t('reputation.totals.dids', { count }) }"
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
              {{ t('reputation.empty.scores') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Runs tab ────────────────────────────────────────────── -->
      <a-tab-pane key="runs" :tab="t('reputation.tabs.runs')">
        <a-table
          :columns="runColumns"
          :data-source="runs"
          :pagination="{ pageSize: 20, showTotal: (count) => t('reputation.totals.rows', { count }) }"
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
              <a-button size="small" type="link" @click="viewRunAnalytics(record)">{{ t('reputation.rowActions.analyze') }}</a-button>
              <a-button v-if="record.status === 'complete'" size="small" type="link" style="color: #52c41a;" @click="applyRun(record)">{{ t('reputation.rowActions.apply') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ExperimentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ t('reputation.empty.runs') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Breakdown tab ───────────────────────────────────────── -->
      <a-tab-pane key="breakdown" :tab="t('reputation.tabs.breakdown')">
        <a-row :gutter="[16, 16]">
          <a-col :xs="24" :lg="12">
            <a-card :title="t('reputation.breakdown.byStatus')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
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
            <a-card :title="t('reputation.breakdown.byObjective')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
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
      :title="t('reputation.observe.title')"
      :confirm-loading="observing"
      :width="540"
      :ok-text="t('reputation.observe.ok')"
      :cancel-text="t('common.cancel')"
      @ok="submitObservation"
      @cancel="resetObserveForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="t('reputation.observe.didLabel')" required>
          <a-input v-model:value="observeForm.did" :placeholder="t('reputation.observe.didPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('reputation.observe.scoreLabel')" required>
          <a-input-number v-model:value="observeForm.score" :min="0" :max="1" :step="0.05" style="width: 160px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">{{ t('reputation.observe.scoreRange') }}</span>
        </a-form-item>
        <a-form-item :label="t('reputation.observe.kindLabel')">
          <a-select v-model:value="observeForm.kind">
            <a-select-option v-for="k in OBSERVATION_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="t('reputation.observe.weightLabel')">
          <a-input-number v-model:value="observeForm.weight" :min="0.1" :step="0.1" style="width: 120px;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Optimize modal ─────────────────────────────────────── -->
    <a-modal
      v-model:open="showOptimizeModal"
      :title="t('reputation.optimize.title')"
      :confirm-loading="optimizing"
      :width="540"
      :ok-text="t('reputation.optimize.ok')"
      :cancel-text="t('common.cancel')"
      @ok="submitOptimization"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="t('reputation.optimize.objectiveLabel')" required>
          <a-select v-model:value="optimizeForm.objective">
            <a-select-option v-for="o in OPTIMIZATION_OBJECTIVES" :key="o" :value="o">{{ objectiveLabel(o) }}</a-select-option>
          </a-select>
          <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">{{ objectiveDesc(optimizeForm.objective) }}</div>
        </a-form-item>
        <a-form-item :label="t('reputation.optimize.iterationsLabel')">
          <a-input-number v-model:value="optimizeForm.iterations" :min="1" :max="1000" :step="10" style="width: 160px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">{{ t('reputation.optimize.iterationsRange') }}</span>
        </a-form-item>
      </a-form>
      <a-alert
        type="info"
        show-icon
        :message="t('reputation.optimize.syncMessage')"
        :description="t('reputation.optimize.syncDescription')"
        style="margin-top: 12px;"
      />
    </a-modal>

    <!-- ── Anomaly detection modal ────────────────────────────── -->
    <a-modal
      v-model:open="showAnomaliesModal"
      :title="t('reputation.anomaly.title')"
      :width="640"
      :footer="null"
    >
      <div style="padding-top: 8px;">
        <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }">
          <a-form-item :label="t('reputation.anomaly.methodLabel')">
            <a-radio-group v-model:value="anomalyForm.method" button-style="solid">
              <a-radio-button v-for="m in ANOMALY_METHODS" :key="m" :value="m">{{ m === 'z_score' ? t('reputation.anomaly.zScoreLabel') : t('reputation.anomaly.iqrLabel') }}</a-radio-button>
            </a-radio-group>
          </a-form-item>
          <a-form-item :label="t('reputation.anomaly.thresholdLabel')">
            <a-input-number v-model:value="anomalyForm.threshold" :min="0.5" :step="0.1" style="width: 120px;" />
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">{{ t('reputation.anomaly.thresholdHint') }}</span>
          </a-form-item>
          <a-form-item :label="t('reputation.anomaly.decayLabel')">
            <a-select v-model:value="anomalyForm.decay" style="width: 200px;">
              <a-select-option v-for="d in DECAY_MODELS" :key="d" :value="d">{{ decayLabel(d) }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :wrapper-col="{ offset: 5, span: 19 }">
            <a-button type="primary" :loading="detectingAnomalies" @click="runAnomalyDetection">
              <template #icon><WarningOutlined /></template>
              {{ t('reputation.anomaly.start') }}
            </a-button>
          </a-form-item>
        </a-form>

        <a-divider />

        <a-empty v-if="!anomalyResult" :description="t('reputation.anomaly.notDetected')" :image="EMPTY_IMG" />
        <div v-else>
          <a-row :gutter="12" style="margin-bottom: 12px;">
            <a-col :span="8"><a-statistic :title="t('reputation.anomaly.totalSamples')" :value="anomalyResult.totalSamples" :value-style="{ fontSize: '16px' }" /></a-col>
            <a-col :span="8"><a-statistic :title="t('reputation.anomaly.threshold')" :value="anomalyResult.threshold" :precision="2" :value-style="{ fontSize: '16px' }" /></a-col>
            <a-col :span="8"><a-statistic :title="t('reputation.anomaly.anomalies')" :value="anomalyResult.anomalies.length" :value-style="{ color: anomalyResult.anomalies.length > 0 ? '#ff4d4f' : '#52c41a', fontSize: '16px' }" /></a-col>
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
                <a-tag color="red" style="margin-left: 8px;">{{ t('reputation.anomaly.scoreTag', { score: item.score.toFixed(4) }) }}</a-tag>
                <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">{{ item.reason }}</span>
                <span v-if="item.zScore !== null" style="margin-left: 8px; color: var(--text-muted); font-size: 11px;">{{ t('reputation.anomaly.zNote', { value: item.zScore.toFixed(2) }) }}</span>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </div>
    </a-modal>

    <!-- ── Run analytics / details modal ──────────────────────── -->
    <a-modal
      v-model:open="showAnalyticsModal"
      :title="t('reputation.analytics.title', { runId: currentRun?.runId?.slice(0, 12) || '' })"
      :width="780"
      :footer="null"
    >
      <div v-if="currentRun" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="t('reputation.analytics.objective')">
            <a-tag :color="objectiveColor(currentRun.objective)">{{ objectiveLabel(currentRun.objective) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="t('reputation.analytics.status')">
            <a-tag :color="statusColor(currentRun.status)">{{ statusLabel(currentRun.status) }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="t('reputation.analytics.iterations')">{{ currentRun.iterations }}</a-descriptions-item>
          <a-descriptions-item :label="t('reputation.analytics.bestScore')">
            <span :style="{ color: scoreColor(currentRun.bestScore), fontWeight: 500, fontFamily: 'monospace' }">
              {{ currentRun.bestScore.toFixed(4) }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('reputation.analytics.createdAt')">{{ formatReputationTime(currentRun.createdAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentRun.completedAt" :label="t('reputation.analytics.completedAt')">{{ formatReputationTime(currentRun.completedAt) }}</a-descriptions-item>
          <a-descriptions-item v-if="currentRun.bestParams" :label="t('reputation.analytics.bestParams')" :span="2">
            <pre class="params-pre">{{ formatParams(currentRun.bestParams) }}</pre>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentRun.errorMessage" :label="t('reputation.analytics.errorMessage')" :span="2">
            <span style="color: #ff4d4f;">{{ currentRun.errorMessage }}</span>
          </a-descriptions-item>
        </a-descriptions>

        <a-spin :spinning="loadingAnalytics">
          <div v-if="currentAnalytics" style="margin-top: 16px;">
            <h4 style="color: var(--text-primary); font-size: 13px; margin: 0 0 10px;">{{ t('reputation.analytics.distributionTitle') }}</h4>
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
                {{ t('reputation.analytics.mean', { value: currentAnalytics.reputationDistribution.mean.toFixed(4) }) }}
                <span v-if="currentAnalytics.reputationDistribution.stdDev !== null" style="margin-left: 12px;">
                  {{ t('reputation.analytics.stdDev', { value: currentAnalytics.reputationDistribution.stdDev.toFixed(4) }) }}
                </span>
              </div>
            </a-card>

            <a-card v-if="currentAnalytics.recommendations.length" :title="t('reputation.analytics.recommendations')" size="small">
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
import { ref, onMounted, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
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

const scoreColumns = computed(() => [
  { title: t('reputation.scoreColumns.rank'), key: 'rank', width: '60px' },
  { title: t('reputation.scoreColumns.did'), key: 'did' },
  { title: t('reputation.scoreColumns.score'), key: 'score', width: '220px' },
  { title: t('reputation.scoreColumns.observations'), key: 'observations', width: '100px' },
  { title: t('reputation.scoreColumns.weightTotal'), key: 'weightTotal', width: '100px' },
])

const runColumns = computed(() => [
  { title: t('reputation.runColumns.runId'), key: 'runId', width: '140px' },
  { title: t('reputation.runColumns.objective'), key: 'objective', width: '140px' },
  { title: t('reputation.runColumns.iterations'), key: 'iterations', width: '80px' },
  { title: t('reputation.runColumns.bestScore'), key: 'bestScore', width: '110px' },
  { title: t('reputation.runColumns.status'), key: 'status', width: '100px' },
  { title: t('reputation.runColumns.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('reputation.runColumns.action'), key: 'action', width: '160px' },
])

function decayLabel(d) {
  const key = `reputation.decay.${d}`
  const v = t(key)
  return v === key ? d : v
}
function kindLabel(k) {
  const key = `reputation.kind.${k}`
  const v = t(key)
  return v === key ? k : v
}
function objectiveLabel(o) {
  const key = `reputation.objective.${o}`
  const v = t(key)
  return v === key ? o : v
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
  const key = `reputation.objectiveDesc.${o}`
  const v = t(key)
  return v === key ? '' : v
}

function statusLabel(s) {
  const key = `reputation.status.${s}`
  const v = t(key)
  return v === key ? s : v
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
    message.error(t('reputation.messages.loadFailed', { err: e?.message || e }))
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
    message.error(t('reputation.messages.loadScoresFailed', { err: e?.message || e }))
  }
}

async function submitObservation() {
  if (!observeForm.did.trim()) {
    message.warning(t('reputation.messages.didRequired'))
    return
  }
  if (observeForm.score < 0 || observeForm.score > 1) {
    message.warning(t('reputation.messages.scoreRange'))
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
      message.error(t('reputation.messages.needInit'))
      return
    }
    if (!/"did"/.test(output)) {
      message.error(t('reputation.messages.observeFailed', { err: output.slice(0, 120) }))
      return
    }
    message.success(t('reputation.messages.observeOk'))
    showObserveModal.value = false
    resetObserveForm()
    await loadAll()
  } catch (e) {
    message.error(t('reputation.messages.observeFailed', { err: e?.message || e }))
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
      message.error(t('reputation.messages.needInit'))
      return
    }
    const run = parseRun(output)
    if (!run) {
      message.error(t('reputation.messages.optimizeFailed', { err: output.slice(0, 120) }))
      return
    }
    showOptimizeModal.value = false
    message.success(t('reputation.messages.optimizeOk', { score: run.bestScore.toFixed(4) }))
    await loadAll()
    // Auto-open analytics for the just-completed run
    currentRun.value = run
    showAnalyticsModal.value = true
    await loadAnalyticsForCurrentRun()
  } catch (e) {
    message.error(t('reputation.messages.optimizeFailed', { err: e?.message || e }))
  } finally {
    optimizing.value = false
  }
}

async function applyRun(record) {
  Modal.confirm({
    title: t('reputation.applyConfirm.title'),
    content: t('reputation.applyConfirm.content', { runId: record.runId.slice(0, 12) }),
    okText: t('reputation.applyConfirm.ok'),
    cancelText: t('reputation.applyConfirm.cancel'),
    onOk: async () => {
      try {
        const { output } = await ws.execute(`reputation apply ${record.runId}`, 8000)
        const err = detectReputationError(output)
        if (err.noDb) {
          message.error(t('reputation.messages.needInit'))
          return
        }
        if (/Failed|Error/i.test(output) && !/Applied/i.test(output)) {
          message.error(t('reputation.messages.applyFailed', { err: output.slice(0, 120) }))
          return
        }
        message.success(t('reputation.messages.applyOk'))
        await loadAll()
      } catch (e) {
        message.error(t('reputation.messages.applyFailed', { err: e?.message || e }))
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
      message.error(t('reputation.messages.needInit'))
      return
    }
    anomalyResult.value = parseAnomalies(output)
  } catch (e) {
    message.error(t('reputation.messages.detectFailed', { err: e?.message || e }))
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
