<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('mtc.title') }}</h2>
        <p class="page-sub">
          {{ t('mtc.subtitle') }}
        </p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadStatus">
          <template #icon><ReloadOutlined /></template>
          {{ t('mtc.refresh') }}
        </a-button>
      </a-space>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="mtc-tabs">
      <!-- ── Tab 1: Audit MTC status ────────────────────────────── -->
      <a-tab-pane key="status" :tab="t('mtc.tabs.status')">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.enabledLabel')"
                :value="status.config.enabled ? t('mtc.status.enabled') : t('mtc.status.disabled')"
                :value-style="{ color: status.config.enabled ? '#52c41a' : '#888', fontSize: '20px' }"
              >
                <template #prefix>
                  <component :is="status.config.enabled ? CheckCircleOutlined : InfoCircleOutlined" />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.intervalLabel')"
                :value="formatBatchInterval(status.config.batch_interval_seconds)"
                :value-style="{ color: '#1677ff', fontSize: '20px' }"
              >
                <template #prefix><ClockCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.stagingLabel')"
                :value="status.staging.count"
                :value-style="{ color: status.staging.count > 0 ? '#faad14' : '#888', fontSize: '20px' }"
              >
                <template #prefix><InboxOutlined /></template>
                <template v-if="status.staging.malformed > 0" #suffix>
                  <a-tag color="red" style="margin-left: 8px;">{{ t('mtc.status.stagingMalformed', { count: status.staging.malformed }) }}</a-tag>
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.totalBatches')"
                :value="status.batches.count"
                :value-style="{ color: '#13c2c2', fontSize: '20px' }"
              >
                <template #prefix><DatabaseOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <a-card :title="t('mtc.status.configCard')" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-descriptions :column="{ xs: 1, sm: 2 }" size="small">
            <a-descriptions-item label="namespace">
              <span style="font-family: monospace;">{{ status.config.namespace_prefix || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="issuer">
              <span style="font-family: monospace;">{{ status.config.issuer || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="oldest queued">
              {{ formatTimestamp(status.staging.oldest_queued_at) }}
            </a-descriptions-item>
            <a-descriptions-item label="last batch">
              <template v-if="status.batches.last_batch_id">
                <a-tag color="cyan" style="font-family: monospace;">#{{ status.batches.last_batch_id }}</a-tag>
                <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">
                  {{ t('mtc.status.lastBatchSize', { size: status.batches.last_tree_size, time: formatRelative(status.batches.last_closed_at) }) }}
                </span>
              </template>
              <span v-else style="color: var(--text-muted);">{{ t('mtc.status.noBatches') }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="last tree_head_id" :span="2">
              <span v-if="status.batches.last_tree_head_id" style="font-family: monospace; font-size: 11px; word-break: break-all;">
                {{ status.batches.last_tree_head_id }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-alert
          v-if="!status.ok && !loading"
          type="info"
          show-icon
          :message="t('mtc.status.loadFailMessage')"
          :description="t('mtc.status.loadFailDescription')"
        />
        <a-alert
          v-else-if="!status.config.enabled"
          type="info"
          show-icon
          :message="t('mtc.status.notEnabledMessage')"
          :description="t('mtc.status.notEnabledDescription')"
        />
      </a-tab-pane>

      <!-- ── Tab 2: Marketplace publisher history ───────────────── -->
      <a-tab-pane key="publisher" :tab="t('mtc.tabs.publisher')">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-form layout="inline" @submit.prevent="loadPublishState">
            <a-form-item :label="t('mtc.publisher.stateFileLabel')">
              <a-input
                v-model:value="publishStateFile"
                :placeholder="t('mtc.publisher.stateFilePlaceholder')"
                style="min-width: 360px;"
                allow-clear
              />
            </a-form-item>
            <a-form-item>
              <a-button :loading="publishLoading" type="primary" html-type="submit">
                {{ t('mtc.publisher.queryButton') }}
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-alert
          v-if="publish.ok && !publish.exists"
          type="info"
          show-icon
          :message="t('mtc.publisher.missingMessage')"
          :description="t('mtc.publisher.missingDescription', { path: publish.stateFile })"
          style="margin-bottom: 16px;"
        />

        <a-row v-if="publish.exists" :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('mtc.publisher.lastSeq')" :value="publish.lastSeq" :value-style="{ color: '#1677ff', fontSize: '20px' }">
                <template #prefix><NumberOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('mtc.publisher.historyEntries')" :value="publish.historyCount" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
                <template #prefix><HistoryOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.publisher.lastPublished')"
                :value="formatRelative(publish.lastPublishedAt)"
                :value-style="{ color: '#52c41a', fontSize: '16px' }"
              >
                <template #prefix><ClockCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <a-table
          v-if="publish.exists && publish.history.length > 0"
          :data-source="publish.history"
          :columns="historyColumns"
          :pagination="{ pageSize: 10 }"
          size="small"
          row-key="key"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'seq'">
              <a-tag color="cyan" style="font-family: monospace;">#{{ record.seq }}</a-tag>
            </template>
            <template v-else-if="column.key === 'treeHeadId'">
              <span style="font-family: monospace; font-size: 11px;">{{ truncate(record.treeHeadId, 22) }}</span>
            </template>
            <template v-else-if="column.key === 'publishedAt'">
              <span :title="record.publishedAt">{{ formatRelative(record.publishedAt) }}</span>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Tab 3: Verify tool ─────────────────────────────────── -->
      <a-tab-pane key="verify" :tab="t('mtc.tabs.verify')">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-alert
            type="info"
            show-icon
            :message="t('mtc.verify.infoMessage')"
            :description="t('mtc.verify.infoDescription')"
            style="margin-bottom: 16px;"
          />
          <a-form layout="vertical" @submit.prevent="runVerify">
            <a-form-item :label="t('mtc.verify.envelopeLabel')">
              <a-input
                v-model:value="verifyEnvelopePath"
                :placeholder="t('mtc.verify.envelopePlaceholder')"
                allow-clear
              />
            </a-form-item>
            <a-form-item :label="t('mtc.verify.landmarkLabel')">
              <a-input
                v-model:value="verifyLandmarkPath"
                :placeholder="t('mtc.verify.landmarkPlaceholder')"
                allow-clear
              />
            </a-form-item>
            <a-form-item>
              <a-button
                :loading="verifyLoading"
                type="primary"
                :disabled="!verifyEnvelopePath || !verifyLandmarkPath"
                @click="runVerify"
              >
                <template #icon><SafetyOutlined /></template>
                {{ t('mtc.verify.runButton') }}
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-card v-if="verifyResult" :title="verifyResult.ok ? t('mtc.verify.passTitle') : t('mtc.verify.failTitle')" size="small" :style="{ background: 'var(--bg-card)', borderColor: verifyResult.ok ? '#52c41a' : '#ff4d4f' }">
          <a-descriptions :column="1" size="small" bordered>
            <a-descriptions-item :label="t('mtc.verify.resultLabel')">
              <a-tag :color="verifyResult.ok ? 'green' : 'red'">
                {{ verifyResult.ok ? 'PASS' : 'FAIL' }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="!verifyResult.ok" :label="t('mtc.verify.errorCodeLabel')">
              <span style="font-family: monospace;">{{ verifyResult.code || t('mtc.verify.errorCodeNone') }}</span>
              <a-tag v-if="verifyResult.recoverable" color="orange" style="margin-left: 8px;">{{ t('mtc.verify.recoverable') }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.leaf" :label="t('mtc.verify.subjectLabel')">
              <span style="font-family: monospace; font-size: 12px;">{{ verifyResult.leaf.subject || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.leaf" :label="t('mtc.verify.kindLabel')">
              <a-tag>{{ verifyResult.leaf.kind || '—' }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.treeHead" :label="t('mtc.verify.treeSizeLabel')">
              {{ verifyResult.treeHead.tree_size }}
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.treeHead" :label="t('mtc.verify.issuerLabel')">
              <span style="font-family: monospace; font-size: 12px;">{{ verifyResult.treeHead.issuer || '—' }}</span>
            </a-descriptions-item>
          </a-descriptions>
          <a-collapse v-if="verifyResult.raw" ghost style="margin-top: 12px;">
            <a-collapse-panel key="raw" :header="t('mtc.verify.rawHeader')">
              <pre class="raw-pre">{{ JSON.stringify(verifyResult.raw, null, 2) }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </a-card>
      </a-tab-pane>

      <!-- ── Tab 4: Cross-chain bridge MTC (v0.6) ────────── -->
      <a-tab-pane key="bridge" tab="跨链桥 MTC">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="桥 MTC 集成"
                :value="bridgeStatus.config.enabled ? '已启用' : '未启用'"
                :value-style="{ color: bridgeStatus.config.enabled ? '#52c41a' : '#888', fontSize: '20px' }"
              />
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="互信模式"
                :value="bridgeModeLabel"
                :value-style="{ color: '#1677ff', fontSize: '20px' }"
              />
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="待批次关闭"
                :value="bridgeStatus.staging.pending"
                :value-style="{ color: bridgeStatus.staging.pending > 0 ? '#faad14' : '#888', fontSize: '20px' }"
              />
            </a-card>
          </a-col>
        </a-row>

        <a-card title="配置" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
            <a-descriptions-item label="算法">
              <a-tag :color="bridgeStatus.config.alg === 'slh-dsa-128f' ? 'purple' : 'blue'">{{ bridgeStatus.config.alg || '—' }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="batch interval">
              {{ formatBatchInterval(bridgeStatus.config.batch_interval_seconds) }}
            </a-descriptions-item>
            <a-descriptions-item label="issuer">
              <span style="font-family: monospace;">{{ bridgeStatus.config.issuer || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="batches 总数">
              {{ bridgeStatus.batches.total }}
              <span v-if="bridgeStatus.batches.latest" style="font-family: monospace; font-size: 11px; color: var(--text-tertiary); margin-left: 8px;">
                latest: {{ bridgeStatus.batches.latest }}
              </span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-card title="信任锚 (Independent 模式)" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-empty v-if="bridgeStatus.trust_anchors.total === 0" description="未配置信任锚" />
          <a-table
            v-else
            :data-source="bridgeAnchorsTable"
            :columns="bridgeAnchorColumns"
            :pagination="false"
            size="small"
            row-key="key"
          />
          <p style="margin-top: 8px; font-size: 12px; color: var(--text-tertiary);">
            添加：<code>cc crosschain mtc-trust-anchor add &lt;chain&gt; &lt;pubkey-id&gt; --alg --issuer</code>
          </p>
        </a-card>

        <a-alert
          type="info"
          show-icon
          message="桥 MTC 仍 opt-in"
          description="启用后 cc crosschain bridge|swap|send 加 --mtc 才会写 envelope；定期 cc crosschain mtc-batch 关 staging 为批次。完整指南见 docs.chainlesschain.com/guide/mtc-merkle-tree-certs。"
        />
      </a-tab-pane>

      <!-- ── Tab 5: Federation governance (v0.7+v0.8) ───── -->
      <a-tab-pane key="governance" tab="联邦治理">
        <a-form layout="inline" style="margin-bottom: 16px;">
          <a-form-item label="联邦 ID">
            <a-input
              v-model:value="govFederationId"
              placeholder="e.g. fed-test"
              style="width: 240px;"
              allow-clear
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" :loading="govLoading" @click="loadGovernanceLog">
              加载 governance.log
            </a-button>
          </a-form-item>
        </a-form>

        <div v-if="govResult">
          <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic title="状态" :value="govResult.state.status || '—'" :value-style="{ fontSize: '20px' }" />
              </a-card>
            </a-col>
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic title="Threshold" :value="govResult.state.threshold || 1" :value-style="{ fontSize: '20px' }" />
              </a-card>
            </a-col>
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic title="事件总数" :value="(govResult.events || []).length" :value-style="{ fontSize: '20px' }" />
              </a-card>
            </a-col>
          </a-row>

          <a-card title="成员" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
            <a-table
              :data-source="govResult.state.members || []"
              :columns="memberColumns"
              :pagination="false"
              size="small"
              row-key="member_id"
            />
          </a-card>

          <a-card v-if="(govResult.state.pending_invites || []).length" title="待投票邀请" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
            <a-list :data-source="govResult.state.pending_invites" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <span style="font-family: monospace;">{{ item.member_id }}</span>
                  <a-tag color="blue">approve {{ item.votes.approve.length }}/{{ item.required }}</a-tag>
                  <a-tag v-if="item.votes.reject.length" color="red">reject {{ item.votes.reject.length }}</a-tag>
                </a-list-item>
              </template>
            </a-list>
          </a-card>

          <a-card title="事件时间线" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
            <a-timeline>
              <a-timeline-item v-for="e in (govResult.events || [])" :key="e.event_id">
                <span style="font-family: monospace; color: var(--text-secondary); font-size: 11px;">{{ e.issued_at }}</span>
                <a-tag :color="eventTypeColor(e.event_type)" style="margin-left: 8px;">{{ e.event_type }}</a-tag>
                actor: <span style="font-family: monospace;">{{ e.actor_member_id }}</span>
              </a-timeline-item>
            </a-timeline>
          </a-card>
        </div>

        <a-empty v-else description="输入联邦 ID 加载 governance.log" />

        <a-alert
          style="margin-top: 16px;"
          type="info"
          show-icon
          message="跨成员同步"
          description="cc mtc federation governance-publish/pull --drop-zone 用文件系统目录在成员间双向同步事件。事件签名 + dedupe by event_id 保证幂等。"
        />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  InboxOutlined,
  DatabaseOutlined,
  NumberOutlined,
  HistoryOutlined,
  SafetyOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseAuditMtcStatus,
  parsePublishStatus,
  parseVerifyResult,
  formatBatchInterval,
  formatTimestamp,
  formatRelative,
} from '../utils/mtc-parser.js'

const { t } = useI18n()
const ws = useWsStore()

const activeTab = ref('status')
const loading = ref(false)
const status = ref(parseAuditMtcStatus(''))

const publishStateFile = ref('')
const publishLoading = ref(false)
const publish = ref(parsePublishStatus(''))

const verifyEnvelopePath = ref('')
const verifyLandmarkPath = ref('')
const verifyLoading = ref(false)
const verifyResult = ref(null)

const historyColumns = computed(() => [
  { title: t('mtc.historyColumns.seq'), key: 'seq', dataIndex: 'seq', width: '90px' },
  { title: t('mtc.historyColumns.namespace'), key: 'namespace', dataIndex: 'namespace' },
  { title: t('mtc.historyColumns.treeSize'), key: 'treeSize', dataIndex: 'treeSize', width: '100px' },
  { title: t('mtc.historyColumns.treeHeadId'), key: 'treeHeadId', dataIndex: 'treeHeadId', width: '180px' },
  { title: t('mtc.historyColumns.publishedAt'), key: 'publishedAt', dataIndex: 'publishedAt', width: '140px' },
])

function truncate(s, max) {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}

async function loadStatus() {
  loading.value = true
  try {
    const { output } = await ws.execute('audit mtc status --json', 8000)
    status.value = parseAuditMtcStatus(output)
  } catch (e) {
    message.error(t('mtc.messages.loadStatusFailed', { err: e?.message || e }))
  } finally {
    loading.value = false
  }
}

async function loadPublishState() {
  if (!publishStateFile.value.trim()) {
    message.warning(t('mtc.messages.stateFileRequired'))
    return
  }
  publishLoading.value = true
  try {
    const path = publishStateFile.value.trim().replace(/"/g, '\\"')
    const { output } = await ws.execute(`mtc publish-status "${path}" --json`, 8000)
    publish.value = parsePublishStatus(output)
  } catch (e) {
    message.error(t('mtc.messages.loadPublishFailed', { err: e?.message || e }))
  } finally {
    publishLoading.value = false
  }
}

async function runVerify() {
  if (!verifyEnvelopePath.value.trim() || !verifyLandmarkPath.value.trim()) {
    message.warning(t('mtc.messages.verifyPathsRequired'))
    return
  }
  verifyLoading.value = true
  verifyResult.value = null
  try {
    const env = verifyEnvelopePath.value.trim().replace(/"/g, '\\"')
    const lm = verifyLandmarkPath.value.trim().replace(/"/g, '\\"')
    const { output } = await ws.execute(`mtc verify "${env}" --landmark "${lm}" --json`, 12000)
    verifyResult.value = parseVerifyResult(output)
    if (!verifyResult.value.raw) {
      message.error(t('mtc.messages.verifyNoJson'))
    }
  } catch (e) {
    message.error(t('mtc.messages.verifyFailed', { err: e?.message || e }))
  } finally {
    verifyLoading.value = false
  }
}

// ─── Bridge MTC tab (v0.6) ────────────────────────────────────
const bridgeStatus = ref({
  config: { enabled: false, mode: 'independent', alg: 'ed25519', batch_interval_seconds: 60, issuer: '' },
  trust_anchors: { chain_count: 0, total: 0, by_chain: {} },
  staging: { pending: 0 },
  batches: { total: 0, latest: null },
})
const bridgeModeLabel = computed(() => {
  switch (bridgeStatus.value.config.mode) {
    case 'federated': return 'Federated'
    case 'light-client': return 'Light Client'
    default: return 'Independent'
  }
})
const bridgeAnchorColumns = [
  { title: 'chain', key: 'chain', dataIndex: 'chain', width: '120px' },
  { title: '锚数', key: 'count', dataIndex: 'count', width: '80px' },
]
const bridgeAnchorsTable = computed(() => {
  const by = bridgeStatus.value.trust_anchors.by_chain || {}
  return Object.entries(by).map(([chain, count]) => ({ key: chain, chain, count }))
})

async function loadBridgeStatus() {
  try {
    const { output } = await ws.execute('crosschain mtc-status --json', 8000)
    const lines = output.split(/\r?\n/)
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try {
            const obj = JSON.parse(lines.slice(s, e).join('\n'))
            if (obj && obj.config) {
              bridgeStatus.value = obj
              return
            }
          } catch (_err) { /* keep trying */ }
        }
      }
    }
  } catch (e) {
    message.error('加载桥 MTC 状态失败: ' + (e?.message || e))
  }
}

// ─── Federation governance tab (v0.7+v0.8) ───────────────────
const govFederationId = ref('')
const govLoading = ref(false)
const govResult = ref(null)
const memberColumns = [
  { title: 'member_id', key: 'member_id', dataIndex: 'member_id' },
  { title: 'status', key: 'status', dataIndex: 'status', width: '110px' },
  { title: 'weight', key: 'weight', dataIndex: 'weight', width: '80px' },
  { title: 'alg', key: 'alg', dataIndex: 'alg', width: '120px' },
]

function eventTypeColor(eventType) {
  switch (eventType) {
    case 'create': return 'cyan'
    case 'invite': case 'vote': return 'blue'
    case 'leave': case 'rotate-key': return 'default'
    case 'propose-revoke': case 'propose-threshold': return 'orange'
    case 'confirm-revoke': case 'confirm-threshold': return 'gold'
    case 'fork': case 'merge': return 'purple'
    case 'dispute': case 'wind-down': return 'red'
    default: return 'default'
  }
}

async function loadGovernanceLog() {
  if (!govFederationId.value.trim()) {
    message.warning('请输入联邦 ID')
    return
  }
  govLoading.value = true
  try {
    const safeId = govFederationId.value.trim().replace(/"/g, '')
    const { output } = await ws.execute(`mtc federation governance-log "${safeId}" --json`, 8000)
    const lines = output.split(/\r?\n/)
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try {
            const obj = JSON.parse(lines.slice(s, e).join('\n'))
            if (obj && obj.state) {
              govResult.value = obj
              return
            }
          } catch (_err) { /* keep trying */ }
        }
      }
    }
    message.error('未能解析 governance-log 输出')
  } catch (e) {
    message.error('加载 governance.log 失败: ' + (e?.message || e))
  } finally {
    govLoading.value = false
  }
}

onMounted(() => {
  loadStatus()
  loadBridgeStatus()
})
</script>

<style scoped>
.page-title {
  margin: 0;
  font-size: 22px;
  color: var(--text-primary);
}
.page-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.mtc-tabs :deep(.ant-tabs-tab) {
  font-size: 13px;
}
.raw-pre {
  margin: 0;
  padding: 8px 12px;
  background: var(--bg-hover);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  max-height: 320px;
  overflow: auto;
}
</style>
