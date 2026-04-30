<template>
  <div>
    <div style="margin-bottom: 24px;">
      <h2 class="page-title">U-Key 签名</h2>
      <p class="page-sub">
        硬件签名 demo — 走 ukey.sign WS topic，仅常规签名（非高危操作）。
        <a-tag color="orange" style="margin-left: 8px; font-size: 10px;">仅桌面 web-shell</a-tag>
      </p>
    </div>

    <a-alert
      v-if="!isEmbedded"
      type="warning"
      show-icon
      message="此页面仅在桌面 web-shell 模式下可用"
      description="ukey.sign 由 Electron 主进程的 UKeyManager 提供 — 浏览器模式无法访问硬件。请使用桌面应用打开。"
      style="margin-bottom: 16px;"
    />

    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <div style="margin-bottom: 12px;">
        <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">待签名数据</div>
        <a-textarea
          v-model:value="data"
          :rows="4"
          placeholder="任意字符串（建议是已哈希的摘要，最多 64 KiB）"
          :disabled="running || !isEmbedded"
        />
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; gap: 8px; align-items: center; color: var(--text-muted); font-size: 11px;">
          <span v-if="data">{{ data.length }} 字符</span>
          <span v-if="currentStage" style="color: #1677ff;">
            <SyncOutlined :spin="true" /> {{ stageLabel(currentStage) }}
          </span>
        </div>
        <a-space>
          <a-button v-if="signResult || error" :disabled="running" @click="reset">清空</a-button>
          <a-button
            type="primary"
            :loading="running"
            :disabled="!data.trim() || !isEmbedded"
            @click="run"
          >
            <template #icon><SafetyCertificateOutlined /></template>
            签名
          </a-button>
        </a-space>
      </div>
    </a-card>

    <a-card
      v-if="signResult || error"
      title="结果"
      style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;"
    >
      <template #extra>
        <a-tag v-if="signResult?.success" color="green">
          <CheckCircleOutlined /> 签名成功
        </a-tag>
        <a-tag v-else-if="signResult && !signResult.success" color="orange">
          <WarningOutlined /> {{ reasonLabel(signResult.reason) }}
        </a-tag>
        <a-tag v-else-if="error" color="red">
          <CloseCircleOutlined /> 协议错误
        </a-tag>
      </template>

      <div v-if="signResult?.success">
        <div style="margin-bottom: 12px;">
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">签名（{{ signResult.algorithm || 'unknown' }}）</div>
          <pre style="background: var(--bg-card-hover); padding: 8px; border-radius: 4px; font-size: 11px; word-break: break-all; white-space: pre-wrap; margin: 0;">{{ signResult.signature }}</pre>
        </div>
      </div>
      <div v-else-if="signResult">
        <div style="color: var(--text-muted); font-size: 12px;">{{ signResult.message || '签名未完成' }}</div>
        <div style="font-size: 11px; color: #999; margin-top: 4px; font-family: monospace;">
          reason: {{ signResult.reason || 'unknown' }}
        </div>
      </div>
      <div v-if="error" style="background: #2a1517; border: 1px solid #5c2426; padding: 8px; border-radius: 4px;">
        <pre style="color: #ff7875; font-size: 11px; margin: 0; white-space: pre-wrap;">{{ error }}</pre>
      </div>

      <div v-if="stageHistory.length" style="margin-top: 16px;">
        <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">阶段时间线</div>
        <a-timeline>
          <a-timeline-item v-for="(s, i) in stageHistory" :key="i">
            <template #color>blue</template>
            {{ stageLabel(s.stage) }} <span style="color: var(--text-muted); font-size: 10px; margin-left: 4px;">{{ s.t }}ms</span>
          </a-timeline-item>
        </a-timeline>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  SafetyCertificateOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue'
import { useUkey } from '../composables/useUkey.js'

const ukey = useUkey()

const isEmbedded = computed(() => window.__CC_CONFIG__?.embeddedShell === true)

const data = ref('')
const running = ref(false)
const currentStage = ref('')
const stageHistory = ref([])
const signResult = ref(null)
const error = ref('')

function stageLabel(stage) {
  return (
    {
      pre_check: '检查驱动 / 设备状态',
      signing: '正在与硬件通信，等待用户确认...',
    }[stage] || stage
  )
}

function reasonLabel(reason) {
  return (
    {
      driver_not_initialized: '驱动未初始化',
      device_locked: '设备已锁定',
      no_result: '无结果',
    }[reason] || reason || '失败'
  )
}

async function run() {
  if (running.value || !data.value.trim()) return
  running.value = true
  signResult.value = null
  error.value = ''
  currentStage.value = ''
  stageHistory.value = []
  const t0 = Date.now()
  try {
    const result = await ukey.sign(data.value, {
      onStage: (stage) => {
        currentStage.value = stage
        stageHistory.value.push({ stage, t: Date.now() - t0 })
      },
    })
    signResult.value = result
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    running.value = false
    currentStage.value = ''
  }
}

function reset() {
  signResult.value = null
  error.value = ''
  stageHistory.value = []
  currentStage.value = ''
}
</script>
