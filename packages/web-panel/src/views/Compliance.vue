<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">合规与威胁情报</h2>
        <p class="page-sub">威胁指标 (IoC) · 用户行为分析 (UEBA)</p>
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
              <a-menu-item key="match"><AimOutlined /> 匹配指标</a-menu-item>
              <a-menu-item key="ueba-build"><DatabaseOutlined /> 构建基线</a-menu-item>
              <a-menu-item key="ueba-analyze"><FundOutlined /> 行为分析</a-menu-item>
              <a-menu-item key="import" disabled>
                <CloudUploadOutlined /> 导入 STIX bundle
                <span style="color: var(--text-muted); font-size: 11px; margin-left: 6px;">(CLI 端)</span>
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="IoC 总数" :value="threatStats.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><SafetyCertificateOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="IoC 类型" :value="threatTypeCount" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><BlockOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="风险实体" :value="uebaTop.length" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="高风险 (≥70)"
            :value="highRiskCount"
            :value-style="{ color: highRiskCount > 0 ? '#ff4d4f' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="近期异常" :value="anomalies.length" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><AlertOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Type breakdown -->
    <a-card
      v-if="threatStats.total > 0"
      title="IoC 类型分布"
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
      <a-tab-pane key="threat" tab="威胁情报">
        <div class="filter-bar">
          <a-radio-group v-model:value="iocTypeFilter" size="small">
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button v-for="t in IOC_TYPES" :key="t" :value="t">{{ t }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="indicatorColumns"
          :data-source="filteredIndicators"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
              <a-popconfirm title="删除该指标？" ok-text="删除" cancel-text="取消" @confirm="removeIndicator(record)">
                <a-button size="small" type="link" danger>删除</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <SafetyCertificateOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无威胁指标。需通过 CLI 导入 STIX bundle: <code style="font-size: 11px;">cc compliance threat-intel import &lt;file.json&gt;</code>
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── UEBA tab ──────────────────────────────────────────────── -->
      <a-tab-pane key="ueba" tab="行为分析 (UEBA)">
        <a-alert
          v-if="uebaError.noAuditLog"
          type="info"
          show-icon
          message="尚无审计日志"
          description="UEBA 基于 audit_log 表的审计事件。先在桌面端或 CLI 触发一些受审计的操作（如 cc auth login / cc note add），再回来运行「构建基线」。"
          style="margin-bottom: 16px;"
        />
        <a-alert
          v-else-if="uebaError.error"
          type="error"
          show-icon
          :message="`UEBA 错误：${uebaError.error}`"
          style="margin-bottom: 16px;"
        />

        <h3 style="color: var(--text-primary); margin: 16px 0 8px; font-size: 14px;">高风险实体 (Top {{ uebaTop.length }})</h3>
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
              {{ uebaError.noAuditLog ? '审计日志为空，无可分析实体' : '暂无风险实体' }}
            </div>
          </template>
        </a-table>

        <h3 v-if="anomalies.length" style="color: var(--text-primary); margin: 24px 0 8px; font-size: 14px;">
          近期异常 ({{ anomalies.length }})
        </h3>
        <a-list v-if="anomalies.length" size="small" :data-source="anomalies" :locale="{ emptyText: '无异常' }">
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
      title="匹配威胁指标"
      :confirm-loading="matching"
      :width="500"
      ok-text="匹配"
      cancel-text="关闭"
      @ok="matchObservable"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="可观测值" required>
          <a-input
            v-model:value="matchForm.observable"
            placeholder="IP / 域名 / URL / 邮箱 / 文件哈希"
            allow-clear
          />
        </a-form-item>
      </a-form>
      <a-card v-if="matchResult" size="small" style="background: var(--bg-base); margin-top: 8px;">
        <a-statistic
          title="匹配结果"
          :value="matchResult.matched ? '命中' : '未命中'"
          :value-style="{ color: matchResult.matched ? '#ff4d4f' : '#52c41a' }"
        />
        <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">
          检测类型: <a-tag :color="iocTypeColor(matchResult.type)">{{ matchResult.type }}</a-tag>
        </div>
        <div v-if="matchResult.indicator" style="margin-top: 12px; font-size: 12px;">
          <div style="color: var(--text-secondary);">来源: {{ matchResult.indicator.sourceName || '—' }}</div>
          <div style="color: var(--text-secondary);">置信度: {{ matchResult.indicator.confidence ?? '—' }}</div>
          <div v-if="matchResult.indicator.labels.length" style="margin-top: 4px;">
            <a-tag v-for="l in matchResult.indicator.labels" :key="l" color="orange" style="font-size: 10px;">{{ l }}</a-tag>
          </div>
        </div>
      </a-card>
    </a-modal>

    <!-- ── UEBA build baseline modal ─────────────────────────────── -->
    <a-modal
      v-model:open="showBuildModal"
      title="构建 UEBA 基线"
      :confirm-loading="building"
      :width="480"
      ok-text="构建"
      cancel-text="取消"
      @ok="buildBaseline"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="实体（可选）">
          <a-input v-model:value="buildForm.entity" placeholder="留空则全量" />
        </a-form-item>
        <a-form-item label="天数">
          <a-input-number v-model:value="buildForm.days" :min="1" :max="365" placeholder="例如 30" style="width: 100%;" />
        </a-form-item>
      </a-form>
      <p style="color: var(--text-secondary); font-size: 12px; margin: 0;">
        从 audit_log 读取最近 N 天的事件，按实体计算事件计数 / 失败率 / 资源覆盖等基线指标。
      </p>
    </a-modal>

    <!-- ── UEBA analyze modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showAnalyzeModal"
      title="运行行为分析"
      :confirm-loading="analyzing"
      :width="480"
      ok-text="分析"
      cancel-text="取消"
      @ok="runAnalyze"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="margin-top: 16px;">
        <a-form-item label="实体（可选）">
          <a-input v-model:value="analyzeForm.entity" placeholder="留空则全量" />
        </a-form-item>
        <a-form-item label="阈值">
          <a-input-number v-model:value="analyzeForm.threshold" :min="0" :max="1" :step="0.05" style="width: 100%;" />
        </a-form-item>
        <a-form-item label="天数">
          <a-input-number v-model:value="analyzeForm.days" :min="1" :max="30" style="width: 100%;" />
        </a-form-item>
      </a-form>
      <p style="color: var(--text-secondary); font-size: 12px; margin: 0;">
        将最近 N 天事件与已存基线对比；分数 ≥ 阈值的事件作为异常输出。
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
  CloudUploadOutlined,
  SafetyCertificateOutlined,
  BlockOutlined,
  UserOutlined,
  WarningOutlined,
  AlertOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
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

const indicatorColumns = [
  { title: '类型', key: 'type', width: '120px' },
  { title: '值', key: 'value' },
  { title: '标签', key: 'labels', width: '160px' },
  { title: '置信度', key: 'confidence', width: '90px' },
  { title: '来源', key: 'source', width: '160px' },
  { title: '最近见到', key: 'lastSeen', width: '160px' },
  { title: '操作', key: 'action', width: '90px' },
]

const uebaColumns = [
  { title: '实体', key: 'entity', width: '180px' },
  { title: '风险分', key: 'riskScore' },
  { title: '事件数', key: 'eventCount', width: '90px' },
  { title: '失败率', key: 'failureRate', width: '90px' },
  { title: '资源数', key: 'uniqueResources', width: '90px' },
  { title: '突发度', key: 'burstiness', width: '90px' },
]

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
    message.error('加载合规数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function matchObservable() {
  const obs = matchForm.observable.trim()
  if (!obs) {
    message.warning('请输入要匹配的可观测值')
    return
  }
  matching.value = true
  matchResult.value = null
  try {
    const cmd = `compliance threat-intel match "${obs.replace(/"/g, '\\"')}" --json`
    const { output } = await ws.execute(cmd, 8000)
    const parsed = parseMatchResult(output)
    if (!parsed) {
      message.error('匹配失败: ' + output.slice(0, 120))
      return
    }
    matchResult.value = parsed
    if (parsed.matched) {
      message.warning(`命中威胁指标 (${parsed.type})`)
    } else if (parsed.type === 'unknown') {
      message.info('无法识别该可观测值类型')
    } else {
      message.success(`未命中（已识别为 ${parsed.type}）`)
    }
  } catch (e) {
    message.error('匹配失败: ' + (e?.message || e))
  } finally {
    matching.value = false
  }
}

async function removeIndicator(record) {
  try {
    const cmd = `compliance threat-intel remove ${record.type} "${record.value.replace(/"/g, '\\"')}" --json`
    const { output } = await ws.execute(cmd, 8000)
    if (/error|失败/i.test(output) && !/"removed"/.test(output)) {
      message.error('删除失败: ' + output.slice(0, 120))
      return
    }
    message.success('指标已删除')
    await loadAll()
  } catch (e) {
    message.error('删除失败: ' + (e?.message || e))
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
      message.warning('audit_log 表为空，无法构建基线')
      showBuildModal.value = false
      return
    }
    if (err.error) {
      message.error('构建失败: ' + err.error)
      return
    }
    message.success('基线已构建')
    showBuildModal.value = false
    activeTab.value = 'ueba'
    await loadAll()
  } catch (e) {
    message.error('构建失败: ' + (e?.message || e))
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
      message.warning('audit_log 表为空，无可分析事件')
      showAnalyzeModal.value = false
      return
    }
    if (err.error && !output.includes('[')) {
      message.error('分析失败: ' + err.error)
      return
    }
    anomalies.value = parseAnomalies(output)
    message.success(`分析完成，发现 ${anomalies.value.length} 个异常`)
    showAnalyzeModal.value = false
    activeTab.value = 'ueba'
  } catch (e) {
    message.error('分析失败: ' + (e?.message || e))
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
