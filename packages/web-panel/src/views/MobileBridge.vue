<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">移动桥</h2>
        <p class="page-sub">已配对的 Android 设备 · QR pairing 完成后会出现在此</p>
      </div>
      <a-space>
        <a-button type="primary" @click="showScanner = true">
          <template #icon><QrcodeOutlined /></template>
          扫描配对
        </a-button>
        <a-button type="primary" ghost :loading="loading" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <template #extra>
        <a-tag color="blue">{{ devices.length }} 台</a-tag>
      </template>

      <div v-if="loading" style="text-align: center; padding: 30px;">
        <a-spin />
      </div>

      <a-empty
        v-else-if="devices.length === 0"
        description="还未配对任何移动设备。在 Android 上：设置 → 配对桌面，生成 QR 后桌面端扫描。"
      />

      <a-table
        v-else
        :columns="columns"
        :data-source="devices"
        :pagination="false"
        size="small"
        row-key="device_id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'device_id'">
            <span style="font-family: monospace; color: var(--text-muted); font-size: 12px;">
              {{ record.device_id.length > 24 ? record.device_id.slice(0, 24) + '…' : record.device_id }}
            </span>
          </template>
          <template v-if="column.key === 'device_name'">
            <a-space>
              <MobileOutlined style="color: var(--text-muted);" />
              <span>{{ record.device_name || '(unnamed)' }}</span>
            </a-space>
          </template>
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'active' ? 'green' : 'default'">
              {{ record.status === 'active' ? '已激活' : record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'paired_at'">
            <span style="color: var(--text-muted); font-size: 12px;">
              {{ formatTime(record.paired_at) }}
            </span>
          </template>
          <template v-if="column.key === 'action'">
            <a-popconfirm
              :title="`确定解除 ${record.device_name || record.device_id.slice(0, 12)} 的配对?`"
              ok-text="解除"
              cancel-text="取消"
              ok-type="danger"
              @confirm="doUnpair(record)"
            >
              <a-button size="small" type="link" danger :loading="unpairingId === record.device_id">
                <DisconnectOutlined /> 解除配对
              </a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>

      <div v-if="error" style="margin-top: 12px; color: #ff4d4f; font-size: 12px;">{{ error }}</div>
    </a-card>

    <QrScannerModal
      :open="showScanner"
      @scanned="onQrScanned"
      @cancel="showScanner = false"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  ReloadOutlined,
  MobileOutlined,
  DisconnectOutlined,
  QrcodeOutlined,
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import QrScannerModal from '../components/QrScannerModal.vue'

const ws = useWsStore()
const devices = ref([])
const loading = ref(false)
const error = ref('')
const unpairingId = ref('')
const showScanner = ref(false)

const columns = [
  { title: '设备 ID', key: 'device_id', dataIndex: 'device_id', width: 280 },
  { title: '设备名称', key: 'device_name', dataIndex: 'device_name' },
  { title: '状态', key: 'status', dataIndex: 'status', width: 90 },
  { title: '配对时间', key: 'paired_at', dataIndex: 'paired_at', width: 180 },
  { title: '操作', key: 'action', width: 130 },
]

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    // v1.1 W3.4a: cc p2p devices --type mobile --json
    const { output } = await ws.execute('p2p devices --type mobile --json', 15000)
    devices.value = parseJsonOutput(output) || []
  } catch (e) {
    error.value = `加载失败: ${e.message}`
    devices.value = []
  } finally {
    loading.value = false
  }
}

async function onQrScanned(qrData) {
  showScanner.value = false
  try {
    // v1.1 W3.5: shell-escape via JSON.stringify wrapping — qrData is raw JSON
    // string from QR code; pass as quoted argv to cc p2p pair-from-qr
    const safeArg = JSON.stringify(qrData)
    const { output } = await ws.execute(
      `p2p pair-from-qr ${safeArg} --json`,
      15000,
    )
    const result = parseJsonOutput(output)
    if (result?.success) {
      message.success(`配对成功: ${result.deviceName || result.deviceId.slice(0, 8)}`)
      await refresh()
    } else {
      message.error(`配对失败: ${result?.error || '未知错误'}`)
    }
  } catch (e) {
    message.error(`配对失败: ${e.message}`)
  }
}

async function doUnpair(record) {
  unpairingId.value = record.device_id
  try {
    const { output } = await ws.execute(
      `p2p unpair ${record.device_id} --json`,
      15000,
    )
    const result = parseJsonOutput(output)
    if (result?.ok) {
      message.success('已解除配对')
      await refresh()
    } else {
      message.error(`解除失败: ${result?.error || '未知错误'}`)
    }
  } catch (e) {
    message.error(`解除失败: ${e.message}`)
  } finally {
    unpairingId.value = ''
  }
}

/**
 * v1.1 W3.4a: CLI --json 输出有时混 logger.info 等噪音，先 tryJSON 直读，失败
 * 再 strip CLI 提示行 retry。与现有 stripCliNoise 模式对齐（参考 Community.vue
 * b1 实现）。
 */
function parseJsonOutput(raw) {
  if (!raw) return null
  // First attempt: parse as-is
  try {
    return JSON.parse(raw)
  } catch {
    // intentional fallthrough
  }
  // Strip lines that don't look like JSON (logger prefixes etc)
  const lines = raw.split('\n').filter((l) => l.trim())
  // Find first line starting with { or [
  const startIdx = lines.findIndex((l) => /^\s*[\{\[]/.test(l))
  if (startIdx < 0) return null
  const jsonText = lines.slice(startIdx).join('\n')
  try {
    return JSON.parse(jsonText)
  } catch {
    return null
  }
}

function formatTime(t) {
  if (!t) return '—'
  try {
    const d = new Date(t)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return t
  }
}

onMounted(refresh)
</script>

<style scoped>
.page-title {
  margin: 0 0 4px;
}

.page-sub {
  color: var(--text-secondary);
  margin: 0;
  font-size: 13px;
}
</style>
