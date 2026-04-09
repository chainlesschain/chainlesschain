<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">P2P 网络</h2>
        <p class="page-sub">设备管理与数据同步</p>
      </div>
      <a-button type="primary" ghost :loading="peersLoading" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- P2P 设备 Section -->
    <a-card
      title="P2P 设备"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
    >
      <template #extra>
        <a-space>
          <a-button size="small" @click="showPairModal = true" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><PlusOutlined /></template>
            配对设备
          </a-button>
          <a-button size="small" @click="showSendModal = true" :disabled="peers.length === 0" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><SendOutlined /></template>
            发送消息
          </a-button>
        </a-space>
      </template>

      <div v-if="peersLoading" style="text-align: center; padding: 30px;"><a-spin /></div>
      <a-empty v-else-if="peers.length === 0" description="暂无已连接设备" />
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
              {{ record.connected ? '在线' : '离线' }}
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
              <SendOutlined /> 发送
            </a-button>
          </template>
        </template>
      </a-table>
      <div v-if="peersError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ peersError }}</div>
    </a-card>

    <!-- 同步状态 Section -->
    <a-card
      title="同步状态"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
      <template #extra>
        <a-tag :color="syncOnline ? 'green' : 'default'">
          {{ syncOnline ? '已同步' : '未同步' }}
        </a-tag>
      </template>

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
                title="待推送"
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

        <a-space>
          <a-button :loading="pushLoading" @click="syncPush" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><SyncOutlined /></template>
            推送变更
          </a-button>
          <a-button :loading="pullLoading" @click="syncPull" style="background: var(--bg-card-hover); border-color: var(--border-color);">
            <template #icon><SyncOutlined /></template>
            拉取变更
          </a-button>
        </a-space>

        <div v-if="syncOutput" style="margin-top: 16px;">
          <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 6px;">操作结果</div>
          <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">{{ syncOutput }}</pre>
        </div>
      </template>
      <div v-if="syncError" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ syncError }}</div>
    </a-card>

    <!-- 配对设备 Modal -->
    <a-modal
      v-model:open="showPairModal"
      title="配对新设备"
      :confirm-loading="pairLoading"
      @ok="doPair"
      ok-text="配对"
      cancel-text="取消"
    >
      <div style="margin-bottom: 12px; color: var(--text-secondary);">请输入要配对的设备名称</div>
      <a-input
        v-model:value="pairDeviceName"
        placeholder="设备名称，例如: My Phone"
        @pressEnter="doPair"
      />
      <div v-if="pairResult" style="margin-top: 12px;">
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ pairResult }}</pre>
      </div>
    </a-modal>

    <!-- 发送消息 Modal -->
    <a-modal
      v-model:open="showSendModal"
      title="发送消息"
      :confirm-loading="sendLoading"
      @ok="doSend"
      ok-text="发送"
      cancel-text="取消"
    >
      <div style="margin-bottom: 8px; color: var(--text-secondary);">选择目标设备</div>
      <a-select
        v-model:value="sendTarget"
        style="width: 100%; margin-bottom: 16px;"
        placeholder="选择设备"
      >
        <a-select-option v-for="p in peers" :key="p.id" :value="p.id">
          {{ p.name || p.id }}
        </a-select-option>
      </a-select>
      <div style="margin-bottom: 8px; color: var(--text-secondary);">消息内容</div>
      <a-input
        v-model:value="sendMessage"
        placeholder="输入消息内容"
        @pressEnter="doSend"
      />
      <div v-if="sendResult" style="margin-top: 12px;">
        <pre style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; color: #aaa; font-size: 12px; white-space: pre-wrap;">{{ sendResult }}</pre>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  WifiOutlined, SyncOutlined, SendOutlined, PlusOutlined,
  ReloadOutlined, MobileOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

// --- Peers ---
const peersLoading = ref(false)
const peersError = ref('')
const peers = ref([])

const peerColumns = [
  { title: '设备名称', key: 'name' },
  { title: 'Peer ID', key: 'id' },
  { title: '状态', key: 'status' },
  { title: '操作', key: 'action', width: 100 },
]

async function loadPeers() {
  peersLoading.value = true
  peersError.value = ''
  try {
    const { output } = await ws.execute('p2p peers', 15000)
    peers.value = parsePeersOutput(output)
  } catch (e) {
    peersError.value = `加载失败: ${e.message}`
  } finally {
    peersLoading.value = false
  }
}

function parsePeersOutput(output) {
  if (!output || output.includes('No peers') || output.includes('no peers')) return []
  const lines = output.split('\n').filter(l => l.trim())
  const result = []
  for (const line of lines) {
    // Try to match lines like: "PeerId  Name  Status" or "12D3Koo... MyPhone connected"
    const match = line.match(/^\s*(\S+)\s+(.+?)\s+(connected|online|offline|disconnected)\s*$/i)
    if (match) {
      result.push({
        id: match[1],
        name: match[2].trim(),
        connected: /connected|online/i.test(match[3]),
      })
      continue
    }
    // Fallback: line with at least a peer ID (hash-like string)
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
    pairResult.value = `配对失败: ${e.message}`
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
    sendResult.value = output || '消息已发送'
  } catch (e) {
    sendResult.value = `发送失败: ${e.message}`
  } finally {
    sendLoading.value = false
  }
}

// --- Sync ---
const syncLoading = ref(false)
const syncError = ref('')
const syncOnline = ref(false)
const syncStatusText = ref('未知')
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
    syncError.value = `加载失败: ${e.message}`
  } finally {
    syncLoading.value = false
  }
}

function parseSyncStatus(output) {
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
