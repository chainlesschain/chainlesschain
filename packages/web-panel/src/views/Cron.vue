<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">定时任务</h2>
        <p class="page-sub">定时任务调度管理</p>
      </div>
      <a-space>
        <a-button @click="showAdd = true" type="primary">
          <template #icon><PlusOutlined /></template>
          新建任务
        </a-button>
        <a-button ghost :loading="loading" @click="loadTasks">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- Stats Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="全部任务" :value="tasks.length" value-style="color: #ccc; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="启用中" :value="activeTasks" value-style="color: #52c41a; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="已暂停" :value="pausedTasks" value-style="color: #faad14; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="预设方案" :value="presets.length" value-style="color: #1677ff; font-size: 18px;" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Presets -->
    <a-card title="快速添加预设" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;" size="small">
      <a-space wrap>
        <a-button
          v-for="p in presets"
          :key="p.label"
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
              :text="record.enabled ? '运行中' : '已暂停'"
            />
          </template>
          <template v-if="column.key === 'actions'">
            <a-space size="small">
              <a-button size="small" type="link" :loading="record.running" @click="runTask(record)">运行</a-button>
              <a-button size="small" type="link" @click="toggleTask(record)">
                {{ record.enabled ? '暂停' : '启用' }}
              </a-button>
              <a-popconfirm title="确认删除此任务?" @confirm="deleteTask(record)">
                <a-button size="small" type="link" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
        <template #emptyText>
          <div style="padding: 40px; color: var(--text-muted); text-align: center;">
            <ClockCircleOutlined style="font-size: 36px; margin-bottom: 12px; display: block;" />
            暂无定时任务
          </div>
        </template>
      </a-table>
    </a-card>

    <!-- Add Task Modal -->
    <a-modal v-model:open="showAdd" title="新建定时任务" :confirm-loading="adding" @ok="addTask" width="520px">
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="任务名称" required>
          <a-input v-model:value="newTask.name" placeholder="任务名称" />
        </a-form-item>
        <a-form-item label="Cron 表达式" required>
          <a-input v-model:value="newTask.cron" placeholder="如: 0 9 * * * (每天9点)" />
          <div style="color: var(--text-secondary); font-size: 11px; margin-top: 4px;">格式: 分 时 日 月 周</div>
        </a-form-item>
        <a-form-item label="任务内容" required>
          <a-textarea v-model:value="newTask.payload" :rows="3" placeholder="要执行的 AI 任务描述..." />
        </a-form-item>
        <a-form-item label="描述">
          <a-input v-model:value="newTask.description" placeholder="可选描述" />
        </a-form-item>
        <a-form-item label="立即启用">
          <a-switch v-model:checked="newTask.enabled" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { PlusOutlined, ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

const loading = ref(false)
const adding = ref(false)
const showAdd = ref(false)
const tasks = ref([])

const activeTasks = computed(() => tasks.value.filter(t => t.enabled).length)
const pausedTasks = computed(() => tasks.value.filter(t => !t.enabled).length)

const presets = [
  { label: '每5分钟', cron: '*/5 * * * *' },
  { label: '每15分钟', cron: '*/15 * * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每天9点', cron: '0 9 * * *' },
  { label: '每天18点', cron: '0 18 * * *' },
  { label: '每周一9点', cron: '0 9 * * 1' },
  { label: '每月1号', cron: '0 9 1 * *' },
]

const newTask = ref({ name: '', cron: '', payload: '', description: '', enabled: true })

const columns = [
  { title: '任务名称', key: 'name', width: '25%' },
  { title: 'Cron', key: 'cron', width: '20%' },
  { title: '状态', key: 'status', width: '15%' },
  { title: '操作', key: 'actions', width: '20%' },
]

async function loadTasks() {
  loading.value = true
  try {
    // Try to list cron tasks via skill
    const { output } = await ws.execute('skill run cron-scheduler "list all scheduled tasks"', 20000)
    tasks.value = parseTasks(output)
  } catch (e) {
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
    // Try to parse task entries
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
  if (!newTask.value.name || !newTask.value.cron) { message.warning('请填写任务名称和 Cron 表达式'); return }
  adding.value = true
  try {
    const cmd = `skill run cron-scheduler "add task: ${newTask.value.name}, schedule: ${newTask.value.cron}, payload: ${newTask.value.payload || 'ping'}"`
    const { output } = await ws.execute(cmd, 20000)
    message.success('任务已创建')
    showAdd.value = false
    newTask.value = { name: '', cron: '', payload: '', description: '', enabled: true }
    await loadTasks()
  } catch (e) {
    message.error('创建失败: ' + e.message)
  } finally {
    adding.value = false
  }
}

async function runTask(record) {
  record.running = true
  try {
    const { output } = await ws.execute(`skill run cron-scheduler "run task: ${record.name}"`, 30000)
    message.success(`任务 ${record.name} 已触发`)
  } catch (e) {
    message.error('触发失败: ' + e.message)
  } finally {
    record.running = false
  }
}

async function toggleTask(record) {
  const action = record.enabled ? 'pause' : 'enable'
  try {
    await ws.execute(`skill run cron-scheduler "${action} task: ${record.name}"`, 10000)
    record.enabled = !record.enabled
    message.success(`任务已${record.enabled ? '启用' : '暂停'}`)
  } catch (e) {
    message.error('操作失败')
  }
}

async function deleteTask(record) {
  try {
    await ws.execute(`skill run cron-scheduler "delete task: ${record.name}"`, 10000)
    tasks.value = tasks.value.filter(t => t.key !== record.key)
    message.success('任务已删除')
  } catch (e) {
    message.error('删除失败')
  }
}

onMounted(loadTasks)
</script>
