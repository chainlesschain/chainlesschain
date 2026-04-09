<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">安全中心</h2>
        <p class="page-sub">DID 身份 / 加密 / 审计</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" @change="onTabChange">
      <!-- Tab 1: DID Identity -->
      <a-tab-pane key="did">
        <template #tab>
          <SafetyCertificateOutlined />
          DID 身份
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" :loading="creating" @click="createDID">
            <template #icon><PlusOutlined /></template>
            创建身份
          </a-button>
          <a-button @click="showSignModal = true">
            <template #icon><KeyOutlined /></template>
            签名消息
          </a-button>
        </a-space>

        <div v-if="didLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="didColumns"
          :data-source="didList"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
                {{ record.isDefault ? '默认' : '可用' }}
              </a-tag>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无 DID 身份，点击「创建身份」添加" />
          </template>
        </a-table>

        <!-- Sign Modal -->
        <a-modal
          v-model:open="showSignModal"
          title="DID 签名"
          :confirm-loading="signing"
          @ok="signMessage"
          ok-text="签名"
          cancel-text="取消"
        >
          <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
            <a-form-item label="消息" required>
              <a-input v-model:value="signText" placeholder="请输入要签名的消息" />
            </a-form-item>
          </a-form>
          <div v-if="signResult" style="margin-top: 12px;">
            <p style="color: var(--text-secondary); margin-bottom: 6px;">签名结果:</p>
            <pre style="white-space: pre-wrap; word-break: break-all; color: #52c41a; font-size: 11px; background: var(--bg-base); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">{{ signResult }}</pre>
          </div>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: File Encryption -->
      <a-tab-pane key="encrypt">
        <template #tab>
          <LockOutlined />
          文件加密
        </template>

        <a-row :gutter="[24, 24]">
          <a-col :xs="24" :md="12">
            <a-card title="加密文件" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
                <a-form-item label="文件路径">
                  <a-input v-model:value="encryptPath" placeholder="输入文件路径，如 /path/to/file.txt" />
                </a-form-item>
                <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                  <a-button type="primary" :loading="encrypting" :disabled="!encryptPath.trim()" @click="doEncrypt">
                    <template #icon><LockOutlined /></template>
                    加密
                  </a-button>
                </a-form-item>
              </a-form>
              <div v-if="encryptResult" style="margin-top: 8px;">
                <a-tag :color="encryptResult.success ? 'green' : 'red'">
                  {{ encryptResult.success ? '成功' : '失败' }}
                </a-tag>
                <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-secondary); font-size: 11px; margin-top: 8px; background: var(--bg-base); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">{{ encryptResult.output }}</pre>
              </div>
            </a-card>
          </a-col>
          <a-col :xs="24" :md="12">
            <a-card title="解密文件" style="background: var(--bg-card); border-color: var(--border-color);">
              <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
                <a-form-item label="文件路径">
                  <a-input v-model:value="decryptPath" placeholder="输入加密文件路径，如 /path/to/file.txt.enc" />
                </a-form-item>
                <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                  <a-button type="primary" :loading="decrypting" :disabled="!decryptPath.trim()" @click="doDecrypt">
                    <template #icon><LockOutlined /></template>
                    解密
                  </a-button>
                </a-form-item>
              </a-form>
              <div v-if="decryptResult" style="margin-top: 8px;">
                <a-tag :color="decryptResult.success ? 'green' : 'red'">
                  {{ decryptResult.success ? '成功' : '失败' }}
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
          审计日志
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
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
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
            <a-empty description="暂无审计日志" />
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
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

const didColumns = [
  { title: 'DID', key: 'did', dataIndex: 'did', ellipsis: true },
  { title: '方法', key: 'method', dataIndex: 'method', width: '100px' },
  { title: '创建时间', key: 'created', dataIndex: 'created', width: '180px' },
  { title: '状态', key: 'status', width: '80px' },
]

async function loadDIDList() {
  didLoading.value = true
  try {
    const { output } = await ws.execute('did list', 15000)
    didList.value = parseDIDList(output)
  } catch (e) {
    message.error('加载 DID 列表失败: ' + e.message)
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
    // Try to match DID string patterns like "did:key:z6Mk..." or numbered entries
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
      message.error('创建失败: ' + output.slice(0, 120))
    } else {
      message.success('DID 身份已创建')
      await loadDIDList()
    }
  } catch (e) {
    message.error('创建失败: ' + e.message)
  } finally {
    creating.value = false
  }
}

async function signMessage() {
  if (!signText.value.trim()) { message.warning('请输入消息'); return }
  signing.value = true
  signResult.value = ''
  try {
    const { output } = await ws.execute(`did sign "${signText.value.replace(/"/g, '\\"')}"`, 15000)
    signResult.value = output
    if (!output.includes('error') && !output.includes('失败')) {
      message.success('签名成功')
    }
  } catch (e) {
    signResult.value = '签名失败: ' + e.message
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
      output: output || '加密完成',
    }
    if (encryptResult.value.success) message.success('文件加密成功')
  } catch (e) {
    encryptResult.value = { success: false, output: '加密失败: ' + e.message }
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
      output: output || '解密完成',
    }
    if (decryptResult.value.success) message.success('文件解密成功')
  } catch (e) {
    decryptResult.value = { success: false, output: '解密失败: ' + e.message }
  } finally {
    decrypting.value = false
  }
}

// --- Tab 3: Audit ---
const auditLoading = ref(false)
const auditEvents = ref([])
const auditStats = ref([])

const auditColumns = [
  { title: '时间', key: 'time', dataIndex: 'time', width: '180px' },
  { title: '事件', key: 'event', dataIndex: 'event', width: '200px' },
  { title: '用户', key: 'user', dataIndex: 'user', width: '120px' },
  { title: '级别', key: 'level', dataIndex: 'level', width: '80px' },
  { title: '详情', key: 'detail', dataIndex: 'detail', ellipsis: true },
]

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
    message.error('加载审计日志失败: ' + e.message)
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
    // Try structured format: "time | event | user | level | detail"
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
    // Fallback: try to parse timestamp-prefixed lines
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
    // Match "Label: Value" or "Label = Value" patterns
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
  // Fallback: if no stats parsed, show placeholder
  if (stats.length === 0) {
    stats.push(
      { label: '总事件数', value: auditEvents.value.length, color: '#1677ff' },
      { label: '状态', value: '就绪', color: '#52c41a' },
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
