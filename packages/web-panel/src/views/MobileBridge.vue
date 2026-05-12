<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">移动桥</h2>
        <p class="page-sub">已配对的 Android 设备 · QR pairing 完成后会出现在此</p>
      </div>
      <a-button type="primary" ghost :loading="loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <!-- v1.1 W3.6 manual entry: 添加配对面板支持两种方式 -->
    <a-card
      title="新增配对"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
    >
      <a-tabs v-model:activeKey="addMode">
        <a-tab-pane key="manual" tab="手动输入（推荐）">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 16px;"
            message="在手机上 设置 → 配对桌面 显示 QR 后，照着屏幕填写下方三个字段"
          />
          <a-form layout="vertical" :model="manualForm">
            <a-form-item label="DID" :required="true">
              <a-input
                v-model:value="manualForm.did"
                placeholder="did:cc:..."
                style="font-family: monospace;"
              />
            </a-form-item>
            <a-form-item label="配对码 (6 位数字)" :required="true">
              <a-input
                v-model:value="manualForm.code"
                placeholder="123456"
                maxlength="6"
                style="font-family: monospace; font-size: 20px; letter-spacing: 4px; text-align: center;"
              />
            </a-form-item>
            <a-form-item label="设备 ID" :required="true">
              <a-input
                v-model:value="manualForm.deviceId"
                placeholder="android-xxx-xxx"
                style="font-family: monospace;"
              />
            </a-form-item>
            <a-form-item label="设备名（可选）">
              <a-input
                v-model:value="manualForm.deviceName"
                placeholder="My Pixel 8"
              />
            </a-form-item>
            <a-form-item>
              <a-button
                type="primary"
                :loading="manualSubmitting"
                :disabled="!manualForm.did || !manualForm.code || !manualForm.deviceId"
                @click="onManualSubmit"
              >
                <template #icon><CheckOutlined /></template>
                提交配对
              </a-button>
              <a-button
                style="margin-left: 8px;"
                :disabled="manualSubmitting"
                @click="resetManualForm"
              >
                清空
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
        <a-tab-pane key="scan" tab="扫描手机 QR（高级）">
          <a-alert
            type="warning"
            show-icon
            style="margin-bottom: 16px;"
            message="需要桌面摄像头，对小屏 QR 识别率不稳定"
            description="无摄像头或扫描失败请用 “手动输入” 标签页"
          />
          <a-button type="primary" @click="showScanner = true">
            <template #icon><QrcodeOutlined /></template>
            打开摄像头扫描
          </a-button>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <a-card
      title="已配对设备"
      style="background: var(--bg-card); border-color: var(--border-color);"
    >
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
  CheckOutlined,
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from '../composables/useShellMode.js'
import QrScannerModal from '../components/QrScannerModal.vue'

const ws = useWsStore()
const devices = ref([])
const loading = ref(false)
const error = ref('')
const unpairingId = ref('')
const showScanner = ref(false)

// v1.1 W3.6 manual entry tab state
const addMode = ref('manual')
const manualSubmitting = ref(false)
const manualForm = ref({
  did: '',
  code: '',
  deviceId: '',
  deviceName: '',
})

function resetManualForm() {
  manualForm.value = { did: '', code: '', deviceId: '', deviceName: '' }
}

/**
 * v1.1 W3.6 manual entry: 用户在手机 QR 屏照填的 DID/code/deviceId/deviceName
 * 构造与 Flow A 完全一致的 PairingQrPayload，复用现有 pair-from-qr CLI + 信令
 * confirmation 完整 round-trip。
 */
async function onManualSubmit() {
  if (manualSubmitting.value) return
  // 6 位数字 validate（与 cc p2p pair-from-qr / desktop validatePairingCode 对齐）
  if (!/^\d{6}$/.test(manualForm.value.code.trim())) {
    message.error('配对码必须是 6 位数字')
    return
  }
  manualSubmitting.value = true
  const constructed = {
    type: 'device-pairing',
    code: manualForm.value.code.trim(),
    did: manualForm.value.did.trim(),
    deviceInfo: {
      deviceId: manualForm.value.deviceId.trim(),
      name: manualForm.value.deviceName.trim() || '(unnamed)',
      platform: 'android',
    },
    // 后端 5min stale 检查用当前 ts 让手动输入不被拒
    timestamp: Date.now(),
  }
  try {
    await onQrScanned(JSON.stringify(constructed))
    // 成功后清空表单方便下一次配对
    resetManualForm()
  } finally {
    manualSubmitting.value = false
  }
}

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
  let pairedPayload = null
  try {
    // v1.1 W3.5: 1) CLI 写 paired_devices SQLite — qrData 是从 QR 解码的
    // raw JSON 字符串，shell-escape via JSON.stringify wrapping。
    const safeArg = JSON.stringify(qrData)
    const { output } = await ws.execute(
      `p2p pair-from-qr ${safeArg} --json`,
      15000,
    )
    const result = parseJsonOutput(output)
    if (!result?.success) {
      message.error(`配对失败: ${result?.error || '未知错误'}`)
      return
    }
    // Parse QR payload for the next signaling step (need .did + .code)
    try {
      pairedPayload = JSON.parse(qrData)
    } catch {
      // Shouldn't happen — pair-from-qr already validated, but guard
    }
    message.success(`已写入配对: ${result.deviceName || result.deviceId.slice(0, 8)}`)
    await refresh()
  } catch (e) {
    message.error(`配对失败: ${e.message}`)
    return
  }

  // v1.1 W3.6: 2) Embedded mode 下让 desktop 经信令服务器给 mobile 发
  // pairing:confirmation，让 Android DesktopPairingViewModel 进入 Completed
  // 状态。cc ui standalone 模式跳过（无 mobileBridge），UI 提示用户。
  if (!pairedPayload) return
  const { isEmbedded } = useShellMode()
  if (!isEmbedded) {
    message.info('CLI 模式下已写本地 paired_devices；手机端确认状态留 cc desktop')
    return
  }
  try {
    const reply = await ws.sendRaw(
      { type: 'mobile.pair.send-confirmation', qrPayload: pairedPayload },
      10000,
    )
    if (reply && reply.ok !== false) {
      message.success('已通知手机端完成握手')
    } else {
      message.warning(
        `desktop 已写库，但通知手机端失败: ${reply?.error || 'unknown'}`,
      )
    }
  } catch (e) {
    message.warning(`通知手机端失败: ${e.message}（desktop 已写库）`)
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
