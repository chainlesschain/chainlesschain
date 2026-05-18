<template>
  <div>
    <div style="margin-bottom: 24px;">
      <h2 class="page-title">{{ $t('quickAsk.title') }}</h2>
      <p class="page-sub">{{ $t('quickAsk.subtitle') }}</p>
    </div>

    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <a-textarea
        v-model:value="prompt"
        :rows="4"
        :placeholder="$t('quickAsk.promptPlaceholder')"
        :disabled="running"
        @keydown.ctrl.enter.prevent="run"
        @keydown.meta.enter.prevent="run"
      />

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;">
        <div style="display: flex; gap: 8px; align-items: center; color: var(--text-muted); font-size: 11px;">
          <a-input
            v-model:value="model"
            :placeholder="$t('quickAsk.modelPlaceholder')"
            size="small"
            style="width: 200px;"
            :disabled="running"
            allow-clear
          />
          <span v-if="answer">{{ answer.length }} {{ $t('quickAsk.charsSuffix') }}</span>
          <span v-if="finalMeta">· {{ finalMeta.tokens ?? 0 }} {{ $t('quickAsk.tokensSuffix') }}</span>
          <span v-if="finalMeta?.model">· {{ finalMeta.model }}</span>
        </div>
        <a-space>
          <a-button v-if="answer || error" :disabled="running" @click="reset">{{ $t('quickAsk.clear') }}</a-button>
          <a-button v-if="running" danger @click="cancel">
            <template #icon><CloseOutlined /></template>
            {{ $t('quickAsk.cancel') }}
          </a-button>
          <a-button v-else type="primary" :disabled="!prompt.trim()" @click="run">
            <template #icon><SendOutlined /></template>
            {{ $t('quickAsk.send') }}
          </a-button>
        </a-space>
      </div>
    </a-card>

    <a-card
      v-if="answer || running || error"
      :title="$t('quickAsk.answerCardTitle')"
      style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;"
    >
      <template #extra>
        <span v-if="running" style="color: #1677ff; font-size: 11px;">
          <SyncOutlined :spin="true" /> {{ $t('quickAsk.streaming') }}
        </span>
        <span v-else-if="finalMeta" style="color: #52c41a; font-size: 11px;">
          <CheckCircleOutlined /> {{ $t('quickAsk.done') }}
        </span>
      </template>
      <pre v-if="answer" style="margin: 0; white-space: pre-wrap; font-family: var(--font-body, system-ui); font-size: 13px;">{{ answer }}</pre>
      <a-empty v-else-if="running" :description="$t('quickAsk.waitingFirstToken')" />
      <div v-if="error" style="background: #2a1517; border: 1px solid #5c2426; padding: 8px; border-radius: 4px; margin-top: 8px;">
        <pre style="color: #ff7875; font-size: 11px; margin: 0; white-space: pre-wrap;">{{ error }}</pre>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { SendOutlined, SyncOutlined, CheckCircleOutlined, CloseOutlined } from '@ant-design/icons-vue'
import { useLlmChat } from '../composables/useLlmChat.js'

const llm = useLlmChat()

const prompt = ref('')
const model = ref('')
const answer = ref('')
const running = ref(false)
const error = ref('')
const finalMeta = ref(null)
let activeChat = null   // { cancel } from useLlmChat.chat() while running

async function run() {
  if (running.value || !prompt.value.trim()) return
  running.value = true
  answer.value = ''
  error.value = ''
  finalMeta.value = null

  try {
    const messages = [{ role: 'user', content: prompt.value }]
    const options = {}
    const m = model.value.trim()
    if (m) options.model = m

    // Use chat() (not chatTo) so we have a cancel handle. Manually drain
    // the stream into the answer ref — same shape chatTo would produce.
    const handle = llm.chat({ messages, options })
    activeChat = handle
    try {
      for await (const chunk of handle.stream) {
        if (chunk?.content) {
          answer.value = chunk.content
        } else if (chunk?.delta) {
          answer.value += chunk.delta
        }
      }
    } catch {
      // Drain error surfaces via handle.result below.
    }
    const final = await handle.result
    finalMeta.value = {
      model: final?.model || null,
      tokens: final?.tokens ?? null,
    }
    if (!answer.value && final?.message?.content) {
      answer.value = final.message.content
    }
  } catch (err) {
    error.value = err?.message || String(err)
  } finally {
    running.value = false
    activeChat = null
  }
}

function cancel() {
  if (activeChat?.cancel) {
    activeChat.cancel()
  }
}

function reset() {
  answer.value = ''
  error.value = ''
  finalMeta.value = null
}
</script>
