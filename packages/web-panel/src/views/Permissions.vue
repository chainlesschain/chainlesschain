<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">权限管理</h2>
        <p class="page-sub">角色 / 权限检查 / 审计</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshCurrentTab">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card" @change="onTabChange">
      <!-- Tab 1: Roles -->
      <a-tab-pane key="roles">
        <template #tab>
          <LockOutlined />
          角色列表
        </template>

        <div v-if="rolesLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>
        <a-table
          v-else
          :columns="rolesColumns"
          :data-source="rolesList"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          style="background: var(--bg-card);"
          :row-class-name="() => 'perm-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: #e0e0e0; font-weight: 500;">{{ record.name }}</span>
            </template>
            <template v-if="column.key === 'description'">
              <span style="color: var(--text-secondary);">{{ record.description }}</span>
            </template>
            <template v-if="column.key === 'permissions'">
              <a-tag v-for="perm in (record.permissions || []).slice(0, 5)" :key="perm" color="blue" style="margin-bottom: 2px;">
                {{ perm }}
              </a-tag>
              <a-tag v-if="(record.permissions || []).length > 5" color="default">
                +{{ record.permissions.length - 5 }}
              </a-tag>
            </template>
            <template v-if="column.key === 'userCount'">
              <a-tag :color="record.userCount > 0 ? 'green' : 'default'">
                {{ record.userCount ?? 0 }}
              </a-tag>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无角色数据" />
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Tab 2: Permission Check -->
      <a-tab-pane key="check">
        <template #tab>
          <CheckCircleOutlined />
          权限检查
        </template>

        <a-card style="background: var(--bg-card); border-color: var(--border-color); max-width: 640px;">
          <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }">
            <a-form-item label="用户 ID" required>
              <a-input v-model:value="checkUserId" placeholder="输入用户 ID" />
            </a-form-item>
            <a-form-item label="权限" required>
              <a-input v-model:value="checkPermission" placeholder="note:read" />
            </a-form-item>
            <a-form-item :wrapper-col="{ offset: 5, span: 19 }">
              <a-space wrap>
                <a-button
                  type="primary"
                  :loading="checking"
                  :disabled="!checkUserId.trim() || !checkPermission.trim()"
                  @click="doCheck"
                >
                  <template #icon><CheckCircleOutlined /></template>
                  检查权限
                </a-button>
                <a-button
                  v-for="qp in quickPermissions"
                  :key="qp"
                  size="small"
                  @click="checkPermission = qp"
                >
                  {{ qp }}
                </a-button>
              </a-space>
            </a-form-item>
          </a-form>

          <div v-if="checkResult !== null" style="margin-top: 16px;">
            <a-alert
              :message="checkResult.allowed ? '权限允许' : '权限拒绝'"
              :description="checkResult.detail"
              :type="checkResult.allowed ? 'success' : 'error'"
              show-icon
            />
          </div>
        </a-card>
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
          :row-class-name="() => 'perm-row'"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'timestamp'">
              <span style="color: var(--text-secondary); font-size: 12px; font-family: monospace;">{{ record.timestamp }}</span>
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
  LockOutlined,
  CheckCircleOutlined,
  AuditOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

// --- Shared ---
const activeTab = ref('roles')
const refreshing = ref(false)

async function refreshCurrentTab() {
  refreshing.value = true
  try {
    if (activeTab.value === 'roles') await loadRoles()
    else if (activeTab.value === 'audit') await loadAudit()
  } finally {
    refreshing.value = false
  }
}

function onTabChange(key) {
  if (key === 'roles' && rolesList.value.length === 0) loadRoles()
  if (key === 'audit' && auditEvents.value.length === 0) loadAudit()
}

// --- Tab 1: Roles ---
const rolesLoading = ref(false)
const rolesList = ref([])

const rolesColumns = [
  { title: '角色名', key: 'name', dataIndex: 'name', width: '160px' },
  { title: '描述', key: 'description', dataIndex: 'description', width: '240px' },
  { title: '权限', key: 'permissions', dataIndex: 'permissions' },
  { title: '用户数', key: 'userCount', dataIndex: 'userCount', width: '100px' },
]

async function loadRoles() {
  rolesLoading.value = true
  try {
    const { output } = await ws.execute('auth roles --json', 15000)
    rolesList.value = parseJsonOutput(output, parseRolesText)
  } catch (e) {
    message.error('加载角色列表失败: ' + e.message)
  } finally {
    rolesLoading.value = false
  }
}

function parseRolesText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^Role/i)) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 2) {
      result.push({
        key: result.length,
        name: parts[0] || '-',
        description: parts[1] || '',
        permissions: parts[2] ? parts[2].split(/[,;\s]+/).filter(Boolean) : [],
        userCount: parts[3] ? parseInt(parts[3], 10) || 0 : 0,
      })
    } else if (trimmed.length > 2) {
      result.push({
        key: result.length,
        name: trimmed.slice(0, 60),
        description: '',
        permissions: [],
        userCount: 0,
      })
    }
  }
  return result
}

// --- Tab 2: Permission Check ---
const checkUserId = ref('')
const checkPermission = ref('')
const checking = ref(false)
const checkResult = ref(null)
const quickPermissions = ['note:read', 'note:write', 'admin:*', 'skill:execute']

async function doCheck() {
  if (!checkUserId.value.trim() || !checkPermission.value.trim()) return
  checking.value = true
  checkResult.value = null
  try {
    const cmd = `auth check ${checkUserId.value.trim()} "${checkPermission.value.trim()}"`
    const { output } = await ws.execute(cmd, 15000)
    const lower = output.toLowerCase()
    const allowed = lower.includes('allow') || lower.includes('granted') || lower.includes('true') || lower.includes('yes')
    const denied = lower.includes('denied') || lower.includes('reject') || lower.includes('false') || lower.includes('no permission')
    checkResult.value = {
      allowed: allowed && !denied,
      detail: output.trim() || (allowed ? '用户拥有该权限' : '用户没有该权限'),
    }
  } catch (e) {
    checkResult.value = { allowed: false, detail: '检查失败: ' + e.message }
  } finally {
    checking.value = false
  }
}

// --- Tab 3: Audit ---
const auditLoading = ref(false)
const auditEvents = ref([])
const auditStats = ref([])

const auditColumns = [
  { title: '时间', key: 'timestamp', dataIndex: 'timestamp', width: '180px' },
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
      ws.execute('audit log --json', 15000),
      ws.execute('audit stats --json', 15000),
    ])
    auditEvents.value = parseJsonOutput(logRes.output, parseAuditLogText)
    auditStats.value = parseAuditStatsOutput(statsRes.output)
  } catch (e) {
    message.error('加载审计日志失败: ' + e.message)
  } finally {
    auditLoading.value = false
  }
}

function parseAuditLogText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Audit') || trimmed.startsWith('Recent')) continue
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 3) {
      result.push({
        key: result.length,
        timestamp: parts[0] || '-',
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
        timestamp: dateMatch[1],
        event: rest.replace(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i, '').trim().slice(0, 80),
        user: '-',
        level: levelMatch ? levelMatch[1].toLowerCase() : 'info',
        detail: '',
      })
    } else if (trimmed.length > 3 && !trimmed.match(/^\d+ event/i)) {
      result.push({
        key: result.length,
        timestamp: '-',
        event: trimmed.slice(0, 80),
        user: '-',
        level: 'info',
        detail: '',
      })
    }
  }
  return result
}

function parseAuditStatsOutput(output) {
  const json = tryParseJson(output)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const colors = ['#1677ff', '#52c41a', '#faad14', '#ff4d4f']
    return Object.entries(json).slice(0, 4).map(([k, v], i) => ({
      label: k,
      value: typeof v === 'number' ? v : String(v),
      color: colors[i % colors.length],
    }))
  }
  const stats = []
  const lines = output.split('\n')
  const colors = ['#1677ff', '#52c41a', '#faad14', '#ff4d4f']
  let colorIdx = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Audit')) continue
    const kvMatch = trimmed.match(/^(.+?)\s*[:=]\s*(.+)$/)
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
      { label: '总事件数', value: auditEvents.value.length, color: '#1677ff' },
      { label: '状态', value: '就绪', color: '#52c41a' },
    )
  }
  return stats
}

// --- Helpers ---
function tryParseJson(str) {
  try {
    const jsonStart = str.indexOf('[') !== -1 ? str.indexOf('[') : str.indexOf('{')
    if (jsonStart === -1) return null
    const jsonEnd = str.lastIndexOf(']') !== -1 ? str.lastIndexOf(']') + 1 : str.lastIndexOf('}') + 1
    return JSON.parse(str.slice(jsonStart, jsonEnd))
  } catch (_e) {
    return null
  }
}

function parseJsonOutput(output, textFallback) {
  const json = tryParseJson(output)
  if (Array.isArray(json)) {
    return json.map((item, i) => ({
      key: i,
      ...item,
    }))
  }
  return textFallback(output)
}

onMounted(() => {
  loadRoles()
})
</script>

<style scoped>
:deep(.perm-row:hover td) { background: var(--bg-card-hover) !important; }
:deep(.ant-tabs-tab) { color: var(--text-secondary) !important; }
:deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #1677ff !important; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
