<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">语音识别配置</h2>
        <p class="page-sub">引擎选择 / Web Speech / Whisper API / Whisper Local</p>
      </div>
      <a-button :loading="loading" @click="loadConfig">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-alert
      message="部分配置仍在桌面端"
      description="高级 storage / audio / 知识库集成 / 性能选项仍在桌面端 SystemSettings 编辑（低频使用，未迁移）。本页覆盖引擎选择 + 三种引擎各自的核心配置。"
      type="info"
      show-icon
      closable
      style="margin-bottom: 16px;"
    />

    <a-spin :spinning="loading">
      <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
        <template #title>
          <span style="color: var(--text-primary);">
            <SoundOutlined style="margin-right: 8px;" />识别引擎
          </span>
        </template>

        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item label="默认引擎">
            <a-select
              v-model:value="form.defaultEngine"
              style="width: 320px;"
              :disabled="saving"
              :options="engineOptions"
            />
            <template #extra>
              <span style="color: var(--text-muted); font-size: 11px;">
                {{ engineHint }}
              </span>
            </template>
          </a-form-item>
        </a-form>
      </a-card>

      <a-card
        v-if="form.defaultEngine === 'webspeech'"
        style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
      >
        <template #title>
          <span style="color: var(--text-primary);">Web Speech API 配置</span>
        </template>
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item label="语言">
            <a-select v-model:value="form.webSpeech.lang" style="width: 240px;" :disabled="saving">
              <a-select-option value="zh-CN">中文（简体）</a-select-option>
              <a-select-option value="zh-TW">中文（繁体）</a-select-option>
              <a-select-option value="en-US">English (US)</a-select-option>
              <a-select-option value="en-GB">English (UK)</a-select-option>
              <a-select-option value="ja-JP">日本語</a-select-option>
              <a-select-option value="ko-KR">한국어</a-select-option>
            </a-select>
          </a-form-item>
        </a-form>
      </a-card>

      <a-card
        v-if="form.defaultEngine === 'whisper-api'"
        style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
      >
        <template #title>
          <span style="color: var(--text-primary);">Whisper API 配置</span>
        </template>
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item label="API Key">
            <a-input-password
              v-model:value="form.whisperAPI.apiKey"
              placeholder="sk-..."
              :disabled="saving"
            />
          </a-form-item>
          <a-form-item label="Base URL">
            <a-input v-model:value="form.whisperAPI.baseURL" :disabled="saving" />
          </a-form-item>
          <a-form-item label="模型">
            <a-input v-model:value="form.whisperAPI.model" :disabled="saving" />
          </a-form-item>
          <a-form-item label="语言代码">
            <a-input v-model:value="form.whisperAPI.language" :disabled="saving" />
          </a-form-item>
          <a-form-item label="超时（毫秒）">
            <a-input-number
              v-model:value="form.whisperAPI.timeout"
              :min="1000"
              :max="600000"
              :step="1000"
              style="width: 200px;"
              :disabled="saving"
            />
          </a-form-item>
        </a-form>
      </a-card>

      <a-card
        v-if="form.defaultEngine === 'whisper-local'"
        style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
      >
        <template #title>
          <span style="color: var(--text-primary);">Whisper Local 配置</span>
        </template>
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item label="服务地址">
            <a-input
              v-model:value="form.whisperLocal.serverUrl"
              placeholder="http://localhost:8002"
              :disabled="saving"
            />
          </a-form-item>
          <a-form-item label="模型规模">
            <a-select v-model:value="form.whisperLocal.modelSize" style="width: 180px;" :disabled="saving">
              <a-select-option value="tiny">tiny</a-select-option>
              <a-select-option value="base">base</a-select-option>
              <a-select-option value="small">small</a-select-option>
              <a-select-option value="medium">medium</a-select-option>
              <a-select-option value="large">large</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="设备">
            <a-select v-model:value="form.whisperLocal.device" style="width: 180px;" :disabled="saving">
              <a-select-option value="auto">auto</a-select-option>
              <a-select-option value="cpu">cpu</a-select-option>
              <a-select-option value="cuda">cuda</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="超时（毫秒）">
            <a-input-number
              v-model:value="form.whisperLocal.timeout"
              :min="1000"
              :max="600000"
              :step="1000"
              style="width: 200px;"
              :disabled="saving"
            />
          </a-form-item>
        </a-form>
      </a-card>

      <div style="display: flex; gap: 12px; align-items: center;">
        <a-button @click="resetForm" :disabled="saving || loading">重置</a-button>
        <a-button type="primary" :loading="saving" :disabled="!isDirty" @click="saveConfig">
          保存配置
        </a-button>
        <span v-if="isDirty" style="color: #faad14; font-size: 12px;">有未保存的修改</span>
      </div>
    </a-spin>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { ReloadOutlined, SoundOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseSpeechConfig,
  diffSpeechConfig,
  SPEECH_DEFAULTS,
} from '../utils/speech-settings-parser.js'

const ws = useWsStore()

const loading = ref(false)
const saving = ref(false)
const form = reactive(JSON.parse(JSON.stringify(SPEECH_DEFAULTS)))
const baseline = ref(JSON.parse(JSON.stringify(SPEECH_DEFAULTS)))

const engineOptions = [
  { value: 'webspeech', label: 'Web Speech API（浏览器内置）' },
  { value: 'whisper-api', label: 'Whisper API（OpenAI 云端）' },
  { value: 'whisper-local', label: 'Whisper Local（本地服务）' },
]

const engineHints = {
  webspeech: '✓ 免费，无需配置；准确度较低',
  'whisper-api': '⚠ 需要 OpenAI API 密钥，按使用量计费；准确度高',
  'whisper-local': '✓ 免费，需要本地部署 Whisper 服务；准确度高',
}

const engineHint = computed(() => engineHints[form.defaultEngine] || '')

const isDirty = computed(() => {
  return Object.keys(diffSpeechConfig(baseline.value, form)).length > 0
})

function applyConfig(parsed) {
  form.defaultEngine = parsed.defaultEngine
  Object.assign(form.webSpeech, parsed.webSpeech)
  Object.assign(form.whisperAPI, parsed.whisperAPI)
  Object.assign(form.whisperLocal, parsed.whisperLocal)
  baseline.value = JSON.parse(JSON.stringify(parsed))
}

async function loadConfig() {
  loading.value = true
  try {
    const { output } = await ws.execute('config get speech', 10000)
    applyConfig(parseSpeechConfig(output))
  } catch (e) {
    if (/key not found/i.test(e.message)) {
      applyConfig(JSON.parse(JSON.stringify(SPEECH_DEFAULTS)))
    } else {
      message.error('加载配置失败: ' + e.message)
    }
  } finally {
    loading.value = false
  }
}

function resetForm() {
  applyConfig(baseline.value)
}

async function saveConfig() {
  const changes = diffSpeechConfig(baseline.value, form)
  const keys = Object.keys(changes)
  if (keys.length === 0) {
    message.info('没有需要保存的修改')
    return
  }

  saving.value = true
  let okCount = 0
  let failCount = 0
  for (const key of keys) {
    const value = changes[key]
    const escaped = String(value).replace(/"/g, '\\"')
    const cmd = `config set speech.${key} "${escaped}"`
    try {
      const { output, exitCode } = await ws.execute(cmd, 10000)
      if (exitCode !== 0 || /error|failed|失败/i.test(output)) {
        failCount++
        message.error(`保存 speech.${key} 失败: ${output.slice(0, 80)}`)
      } else {
        okCount++
      }
    } catch (e) {
      failCount++
      message.error(`保存 speech.${key} 失败: ${e.message}`)
    }
  }

  saving.value = false

  if (failCount === 0) {
    message.success(`保存成功（${okCount} 项）`)
    baseline.value = JSON.parse(JSON.stringify(form))
  } else if (okCount > 0) {
    message.warning(`部分保存成功：${okCount} 成功 / ${failCount} 失败`)
    await loadConfig()
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped>
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
