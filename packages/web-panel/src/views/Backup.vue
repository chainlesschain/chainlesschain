<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('backup.title') }}</h2>
        <p class="page-sub">{{ t('backup.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="refreshing" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        {{ t('backup.refresh') }}
      </a-button>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Tab 1: Backup management -->
      <a-tab-pane key="backup">
        <template #tab><CloudUploadOutlined /> {{ t('backup.tabs.backup') }}</template>

        <a-card
          style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
        >
          <template #title>
            <a-space>
              <CloudUploadOutlined />
              <span>{{ t('backup.backup.cardTitle') }}</span>
            </a-space>
          </template>
          <template #extra>
            <a-space>
              <a-button
                :disabled="!backups.length"
                :loading="exportingList"
                @click="exportBackupList"
              >
                <template #icon><DownloadOutlined /></template>
                {{ t('backup.backup.exportButton') }}
              </a-button>
              <a-button type="primary" :loading="backupCreating" @click="createBackup">
                <template #icon><PlusOutlined /></template>
                {{ t('backup.backup.createButton') }}
              </a-button>
            </a-space>
          </template>

          <div v-if="backupLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
          <a-empty v-else-if="backups.length === 0 && !lastBackupResult" :description="t('backup.backup.emptyText')" />

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
                  {{ t('backup.backupColumns.restore') }}
                </a-button>
              </template>
            </template>
          </a-table>

          <!-- Last backup result (fallback when no list) -->
          <div v-if="lastBackupResult" style="margin-top: 16px;">
            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">{{ t('backup.backup.lastResultLabel') }}</div>
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">{{ lastBackupResult }}</pre>
          </div>

          <div v-if="backupError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ backupError }}</div>
        </a-card>

        <!-- Restore confirmation modal -->
        <a-modal
          v-model:open="showRestoreModal"
          :title="t('backup.backup.restoreTitle')"
          :ok-text="t('backup.backup.restoreOk')"
          :cancel-text="t('common.cancel')"
          :confirm-loading="restoreLoading"
          @ok="doRestore"
          ok-type="danger"
        >
          <p style="color: var(--text-secondary);">
            {{ t('backup.backup.restoreIntro') }}
          </p>
          <div v-if="restoreTarget" style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; margin-top: 8px;">
            <div><strong>{{ t('backup.backup.backupIdPrefix') }}</strong> <span style="font-family: monospace;">{{ restoreTarget.id }}</span></div>
            <div v-if="restoreTarget.createdAt"><strong>{{ t('backup.backup.createdAtPrefix') }}</strong> {{ restoreTarget.createdAt }}</div>
          </div>
          <div v-if="restoreResult" style="margin-top: 12px;">
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ restoreResult }}</pre>
          </div>
        </a-modal>
      </a-tab-pane>

      <!-- Tab 2: Data sync -->
      <a-tab-pane key="sync">
        <template #tab><SyncOutlined /> {{ t('backup.tabs.sync') }}</template>

        <div v-if="syncLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
        <template v-else>
          <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic
                  :title="t('backup.sync.statusLabel')"
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
                  :title="t('backup.sync.pendingLabel')"
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
                  :title="t('backup.sync.lastSyncLabel')"
                  :value="lastSyncTime || t('backup.sync.noLastSync')"
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
              {{ t('backup.sync.pushButton') }}
            </a-button>
            <a-button :loading="pullLoading" @click="syncPull" style="background: var(--bg-card-hover); border-color: var(--border-color);">
              <template #icon><SyncOutlined /></template>
              {{ t('backup.sync.pullButton') }}
            </a-button>
          </a-space>

          <div v-if="syncOutput" style="margin-bottom: 16px;">
            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">{{ t('backup.sync.outputLabel') }}</div>
            <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">{{ syncOutput }}</pre>
          </div>

          <!-- Conflicts -->
          <a-card
            v-if="conflicts.length > 0"
            :title="t('backup.sync.conflictsTitle')"
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
                  <a-tag color="red">{{ record.type || t('backup.sync.conflictDefault') }}</a-tag>
                </template>
              </template>
            </a-table>
          </a-card>
        </template>

        <div v-if="syncError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ syncError }}</div>
      </a-tab-pane>

      <!-- Tab 3: IPFS storage -->
      <a-tab-pane key="ipfs">
        <template #tab><HddOutlined /> {{ t('backup.tabs.ipfs') }}</template>

        <!-- IPFS Status -->
        <a-card
          :title="t('backup.ipfs.statusCardTitle')"
          style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
        >
          <template #extra>
            <a-tag :color="ipfsOnline ? 'green' : 'default'">
              {{ ipfsOnline ? t('backup.ipfs.online') : t('backup.ipfs.offline') }}
            </a-tag>
          </template>

          <div v-if="ipfsLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
          <template v-else>
            <a-row :gutter="[16, 16]">
              <a-col :xs="24" :sm="8">
                <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                  <a-statistic
                    :title="t('backup.ipfs.nodeStatusLabel')"
                    :value="ipfsOnline ? t('backup.ipfs.connected') : t('backup.ipfs.disconnected')"
                    :value-style="{ color: ipfsOnline ? '#52c41a' : '#888', fontSize: '16px' }"
                  >
                    <template #prefix><HddOutlined /></template>
                  </a-statistic>
                </a-card>
              </a-col>
              <a-col :xs="24" :sm="8">
                <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                  <a-statistic
                    :title="t('backup.ipfs.pinnedLabel')"
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
                    :title="t('backup.ipfs.peerIdLabel')"
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
          :title="t('backup.ipfs.pinListTitle')"
          style="background: var(--bg-card); border-color: var(--border-color);"
        >
          <template #extra>
            <a-button size="small" @click="showPinModal = true" style="background: var(--bg-card-hover); border-color: var(--border-color);">
              <template #icon><PlusOutlined /></template>
              {{ t('backup.ipfs.pinFileButton') }}
            </a-button>
          </template>

          <div v-if="pinsLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
          <a-empty v-else-if="pins.length === 0" :description="t('backup.ipfs.pinEmptyText')" />
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
                  :title="t('backup.ipfs.unpinConfirm')"
                  :ok-text="t('backup.ipfs.unpinOk')"
                  :cancel-text="t('common.cancel')"
                  @confirm="unpinFile(record)"
                >
                  <a-button size="small" type="link" danger>
                    <DeleteOutlined /> {{ t('backup.ipfs.unpinAction') }}
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
          :title="t('backup.ipfs.pinModalTitle')"
          :confirm-loading="pinLoading"
          @ok="doPin"
          :ok-text="t('backup.ipfs.pinModalOk')"
          :cancel-text="t('common.cancel')"
        >
          <div style="margin-bottom: 12px; color: var(--text-secondary);">{{ t('backup.ipfs.pinModalIntro') }}</div>
          <a-input
            v-model:value="pinFilePath"
            :placeholder="t('backup.ipfs.pinModalPlaceholder')"
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
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { tryParseJson } from '../utils/community-parser.js'
import {
  CloudUploadOutlined, SyncOutlined, HddOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined,
  DownloadOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useFs } from '../composables/useFs.js'
import { formatSize } from '../utils/format-size.js'

const { t } = useI18n()
const ws = useWsStore()
const fs = useFs()
const exportingList = ref(false)

const activeTab = ref('backup')
const refreshing = ref(false)

// ==================== Tab 1: Backup management ====================
const backupLoading = ref(false)
const backupCreating = ref(false)
const backupError = ref('')
const backups = ref([])
const lastBackupResult = ref('')

const backupColumns = computed(() => [
  { title: t('backup.backupColumns.id'), key: 'id' },
  { title: t('backup.backupColumns.size'), key: 'size', width: 120 },
  { title: t('backup.backupColumns.createdAt'), key: 'createdAt' },
  { title: t('backup.backupColumns.action'), key: 'action', width: 100 },
])

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
    backupError.value = t('backup.messages.loadBackupsFailed', { err: e.message })
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
    lastBackupResult.value = output || t('backup.backup.createDefaultMessage')
    await loadBackups()
  } catch (e) {
    lastBackupResult.value = t('backup.messages.createBackupFailed', { err: e.message })
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
    restoreResult.value = output || t('backup.backup.restoreDefaultMessage')
  } catch (e) {
    restoreResult.value = t('backup.messages.restoreFailed', { err: e.message })
  } finally {
    restoreLoading.value = false
  }
}

// ==================== Tab 2: Data sync ====================
const syncLoading = ref(false)
const syncError = ref('')
const syncOnline = ref(false)
const syncStatusText = ref('')
const syncPending = ref(0)
const lastSyncTime = ref('')
const syncOutput = ref('')
const pushLoading = ref(false)
const pullLoading = ref(false)
const conflicts = ref([])

const conflictColumns = computed(() => [
  { title: t('backup.conflictColumns.path'), key: 'path' },
  { title: t('backup.conflictColumns.type'), key: 'type', width: 120 },
])

async function loadSync() {
  syncLoading.value = true
  syncError.value = ''
  try {
    const { output } = await ws.execute('sync status --json', 15000)
    const parsed = safeParseJson(output)
    if (parsed) {
      syncOnline.value = parsed.online || parsed.synced || parsed.status === 'online' || false
      syncStatusText.value = syncOnline.value ? t('backup.sync.synced') : t('backup.sync.notSynced')
      syncPending.value = parsed.pending ?? parsed.pendingChanges ?? 0
      lastSyncTime.value = parsed.lastSync || parsed.lastSyncTime || ''
    } else {
      parseSyncStatusText(output)
    }
  } catch (e) {
    syncError.value = t('backup.messages.loadSyncFailed', { err: e.message })
  } finally {
    syncLoading.value = false
  }
}

function parseSyncStatusText(output) {
  if (!output) {
    syncStatusText.value = t('backup.sync.unknown')
    return
  }
  syncOnline.value = /synced|online|up.to.date/i.test(output)
  syncStatusText.value = syncOnline.value ? t('backup.sync.synced') : t('backup.sync.notSynced')

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
    syncOutput.value = output || t('backup.sync.pushDefaultMessage')
    await loadSync()
  } catch (e) {
    syncOutput.value = t('backup.messages.pushFailed', { err: e.message })
  } finally {
    pushLoading.value = false
  }
}

async function syncPull() {
  pullLoading.value = true
  syncOutput.value = ''
  try {
    const { output } = await ws.execute('sync pull', 30000)
    syncOutput.value = output || t('backup.sync.pullDefaultMessage')
    await loadSync()
  } catch (e) {
    syncOutput.value = t('backup.messages.pullFailed', { err: e.message })
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

// ==================== Tab 3: IPFS storage ====================
const ipfsLoading = ref(false)
const ipfsError = ref('')
const ipfsOnline = ref(false)
const ipfsPeerId = ref('')
const pinsLoading = ref(false)
const pinsError = ref('')
const pins = ref([])

const pinColumns = computed(() => [
  { title: t('backup.pinColumns.cid'), key: 'cid' },
  { title: t('backup.pinColumns.name'), key: 'name' },
  { title: t('backup.pinColumns.size'), key: 'size', width: 120 },
  { title: t('backup.pinColumns.pinnedAt'), key: 'pinnedAt' },
  { title: t('backup.pinColumns.action'), key: 'action', width: 120 },
])

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
    ipfsError.value = t('backup.messages.loadIpfsFailed', { err: e.message })
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
    pinsError.value = t('backup.messages.loadPinsFailed', { err: e.message })
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
    pinResult.value = output || t('backup.ipfs.pinDefaultSuccess')
    await loadPins()
  } catch (e) {
    pinResult.value = t('backup.messages.pinFailed', { err: e.message })
  } finally {
    pinLoading.value = false
  }
}

async function unpinFile(record) {
  try {
    await ws.execute(`ipfs unpin ${record.cid}`, 15000)
    await loadPins()
  } catch (e) {
    pinsError.value = t('backup.messages.unpinFailed', { err: e.message })
  }
}

// ==================== Helpers ====================
// Delegate to the shared robust parser (strips CLI noise + brace-balanced
// candidate extraction) instead of a greedy `/\{[\s\S]*\}/` that over-captures
// when the CLI output wraps the JSON in prose / bracketed tags.
function safeParseJson(str) {
  return tryParseJson(str)
}

async function exportBackupList() {
  if (!backups.value.length) return
  exportingList.value = true
  try {
    const r = await fs.saveJson(
      { schema: 1, exportedAt: new Date().toISOString(), count: backups.value.length, backups: backups.value },
      { defaultPath: `backup-list-${new Date().toISOString().slice(0, 10)}.json` },
    )
    if (r.canceled) return
    message.success(r.path
      ? t('backup.messages.exportOk', { count: backups.value.length, path: r.path })
      : t('backup.messages.exportOkDefault'))
  } catch (e) {
    message.error(t('backup.messages.exportFailed', { err: e.message || e }))
  } finally {
    exportingList.value = false
  }
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
