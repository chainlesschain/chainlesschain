<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('memory.title') }}</h2>
        <p class="page-sub">{{ t('memory.subtitle') }}</p>
      </div>
      <a-space>
        <a-button @click="showStore = true" type="primary">
          <template #icon><PlusOutlined /></template>
          {{ t('memory.storeButton') }}
        </a-button>
        <a-button ghost :loading="loading" @click="loadStats">
          <template #icon><ReloadOutlined /></template>
          {{ t('memory.refresh') }}
        </a-button>
      </a-space>
    </div>

    <!-- Stats Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="24" :sm="8">
        <a-card style="background: rgba(114,46,209,.1); border-color: rgba(114,46,209,.35); cursor: pointer;" hoverable @click="activeLayer = 'short-term'">
          <a-statistic :title="t('memory.stats.shortTerm')" :value="stats.shortTerm || 0" value-style="color: #c084fc; font-size: 20px;">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
          <div style="margin-top: 4px; color: var(--text-secondary); font-size: 11px;">{{ t('memory.stats.shortTermHint') }}</div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8">
        <a-card style="background: rgba(22,119,255,.08); border-color: rgba(22,119,255,.3); cursor: pointer;" hoverable @click="activeLayer = 'long-term'">
          <a-statistic :title="t('memory.stats.longTerm')" :value="stats.longTerm || 0" value-style="color: #91caff; font-size: 20px;">
            <template #prefix><ClockCircleOutlined /></template>
          </a-statistic>
          <div style="margin-top: 4px; color: var(--text-secondary); font-size: 11px;">{{ t('memory.stats.longTermHint') }}</div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8">
        <a-card style="background: rgba(41,162,112,.08); border-color: rgba(41,162,112,.3); cursor: pointer;" hoverable @click="activeLayer = 'core'">
          <a-statistic :title="t('memory.stats.core')" :value="stats.core || 0" value-style="color: #69db7c; font-size: 20px;">
            <template #prefix><StarOutlined /></template>
          </a-statistic>
          <div style="margin-top: 4px; color: var(--text-secondary); font-size: 11px;">{{ t('memory.stats.coreHint') }}</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Layer Tabs + Recall -->
    <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
      <template #title>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span>{{ t('memory.card.title') }}</span>
          <a-radio-group v-model:value="activeLayer" button-style="solid" size="small" @change="recallByLayer">
            <a-radio-button value="short-term">{{ t('memory.card.tabs.short') }}</a-radio-button>
            <a-radio-button value="long-term">{{ t('memory.card.tabs.long') }}</a-radio-button>
            <a-radio-button value="core">{{ t('memory.card.tabs.core') }}</a-radio-button>
          </a-radio-group>
        </div>
      </template>
      <template #extra>
        <a-input-search
          v-model:value="recallQuery"
          :placeholder="t('memory.card.searchPlaceholder')"
          allow-clear
          size="small"
          style="width: 220px;"
          :loading="recalling"
          @search="doRecall"
        />
      </template>

      <div v-if="recalling" style="text-align: center; padding: 30px;"><a-spin /></div>
      <div v-else-if="!memories.length" style="text-align: center; padding: 30px; color: var(--text-muted);">
        {{ t('memory.card.emptyText') }}
      </div>
      <div v-else class="memory-list">
        <div v-for="mem in memories" :key="mem.id" class="memory-item">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <a-tag :color="layerColor(mem.layer || activeLayer)" style="font-size: 10px;">
                {{ layerLabel(mem.layer || activeLayer) }}
              </a-tag>
              <span v-if="mem.importance" style="color: var(--text-secondary); font-size: 11px;">
                {{ t('memory.card.importanceLabel', { value: mem.importance }) }}
              </span>
            </div>
            <span style="color: var(--text-muted); font-size: 11px;">{{ mem.time }}</span>
          </div>
          <div style="color: #ccc; font-size: 13px; line-height: 1.6;">{{ mem.content }}</div>
        </div>
      </div>
    </a-card>

    <!-- Consolidate Button -->
    <a-button
      :loading="consolidating"
      @click="consolidate"
      style="background: var(--bg-card-hover); border-color: var(--text-muted); width: 100%;"
    >
      <template #icon><SyncOutlined /></template>
      {{ t('memory.consolidateButton') }}
    </a-button>

    <!-- Store Memory Modal -->
    <a-modal v-model:open="showStore" :title="t('memory.modal.title')" :confirm-loading="storing" @ok="storeMemory">
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item :label="t('memory.modal.contentLabel')" required>
          <a-textarea v-model:value="newMemory.content" :rows="4" :placeholder="t('memory.modal.contentPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('memory.modal.importanceLabel')">
          <a-slider v-model:value="newMemory.importance" :min="0" :max="1" :step="0.1" :marks="importanceMarks" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  PlusOutlined, ReloadOutlined, ThunderboltOutlined, ClockCircleOutlined,
  StarOutlined, SyncOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

const loading = ref(false)
const recalling = ref(false)
const consolidating = ref(false)
const storing = ref(false)
const showStore = ref(false)

const stats = ref({ shortTerm: 0, longTerm: 0, core: 0 })
const memories = ref([])
const activeLayer = ref('short-term')
const recallQuery = ref('')
const newMemory = ref({ content: '', importance: 0.5 })

const importanceMarks = computed(() => ({
  0: t('memory.modal.marks.low'),
  0.5: t('memory.modal.marks.mid'),
  1: t('memory.modal.marks.high'),
}))

function layerColor(layer) {
  return { 'short-term': 'purple', 'long-term': 'blue', 'core': 'green' }[layer] || 'default'
}
function layerLabel(layer) {
  const key = `memory.layer.${layer}`
  const v = t(key)
  return v === key ? layer : v
}

async function loadStats() {
  loading.value = true
  try {
    const { output } = await ws.execute('hmemory stats', 15000)
    parseStats(output)
  } catch (e) {
    console.error('hmemory stats failed:', e)
  } finally {
    loading.value = false
    await recallByLayer()
  }
}

function parseStats(output) {
  const short = output.match(/short.?term[^\d]*(\d+)/i)
  const long = output.match(/long.?term[^\d]*(\d+)/i)
  const core = output.match(/core[^\d]*(\d+)/i)
  if (short) stats.value.shortTerm = parseInt(short[1])
  if (long) stats.value.longTerm = parseInt(long[1])
  if (core) stats.value.core = parseInt(core[1])
}

async function recallByLayer() {
  recalling.value = true
  try {
    const query = activeLayer.value === 'short-term' ? 'recent' : activeLayer.value === 'long-term' ? 'important' : 'core'
    const { output } = await ws.execute(`hmemory recall "${query}" --limit 20`, 15000)
    memories.value = parseMemories(output)
  } catch (_e) {
    memories.value = []
  } finally {
    recalling.value = false
  }
}

async function doRecall() {
  if (!recallQuery.value.trim()) { await recallByLayer(); return }
  recalling.value = true
  try {
    const { output } = await ws.execute(`hmemory recall "${recallQuery.value}"`, 15000)
    memories.value = parseMemories(output)
  } catch (_e) {
    memories.value = []
  } finally {
    recalling.value = false
  }
}

function parseMemories(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Recall')) continue
    const m = trimmed.match(/^[-●•\d.]+\s+(.+)/)
    if (m) {
      const text = m[1].trim()
      if (text.length > 5) {
        result.push({
          id: result.length,
          content: text,
          layer: activeLayer.value,
          importance: '',
          time: ''
        })
      }
    } else if (trimmed.length > 10 && !trimmed.includes(':') && result.length < 30) {
      result.push({ id: result.length, content: trimmed, layer: activeLayer.value, importance: '', time: '' })
    }
  }
  return result.slice(0, 20)
}

async function storeMemory() {
  if (!newMemory.value.content.trim()) { message.warning(t('memory.messages.contentRequired')); return }
  storing.value = true
  try {
    const cmd = `hmemory store "${newMemory.value.content.replace(/"/g, '\\"')}" --importance ${newMemory.value.importance}`
    const { output } = await ws.execute(cmd, 15000)
    if (output.toLowerCase().includes('stored') || output.includes('✔')) {
      message.success(t('memory.messages.storeOk'))
      showStore.value = false
      newMemory.value = { content: '', importance: 0.5 }
      await loadStats()
    } else {
      message.warning(output.slice(0, 100) || t('memory.messages.storeDefault'))
      showStore.value = false
    }
  } catch (e) {
    message.error(t('memory.messages.storeFailed', { err: e.message }))
  } finally {
    storing.value = false
  }
}

async function consolidate() {
  consolidating.value = true
  try {
    await ws.execute('hmemory consolidate', 20000)
    message.success(t('memory.messages.consolidateOk'))
    await loadStats()
  } catch (e) {
    message.error(t('memory.messages.consolidateFailed', { err: e.message }))
  } finally {
    consolidating.value = false
  }
}

onMounted(loadStats)
</script>

<style scoped>
.memory-list { display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
.memory-item {
  background: var(--bg-card-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 14px;
  transition: border-color 0.2s;
}
.memory-item:hover { border-color: var(--text-muted); }
</style>
