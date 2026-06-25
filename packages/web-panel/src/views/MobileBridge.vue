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
      <a-tabs v-model:activeKey="addMode" @change="onTabChange">
        <a-tab-pane key="desktop-qr" tab="桌面 QR（推荐）">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 16px;"
            message="在手机上 设置 → 扫描桌面 QR，对准下方二维码即可"
          />
          <div style="text-align: center;">
            <div v-if="desktopQrLoading">
              <a-spin /> 生成 QR 中…
            </div>
            <div v-else-if="desktopQrError" style="color: #ff4d4f;">
              {{ desktopQrError }}
              <div style="margin-top: 12px;">
                <a-button @click="regenerateDesktopQr">重试</a-button>
              </div>
            </div>
            <div v-else-if="desktopQrPayload">
              <div
                style="display: inline-block; background: #fff; padding: 16px; border-radius: 8px; border: 2px solid var(--border-color);"
              >
                <a-qrcode
                  :value="desktopQrPayloadJson"
                  :size="280"
                  error-level="H"
                />
              </div>
              <div style="margin-top: 16px; color: var(--text-muted); font-size: 12px;">
                配对码（手机也可手输）：
              </div>
              <div
                style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin-top: 4px;"
              >
                {{ desktopQrPayload.code }}
              </div>
              <div style="margin-top: 16px;">
                <a-tag :color="desktopAckStatus.color">
                  {{ desktopAckStatus.label }}
                </a-tag>
                <a-button
                  size="small"
                  type="link"
                  style="margin-left: 8px;"
                  @click="regenerateDesktopQr"
                >
                  重新生成
                </a-button>
              </div>
            </div>
          </div>
        </a-tab-pane>
        <a-tab-pane key="manual" tab="手动输入">
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
import { ref, onMounted, onUnmounted } from 'vue'
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
import { tryParseJson } from '../utils/community-parser.js'
import QrScannerModal from '../components/QrScannerModal.vue'

const ws = useWsStore()
const devices = ref([])
const loading = ref(false)
const error = ref('')
const unpairingId = ref('')
const showScanner = ref(false)

// v1.1 W3.7 Flow B default tab — desktop QR / phone scans
const addMode = ref('desktop-qr')
const desktopQrLoading = ref(false)
const desktopQrError = ref('')
const desktopQrPayload = ref(null)
const desktopQrPayloadJson = ref('')
const desktopAckStatus = ref({ label: '等待手机扫描…', color: 'blue' })
let desktopAckPollTimer = null

// v1.1 W3.6 manual entry tab state
const manualSubmitting = ref(false)
const manualForm = ref({
  did: '',
  code: '',
  deviceId: '',
  deviceName: '',
})

async function generateDesktopQr() {
  desktopQrLoading.value = true
  desktopQrError.value = ''
  desktopQrPayload.value = null
  desktopAckStatus.value = { label: '等待手机扫描…', color: 'blue' }
  try {
    const reply = await ws.sendRaw({ type: 'desktop.pair.generate-qr' }, 10000)
    const r = reply?.result ?? reply
    if (r?.payload && r?.payloadJson) {
      desktopQrPayload.value = r.payload
      desktopQrPayloadJson.value = r.payloadJson
      startAckPolling()
    } else {
      desktopQrError.value = reply?.error || '生成失败：mobileBridge 未就绪？'
    }
  } catch (e) {
    desktopQrError.value = `生成失败: ${e.message}`
  } finally {
    desktopQrLoading.value = false
  }
}

async function regenerateDesktopQr() {
  stopAckPolling()
  try {
    await ws.sendRaw({ type: 'desktop.pair.reset' }, 3000)
  } catch {
    // best-effort cleanup
  }
  await generateDesktopQr()
}

function startAckPolling() {
  stopAckPolling()
  desktopAckPollTimer = setInterval(async () => {
    try {
      const reply = await ws.sendRaw({ type: 'desktop.pair.poll-ack' }, 3000)
      const r = reply?.result ?? reply
      if (r?.status === 'acked') {
        desktopAckStatus.value = {
          label: `手机已扫描确认 (${r.ack?.deviceInfo?.name || r.ack?.mobileDid?.slice(0, 12) || ''})`,
          color: 'green',
        }
        stopAckPolling()
        // v1.1 W3.7 Flow B: ack 到了只是内存 session 状态变 acked，要把这条
        // mobile 设备写进 p2p_paired_devices SQLite 表才会在"已配对设备"
        // 列表显示。复用 pair-from-qr CLI 路径，构 PairingQrPayload 提交。
        await registerPairedFromAck(r.ack)
        await refresh()
      } else if (r?.status === 'expired') {
        desktopAckStatus.value = { label: 'QR 已过期（5min），点重新生成', color: 'orange' }
        stopAckPolling()
      }
    } catch {
      // transient WS hiccup; keep polling
    }
  }, 2500)
}

async function registerPairedFromAck(ack) {
  if (!ack || !ack.pairingCode || !ack.mobileDid || !ack.deviceInfo?.deviceId) {
    message.warning('配对成功但 ack 字段不全，无法写入设备表')
    return
  }
  const payload = {
    type: 'device-pairing',
    code: ack.pairingCode,
    did: ack.mobileDid,
    deviceInfo: {
      deviceId: ack.deviceInfo.deviceId,
      name: ack.deviceInfo.name || '(unnamed)',
      platform: ack.deviceInfo.platform || 'android',
    },
    timestamp: Date.now(),
  }
  try {
    const safeArg = JSON.stringify(JSON.stringify(payload))
    const { output } = await ws.execute(`p2p pair-from-qr ${safeArg} --json`, 15000)
    const result = parseJsonOutput(output)
    if (result?.success) {
      message.success(`配对成功: ${result.deviceName || result.deviceId.slice(0, 8)}`)
    } else if (result?.error?.includes?.('QR 已过期')) {
      // v1.3+ 桌面 main 进程已经在 recordPairAck 时直写 SQLite (persistPairAck spawn).
      // 这里二次调用 pair-from-qr 命中 5min QR 过期校验属正常 — DB 早被 main 写入。
      // 不报 warning,只 info 提示.
      message.info('配对已确认，设备已写入数据库')
    } else {
      // 真正写入异常才告警。还是同时静默,因 main spawn 可能已成功，UI 仅是 polling
      // 二次确认。
      message.warning(`配对状态待确认: ${result?.error || 'unknown'} — 列表刷新后即可见`)
    }
  } catch (e) {
    // 网络/超时类异常，不掩盖真问题
    message.warning(`配对状态待确认: ${e.message} — 列表刷新后即可见`)
  }
}

function stopAckPolling() {
  if (desktopAckPollTimer) {
    clearInterval(desktopAckPollTimer)
    desktopAckPollTimer = null
  }
}

function onTabChange(key) {
  if (key === 'desktop-qr') {
    if (!desktopQrPayload.value) {
      generateDesktopQr()
    } else if (!desktopAckPollTimer) {
      startAckPolling()
    }
  } else {
    // 切到其它 tab 停 poll，省 ws 流量
    stopAckPolling()
  }
}

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
 * v1.1 W3.4a: CLI --json 输出有时混 logger.info 等噪音。委托给共享的
 * tryParseJson（先剥离 CLI 噪声行，再按括号配对抽取首个完整 JSON 值），
 * 兑现原注释「与现有 stripCliNoise 模式对齐」的意图。旧的手写逐行扫描在
 * 没有以闭括号起首的行时会过度捕获（reverse findIndex 返回 -1 →
 * endIdx=lines.length → slice 到输出末尾）从而丢数据。
 */
function parseJsonOutput(raw) {
  return tryParseJson(raw)
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

onMounted(async () => {
  await refresh()
  // v1.1 W3.7: 默认 tab 是 desktop-qr，挂载时生成 QR + 起轮询
  if (addMode.value === 'desktop-qr') {
    generateDesktopQr()
  }
})

onUnmounted(() => {
  stopAckPolling()
})
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
