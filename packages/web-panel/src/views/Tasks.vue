<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">后台任务</h2>
        <p class="page-sub">Background Task Manager — 后台任务监控与管理</p>
      </div>
      <a-space>
        <a-button ghost :loading="store.loading" @click="store.fetchTasks()">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- Stats Row -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="全部任务" :value="store.tasks.length" value-style="color: var(--text-secondary); font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="运行中" :value="store.running.length" value-style="color: #1677ff; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="等待中" :value="store.pending.length" value-style="color: #faad14; font-size: 18px;" />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic title="已完成" :value="store.completed.length" value-style="color: #52c41a; font-size: 18px;" />
        </a-card>
      </a-col>
    </a-row>

    <!-- Running Tasks -->
    <a-card
      v-if="store.running.length > 0"
      title="运行中的任务"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
      size="small"
    >
      <div v-for="task in store.running" :key="task.id" class="task-item running">
        <div class="task-header">
          <a-tag :color="store.getStatusColor(task.status)">{{ task.status.toUpperCase() }}</a-tag>
          <span class="task-desc">{{ task.description }}</span>
          <span class="task-id">{{ task.id.slice(0, 16) }}</span>
        </div>
        <div class="task-meta">
          <span>类型: {{ task.type }}</span>
          <span>已运行: {{ store.formatDuration(Date.now() - task.startedAt) }}</span>
          <a-button size="small" danger @click="store.stopTask(task.id)">停止</a-button>
        </div>
      </div>
    </a-card>

    <!-- All Tasks Table -->
    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <a-table
        :columns="columns"
        :data-source="store.tasks"
        :pagination="{ pageSize: 15, size: 'small' }"
        :loading="store.loading"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="store.getStatusColor(record.status)">{{ record.status }}</a-tag>
          </template>
          <template v-else-if="column.key === 'description'">
            <span :title="record.command">{{ record.description }}</span>
          </template>
          <template v-else-if="column.key === 'duration'">
            {{ getDuration(record) }}
          </template>
          <template v-else-if="column.key === 'createdAt'">
            {{ formatTime(record.createdAt) }}
          </template>
          <template v-else-if="column.key === 'result'">
            <span v-if="record.error" style="color: #ff4d4f;">{{ truncate(record.error, 60) }}</span>
            <span v-else-if="record.result" style="color: #52c41a;">{{ truncate(String(record.result), 60) }}</span>
            <span v-else style="color: var(--text-tertiary);">-</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-button
              v-if="record.status === 'running'"
              size="small"
              danger
              @click="store.stopTask(record.id)"
            >
              停止
            </a-button>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { useTasksStore } from '../stores/tasks'

const store = useTasksStore()

const columns = [
  { title: '状态', key: 'status', width: 90 },
  { title: '描述', key: 'description', ellipsis: true },
  { title: '类型', dataIndex: 'type', width: 80 },
  { title: '耗时', key: 'duration', width: 90 },
  { title: '创建时间', key: 'createdAt', width: 150 },
  { title: '结果', key: 'result', ellipsis: true },
  { title: '操作', key: 'action', width: 80 },
]

function getDuration(task) {
  if (task.status === 'running' && task.startedAt) {
    return store.formatDuration(Date.now() - task.startedAt)
  }
  if (task.completedAt && task.startedAt) {
    return store.formatDuration(task.completedAt - task.startedAt)
  }
  return '-'
}

function formatTime(ts) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

function truncate(str, len) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

onMounted(() => store.startPolling(5000))
onUnmounted(() => store.stopPolling())
</script>

<style scoped>
.task-item {
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 8px;
  background: var(--bg-card-hover, rgba(255, 255, 255, 0.04));
}
.task-item.running {
  border-left: 3px solid #1677ff;
}
.task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.task-desc {
  flex: 1;
  color: var(--text-primary);
  font-weight: 500;
}
.task-id {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-tertiary);
}
.task-meta {
  display: flex;
  gap: 16px;
  align-items: center;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
