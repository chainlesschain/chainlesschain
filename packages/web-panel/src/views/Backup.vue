<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">备份与同步</h2>
        <p class="page-sub">备份管理 / 数据同步 / IPFS</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Tab 1: 备份管理 -->
      <a-tab-pane key="backup">
        <template #tab><CloudUploadOutlined /> 备份管理</template>

        <a-card
          style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
        >
          <template #title>
            <a-space>
              <CloudUploadOutlined />
              <span>备份操作</span>
            </a-space>
          </template>
          <template #extra>
            <a-button type="primary" :loading="backupCreating" @click="createBackup">
              <template #icon><PlusOutlined /></template>
              创建备份
            </a-button>
          </template>

          <div v-if="backupLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
          <a-empty v-else-if="backups.length === 0 && !lastBackupResult" description="暂无备份记录" />

          <!-- Backup list -->
          <a-table
            v-if="backups.length > 0"
            :columns="backupColumns"
            :data-source="backups"
            :pagination="false"
            size="small"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'id'">
                <span style="font-family: monospace; color: var(--text-muted); font-size: 12px;">
                  {{ record.id.length > 20 ? record.id.slice(0, 20) + '...' : record.id }}
                </span>
              </template>
              <template v-if="column.key === 'size'">
                <span>{{ formatSize(record.size) }}</span>
              </template>
              <template v-if="column.key === 'createdAt'">
                <span style="color: var(--text-secondary); font-size: 12px;">{{ record.createdAt || '-' }}</span>
              </template>
              <template v-if="column.key === 'action'">
                <a-button size="small" type="link" @click="confirmRestore(record)">
                  恢复
                </a-button>
              </template>
            </template>
          </a-table>

          <!-- Last backup result (fallback when no list) -->
          <div v-if="lastBackupResult" style="margin-top: 16px;">
            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">最近操作结果</div>
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">{{ lastBackupResult }}</pre>
          </div>

          <div v-if="backupError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ backupError }}</div>
        </a-card>

        <!-- Restore confirmation modal -->
        <a-modal
          v-model:open="showRestoreModal"
          title="确认恢复备份"
          ok-text="确认恢复"
          cancel-text="取消"
          :confirm-loading="restoreLoading"
          @ok="doRestore"
          ok-type="danger"
        >
          <p style="color: var(--text-secondary);">
            确定要恢复以下备份吗？此操作将覆盖当前数据。
          </p>
          <div v-if="restoreTarget" style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; margin-top: 8px;">
            <div><strong>备份 ID:</strong> <span style="font-family: monospace;">{{ restoreTarget.id }}</span></div>
            <div v-if="restoreTarget.createdAt"><strong>创建时间:</strong> {{ restoreTarget.createdAt }}</div>
          </div>
          <div v-if="restoreResult" style="margin-top: 12px;">
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ restoreResult }}</pre>
          </div>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: 数据同步 -->
      <a-tab-pane key="sync">
        <template #tab><SyncOutlined /> 数据同步</template>

        <div v-if="syncLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
        <template v-else>
          <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic
                  title="同步状态"
                  :value="syncStatusText"
                  :value-style="{ color: syncOnline ? '#52c41a' : '#888', fontSize: '16px' }"
                >
                  <template #prefix><SyncOutlined /></template>
                </a-statistic>
              </a-card>
            </a-col>
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic
                  title="待同步变更"
                  :value="syncPending"
                  :value-style="{ color: syncPending > 0 ? '#faad14' : '#52c41a', fontSize: '16px' }"
                >
                  <template #prefix><SyncOutlined /></template>
                </a-statistic>
              </a-card>
            </a-col>
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic
                  title="最近同步"
                  :value="lastSyncTime || '无'"
                  :value-style="{ color: 'var(--text-secondary)', fontSize: '16px' }"
                >
                  <template #prefix><SyncOutlined /></template>
                </a-statistic>
              </a-card>
            </a-col>
          </a-row>

          <a-space style="margin-bottom: 16px;">
            <a-button :loading="pushLoading" @click="syncPush" style="background: var(--bg-card-hover); border-color: var(--border-color);">
              <template #icon><CloudUploadOutlined /></template>
              推送
            </a-button>
            <a-button :loading="pullLoading" @click="syncPull" style="background: var(--bg-card-hover); border-color: var(--border-color);">
              <template #icon><SyncOutlined /></template>
              拉取
            </a-button>
          </a-space>

          <div v-if="syncOutput" style="margin-bottom: 16px;">
            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">操作结果</div>
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">{{ syncOutput }}</pre>
          </div>

          <!-- Conflicts -->
          <a-card
            v-if="conflicts.length > 0"
            title="冲突列表"
            style="background: var(--bg-card); border-color: var(--border-color);"
          >
            <a-table
              :columns="conflictColumns"
              :data-source="conflicts"
              :pagination="false"
              size="small"
              row-key="path"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'path'">
                  <span style="font-family: monospace; font-size: 12px;">{{ record.path }}</span>
                </template>
                <template v-if="column.key === 'type'">
                  <a-tag color="red">{{ record.type || '冲突' }}</a-tag>
                </template>
              </template>
            </a-table>
          </a-card>
        </template>

        <div v-if="syncError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ syncError }}</div>
      </a-tab-pane>

      <!-- Tab 3: IPFS 存储 -->
      <a-tab-pane key="ipfs">
        <template #tab><HddOutlined /> IPFS 存储</template>

        <!-- IPFS Status -->
        <a-card
          title="IPFS 状态"
          style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
        >
          <template #extra>
            <a-tag :color="ipfsOnline ? 'green' : 'default'">
              {{ ipfsOnline ? '在线' : '离线' }}
            </a-tag>
          </template>

          <div v-if="ipfsLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
          <template v-else>
            <a-row :gutter="[16, 16]">
              <a-col :xs="24" :sm="8">
                <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                  <a-statistic
                    title="节点状态"
                    :value="ipfsOnline ? '已连接' : '未连接'"
                    :value-style="{ color: ipfsOnline ? '#52c41a' : '#888', fontSize: '16px' }"
                  >
                    <template #prefix><HddOutlined /></template>
                  </a-statistic>
                </a-card>
              </a-col>
              <a-col :xs="24" :sm="8">
                <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                  <a-statistic
                    title="已固定文件"
                    :value="pins.length"
                    :value-style="{ fontSize: '16px' }"
                  >
                    <template #prefix><HddOutlined /></template>
                  </a-statistic>
                </a-card>
              </a-col>
              <a-col :xs="24" :sm="8">
                <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                  <a-statistic
                    title="Peer ID"
                    :value="ipfsPeerId || '-'"
                    :value-style="{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'monospace' }"
                  >
                    <template #prefix><HddOutlined /></template>
                  </a-statistic>
                </a-card>
              </a-col>
            </a-row>
          </template>
          <div v-if="ipfsError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ ipfsError }}</div>
        </a-card>

        <!-- Pin List -->
        <a-card
          title="固定文件列表"
          style="background: var(--bg-card); border-color: var(--border-color);"
        >
          <template #extra>
            <a-button size="small" @click="showPinModal = true" style="background: var(--bg-card-hover); border-color: var(--border-color);">
              <template #icon><PlusOutlined /></template>
              固定文件
            </a-button>
          </template>

          <div v-if="pinsLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
          <a-empty v-else-if="pins.length === 0" description="暂无固定文件" />
          <a-table
            v-else
            :columns="pinColumns"
            :data-source="pins"
            :pagination="{ pageSize: 10 }"
            size="small"
            row-key="cid"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'cid'">
                <span style="font-family: monospace; color: var(--text-muted); font-size: 12px;">
                  {{ record.cid.length > 24 ? record.cid.slice(0, 24) + '...' : record.cid }}
                </span>
              </template>
              <template v-if="column.key === 'name'">
                <span>{{ record.name || '-' }}</span>
              </template>
              <template v-if="column.key === 'size'">
                <span>{{ formatSize(record.size) }}</span>
              </template>
              <template v-if="column.key === 'pinnedAt'">
                <span style="color: var(--text-secondary); font-size: 12px;">{{ record.pinnedAt || '-' }}</span>
              </template>
              <template v-if="column.key === 'action'">
                <a-popconfirm
                  title="确定取消固定？"
                  ok-text="确定"
                  cancel-text="取消"
                  @confirm="unpinFile(record)"
                >
                  <a-button size="small" type="link" danger>
                    <DeleteOutlined /> 取消固定
                  </a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
          <div v-if="pinsError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ pinsError }}</div>
        </a-card>

        <!-- Pin file modal -->
        <a-modal
          v-model:open="showPinModal"
          title="固定文件到 IPFS"
          :confirm-loading="pinLoading"
          @ok="doPin"
          ok-text="固定"
          cancel-text="取消"
        >
          <div style="margin-bottom: 12px; color: var(--text-secondary);">请输入要固定的文件路径</div>
          <a-input
            v-model:value="pinFilePath"
            placeholder="文件路径，例如: /path/to/file.txt"
            @pressEnter="doPin"
          />
          <div v-if="pinResult" style="margin-top: 12px;">
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ pinResult }}</pre>
          </div>
        </a-modal>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  CloudUploadOutlined, SyncOutlined, HddOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

const activeTab = ref('backup')
const refreshing = ref(false)

// ==================== Tab 1: 备份管理 ====================
const backupLoading = ref(false)
const backupCreating = ref(false)
const backupError = ref('')
const backups = ref([])
const lastBackupResult = ref('')

const backupColumns = [
  { title: '备份 ID', key: 'id' },
  { title: '大小', key: 'size', width: 120 },
  { title: '创建时间', key: 'createdAt' },
  { title: '操作', key: 'action', width: 100 },
]

async function loadBackups() {
  backupLoading.value = true
  backupError.value = ''
  try {
    const { output } = await ws.execute('backup list --json', 15000)
    const parsed = safeParseJson(output)
    if (Array.isArray(parsed)) {
      backups.value = parsed
    } else if (parsed && Array.isArray(parsed.backups)) {
      backups.value = parsed.backups
    } else {
      backups.value = []
      if (output && output.trim()) {
        lastBackupResult.value = output
      }
    }
  } catch (e) {
    backupError.value = `加载备份列表失败: ${e.message}`
  } finally {
    backupLoading.value = false
  }
}

async function createBackup() {
  backupCreating.value = true
  lastBackupResult.value = ''
  backupError.value = ''
  try {
    const { output } = await ws.execute('backup create --json', 30000)
    lastBackupResult.value = output || '备份已创建'
    await loadBackups()
  } catch (e) {
    lastBackupResult.value = `创建备份失败: ${e.message}`
  } finally {
    backupCreating.value = false
  }
}

// Restore
const showRestoreModal = ref(false)
const restoreLoading = ref(false)
const restoreTarget = ref(null)
const restoreResult = ref('')

function confirmRestore(record) {
  restoreTarget.value = record
  restoreResult.value = ''
  showRestoreModal.value = true
}

async function doRestore() {
  if (!restoreTarget.value) return
  restoreLoading.value = true
  restoreResult.value = ''
  try {
    const { output } = await ws.execute(`backup restore ${restoreTarget.value.id}`, 60000)
    restoreResult.value = output || '恢复完成'
  } catch (e) {
    restoreResult.value = `恢复失败: ${e.message}`
  } finally {
    restoreLoading.value = false
  }
}

// ==================== Tab 2: 数据同步 ====================
const syncLoading = ref(false)
const syncError = ref('')
const syncOnline = ref(false)
const syncStatusText = ref('未知')
const syncPending = ref(0)
const lastSyncTime = ref('')
const syncOutput = ref('')
const pushLoading = ref(false)
const pullLoading = ref(false)
const conflicts = ref([])

const conflictColumns = [
  { title: '文件路径', key: 'path' },
  { title: '冲突类型', key: 'type', width: 120 },
]

async function loadSync() {
  syncLoading.value = true
  syncError.value = ''
  try {
    const { output } = await ws.execute('sync status --json', 15000)
    const parsed = safeParseJson(output)
    if (parsed) {
      syncOnline.value = parsed.online || parsed.synced || parsed.status === 'online' || false
      syncStatusText.value = syncOnline.value ? '已同步' : '未同步'
      syncPending.value = parsed.pending ?? parsed.pendingChanges ?? 0
      lastSyncTime.value = parsed.lastSync || parsed.lastSyncTime || ''
    } else {
      parseSyncStatusText(output)
    }
  } catch (e) {
    syncError.value = `加载同步状态失败: ${e.message}`
  } finally {
    syncLoading.value = false
  }
}

function parseSyncStatusText(output) {
  if (!output) {
    syncStatusText.value = '未知'
    return
  }
  syncOnline.value = /synced|online|up.to.date/i.test(output)
  syncStatusText.value = syncOnline.value ? '已同步' : '未同步'

  const pendingMatch = output.match(/pending[:\s]+(\d+)/i)
  syncPending.value = pendingMatch ? parseInt(pendingMatch[1]) : 0

  const timeMatch = output.match(/last[:\s]+(.+)/i)
  if (timeMatch) {
    lastSyncTime.value = timeMatch[1].trim()
  }
}

async function syncPush() {
  pushLoading.value = true
  syncOutput.value = ''
  try {
    const { output } = await ws.execute('sync push', 30000)
    syncOutput.value = output || '推送完成'
    await loadSync()
  } catch (e) {
    syncOutput.value = `推送失败: ${e.message}`
  } finally {
    pushLoading.value = false
  }
}

async function syncPull() {
  pullLoading.value = true
  syncOutput.value = ''
  try {
    const { output } = await ws.execute('sync pull', 30000)
    syncOutput.value = output || '拉取完成'
    await loadSync()
  } catch (e) {
    syncOutput.value = `拉取失败: ${e.message}`
  } finally {
    pullLoading.value = false
  }
}

async function loadConflicts() {
  try {
    const { output } = await ws.execute('sync conflicts --json', 15000)
    const parsed = safeParseJson(output)
    if (Array.isArray(parsed)) {
      conflicts.value = parsed
    } else if (parsed && Array.isArray(parsed.conflicts)) {
      conflicts.value = parsed.conflicts
    } else {
      conflicts.value = []
    }
  } catch (_e) {
    conflicts.value = []
  }
}

// ==================== Tab 3: IPFS 存储 ====================
const ipfsLoading = ref(false)
const ipfsError = ref('')
const ipfsOnline = ref(false)
const ipfsPeerId = ref('')
const pinsLoading = ref(false)
const pinsError = ref('')
const pins = ref([])

const pinColumns = [
  { title: 'CID', key: 'cid' },
  { title: '名称', key: 'name' },
  { title: '大小', key: 'size', width: 120 },
  { title: '固定时间', key: 'pinnedAt' },
  { title: '操作', key: 'action', width: 120 },
]

async function loadIpfsStatus() {
  ipfsLoading.value = true
  ipfsError.value = ''
  try {
    const { output } = await ws.execute('ipfs status --json', 15000)
    const parsed = safeParseJson(output)
    if (parsed) {
      ipfsOnline.value = parsed.online || parsed.status === 'online' || parsed.connected || false
      ipfsPeerId.value = parsed.peerId || parsed.id || ''
    } else {
      ipfsOnline.value = output ? /online|connected|running/i.test(output) : false
      const idMatch = output ? output.match(/(?:peer\s*id|id)[:\s]+(\S+)/i) : null
      ipfsPeerId.value = idMatch ? idMatch[1] : ''
    }
  } catch (e) {
    ipfsError.value = `加载 IPFS 状态失败: ${e.message}`
  } finally {
    ipfsLoading.value = false
  }
}

async function loadPins() {
  pinsLoading.value = true
  pinsError.value = ''
  try {
    const { output } = await ws.execute('ipfs pins --json', 15000)
    const parsed = safeParseJson(output)
    if (Array.isArray(parsed)) {
      pins.value = parsed
    } else if (parsed && Array.isArray(parsed.pins)) {
      pins.value = parsed.pins
    } else {
      pins.value = []
    }
  } catch (e) {
    pinsError.value = `加载固定列表失败: ${e.message}`
  } finally {
    pinsLoading.value = false
  }
}

// Pin file modal
const showPinModal = ref(false)
const pinLoading = ref(false)
const pinFilePath = ref('')
const pinResult = ref('')

async function doPin() {
  if (!pinFilePath.value.trim()) return
  pinLoading.value = true
  pinResult.value = ''
  try {
    const { output } = await ws.execute(`ipfs pin "${pinFilePath.value.trim()}"`, 30000)
    pinResult.value = output || '固定成功'
    await loadPins()
  } catch (e) {
    pinResult.value = `固定失败: ${e.message}`
  } finally {
    pinLoading.value = false
  }
}

async function unpinFile(record) {
  try {
    await ws.execute(`ipfs unpin ${record.cid}`, 15000)
    await loadPins()
  } catch (e) {
    pinsError.value = `取消固定失败: ${e.message}`
  }
}

// ==================== Helpers ====================
function safeParseJson(str) {
  if (!str || !str.trim()) return null
  try {
    return JSON.parse(str.trim())
  } catch (_e) {
    const match = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (match) {
      try { return JSON.parse(match[0]) } catch (_e2) { /* ignore */ }
    }
    return null
  }
}

function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '-'
  const num = Number(bytes)
  if (num === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(num) / Math.log(1024))
  return (num / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

// ==================== Init ====================
async function refreshAll() {
  refreshing.value = true
  try {
    await Promise.all([
      loadBackups(),
      loadSync(),
      loadConflicts(),
      loadIpfsStatus(),
      loadPins(),
    ])
  } finally {
    refreshing.value = false
  }
}

onMounted(refreshAll)
</script>

<style scoped>
:deep(.ant-table) {
  background: transparent;
}
:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab) {
  background: var(--bg-card);
  border-color: var(--border-color);
}
:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab-active) {
  background: var(--bg-card-hover);
  border-bottom-color: var(--bg-card-hover);
}
:deep(.ant-select-selector) {
  background: var(--bg-card) !important;
  border-color: var(--border-color) !important;
}
</style>
