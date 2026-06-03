<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('p2p.title') }}</h2>
        <p class="page-sub">{{ t('p2p.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost :loading="peersLoading" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        {{ t('p2p.refresh') }}
      </a-button>
    </div>

    <!-- P2P Devices Section -->
    <a-card
      :title="t('p2p.peers.cardTitle')"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <template #extra>
        <a-space>
          <a-button size="small" @click="showPairModal = true" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><PlusOutlined /></template>
            {{ t('p2p.peers.pairButton') }}
          </a-button>
          <a-button size="small" @click="showSendModal = true" :disabled="peers.length === 0" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><SendOutlined /></template>
            {{ t('p2p.peers.sendButton') }}
          </a-button>
        </a-space>
      </template>

      <div v-if="peersLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <a-empty v-else-if="peers.length === 0" :description="t('p2p.peers.emptyText')" />
      <a-table
        v-else
        :columns="peerColumns"
        :data-source="peers"
        :pagination="false"
        size="small"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.connected ? 'green' : 'default'">
              {{ record.connected ? t('p2p.peers.online') : t('p2p.peers.offline') }}
            </a-tag>
          </template>
          <template v-if="column.key === 'name'">
            <a-space>
              <MobileOutlined style="color: var(--text-muted);" />
              <span>{{ record.name || record.id }}</span>
            </a-space>
          </template>
          <template v-if="column.key === 'id'">
            <span style="font-family: monospace; color: var(--text-muted); font-size: 12px;">
              {{ record.id.length > 16 ? record.id.slice(0, 16) + '...' : record.id }}
            </span>
          </template>
          <template v-if="column.key === 'action'">
            <a-button size="small" type="link" @click="openSendTo(record)">
              <SendOutlined /> {{ t('p2p.peers.rowSend') }}
            </a-button>
          </template>
        </template>
      </a-table>
      <div v-if="peersError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ peersError }}</div>
    </a-card>

    <!-- Sync Section -->
    <a-card
      :title="t('p2p.sync.cardTitle')"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
      <template #extra>
        <a-tag :color="syncOnline ? 'green' : 'default'">
          {{ syncOnline ? t('p2p.sync.synced') : t('p2p.sync.notSynced') }}
        </a-tag>
      </template>

      <div v-if="syncLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <template v-else>
        <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('p2p.sync.statusLabel')"
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
                :title="t('p2p.sync.pendingLabel')"
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
                :title="t('p2p.sync.lastSyncLabel')"
                :value="lastSyncTime || t('p2p.sync.noLastSync')"
                :value-style="{ color: 'var(--text-secondary)', fontSize: '16px' }"
              >
                <template #prefix><SyncOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <a-space>
          <a-button :loading="pushLoading" @click="syncPush" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><SyncOutlined /></template>
            {{ t('p2p.sync.pushButton') }}
          </a-button>
          <a-button :loading="pullLoading" @click="syncPull" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><SyncOutlined /></template>
            {{ t('p2p.sync.pullButton') }}
          </a-button>
        </a-space>

        <div v-if="syncOutput" style="margin-top: 16px;">
          <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">{{ t('p2p.sync.outputLabel') }}</div>
          <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">{{ syncOutput }}</pre>
        </div>
      </template>
      <div v-if="syncError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ syncError }}</div>
    </a-card>

    <!-- Pair Modal -->
    <a-modal
      v-model:open="showPairModal"
      :title="t('p2p.pair.title')"
      :confirm-loading="pairLoading"
      @ok="doPair"
      :ok-text="t('p2p.pair.ok')"
      :cancel-text="t('common.cancel')"
    >
      <div style="margin-bottom: 12px; color: var(--text-secondary);">{{ t('p2p.pair.intro') }}</div>
      <a-input
        v-model:value="pairDeviceName"
        :placeholder="t('p2p.pair.placeholder')"
        @pressEnter="doPair"
      />
      <div v-if="pairResult" style="margin-top: 12px;">
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ pairResult }}</pre>
      </div>
    </a-modal>

    <!-- Send Modal -->
    <a-modal
      v-model:open="showSendModal"
      :title="t('p2p.send.title')"
      :confirm-loading="sendLoading"
      @ok="doSend"
      :ok-text="t('p2p.send.ok')"
      :cancel-text="t('common.cancel')"
    >
      <div style="margin-bottom: 8px; color: var(--text-secondary);">{{ t('p2p.send.targetLabel') }}</div>
      <a-select
        v-model:value="sendTarget"
        style="width: 100%; margin-bottom: 16px;"
        :placeholder="t('p2p.send.targetPlaceholder')"
      >
        <a-select-option v-for="p in peers" :key="p.id" :value="p.id">
          {{ p.name || p.id }}
        </a-select-option>
      </a-select>
      <div style="margin-bottom: 8px; color: var(--text-secondary);">{{ t('p2p.send.messageLabel') }}</div>
      <a-input
        v-model:value="sendMessage"
        :placeholder="t('p2p.send.messagePlaceholder')"
        @pressEnter="doSend"
      />
      <div v-if="sendResult" style="margin-top: 12px;">
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ sendResult }}</pre>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  SyncOutlined, SendOutlined, PlusOutlined,
  ReloadOutlined, MobileOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

// --- Peers ---
const peersLoading = ref(false)
const peersError = ref('')
const peers = ref([])

const peerColumns = computed(() => [
  { title: t('p2p.peerColumns.name'), key: 'name' },
  { title: t('p2p.peerColumns.id'), key: 'id' },
  { title: t('p2p.peerColumns.status'), key: 'status' },
  { title: t('p2p.peerColumns.action'), key: 'action', width: 100 },
])

async function loadPeers() {
  peersLoading.value = true
  peersError.value = ''
  try {
    const { output } = await ws.execute('p2p peers', 15000)
    peers.value = parsePeersOutput(output)
  } catch (e) {
    peersError.value = t('p2p.messages.loadPeersFailed', { err: e.message })
  } finally {
    peersLoading.value = false
  }
}

function parsePeersOutput(output) {
  if (!output || output.includes('No peers') || output.includes('no peers')) return []
  const lines = output.split('\n').filter(l => l.trim())
  const result = []
  for (const line of lines) {
    const match = line.match(/^\s*(\S+)\s+(.+?)\s+(connected|online|offline|disconnected)\s*$/i)
    if (match) {
      result.push({
        id: match[1],
        name: match[2].trim(),
        connected: /connected|online/i.test(match[3]),
      })
      continue
    }
    const idMatch = line.match(/^\s*((?:12D3|Qm)\S{10,})\s*(.*)$/)
    if (idMatch) {
      const rest = idMatch[2].trim()
      result.push({
        id: idMatch[1],
        name: rest || idMatch[1].slice(0, 12),
        connected: /connected|online/i.test(rest),
      })
    }
  }
  return result
}

// --- Pair ---
const showPairModal = ref(false)
const pairLoading = ref(false)
const pairDeviceName = ref('')
const pairResult = ref('')

async function doPair() {
  if (!pairDeviceName.value.trim()) return
  pairLoading.value = true
  pairResult.value = ''
  try {
    const { output } = await ws.execute(`p2p pair "${pairDeviceName.value.trim()}"`, 30000)
    pairResult.value = output
    await loadPeers()
  } catch (e) {
    pairResult.value = t('p2p.messages.pairFailed', { err: e.message })
  } finally {
    pairLoading.value = false
  }
}

// --- Send ---
const showSendModal = ref(false)
const sendLoading = ref(false)
const sendTarget = ref(undefined)
const sendMessage = ref('')
const sendResult = ref('')

function openSendTo(peer) {
  sendTarget.value = peer.id
  sendMessage.value = ''
  sendResult.value = ''
  showSendModal.value = true
}

async function doSend() {
  if (!sendTarget.value || !sendMessage.value.trim()) return
  sendLoading.value = true
  sendResult.value = ''
  try {
    const { output } = await ws.execute(`p2p send ${sendTarget.value} "${sendMessage.value.trim()}"`, 15000)
    sendResult.value = output || t('p2p.send.messageDefault')
  } catch (e) {
    sendResult.value = t('p2p.messages.sendFailed', { err: e.message })
  } finally {
    sendLoading.value = false
  }
}

// --- Sync ---
const syncLoading = ref(false)
const syncError = ref('')
const syncOnline = ref(false)
const syncStatusText = ref('')
const syncPending = ref(0)
const lastSyncTime = ref('')
const syncOutput = ref('')
const pushLoading = ref(false)
const pullLoading = ref(false)

async function loadSync() {
  syncLoading.value = true
  syncError.value = ''
  try {
    const { output } = await ws.execute('sync status', 15000)
    parseSyncStatus(output)
  } catch (e) {
    syncError.value = t('p2p.messages.loadSyncFailed', { err: e.message })
  } finally {
    syncLoading.value = false
  }
}

function parseSyncStatus(output) {
  if (!output) {
    syncStatusText.value = t('p2p.sync.unknown')
    return
  }
  syncOnline.value = /synced|online|up.to.date/i.test(output)
  syncStatusText.value = syncOnline.value ? t('p2p.sync.synced') : t('p2p.sync.notSynced')

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
    syncOutput.value = output || t('p2p.sync.pushDefault')
    await loadSync()
  } catch (e) {
    syncOutput.value = t('p2p.messages.pushFailed', { err: e.message })
  } finally {
    pushLoading.value = false
  }
}

async function syncPull() {
  pullLoading.value = true
  syncOutput.value = ''
  try {
    const { output } = await ws.execute('sync pull', 30000)
    syncOutput.value = output || t('p2p.sync.pullDefault')
    await loadSync()
  } catch (e) {
    syncOutput.value = t('p2p.messages.pullFailed', { err: e.message })
  } finally {
    pullLoading.value = false
  }
}

// --- Init ---
async function refreshAll() {
  await Promise.all([loadPeers(), loadSync()])
}

onMounted(refreshAll)
</script>

<style scoped>
:deep(.ant-table) {
  background: transparent;
}
:deep(.ant-select-selector) {
  background: var(--bg-card) !important;
  border-color: var(--border-color) !important;
}
</style>
