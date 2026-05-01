<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">默克尔树证书 (MTC)</h2>
        <p class="page-sub">
          Audit 双轨状态 · Marketplace publisher 历史 · 离线验证工具
        </p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadStatus">
          <template #icon><ReloadOutlined /></template>
          刷新状态
        </a-button>
      </a-space>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="mtc-tabs">
      <!-- ── Tab 1: Audit MTC status ────────────────────────────── -->
      <a-tab-pane key="status" tab="Audit 双轨状态">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="启用状态"
                :value="status.config.enabled ? '已启用' : '未启用'"
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
                title="批次间隔"
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
                title="待批次关闭"
                :value="status.staging.count"
                :value-style="{ color: status.staging.count > 0 ? '#faad14' : '#888', fontSize: '20px' }"
              >
                <template #prefix><InboxOutlined /></template>
                <template v-if="status.staging.malformed > 0" #suffix>
                  <a-tag color="red" style="margin-left: 8px;">{{ status.staging.malformed }} 损坏</a-tag>
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="累计批次"
                :value="status.batches.count"
                :value-style="{ color: '#13c2c2', fontSize: '20px' }"
              >
                <template #prefix><DatabaseOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <a-card title="配置" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
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
                  size={{ status.batches.last_tree_size }} · {{ formatRelative(status.batches.last_closed_at) }}
                </span>
              </template>
              <span v-else style="color: var(--text-muted);">尚未关批</span>
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
          message="状态加载失败"
          description="`cc audit mtc status --json` 没返回有效输出。请确认 cc serve 在运行，且当前账户能读 audit-mtc 目录。"
        />
        <a-alert
          v-else-if="!status.config.enabled"
          type="info"
          show-icon
          message="audit-mtc 未启用 · 已就绪"
          description="法务出函阻塞已于 2026-05-01 解除。运行 `cc audit mtc enable --interval <60|3600> --namespace <ns> --issuer <issuer>` 即可在本租户启用双轨签名。"
        />
      </a-tab-pane>

      <!-- ── Tab 2: Marketplace publisher history ───────────────── -->
      <a-tab-pane key="publisher" tab="Marketplace publisher">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-form layout="inline" @submit.prevent="loadPublishState">
            <a-form-item label="状态文件路径">
              <a-input
                v-model:value="publishStateFile"
                placeholder="e.g. ~/.chainlesschain/marketplace-state.json"
                style="min-width: 360px;"
                allow-clear
              />
            </a-form-item>
            <a-form-item>
              <a-button :loading="publishLoading" type="primary" html-type="submit">
                查询
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-alert
          v-if="publish.ok && !publish.exists"
          type="info"
          show-icon
          message="状态文件不存在"
          :description="`路径 ${publish.stateFile} 还没有任何发布记录。运行一次 cc mtc publish-skills 后此处会出现历史。`"
          style="margin-bottom: 16px;"
        />

        <a-row v-if="publish.exists" :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic title="last seq" :value="publish.lastSeq" :value-style="{ color: '#1677ff', fontSize: '20px' }">
                <template #prefix><NumberOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic title="历史条目" :value="publish.historyCount" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
                <template #prefix><HistoryOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="last published"
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
      <a-tab-pane key="verify" tab="Envelope 验证工具">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-alert
            type="info"
            show-icon
            message="只读验证 · 通过本机 cc serve 运行"
            description="此工具调用 `cc mtc verify` 子命令。Envelope + landmark 文件必须已在本机磁盘上 — 浏览器只把路径转给 cc serve，不会上传文件内容。"
            style="margin-bottom: 16px;"
          />
          <a-form layout="vertical" @submit.prevent="runVerify">
            <a-form-item label="Envelope 文件路径">
              <a-input
                v-model:value="verifyEnvelopePath"
                placeholder="e.g. ./mtc-out/envelope-000000.json"
                allow-clear
              />
            </a-form-item>
            <a-form-item label="Landmark 文件路径">
              <a-input
                v-model:value="verifyLandmarkPath"
                placeholder="e.g. ./mtc-out/landmark.json"
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
                运行 cc mtc verify
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-card v-if="verifyResult" :title="verifyResult.ok ? '✓ 验证通过' : '✗ 验证失败'" size="small" :style="{ background: 'var(--bg-card)', borderColor: verifyResult.ok ? '#52c41a' : '#ff4d4f' }">
          <a-descriptions :column="1" size="small" bordered>
            <a-descriptions-item label="结果">
              <a-tag :color="verifyResult.ok ? 'green' : 'red'">
                {{ verifyResult.ok ? 'PASS' : 'FAIL' }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="!verifyResult.ok" label="错误码">
              <span style="font-family: monospace;">{{ verifyResult.code || '(none)' }}</span>
              <a-tag v-if="verifyResult.recoverable" color="orange" style="margin-left: 8px;">可恢复</a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.leaf" label="Subject">
              <span style="font-family: monospace; font-size: 12px;">{{ verifyResult.leaf.subject || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.leaf" label="Kind">
              <a-tag>{{ verifyResult.leaf.kind || '—' }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.treeHead" label="Tree size">
              {{ verifyResult.treeHead.tree_size }}
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.treeHead" label="Issuer">
              <span style="font-family: monospace; font-size: 12px;">{{ verifyResult.treeHead.issuer || '—' }}</span>
            </a-descriptions-item>
          </a-descriptions>
          <a-collapse v-if="verifyResult.raw" ghost style="margin-top: 12px;">
            <a-collapse-panel key="raw" header="原始 JSON 输出">
              <pre class="raw-pre">{{ JSON.stringify(verifyResult.raw, null, 2) }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
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

const historyColumns = [
  { title: 'Seq', key: 'seq', dataIndex: 'seq', width: '90px' },
  { title: 'Namespace', key: 'namespace', dataIndex: 'namespace' },
  { title: 'Tree size', key: 'treeSize', dataIndex: 'treeSize', width: '100px' },
  { title: 'Tree head', key: 'treeHeadId', dataIndex: 'treeHeadId', width: '180px' },
  { title: 'Published', key: 'publishedAt', dataIndex: 'publishedAt', width: '140px' },
]

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
    message.error('状态加载失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function loadPublishState() {
  if (!publishStateFile.value.trim()) {
    message.warning('请输入状态文件路径')
    return
  }
  publishLoading.value = true
  try {
    // Quote path to handle spaces; the CLI accepts a positional <state-file> arg.
    const path = publishStateFile.value.trim().replace(/"/g, '\\"')
    const { output } = await ws.execute(`mtc publish-status "${path}" --json`, 8000)
    publish.value = parsePublishStatus(output)
  } catch (e) {
    message.error('publisher 状态加载失败: ' + (e?.message || e))
  } finally {
    publishLoading.value = false
  }
}

async function runVerify() {
  if (!verifyEnvelopePath.value.trim() || !verifyLandmarkPath.value.trim()) {
    message.warning('请填写 envelope 和 landmark 路径')
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
      message.error('验证命令未返回 JSON。请检查路径是否正确。')
    }
  } catch (e) {
    message.error('验证失败: ' + (e?.message || e))
  } finally {
    verifyLoading.value = false
  }
}

onMounted(() => {
  loadStatus()
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
