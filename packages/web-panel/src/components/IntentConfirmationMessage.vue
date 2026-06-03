<template>
  <div class="intent-confirmation-message">
    <div class="confirmation-header">
      <div class="header-icon">
        <CheckCircleOutlined v-if="isConfirmed" style="color: #52c41a" />
        <ExclamationCircleOutlined v-else-if="isCorrected" style="color: #faad14" />
        <BulbOutlined v-else style="color: #1890ff" />
      </div>
      <div class="header-text">
        <span v-if="isConfirmed">{{ $t('chat.intent.confirmed') }}</span>
        <span v-else-if="isCorrected">{{ $t('chat.intent.corrected') }}</span>
        <span v-else>{{ message.content }}</span>
      </div>
    </div>

    <div class="understanding-content">
      <div v-if="hasCorrectedInput" class="original-input">
        <div class="label">{{ $t('chat.intent.label.original') }}</div>
        <div class="value original-text">{{ originalInput }}</div>
      </div>

      <div v-if="hasCorrectedInput" class="corrected-input">
        <div class="label">{{ $t('chat.intent.label.understood') }}</div>
        <div class="value corrected-text">{{ correctedInput }}</div>
      </div>

      <div class="intent-section">
        <div class="label">🎯 {{ $t('chat.intent.label.intent') }}</div>
        <div class="value">{{ intent }}</div>
      </div>

      <div v-if="keyPoints && keyPoints.length > 0" class="key-points-section">
        <div class="label">📝 {{ $t('chat.intent.label.keyPoints') }}</div>
        <ul class="key-points-list">
          <li v-for="(point, idx) in keyPoints" :key="idx">{{ point }}</li>
        </ul>
      </div>

      <div v-if="correction" class="correction-section">
        <div class="label">📝 {{ $t('chat.intent.label.correction') }}</div>
        <div class="value correction-text">{{ correction }}</div>
      </div>
    </div>

    <div v-if="isStreaming" class="streaming-indicator">
      <LoadingOutlined spin />
      <span>{{ $t('chat.intent.status.understanding') }}</span>
      <span v-if="streamingTokens > 0" class="streaming-tokens">· {{ streamingTokens }} tokens</span>
    </div>

    <div v-else-if="!isConfirmed && !isCorrected" class="action-buttons">
      <a-button type="primary" @click="handleConfirm">
        <CheckOutlined />
        {{ $t('chat.intent.action.confirm') }}
      </a-button>
      <a-button @click="handleCorrect">
        <EditOutlined />
        {{ $t('chat.intent.action.correct') }}
      </a-button>
    </div>

    <div v-if="showCorrectionInput" class="correction-input-section">
      <a-textarea
        v-model:value="correctionInput"
        :placeholder="$t('chat.intent.action.correctPlaceholder')"
        :auto-size="{ minRows: 2, maxRows: 6 }"
      />
      <div class="correction-actions">
        <a-button type="primary" size="small" @click="handleSubmitCorrection">
          <CheckOutlined />
          {{ $t('chat.intent.action.submitCorrection') }}
        </a-button>
        <a-button size="small" @click="handleCancelCorrection">
          <CloseOutlined />
          {{ $t('chat.intent.action.cancelCorrection') }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  BulbOutlined,
  CheckOutlined,
  EditOutlined,
  CloseOutlined,
  LoadingOutlined,
} from '@ant-design/icons-vue'

const props = defineProps({
  message: { type: Object, required: true },
})

const emit = defineEmits(['confirm', 'correct'])

const showCorrectionInput = ref(false)
const correctionInput = ref('')

const originalInput = computed(() => props.message.metadata?.originalInput || '')
const understanding = computed(() => props.message.metadata?.understanding || {})
const correctedInput = computed(() => understanding.value.correctedInput || originalInput.value)
const intent = computed(() => understanding.value.intent || '未识别')
const keyPoints = computed(() => understanding.value.keyPoints || [])
const hasCorrectedInput = computed(() =>
  correctedInput.value !== originalInput.value && originalInput.value.trim() !== '',
)

const status = computed(() => props.message.metadata?.status || 'pending')
const isConfirmed = computed(() => status.value === 'confirmed')
const isCorrected = computed(() => status.value === 'corrected')
const isStreaming = computed(() => Boolean(props.message.metadata?.streaming))
const streamingTokens = computed(() => props.message.metadata?.streamingTokens || 0)
const correction = computed(() => props.message.metadata?.correction || null)

function handleConfirm() {
  emit('confirm', {
    messageId: props.message.id,
    originalInput: originalInput.value,
    understanding: understanding.value,
  })
}

function handleCorrect() {
  showCorrectionInput.value = true
  correctionInput.value = correctedInput.value
}

function handleSubmitCorrection() {
  if (!correctionInput.value.trim()) return
  emit('correct', {
    messageId: props.message.id,
    originalInput: originalInput.value,
    correction: correctionInput.value,
  })
  showCorrectionInput.value = false
}

function handleCancelCorrection() {
  showCorrectionInput.value = false
  correctionInput.value = ''
}
</script>

<style scoped>
.intent-confirmation-message {
  padding: 16px;
  margin: 12px 0;
  background: linear-gradient(135deg, rgba(24, 144, 255, 0.08) 0%, rgba(24, 144, 255, 0.02) 100%);
  border-left: 4px solid #1890ff;
  border-radius: 8px;
}

.confirmation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(24, 144, 255, 0.2);
}

.header-icon { font-size: 20px; }
.header-text { font-size: 15px; font-weight: 600; color: #1890ff; }

.understanding-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.original-input,
.corrected-input,
.intent-section,
.key-points-section,
.correction-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label { font-size: 13px; font-weight: 600; color: var(--text-secondary, #aaa); }
.value { font-size: 14px; color: var(--text-primary, #ddd); line-height: 1.6; }

.original-text {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  border: 1px dashed var(--border-color, #555);
  text-decoration: line-through;
  color: var(--text-muted, #888);
}

.corrected-text {
  padding: 8px 12px;
  background: rgba(82, 196, 26, 0.08);
  border-radius: 6px;
  border: 1px solid #52c41a;
  font-weight: 500;
}

.correction-text {
  padding: 8px 12px;
  background: rgba(250, 173, 20, 0.08);
  border-radius: 6px;
  border: 1px solid #faad14;
  font-weight: 500;
}

.key-points-list {
  margin: 0;
  padding-left: 20px;
  list-style: disc;
}
.key-points-list li {
  margin: 4px 0;
  font-size: 14px;
  line-height: 1.6;
}

.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(24, 144, 255, 0.2);
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(24, 144, 255, 0.2);
  font-size: 13px;
  color: var(--text-secondary, #aaa);
}

.streaming-tokens {
  font-size: 11px;
  color: var(--text-muted, #888);
}

.correction-input-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(24, 144, 255, 0.2);
}

.correction-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
