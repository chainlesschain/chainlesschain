<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('speechSettings.title') }}</h2>
        <p class="page-sub">{{ t('speechSettings.subtitle') }}</p>
      </div>
      <a-button :loading="loading" @click="loadConfig">
        <template #icon><ReloadOutlined /></template>
        {{ t('speechSettings.refresh') }}
      </a-button>
    </div>

    <a-alert
      :message="t('speechSettings.alert.message')"
      :description="t('speechSettings.alert.description')"
      type="info"
      show-icon
      closable
      style="margin-bottom: 16px;"
    />

    <a-spin :spinning="loading">
      <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
        <template #title>
          <span style="color: var(--text-primary);">
            <SoundOutlined style="margin-right: 8px;" />{{ t('speechSettings.engineCardTitle') }}
          </span>
        </template>

        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item :label="t('speechSettings.engineLabel')">
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
          <span style="color: var(--text-primary);">{{ t('speechSettings.webSpeech.cardTitle') }}</span>
        </template>
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item :label="t('speechSettings.webSpeech.langLabel')">
            <a-select v-model:value="form.webSpeech.lang" style="width: 240px;" :disabled="saving">
              <a-select-option value="zh-CN">{{ t('speechSettings.webSpeech.langOptions.zh-CN') }}</a-select-option>
              <a-select-option value="zh-TW">{{ t('speechSettings.webSpeech.langOptions.zh-TW') }}</a-select-option>
              <a-select-option value="en-US">{{ t('speechSettings.webSpeech.langOptions.en-US') }}</a-select-option>
              <a-select-option value="en-GB">{{ t('speechSettings.webSpeech.langOptions.en-GB') }}</a-select-option>
              <a-select-option value="ja-JP">{{ t('speechSettings.webSpeech.langOptions.ja-JP') }}</a-select-option>
              <a-select-option value="ko-KR">{{ t('speechSettings.webSpeech.langOptions.ko-KR') }}</a-select-option>
            </a-select>
          </a-form-item>
        </a-form>
      </a-card>

      <a-card
        v-if="form.defaultEngine === 'whisper-api'"
        style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
      >
        <template #title>
          <span style="color: var(--text-primary);">{{ t('speechSettings.whisperAPI.cardTitle') }}</span>
        </template>
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item :label="t('speechSettings.whisperAPI.apiKeyLabel')">
            <a-input-password
              v-model:value="form.whisperAPI.apiKey"
              placeholder="sk-..."
              :disabled="saving"
            />
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperAPI.baseUrlLabel')">
            <a-input v-model:value="form.whisperAPI.baseURL" :disabled="saving" />
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperAPI.modelLabel')">
            <a-input v-model:value="form.whisperAPI.model" :disabled="saving" />
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperAPI.languageLabel')">
            <a-input v-model:value="form.whisperAPI.language" :disabled="saving" />
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperAPI.timeoutLabel')">
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
          <span style="color: var(--text-primary);">{{ t('speechSettings.whisperLocal.cardTitle') }}</span>
        </template>
        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }" style="max-width: 720px;">
          <a-form-item :label="t('speechSettings.whisperLocal.serverUrlLabel')">
            <a-input
              v-model:value="form.whisperLocal.serverUrl"
              placeholder="http://localhost:8002"
              :disabled="saving"
            />
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperLocal.modelSizeLabel')">
            <a-select v-model:value="form.whisperLocal.modelSize" style="width: 180px;" :disabled="saving">
              <a-select-option value="tiny">tiny</a-select-option>
              <a-select-option value="base">base</a-select-option>
              <a-select-option value="small">small</a-select-option>
              <a-select-option value="medium">medium</a-select-option>
              <a-select-option value="large">large</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperLocal.deviceLabel')">
            <a-select v-model:value="form.whisperLocal.device" style="width: 180px;" :disabled="saving">
              <a-select-option value="auto">auto</a-select-option>
              <a-select-option value="cpu">cpu</a-select-option>
              <a-select-option value="cuda">cuda</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :label="t('speechSettings.whisperLocal.timeoutLabel')">
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
        <a-button @click="resetForm" :disabled="saving || loading">{{ t('speechSettings.buttons.reset') }}</a-button>
        <a-button type="primary" :loading="saving" :disabled="!isDirty" @click="saveConfig">
          {{ t('speechSettings.buttons.save') }}
        </a-button>
        <span v-if="isDirty" style="color: #faad14; font-size: 12px;">{{ t('speechSettings.dirtyHint') }}</span>
      </div>
    </a-spin>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ReloadOutlined, SoundOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseSpeechConfig,
  diffSpeechConfig,
  SPEECH_DEFAULTS,
} from '../utils/speech-settings-parser.js'

const { t } = useI18n()
const ws = useWsStore()

const loading = ref(false)
const saving = ref(false)
const form = reactive(JSON.parse(JSON.stringify(SPEECH_DEFAULTS)))
const baseline = ref(JSON.parse(JSON.stringify(SPEECH_DEFAULTS)))

const engineOptions = computed(() => [
  { value: 'webspeech', label: t('speechSettings.engineOptions.webspeech') },
  { value: 'whisper-api', label: t('speechSettings.engineOptions.whisper-api') },
  { value: 'whisper-local', label: t('speechSettings.engineOptions.whisper-local') },
])

const engineHint = computed(() => {
  const key = `speechSettings.engineHint.${form.defaultEngine}`
  const v = t(key)
  return v === key ? '' : v
})

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
      message.error(t('speechSettings.messages.loadFailed', { err: e.message }))
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
    message.info(t('speechSettings.messages.noChanges'))
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
        message.error(t('speechSettings.messages.saveItemFailed', { key, err: output.slice(0, 80) }))
      } else {
        okCount++
      }
    } catch (e) {
      failCount++
      message.error(t('speechSettings.messages.saveItemFailed', { key, err: e.message }))
    }
  }

  saving.value = false

  if (failCount === 0) {
    message.success(t('speechSettings.messages.saveOk', { count: okCount }))
    baseline.value = JSON.parse(JSON.stringify(form))
  } else if (okCount > 0) {
    message.warning(t('speechSettings.messages.savePartial', { ok: okCount, fail: failCount }))
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
