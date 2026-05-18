<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('compliance.title') }}</h2>
        <p class="page-sub">{{ $t('compliance.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('compliance.refresh') }}
        </a-button>
        <a-dropdown :trigger="['click']">
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ $t('compliance.actionDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu @click="handleNewClick">
              <a-menu-item key="match"><AimOutlined /> {{ $t('compliance.actions.match') }}</a-menu-item>
              <a-menu-item key="ueba-build"><DatabaseOutlined /> {{ $t('compliance.actions.uebaBuild') }}</a-menu-item>
              <a-menu-item key="ueba-analyze"><FundOutlined /> {{ $t('compliance.actions.uebaAnalyze') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('compliance.stats.iocTotal')" :value="threatStats.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><SafetyCertificateOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('compliance.stats.iocTypes')" :value="threatTypeCount" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><BlockOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('compliance.stats.riskEntities')" :value="uebaTop.length" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('compliance.stats.highRisk')"
            :value="highRiskCount"
            :value-style="{ color: highRiskCount > 0 ? '#ff4d4f' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('compliance.stats.recentAnomalies')" :value="anomalies.length" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><AlertOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Type breakdown -->
    <a-card
      v-if="threatStats.total > 0"
      :title="$t('compliance.typeBreakdown')"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-space :size="[12, 8]" wrap>
        <a-tag v-for="[t, n] in typeBreakdown" :key="t" :color="iocTypeColor(t)">
          {{ t }}: {{ n }}
        </a-tag>
      </a-space>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="compliance-tabs">
      <!-- ── Threat Intel tab ──────────────────────────────────────── -->
      <a-tab-pane key="threat" :tab="$t('compliance.tabs.threat')">
        <div class="filter-bar">
          <a-radio-group v-model:value="iocTypeFilter" size="small">
            <a-radio-button value="">{{ $t('compliance.filter.all') }}</a-radio-button>
            <a-radio-button v-for="t in IOC_TYPES" :key="t" :value="t">{{ t }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="indicatorColumns"
          :data-source="filteredIndicators"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('compliance.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <a-tag :color="iocTypeColor(record.type)" style="font-family: monospace;">{{ record.type }}</a-tag>
            </template>
            <template v-if="column.key === 'value'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px; word-break: break-all;">
                {{ truncate(record.value, 64) }}
              </span>
            </template>
            <template v-if="column.key === 'labels'">
              <a-tag v-for="l in record.labels" :key="l" color="orange" style="font-size: 10px; margin: 1px;">{{ l }}</a-tag>
              <span v-if="!record.labels.length" style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'confidence'">
              <span v-if="record.confidence != null" :style="{ color: confidenceColor(record.confidence), fontWeight: 500 }">
                {{ record.confidence }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'source'">
              <span v-if="record.sourceName" style="color: var(--text-secondary); font-size: 12px;">{{ record.sourceName }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'lastSeen'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatComplianceTime(record.lastSeenAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-popconfirm
                :title="$t('compliance.table.deleteConfirm')"
                :ok-text="$t('compliance.table.deleteOk')"
                :cancel-text="$t('compliance.table.cancel')"
                @confirm="removeIndicator(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('compliance.table.delete') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <SafetyCertificateOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('compliance.table.emptyThreatsLine1') }} <code style="font-size: 11px;">cc compliance threat-intel import &lt;file.json&gt;</code>
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── UEBA tab ──────────────────────────────────────────────── -->
      <a-tab-pane key="ueba" :tab="$t('compliance.tabs.ueba')">
        <a-alert
          v-if="uebaError.noAuditLog"
          type="info"
          show-icon
          :message="$t('compliance.ueba.noAuditLog')"
          :description="$t('compliance.ueba.noAuditLogDesc')"
          style="margin-bottom: 16px;"
        />
        <a-alert
          v-else-if="uebaError.error"
          type="error"
          show-icon
          :message="$t('compliance.ueba.errorMessage', { err: uebaError.error })"
          style="margin-bottom: 16px;"
        />

        <h3 style="color: var(--text-primary); margin: 16px 0 8px; font-size: 14px;">{{ $t('compliance.ueba.topRiskTitle', { count: uebaTop.length }) }}</h3>
        <a-table
          :columns="uebaColumns"
          :data-source="uebaTop"
          :pagination="false"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'entity'">
              <span style="color: var(--text-primary); font-family: monospace; font-weight: 500;">{{ record.entity }}</span>
            </template>
            <template v-if="column.key === 'riskScore'">
              <a-progress
                :percent="Math.min(record.riskScore, 100)"
                :stroke-color="riskColor(record.riskScore)"
                size="small"
                :format="() => record.riskScore.toFixed(1)"
              />
            </template>
            <template v-if="column.key === 'eventCount'">
              <span style="color: var(--text-secondary);">{{ record.eventCount }}</span>
            </template>
            <template v-if="column.key === 'failureRate'">
              <span :style="{ color: record.failureRate > 0.3 ? '#ff4d4f' : 'var(--text-secondary)', fontFamily: 'monospace' }">
                {{ (record.failureRate * 100).toFixed(1) }}%
              </span>
            </template>
            <template v-if="column.key === 'uniqueResources'">
              <a-tag color="cyan" style="font-size: 11px;">{{ record.uniqueResources }}</a-tag>
            </template>
            <template v-if="column.key === 'burstiness'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ (record.burstiness * 100).toFixed(0) }}%
              </span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 30px; color: var(--text-muted); text-align: center;">
              <UserOutlined style="font-size: 32px; margin-bottom: 8px; display: block;" />
              {{ uebaError.noAuditLog ? $t('compliance.table.emptyAuditEntities') : $t('compliance.table.emptyRiskEntities') }}
            </div>
          </template>
        </a-table>

        <h3 v-if="anomalies.length" style="color: var(--text-primary); margin: 24px 0 8px; font-size: 14px;">
          {{ $t('compliance.ueba.anomalyTitle', { count: anomalies.length }) }}
        </h3>
        <a-list v-if="anomalies.length" size="small" :data-source="anomalies" :locale="{ emptyText: $t('compliance.table.noAnomalies') }">
          <template #renderItem="{ item }">
            <a-list-item style="background: var(--bg-card); padding: 10px 16px;">
              <div style="flex: 1;">
                <div style="display: flex; gap: 8px; align-items: center;">
                  <a-tag :color="riskColor(item.score * 100)">score {{ item.score.toFixed(2) }}</a-tag>
                  <span v-if="item.event?.entity" style="color: var(--text-primary); font-family: monospace; font-size: 12px;">
                    {{ item.event.entity }}
                  </span>
                  <span v-if="item.event?.action" style="color: var(--text-secondary); font-size: 11px;">
                    → {{ item.event.action }}
                  </span>
                </div>
                <div v-if="item.reasons.length" style="margin-top: 4px;">
                  <a-tag v-for="r in item.reasons" :key="r" color="volcano" style="font-size: 10px; margin: 1px;">{{ r }}</a-tag>
                </div>
              </div>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Match modal ───────────────────────────────────────────── -->
    <a-modal
      v-model:open="showMatchModal"
      :title="$t('compliance.match.modalTitle')"
      :confirm-loading="matching"
      :width="500"
      :ok-text="$t('compliance.match.ok')"
      :cancel-text="$t('compliance.match.close')"
      @ok="matchObservable"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('compliance.match.label')" required>
          <a-input
            v-model:value="matchForm.observable"
            :placeholder="$t('compliance.match.placeholder')"
            allow-clear
          />
        </a-form-item>
      </a-form>
      <a-card v-if="matchResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <a-statistic
          :title="$t('compliance.match.result')"
          :value="matchResult.matched ? $t('compliance.match.hit') : $t('compliance.match.miss')"
          :value-style="{ color: matchResult.matched ? '#ff4d4f' : '#52c41a' }"
        />
        <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">
          {{ $t('compliance.match.detectType') }} <a-tag :color="iocTypeColor(matchResult.type)">{{ matchResult.type }}</a-tag>
        </div>
        <div v-if="matchResult.indicator" style="margin-top: 12px; font-size: 12px;">
          <div style="color: var(--text-secondary);">{{ $t('compliance.match.sourcePrefix') }} {{ matchResult.indicator.sourceName || '—' }}</div>
          <div style="color: var(--text-secondary);">{{ $t('compliance.match.confidencePrefix') }} {{ matchResult.indicator.confidence ?? '—' }}</div>
          <div v-if="matchResult.indicator.labels.length" style="margin-top: 4px;">
            <a-tag v-for="l in matchResult.indicator.labels" :key="l" color="orange" style="font-size: 10px;">{{ l }}</a-tag>
          </div>
        </div>
      </a-card>
    </a-modal>

    <!-- ── UEBA build baseline modal ─────────────────────────────── -->
    <a-modal
      v-model:open="showBuildModal"
      :title="$t('compliance.build.modalTitle')"
      :confirm-loading="building"
      :width="480"
      :ok-text="$t('compliance.build.ok')"
      :cancel-text="$t('compliance.build.cancel')"
      @ok="buildBaseline"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item :label="$t('compliance.build.entityLabel')">
          <a-input v-model:value="buildForm.entity" :placeholder="$t('compliance.build.entityPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('compliance.build.daysLabel')">
          <a-input-number v-model:value="buildForm.days" :min="1" :max="365" :placeholder="$t('compliance.build.daysPlaceholder')" style="width: 100%;" />
        </a-form-item>
      </a-form>
      <p style="color: var(--text-secondary); font-size: 12px; margin: 0;">
        {{ $t('compliance.build.footnote') }}
      </p>
    </a-modal>

    <!-- ── UEBA analyze modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showAnalyzeModal"
      :title="$t('compliance.analyze.modalTitle')"
      :confirm-loading="analyzing"
      :width="480"
      :ok-text="$t('compliance.analyze.ok')"
      :cancel-text="$t('compliance.analyze.cancel')"
      @ok="runAnalyze"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item :label="$t('compliance.analyze.entityLabel')">
          <a-input v-model:value="analyzeForm.entity" :placeholder="$t('compliance.analyze.entityPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('compliance.analyze.thresholdLabel')">
          <a-input-number v-model:value="analyzeForm.threshold" :min="0" :max="1" :step="0.05" style="width: 100%;" />
        </a-form-item>
        <a-form-item :label="$t('compliance.analyze.daysLabel')">
          <a-input-number v-model:value="analyzeForm.days" :min="1" :max="30" style="width: 100%;" />
        </a-form-item>
      </a-form>
      <p style="color: var(--text-secondary); font-size: 12px; margin: 0;">
        {{ $t('compliance.analyze.footnote') }}
      </p>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  AimOutlined,
  DatabaseOutlined,
  FundOutlined,
  SafetyCertificateOutlined,
  BlockOutlined,
  UserOutlined,
  WarningOutlined,
  AlertOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parseIndicators,
  parseMatchResult,
  parseThreatIntelStats,
  parseUebaTop,
  parseAnomalies,
  detectUebaError,
  formatComplianceTime,
  IOC_TYPES,
} from '../utils/compliance-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const loading = ref(false)
const matching = ref(false)
const building = ref(false)
const analyzing = ref(false)

const indicators = ref([])
const threatStats = ref({ total: 0, byType: {} })
const uebaTop = ref([])
const anomalies = ref([])
const uebaError = ref({ noAuditLog: false, error: '' })

const activeTab = ref('threat')
const iocTypeFilter = ref('')

const showMatchModal = ref(false)
const showBuildModal = ref(false)
const showAnalyzeModal = ref(false)

const matchForm = reactive({ observable: '' })
const matchResult = ref(null)
const buildForm = reactive({ entity: '', days: 30 })
const analyzeForm = reactive({ entity: '', threshold: 0.7, days: 1 })

// computed() so column titles re-render when the user toggles locale.
const indicatorColumns = computed(() => [
  { title: t('compliance.cols.type'), key: 'type', width: '120px' },
  { title: t('compliance.cols.value'), key: 'value' },
  { title: t('compliance.cols.labels'), key: 'labels', width: '160px' },
  { title: t('compliance.cols.confidence'), key: 'confidence', width: '90px' },
  { title: t('compliance.cols.source'), key: 'source', width: '160px' },
  { title: t('compliance.cols.lastSeen'), key: 'lastSeen', width: '160px' },
  { title: t('compliance.cols.action'), key: 'action', width: '90px' },
])

const uebaColumns = computed(() => [
  { title: t('compliance.cols.entity'), key: 'entity', width: '180px' },
  { title: t('compliance.cols.riskScore'), key: 'riskScore' },
  { title: t('compliance.cols.eventCount'), key: 'eventCount', width: '90px' },
  { title: t('compliance.cols.failureRate'), key: 'failureRate', width: '90px' },
  { title: t('compliance.cols.uniqueResources'), key: 'uniqueResources', width: '90px' },
  { title: t('compliance.cols.burstiness'), key: 'burstiness', width: '90px' },
])

const filteredIndicators = computed(() => {
  if (!iocTypeFilter.value) return indicators.value
  return indicators.value.filter(i => i.type === iocTypeFilter.value)
})

const threatTypeCount = computed(() => Object.keys(threatStats.value.byType).length)

const typeBreakdown = computed(() =>
  Object.entries(threatStats.value.byType).sort((a, b) => b[1] - a[1]),
)

const highRiskCount = computed(() => uebaTop.value.filter(e => e.riskScore >= 70).length)

const IOC_TYPE_COLORS = {
  'ipv4': 'blue', 'ipv6': 'cyan', 'domain': 'purple', 'url': 'magenta', 'email': 'gold',
  'file-md5': 'orange', 'file-sha1': 'orange', 'file-sha256': 'red', 'file-sha512': 'red',
  'unknown': 'default',
}
function iocTypeColor(t) { return IOC_TYPE_COLORS[t] || 'default' }

function confidenceColor(c) {
  if (c >= 80) return '#ff4d4f'
  if (c >= 50) return '#faad14'
  return '#52c41a'
}

function riskColor(score) {
  if (score >= 70) return '#ff4d4f'
  if (score >= 40) return '#faad14'
  return '#52c41a'
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function handleNewClick({ key }) {
  if (key === 'match') {
    matchResult.value = null
    showMatchModal.value = true
  } else if (key === 'ueba-build') showBuildModal.value = true
  else if (key === 'ueba-analyze') showAnalyzeModal.value = true
}

async function loadAll() {
  loading.value = true
  try {
    const [listRes, statsRes, topRes] = await Promise.all([
      ws.execute('compliance threat-intel list --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('compliance threat-intel stats --json', 8000).catch(() => ({ output: '' })),
      ws.execute('compliance ueba top --top-k 20 --json', 10000).catch(() => ({ output: '' })),
    ])
    indicators.value = parseIndicators(listRes.output)
    threatStats.value = parseThreatIntelStats(statsRes.output)
    uebaError.value = detectUebaError(topRes.output)
    uebaTop.value = uebaError.value.noAuditLog ? [] : parseUebaTop(topRes.output)
    // Anomalies are loaded separately on demand (analyze) since they
    // require a baseline build first; just keep cached results.
  } catch (e) {
    message.error(t('compliance.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function matchObservable() {
  const obs = matchForm.observable.trim()
  if (!obs) {
    message.warning(t('compliance.msg.matchEmpty'))
    return
  }
  matching.value = true
  matchResult.value = null
  try {
    const cmd = `compliance threat-intel match "${obs.replace(/"/g, '\\"')}" --json`
    const { output } = await ws.execute(cmd, 8000)
    const parsed = parseMatchResult(output)
    if (!parsed) {
      message.error(t('compliance.msg.matchFailed') + ': ' + output.slice(0, 120))
      return
    }
    matchResult.value = parsed
    if (parsed.matched) {
      message.warning(t('compliance.msg.matchHit', { type: parsed.type }))
    } else if (parsed.type === 'unknown') {
      message.info(t('compliance.msg.matchUnknownType'))
    } else {
      message.success(t('compliance.msg.matchMiss', { type: parsed.type }))
    }
  } catch (e) {
    message.error(t('compliance.msg.matchFailed') + ': ' + (e?.message || e))
  } finally {
    matching.value = false
  }
}

async function removeIndicator(record) {
  try {
    const cmd = `compliance threat-intel remove ${record.type} "${record.value.replace(/"/g, '\\"')}" --json`
    const { output } = await ws.execute(cmd, 8000)
    if (/error|失败/i.test(output) && !/"removed"/.test(output)) {
      message.error(t('compliance.msg.deleteFailed') + ': ' + output.slice(0, 120))
      return
    }
    message.success(t('compliance.msg.deleteSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('compliance.msg.deleteFailed') + ': ' + (e?.message || e))
  }
}

async function buildBaseline() {
  building.value = true
  try {
    const parts = ['compliance ueba baseline']
    if (buildForm.entity.trim()) parts.push(`--entity "${buildForm.entity.trim().replace(/"/g, '\\"')}"`)
    if (buildForm.days != null) parts.push(`--days ${buildForm.days}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 30000)
    const err = detectUebaError(output)
    if (err.noAuditLog) {
      uebaError.value = err
      message.warning(t('compliance.msg.auditEmptyBuild'))
      showBuildModal.value = false
      return
    }
    if (err.error) {
      message.error(t('compliance.msg.buildFailed') + ': ' + err.error)
      return
    }
    message.success(t('compliance.msg.buildSuccess'))
    showBuildModal.value = false
    activeTab.value = 'ueba'
    await loadAll()
  } catch (e) {
    message.error(t('compliance.msg.buildFailed') + ': ' + (e?.message || e))
  } finally {
    building.value = false
  }
}

async function runAnalyze() {
  analyzing.value = true
  try {
    const parts = ['compliance ueba analyze']
    if (analyzeForm.entity.trim()) parts.push(`--entity "${analyzeForm.entity.trim().replace(/"/g, '\\"')}"`)
    if (analyzeForm.threshold != null) parts.push(`--threshold ${analyzeForm.threshold}`)
    if (analyzeForm.days != null) parts.push(`--days ${analyzeForm.days}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 30000)
    const err = detectUebaError(output)
    if (err.noAuditLog) {
      uebaError.value = err
      message.warning(t('compliance.msg.auditEmptyAnalyze'))
      showAnalyzeModal.value = false
      return
    }
    if (err.error && !output.includes('[')) {
      message.error(t('compliance.msg.analyzeFailed') + ': ' + err.error)
      return
    }
    anomalies.value = parseAnomalies(output)
    message.success(t('compliance.msg.analyzeSuccess', { n: anomalies.value.length }))
    showAnalyzeModal.value = false
    activeTab.value = 'ueba'
  } catch (e) {
    message.error(t('compliance.msg.analyzeFailed') + ': ' + (e?.message || e))
  } finally {
    analyzing.value = false
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

.compliance-tabs :deep(.ant-tabs-nav) {
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
