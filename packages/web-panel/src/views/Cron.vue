<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('cron.title') }}</h2>
        <p class="page-sub">{{ t('cron.subtitle') }}</p>
      </div>
      <a-space>
        <a-button @click="showAdd = true" type="primary">
          <template #icon><PlusOutlined /></template>
          {{ t('cron.newTask') }}
        </a-button>
        <a-button ghost :loading="loading" @click="loadTasks">
          <template #icon><ReloadOutlined /></template>
          {{ t('cron.refresh') }}
        </a-button>
      </a-space>
    </div>

    <!-- Stats Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('cron.stats.all')" :value="tasks.length" value-style="color: #ccc; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('cron.stats.active')" :value="activeTasks" value-style="color: #52c41a; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('cron.stats.paused')" :value="pausedTasks" value-style="color: #faad14; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic :title="t('cron.stats.presets')" :value="presets.length" value-style="color: #1677ff; font-size: 18px;" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Presets -->
    <a-card :title="t('cron.presetsCardTitle')" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;" size="small">
      <a-space wrap>
        <a-button
          v-for="p in presets"
          :key="p.key"
          size="small"
          style="background: var(--bg-card-hover); border-color: var(--border-color); font-size: 12px;"
          @click="applyPreset(p)"
        >
          {{ p.label }}
        </a-button>
      </a-space>
    </a-card>

    <!-- Tasks Table -->
    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <div v-if="loading" style="text-align: center; padding: 40px;"><a-spin size="large" /></div>
      <a-table
        v-else
        :columns="columns"
        :data-source="tasks"
        :pagination="{ pageSize: 15 }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div style="color: #e0e0e0; font-weight: 500;">{{ record.name }}</div>
            <div v-if="record.description" style="color: var(--text-secondary); font-size: 11px;">{{ record.description }}</div>
          </template>
          <template v-if="column.key === 'cron'">
            <code style="background: var(--bg-card-hover); padding: 2px 6px; border-radius: 3px; color: #91caff; font-size: 11px;">{{ record.cron }}</code>
          </template>
          <template v-if="column.key === 'status'">
            <a-badge
              :status="record.enabled ? 'success' : 'warning'"
              :text="record.enabled ? t('cron.running') : t('cron.paused')"
            />
          </template>
          <template v-if="column.key === 'actions'">
            <a-space size="small">
              <a-button size="small" type="link" :loading="record.running" @click="runTask(record)">{{ t('cron.actions.run') }}</a-button>
              <a-button size="small" type="link" @click="toggleTask(record)">
                {{ record.enabled ? t('cron.actions.pause') : t('cron.actions.enable') }}
              </a-button>
              <a-popconfirm :title="t('cron.actions.deleteConfirm')" @confirm="deleteTask(record)">
                <a-button size="small" type="link" danger>{{ t('cron.actions.delete') }}</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
        <template #emptyText>
          <div style="padding: 40px; color: var(--text-muted); text-align: center;">
            <ClockCircleOutlined style="font-size: 36px; margin-bottom: 12px; display: block;" />
            {{ t('cron.emptyText') }}
          </div>
        </template>
      </a-table>
    </a-card>

    <!-- Add Task Modal -->
    <a-modal v-model:open="showAdd" :title="t('cron.modal.title')" :confirm-loading="adding" @ok="addTask" width="520px">
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="t('cron.modal.nameLabel')" required>
          <a-input v-model:value="newTask.name" :placeholder="t('cron.modal.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('cron.modal.cronLabel')" required>
          <a-input v-model:value="newTask.cron" :placeholder="t('cron.modal.cronPlaceholder')" />
          <div style="color: var(--text-secondary); font-size: 11px; margin-top: 4px;">{{ t('cron.modal.cronHint') }}</div>
        </a-form-item>
        <a-form-item :label="t('cron.modal.payloadLabel')" required>
          <a-textarea v-model:value="newTask.payload" :rows="3" :placeholder="t('cron.modal.payloadPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('cron.modal.descriptionLabel')">
          <a-input v-model:value="newTask.description" :placeholder="t('cron.modal.descriptionPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('cron.modal.enabledLabel')">
          <a-switch v-model:checked="newTask.enabled" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

const loading = ref(false)
const adding = ref(false)
const showAdd = ref(false)
const tasks = ref([])

const activeTasks = computed(() => tasks.value.filter(task => task.enabled).length)
const pausedTasks = computed(() => tasks.value.filter(task => !task.enabled).length)

const PRESETS = [
  { key: 'every5m', cron: '*/5 * * * *' },
  { key: 'every15m', cron: '*/15 * * * *' },
  { key: 'everyHour', cron: '0 * * * *' },
  { key: 'every9am', cron: '0 9 * * *' },
  { key: 'every6pm', cron: '0 18 * * *' },
  { key: 'weeklyMon9', cron: '0 9 * * 1' },
  { key: 'monthly1', cron: '0 9 1 * *' },
]

const presets = computed(() =>
  PRESETS.map(p => ({ ...p, label: t(`cron.presets.${p.key}`) })),
)

const newTask = ref({ name: '', cron: '', payload: '', description: '', enabled: true })

const columns = computed(() => [
  { title: t('cron.columns.name'), key: 'name', width: '25%' },
  { title: t('cron.columns.cron'), key: 'cron', width: '20%' },
  { title: t('cron.columns.status'), key: 'status', width: '15%' },
  { title: t('cron.columns.actions'), key: 'actions', width: '20%' },
])

async function loadTasks() {
  loading.value = true
  try {
    const { output } = await ws.execute('skill run cron-scheduler "list all scheduled tasks"', 20000)
    tasks.value = parseTasks(output)
  } catch (_e) {
    tasks.value = []
  } finally {
    loading.value = false
  }
}

function parseTasks(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─')) continue
    const m = trimmed.match(/^([^\t|]+?)[\t|]+([*\d/,\-?LW#\s]+)[\t|]+/)
    if (m) {
      result.push({
        key: result.length,
        name: m[1].trim(),
        cron: m[2].trim(),
        enabled: !trimmed.toLowerCase().includes('pause') && !trimmed.toLowerCase().includes('disabled'),
        description: '',
        running: false
      })
    }
  }
  return result
}

function applyPreset(preset) {
  newTask.value.cron = preset.cron
  showAdd.value = true
}

async function addTask() {
  if (!newTask.value.name || !newTask.value.cron) { message.warning(t('cron.messages.nameAndCronRequired')); return }
  adding.value = true
  try {
    const cmd = `skill run cron-scheduler "add task: ${newTask.value.name}, schedule: ${newTask.value.cron}, payload: ${newTask.value.payload || 'ping'}"`
    await ws.execute(cmd, 20000)
    message.success(t('cron.messages.createOk'))
    showAdd.value = false
    newTask.value = { name: '', cron: '', payload: '', description: '', enabled: true }
    await loadTasks()
  } catch (e) {
    message.error(t('cron.messages.createFailed', { err: e.message }))
  } finally {
    adding.value = false
  }
}

async function runTask(record) {
  record.running = true
  try {
    await ws.execute(`skill run cron-scheduler "run task: ${record.name}"`, 30000)
    message.success(t('cron.messages.runOk', { name: record.name }))
  } catch (e) {
    message.error(t('cron.messages.runFailed', { err: e.message }))
  } finally {
    record.running = false
  }
}

async function toggleTask(record) {
  const action = record.enabled ? 'pause' : 'enable'
  try {
    await ws.execute(`skill run cron-scheduler "${action} task: ${record.name}"`, 10000)
    record.enabled = !record.enabled
    message.success(record.enabled ? t('cron.messages.toggleEnabled') : t('cron.messages.togglePaused'))
  } catch (_e) {
    message.error(t('cron.messages.toggleFailed'))
  }
}

async function deleteTask(record) {
  try {
    await ws.execute(`skill run cron-scheduler "delete task: ${record.name}"`, 10000)
    tasks.value = tasks.value.filter(task => task.key !== record.key)
    message.success(t('cron.messages.deleteOk'))
  } catch (_e) {
    message.error(t('cron.messages.deleteFailed'))
  }
}

onMounted(loadTasks)
</script>
