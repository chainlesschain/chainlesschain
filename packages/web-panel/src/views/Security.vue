<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('security.title') }}</h2>
        <p class="page-sub">{{ t('security.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        {{ t('security.refresh') }}
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" @change="onTabChange">
      <!-- Tab 1: DID Identity -->
      <a-tab-pane key="did">
        <template #tab>
          <SafetyCertificateOutlined />
          {{ t('security.tabs.did') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" :loading="creating" @click="createDID">
            <template #icon><PlusOutlined /></template>
            {{ t('security.did.createButton') }}
          </a-button>
          <a-button @click="showSignModal = true">
            <template #icon><KeyOutlined /></template>
            {{ t('security.did.signButton') }}
          </a-button>
        </a-space>

        <div v-if="didLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="didColumns"
          :data-source="didList"
          :pagination="{ pageSize: 20, showTotal: (count) => t('security.totals.rows', { count }) }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'sec-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'did'">
              <span style="color: #e0e0e0; font-family: monospace; font-size: 12px;">{{ record.did }}</span>
            </template>
            <template v-if="column.key === 'method'">
              <a-tag color="blue">{{ record.method }}</a-tag>
            </template>
            <template v-if="column.key === 'created'">
              <span style="color: var(--text-secondary); font-size: 12px;">{{ record.created }}</span>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="record.isDefault ? 'green' : 'default'">
                {{ record.isDefault ? t('security.did.default') : t('security.did.available') }}
              </a-tag>
            </template>
          </template>
          <template #emptyText>
            <a-empty :description="t('security.did.emptyText')" />
          </template>
        </a-table>

        <!-- Sign Modal -->
        <a-modal
          v-model:open="showSignModal"
          :title="t('security.did.signTitle')"
          :confirm-loading="signing"
          @ok="signMessage"
          :ok-text="t('security.did.signOk')"
          :cancel-text="t('common.cancel')"
        >
          <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
            <a-form-item :label="t('security.did.messageLabel')" required>
              <a-input v-model:value="signText" :placeholder="t('security.did.messagePlaceholder')" />
            </a-form-item>
          </a-form>
          <div v-if="signResult" style="margin-top: 12px;">
            <p style="color: var(--text-secondary); margin-bottom: 6px;">{{ t('security.did.signResultLabel') }}</p>
            <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">{{ signResult }}</pre>
          </div>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: File Encryption -->
      <a-tab-pane key="encrypt">
        <template #tab>
          <LockOutlined />
          {{ t('security.tabs.encrypt') }}
        </template>

        <a-row :gutter="[24, 24]">
          <a-col :xs="24" :md="12">
            <a-card :title="t('security.encrypt.encryptCardTitle')" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
                <a-form-item :label="t('security.encrypt.pathLabel')">
                  <a-input v-model:value="encryptPath" :placeholder="t('security.encrypt.encryptPlaceholder')" />
                </a-form-item>
                <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                  <a-button type="primary" :loading="encrypting" :disabled="!encryptPath.trim()" @click="doEncrypt">
                    <template #icon><LockOutlined /></template>
                    {{ t('security.encrypt.encryptButton') }}
                  </a-button>
                </a-form-item>
              </a-form>
              <div v-if="encryptResult" style="margin-top: 8px;">
                <a-tag :color="encryptResult.success ? 'green' : 'red'">
                  {{ encryptResult.success ? t('security.encrypt.successTag') : t('security.encrypt.failureTag') }}
                </a-tag>
                <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px; margin-top: 8px; background: var(--bg-base); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">{{ encryptResult.output }}</pre>
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-card :title="t('security.encrypt.decryptCardTitle')" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
                <a-form-item :label="t('security.encrypt.pathLabel')">
                  <a-input v-model:value="decryptPath" :placeholder="t('security.encrypt.decryptPlaceholder')" />
                </a-form-item>
                <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                  <a-button type="primary" :loading="decrypting" :disabled="!decryptPath.trim()" @click="doDecrypt">
                    <template #icon><LockOutlined /></template>
                    {{ t('security.encrypt.decryptButton') }}
                  </a-button>
                </a-form-item>
              </a-form>
              <div v-if="decryptResult" style="margin-top: 8px;">
                <a-tag :color="decryptResult.success ? 'green' : 'red'">
                  {{ decryptResult.success ? t('security.encrypt.successTag') : t('security.encrypt.failureTag') }}
                </a-tag>
                <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px; margin-top: 8px; background: var(--bg-base); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">{{ decryptResult.output }}</pre>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- Tab 3: Audit Logs -->
      <a-tab-pane key="audit">
        <template #tab>
          <AuditOutlined />
          {{ t('security.tabs.audit') }}
        </template>

        <!-- Stats Cards -->
        <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
          <a-col :xs="12" :sm="6" v-for="stat in auditStats" :key="stat.label">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
              <a-statistic
                :title="stat.label"
                :value="stat.value"
                :value-style="{ color: stat.color, fontSize: '20px' }"
              />
            </a-card>
          </a-col>
        </a-row>

        <div v-if="auditLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="auditColumns"
          :data-source="auditEvents"
          :pagination="{ pageSize: 20, showTotal: (count) => t('security.totals.rows', { count }) }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'sec-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'time'">
              <span style="color: var(--text-secondary); font-size: 12px; font-family: monospace;">{{ record.time }}</span>
            </template>
            <template v-if="column.key === 'event'">
              <span style="color: #e0e0e0;">{{ record.event }}</span>
            </template>
            <template v-if="column.key === 'user'">
              <span style="color: var(--text-secondary);">{{ record.user }}</span>
            </template>
            <template v-if="column.key === 'level'">
              <a-tag :color="levelColor(record.level)">{{ record.level }}</a-tag>
            </template>
            <template v-if="column.key === 'detail'">
              <span style="color: var(--text-muted); font-size: 12px;">{{ record.detail }}</span>
            </template>
          </template>
          <template #emptyText>
            <a-empty :description="t('security.audit.emptyText')" />
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  SafetyCertificateOutlined,
  LockOutlined,
  AuditOutlined,
  PlusOutlined,
  ReloadOutlined,
  KeyOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

// --- Shared ---
const activeTab = ref('did')
const refreshing = ref(false)

async function refreshCurrentTab() {
  refreshing.value = true
  try {
    if (activeTab.value === 'did') await loadDIDList()
    else if (activeTab.value === 'audit') await loadAudit()
  } finally {
    refreshing.value = false
  }
}

function onTabChange(key) {
  if (key === 'did' && didList.value.length === 0) loadDIDList()
  if (key === 'audit' && auditEvents.value.length === 0) loadAudit()
}

// --- Tab 1: DID Identity ---
const didLoading = ref(false)
const creating = ref(false)
const signing = ref(false)
const didList = ref([])
const showSignModal = ref(false)
const signText = ref('')
const signResult = ref('')

const didColumns = computed(() => [
  { title: t('security.didColumns.did'), key: 'did', dataIndex: 'did', ellipsis: true },
  { title: t('security.didColumns.method'), key: 'method', dataIndex: 'method', width: '100px' },
  { title: t('security.didColumns.created'), key: 'created', dataIndex: 'created', width: '180px' },
  { title: t('security.didColumns.status'), key: 'status', width: '80px' },
])

async function loadDIDList() {
  didLoading.value = true
  try {
    const { output } = await ws.execute('did list', 15000)
    didList.value = parseDIDList(output)
  } catch (e) {
    message.error(t('security.messages.loadDidsFailed', { err: e.message }))
  } finally {
    didLoading.value = false
  }
}

function parseDIDList(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('DID') || trimmed.match(/^\d+ identit/i)) continue
    const didMatch = trimmed.match(/(did:\w+:\w+)/)
    if (didMatch) {
      const did = didMatch[1]
      const method = did.split(':')[1] || 'key'
      const isDefault = /default|默认|\*/.test(trimmed)
      const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2}[\sT]?\d{2}:\d{2}(?::\d{2})?)/)
      result.push({
        key: did,
        did,
        method,
        created: dateMatch ? dateMatch[1] : '-',
        isDefault,
      })
    }
  }
  return result
}

async function createDID() {
  creating.value = true
  try {
    const { output } = await ws.execute('did create', 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error(t('security.messages.didCreateFailed', { err: output.slice(0, 120) }))
    } else {
      message.success(t('security.messages.didCreateOk'))
      await loadDIDList()
    }
  } catch (e) {
    message.error(t('security.messages.didCreateFailed', { err: e.message }))
  } finally {
    creating.value = false
  }
}

async function signMessage() {
  if (!signText.value.trim()) { message.warning(t('security.messages.messageRequired')); return }
  signing.value = true
  signResult.value = ''
  try {
    const { output } = await ws.execute(`did sign "${signText.value.replace(/"/g, '\\"')}"`, 15000)
    signResult.value = output
    if (!output.includes('error') && !output.includes('失败')) {
      message.success(t('security.messages.signOk'))
    }
  } catch (e) {
    signResult.value = t('security.messages.signFailed', { err: e.message })
  } finally {
    signing.value = false
  }
}

// --- Tab 2: File Encryption ---
const encryptPath = ref('')
const decryptPath = ref('')
const encrypting = ref(false)
const decrypting = ref(false)
const encryptResult = ref(null)
const decryptResult = ref(null)

async function doEncrypt() {
  if (!encryptPath.value.trim()) return
  encrypting.value = true
  encryptResult.value = null
  try {
    const { output, exitCode } = await ws.execute(`encrypt file "${encryptPath.value.trim()}"`, 30000)
    encryptResult.value = {
      success: exitCode === 0 && !output.includes('error') && !output.includes('失败'),
      output: output || t('security.encrypt.encryptDefault'),
    }
    if (encryptResult.value.success) message.success(t('security.messages.encryptOk'))
  } catch (e) {
    encryptResult.value = { success: false, output: t('security.messages.encryptFailed', { err: e.message }) }
  } finally {
    encrypting.value = false
  }
}

async function doDecrypt() {
  if (!decryptPath.value.trim()) return
  decrypting.value = true
  decryptResult.value = null
  try {
    const { output, exitCode } = await ws.execute(`decrypt file "${decryptPath.value.trim()}"`, 30000)
    decryptResult.value = {
      success: exitCode === 0 && !output.includes('error') && !output.includes('失败'),
      output: output || t('security.encrypt.decryptDefault'),
    }
    if (decryptResult.value.success) message.success(t('security.messages.decryptOk'))
  } catch (e) {
    decryptResult.value = { success: false, output: t('security.messages.decryptFailed', { err: e.message }) }
  } finally {
    decrypting.value = false
  }
}

// --- Tab 3: Audit ---
const auditLoading = ref(false)
const auditEvents = ref([])
const auditStats = ref([])

const auditColumns = computed(() => [
  { title: t('security.auditColumns.time'), key: 'time', dataIndex: 'time', width: '180px' },
  { title: t('security.auditColumns.event'), key: 'event', dataIndex: 'event', width: '200px' },
  { title: t('security.auditColumns.user'), key: 'user', dataIndex: 'user', width: '120px' },
  { title: t('security.auditColumns.level'), key: 'level', dataIndex: 'level', width: '80px' },
  { title: t('security.auditColumns.detail'), key: 'detail', dataIndex: 'detail', ellipsis: true },
])

function levelColor(level) {
  const map = { info: 'blue', warn: 'orange', warning: 'orange', error: 'red', critical: 'red' }
  return map[(level || '').toLowerCase()] || 'default'
}

async function loadAudit() {
  auditLoading.value = true
  try {
    const [logRes, statsRes] = await Promise.all([
      ws.execute('audit log', 15000),
      ws.execute('audit stats', 15000),
    ])
    auditEvents.value = parseAuditLog(logRes.output)
    auditStats.value = parseAuditStats(statsRes.output)
  } catch (e) {
    message.error(t('security.messages.loadAuditFailed', { err: e.message }))
  } finally {
    auditLoading.value = false
  }
}

function parseAuditLog(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Audit') || trimmed.startsWith('Recent')) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 3) {
      result.push({
        key: result.length,
        time: parts[0] || '-',
        event: parts[1] || '-',
        user: parts[2] || '-',
        level: parts[3] || 'info',
        detail: parts.slice(4).join(' ') || '',
      })
      continue
    }
    const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(?::\d{2})?)\s+(.+)/)
    if (dateMatch) {
      const rest = dateMatch[2]
      const levelMatch = rest.match(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i)
      result.push({
        key: result.length,
        time: dateMatch[1],
        event: rest.replace(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i, '').trim().slice(0, 80),
        user: '-',
        level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
        detail: '',
      })
    } else if (trimmed.length > 3 && !trimmed.match(/^\d+ event/i)) {
      result.push({
        key: result.length,
        time: '-',
        event: trimmed.slice(0, 80),
        user: '-',
        level: 'info',
        detail: '',
      })
    }
  }
  return result
}

function parseAuditStats(output) {
  const stats = []
  const lines = output.split('\n')
  const colors = ['#1677ff', '#52c41a', '#faad14', '#ff4d4f']
  let colorIdx = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Audit')) continue
    const kvMatch = trimmed.match(/^(.+?)\s*[:=：]\s*(.+)$/)
    if (kvMatch) {
      const label = kvMatch[1].trim()
      const rawValue = kvMatch[2].trim()
      const numMatch = rawValue.match(/^(\d+)/)
      stats.push({
        label,
        value: numMatch ? parseInt(numMatch[1], 10) : rawValue,
        color: colors[colorIdx % colors.length],
      })
      colorIdx++
    }
  }
  if (stats.length === 0) {
    stats.push(
      { label: t('security.audit.totalEvents'), value: auditEvents.value.length, color: '#1677ff' },
      { label: t('security.audit.statusLabel'), value: t('security.audit.ready'), color: '#52c41a' },
    )
  }
  return stats
}

onMounted(() => {
  loadDIDList()
})
</script>

<style scoped>
:deep(.sec-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-tabs-tab) { color: var(--text-secondary) !important; }
:deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #1677ff !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
