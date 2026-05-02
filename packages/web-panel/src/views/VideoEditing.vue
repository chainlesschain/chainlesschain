<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('videoEditing.title') }}</h2>
        <p class="page-sub">{{ t('videoEditing.subtitle') }}</p>
      </div>
      <a-button type="primary" ghost @click="loadAssets">
        <template #icon><ReloadOutlined /></template>
        {{ t('videoEditing.refreshAssets') }}
      </a-button>
    </div>

    <a-row :gutter="16">
      <!-- Left: Asset Library -->
      <a-col :span="6">
        <a-card :title="t('videoEditing.library.title')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
          <a-spin v-if="assetsLoading" />
          <div v-else-if="assets.length === 0" style="color: var(--text-muted); text-align: center; padding: 20px;">
            {{ t('videoEditing.library.empty') }}<br />{{ t('videoEditing.library.emptyHint') }}
          </div>
          <div v-else>
            <div
              v-for="a in assets"
              :key="a.hash"
              class="asset-item"
              :class="{ active: selectedAsset?.hash === a.hash }"
              @click="selectedAsset = a"
            >
              <div style="font-weight: 500; font-family: monospace; font-size: 12px;">{{ a.hash }}</div>
              <div style="color: var(--text-muted); font-size: 11px; word-break: break-all;">{{ a.videoPath }}</div>
              <div style="color: var(--text-muted); font-size: 11px;">{{ a.modifiedAt?.slice(0,10) }}</div>
            </div>
          </div>
        </a-card>
      </a-col>

      <!-- Center: Workspace -->
      <a-col :span="10">
        <a-card :title="t('videoEditing.workspace.title')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
          <a-form layout="vertical" style="max-width: 100%;">
            <a-form-item :label="t('videoEditing.workspace.videoLabel')">
              <a-input v-model:value="form.videoPath" :placeholder="t('videoEditing.workspace.videoPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('videoEditing.workspace.audioLabel')">
              <a-input v-model:value="form.audioPath" :placeholder="t('videoEditing.workspace.audioPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('videoEditing.workspace.srtLabel')">
              <a-input v-model:value="form.existingSrt" :placeholder="t('videoEditing.workspace.srtPlaceholder')" />
            </a-form-item>
            <a-form-item :label="t('videoEditing.workspace.instructionLabel')">
              <a-textarea v-model:value="form.instruction" :rows="3" :placeholder="t('videoEditing.workspace.instructionPlaceholder')" />
            </a-form-item>
            <a-row :gutter="12">
              <a-col :span="8">
                <a-form-item :label="t('videoEditing.workspace.fpsLabel')">
                  <a-input-number v-model:value="form.fps" :min="1" :max="30" style="width: 100%;" />
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item :label="t('videoEditing.workspace.characterLabel')">
                  <a-input v-model:value="form.mainCharacter" placeholder="Joker" />
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item :label="t('videoEditing.workspace.outputLabel')">
                  <a-input v-model:value="form.outputPath" :placeholder="t('videoEditing.workspace.outputPlaceholder')" />
                </a-form-item>
              </a-col>
            </a-row>
          </a-form>

          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <a-button type="primary" :loading="running" :disabled="!form.videoPath" @click="runFullPipeline">
              {{ t('videoEditing.workspace.actions.fullPipeline') }}
            </a-button>
            <a-button :loading="running" :disabled="!form.videoPath" @click="runDeconstruct">
              {{ t('videoEditing.workspace.actions.deconstruct') }}
            </a-button>
            <a-button :loading="running" :disabled="!selectedAsset" @click="runPlan">
              {{ t('videoEditing.workspace.actions.plan') }}
            </a-button>
            <a-button v-if="running" danger @click="cancel">
              {{ t('videoEditing.workspace.actions.cancel') }}
            </a-button>
          </div>
        </a-card>
      </a-col>

      <!-- Right: Progress & Preview -->
      <a-col :span="8">
        <a-card :title="t('videoEditing.progress.title')" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <div v-if="!running && events.length === 0" style="color: var(--text-muted); text-align: center; padding: 20px;">
            {{ t('videoEditing.progress.waiting') }}
          </div>
          <div v-else>
            <div v-for="(phase, idx) in phases" :key="idx" style="margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <a-badge :status="phaseStatus(phase)" />
                <span style="font-weight: 500;">{{ phase.phase }}</span>
                <span v-if="phase.pct != null" style="color: var(--text-muted); font-size: 12px;">
                  {{ Math.round(phase.pct * 100) }}%
                </span>
              </div>
              <a-progress
                v-if="phase.pct != null"
                :percent="Math.round(phase.pct * 100)"
                :show-info="false"
                size="small"
                :status="phase.done ? 'success' : 'active'"
              />
              <div v-if="phase.message" style="color: var(--text-muted); font-size: 11px;">{{ phase.message }}</div>
            </div>
          </div>
        </a-card>

        <!-- Shot Plan Timeline -->
        <a-card v-if="shotPlan" :title="t('videoEditing.shotPlan.title')" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <div class="timeline-container">
            <div
              v-for="(sec, idx) in shotPlan.sections || []"
              :key="idx"
              class="timeline-section"
              :style="{ width: sectionWidth(sec) + '%' }"
              :title="`Section ${sec.section_idx}: ${sec.shots?.length || 0} shots`"
            >
              <div class="timeline-label">{{ sec.music_segment?.label || idx }}</div>
            </div>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">
            {{ t('videoEditing.shotPlan.summary', { sections: (shotPlan.sections || []).length, shots: (shotPlan.sections || []).reduce((s, sec) => s + (sec.shots?.length || 0), 0) }) }}
          </div>
        </a-card>

        <!-- Event Log -->
        <a-card :title="t('videoEditing.events.title')" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
          <div class="event-log" ref="eventLogRef">
            <div v-for="(ev, idx) in events.slice(-50)" :key="idx" class="event-item">
              <span class="event-type">{{ ev.type }}</span>
              <span class="event-detail">{{ eventDetail(ev) }}</span>
            </div>
          </div>
        </a-card>

        <!-- Video Preview -->
        <a-card v-if="outputPath" :title="t('videoEditing.preview.title')" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-top: 16px;">
          <div style="text-align: center;">
            <div style="color: var(--text-muted); margin-bottom: 8px;">{{ outputPath }}</div>
            <a-button type="primary" ghost size="small" @click="copyPath(outputPath)">{{ t('videoEditing.preview.copyButton') }}</a-button>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { ref, reactive, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws'
import { message as antMsg } from 'ant-design-vue'

const { t } = useI18n()
const ws = useWsStore()

const assets = ref([])
const assetsLoading = ref(false)
const selectedAsset = ref(null)
const running = ref(false)
const events = ref([])
const phases = ref([])
const shotPlan = ref(null)
const outputPath = ref(null)
const eventLogRef = ref(null)
let currentRequestId = null

const form = reactive({
  videoPath: '',
  audioPath: '',
  existingSrt: '',
  instruction: '',
  fps: 2,
  mainCharacter: '',
  outputPath: './output.mp4',
})

onMounted(() => {
  loadAssets()
})

async function loadAssets() {
  assetsLoading.value = true
  try {
    await ws.waitConnected()
    const result = await ws.sendRaw({ type: 'video.assets.list' })
    assets.value = result.assets || []
  } catch {
    assets.value = []
  } finally {
    assetsLoading.value = false
  }
}

function startStreaming(type, payload) {
  events.value = []
  phases.value = []
  shotPlan.value = null
  outputPath.value = null
  running.value = true

  const id = `video-${Date.now()}`
  currentRequestId = id

  const unsub = ws.onMessage((msg) => {
    if (msg.id !== id) return

    if (msg.type === 'stream.event' && msg.event) {
      handleEvent(msg.event)
    }

    if (msg.type === `${type}.end`) {
      running.value = false
      unsub()
      if (msg.ok) {
        if (msg.shotPlan) shotPlan.value = msg.shotPlan
        if (msg.outputPath) outputPath.value = msg.outputPath
        if (msg.assetDir) loadAssets()
        antMsg.success(t('videoEditing.messages.completed'))
      } else {
        antMsg.error(msg.error?.message || t('videoEditing.messages.failed'))
      }
    }
  })

  ws.sendRaw({ type, id, ...payload }).catch(() => {
    running.value = false
    unsub()
  })
}

function handleEvent(ev) {
  events.value.push(ev)

  if (ev.type === 'phase.start') {
    phases.value.push({ phase: ev.phase, pct: 0, message: '', done: false })
  } else if (ev.type === 'phase.progress') {
    const p = phases.value.find(p => p.phase === ev.phase)
    if (p) { p.pct = ev.pct; p.message = ev.message || '' }
  } else if (ev.type === 'phase.end') {
    const p = phases.value.find(p => p.phase === ev.phase)
    if (p) { p.pct = 1; p.done = true }
  }

  nextTick(() => {
    if (eventLogRef.value) eventLogRef.value.scrollTop = eventLogRef.value.scrollHeight
  })
}

function runFullPipeline() {
  startStreaming('video.edit', {
    videoPath: form.videoPath,
    audioPath: form.audioPath || undefined,
    instruction: form.instruction,
    outputPath: form.outputPath,
    existingSrt: form.existingSrt || undefined,
    fps: form.fps,
    mainCharacter: form.mainCharacter || undefined,
  })
}

function runDeconstruct() {
  startStreaming('video.deconstruct', {
    videoPath: form.videoPath,
    audioPath: form.audioPath || undefined,
    existingSrt: form.existingSrt || undefined,
    fps: form.fps,
  })
}

function runPlan() {
  if (!selectedAsset.value) return
  startStreaming('video.plan', {
    assetDir: selectedAsset.value.hash,
    instruction: form.instruction,
    mainCharacter: form.mainCharacter || undefined,
  })
}

function cancel() {
  if (currentRequestId) {
    ws.sendRaw({ type: 'cancel', id: currentRequestId }).catch(() => {})
  }
  running.value = false
}

function phaseStatus(phase) {
  if (phase.done) return 'success'
  if (phase.pct > 0) return 'processing'
  return 'default'
}

function sectionWidth(sec) {
  const total = (shotPlan.value?.sections || []).reduce(
    (s, segment) => s + (segment.music_segment?.end || 0) - (segment.music_segment?.start || 0), 0
  )
  const w = ((sec.music_segment?.end || 0) - (sec.music_segment?.start || 0)) / (total || 1) * 100
  return Math.max(w, 2)
}

function eventDetail(ev) {
  if (ev.phase) return ev.message || ev.phase
  if (ev.tool) return `${ev.agent}.${ev.tool}`
  if (ev.reason) return ev.reason
  return ''
}

function copyPath(p) {
  navigator.clipboard?.writeText(p)
  antMsg.success(t('videoEditing.messages.copied'))
}
</script>

<style scoped>
.asset-item {
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.asset-item:hover { border-color: #1890ff; }
.asset-item.active { border-color: #1890ff; background: rgba(24, 144, 255, 0.08); }

.timeline-container {
  display: flex;
  height: 28px;
  border-radius: 4px;
  overflow: hidden;
  gap: 1px;
}
.timeline-section {
  background: #1890ff;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  transition: all 0.3s;
}
.timeline-section:nth-child(2n) { background: #52c41a; }
.timeline-section:nth-child(3n) { background: #faad14; }
.timeline-section:nth-child(5n) { background: #eb2f96; }
.timeline-label {
  font-size: 10px;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
}

.event-log {
  max-height: 200px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 11px;
}
.event-item {
  padding: 2px 0;
  border-bottom: 1px solid var(--border-color);
}
.event-type {
  color: #1890ff;
  margin-right: 8px;
}
.event-detail {
  color: var(--text-muted);
}
</style>
