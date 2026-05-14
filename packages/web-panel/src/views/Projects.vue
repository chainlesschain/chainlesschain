<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('projects.title') }}</h2>
        <p class="page-sub">桌面 / CLI / 手机 三端共享同一份项目数据，Phase 3d sync 自动同步 (<router-link to="/project-init">项目初始化 / 环境设置</router-link>)</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="onShowCreate">
          <template #icon><PlusOutlined /></template>
          新建项目
        </a-button>
      </a-space>
    </div>

    <!-- Stats -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="总项目" :value="projects.length" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><FolderOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="活跃" :value="countByStatus.active" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="草稿" :value="countByStatus.draft" :value-style="{ color: '#8c8c8c', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="6">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="已完成" :value="countByStatus.completed" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
            <template #prefix><CheckSquareOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Filter -->
    <div class="filter-bar" style="margin-bottom: 12px; display: flex; gap: 12px; align-items: center;">
      <a-radio-group v-model:value="statusFilter" size="small" button-style="solid">
        <a-radio-button value="">全部</a-radio-button>
        <a-radio-button value="active">活跃</a-radio-button>
        <a-radio-button value="draft">草稿</a-radio-button>
        <a-radio-button value="completed">已完成</a-radio-button>
        <a-radio-button value="archived">已归档</a-radio-button>
      </a-radio-group>
      <a-input-search v-model:value="nameFilter" placeholder="按名称过滤" style="max-width: 260px;" allow-clear />
    </div>

    <a-alert
      v-if="!projects.length && !loading"
      type="info"
      message="还没有项目"
      description='运行 `cc project init <name>` 或点击右上角"新建项目"按钮创建。桌面 / CLI / 手机三端共享同一份数据。'
      show-icon
      style="margin-bottom: 16px;"
    />

    <a-table
      v-if="projects.length || loading"
      :columns="columns"
      :data-source="filteredProjects"
      :loading="loading"
      :pagination="{ pageSize: 20, showSizeChanger: true }"
      row-key="id"
      :custom-row="onRowClick"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'id'">
          <code style="font-size: 12px; color: #888;">{{ record.id.slice(0, 8) }}…</code>
        </template>
        <template v-else-if="column.key === 'name'">
          <strong>{{ record.name }}</strong>
          <div v-if="record.description" style="color: #888; font-size: 12px;">{{ record.description }}</div>
        </template>
        <template v-else-if="column.key === 'project_type'">
          <a-tag>{{ record.project_type }}</a-tag>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ record.status }}</a-tag>
        </template>
        <template v-else-if="column.key === 'sync_status'">
          <a-tag :color="syncColor(record.sync_status)">{{ record.sync_status || 'unknown' }}</a-tag>
        </template>
        <template v-else-if="column.key === 'updated_at'">
          {{ formatTime(record.updated_at) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space @click.stop>
            <a-button size="small" @click="openDetail(record)">详情</a-button>
            <a-popconfirm
              :title="`删除项目 '${record.name}' ？`"
              ok-text="删除"
              ok-type="danger"
              cancel-text="取消"
              @confirm="onDelete(record)"
            >
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- Detail drawer -->
    <a-drawer
      v-model:open="detailOpen"
      :title="detail?.name || '项目详情'"
      width="640"
      placement="right"
    >
      <a-descriptions v-if="detail" :column="1" bordered size="small">
        <a-descriptions-item label="ID"><code>{{ detail.id }}</code></a-descriptions-item>
        <a-descriptions-item label="名称">{{ detail.name }}</a-descriptions-item>
        <a-descriptions-item label="描述">{{ detail.description || '-' }}</a-descriptions-item>
        <a-descriptions-item label="类型"><a-tag>{{ detail.project_type }}</a-tag></a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="statusColor(detail.status)">{{ detail.status }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="同步状态">
          <a-tag :color="syncColor(detail.sync_status)">{{ detail.sync_status || 'unknown' }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="用户">{{ detail.user_id }}</a-descriptions-item>
        <a-descriptions-item label="根路径">
          <code v-if="detail.root_path">{{ detail.root_path }}</code>
          <span v-else style="color: #888;">(无)</span>
        </a-descriptions-item>
        <a-descriptions-item label="文件数">{{ detail.file_count || 0 }}</a-descriptions-item>
        <a-descriptions-item label="创建">{{ formatTime(detail.created_at) }}</a-descriptions-item>
        <a-descriptions-item label="更新">{{ formatTime(detail.updated_at) }}</a-descriptions-item>
      </a-descriptions>

      <a-divider>文件</a-divider>
      <a-spin :spinning="filesLoading">
        <a-empty v-if="!files.length && !filesLoading" description="无文件 (仅元数据项目)" />
        <a-list v-else size="small" :data-source="files">
          <template #renderItem="{ item }">
            <a-list-item>
              <span>{{ item.is_folder ? '📁' : '📄' }} {{ item.file_path }}</span>
              <template #extra>
                <span v-if="item.file_size" style="color: #888; font-size: 12px;">{{ item.file_size }} B</span>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-spin>
    </a-drawer>

    <!-- Create modal -->
    <a-modal
      v-model:open="createOpen"
      title="新建项目"
      :confirm-loading="creating"
      ok-text="创建"
      cancel-text="取消"
      @ok="onCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="项目名称" required>
          <a-input v-model:value="newProject.name" placeholder="例如：旅行计划-上海" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="newProject.description" :rows="2" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="newProject.type">
            <a-select-option value="document">文档 (document)</a-select-option>
            <a-select-option value="data">数据 (data)</a-select-option>
            <a-select-option value="web">Web</a-select-option>
            <a-select-option value="app">应用 (app)</a-select-option>
            <a-select-option value="presentation">演示文稿</a-select-option>
            <a-select-option value="spreadsheet">表格</a-select-option>
            <a-select-option value="design">设计</a-select-option>
            <a-select-option value="code">代码</a-select-option>
            <a-select-option value="workflow">工作流</a-select-option>
            <a-select-option value="knowledge">知识库</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="根路径 (可选)">
          <a-input v-model:value="newProject.rootPath" placeholder="留空则仅元数据" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  FolderOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from '../composables/useShellMode.js'

const { t } = useI18n()
const ws = useWsStore()
const { isEmbedded } = useShellMode()

// #21 P3 — embedded shell 走 in-process WS topic (避免 cc subprocess 冷启 6-10s)；
// cc serve 模式仍用 ws.executeJson 兜底 (subprocess 在裸 node 无 asar 开销可接受)。
async function callProjectTopic(topic, msg, fallbackCmd, timeoutMs = 8000) {
  if (isEmbedded) {
    const reply = await ws.sendRaw({ type: topic, ...msg }, timeoutMs)
    if (!reply?.ok) {
      const err = reply?.error
      throw new Error(typeof err === 'string' ? err : err?.message || `${topic} failed`)
    }
    return reply.result
  }
  return ws.executeJson(fallbackCmd, timeoutMs)
}

const loading = ref(false)
const projects = ref([])
const statusFilter = ref('')
const nameFilter = ref('')

const detailOpen = ref(false)
const detail = ref(null)
const files = ref([])
const filesLoading = ref(false)

const createOpen = ref(false)
const creating = ref(false)
const newProject = ref({ name: '', description: '', type: 'document', rootPath: '' })

const columns = [
  { title: 'ID', key: 'id', width: 110 },
  { title: '名称', key: 'name' },
  { title: '类型', key: 'project_type', width: 120 },
  { title: '状态', key: 'status', width: 100 },
  { title: '同步', key: 'sync_status', width: 100 },
  { title: '更新', key: 'updated_at', width: 160 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' },
]

const countByStatus = computed(() => {
  const c = { active: 0, draft: 0, completed: 0, archived: 0 }
  for (const p of projects.value) {
    if (c[p.status] !== undefined) c[p.status] += 1
  }
  return c
})

const filteredProjects = computed(() => {
  return projects.value.filter((p) => {
    if (statusFilter.value && p.status !== statusFilter.value) return false
    if (nameFilter.value && !p.name.toLowerCase().includes(nameFilter.value.toLowerCase())) return false
    return true
  })
})

function statusColor(s) {
  switch (s) {
    case 'active': return 'green'
    case 'draft': return 'default'
    case 'completed': return 'cyan'
    case 'archived': return 'gold'
    default: return 'default'
  }
}

function syncColor(s) {
  switch (s) {
    case 'synced': return 'green'
    case 'pending': return 'orange'
    case 'conflict': return 'red'
    case 'error': return 'red'
    default: return 'default'
  }
}

function formatTime(ms) {
  if (!ms && ms !== 0) return '-'
  const d = new Date(typeof ms === 'number' ? ms : parseInt(ms, 10))
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function loadAll() {
  loading.value = true
  try {
    const result = await callProjectTopic(
      'project.list',
      { limit: 500 },
      'project list --limit 500 --json',
      10000,
    )
    projects.value = Array.isArray(result?.projects)
      ? result.projects
      : Array.isArray(result)
        ? result
        : []
  } catch (err) {
    message.error('加载失败: ' + (err.message || err))
    projects.value = []
  } finally {
    loading.value = false
  }
}

function onRowClick(record) {
  return { onClick: () => openDetail(record) }
}

async function openDetail(record) {
  detail.value = record
  detailOpen.value = true
  filesLoading.value = true
  files.value = []
  try {
    const r = await callProjectTopic(
      'project.listFiles',
      { projectId: record.id, limit: 200 },
      `project list-files ${record.id} --json`,
      8000,
    )
    files.value = Array.isArray(r?.files) ? r.files : []
  } catch {
    files.value = []
  } finally {
    filesLoading.value = false
  }
}

async function onDelete(record) {
  try {
    const r = await callProjectTopic(
      'project.delete',
      { id: record.id },
      `project delete ${record.id} --json`,
      8000,
    )
    if (r?.ok) {
      message.success(`已删除项目 '${record.name}'`)
      detailOpen.value = false
      await loadAll()
    } else {
      message.error('删除失败')
    }
  } catch (err) {
    message.error(err.message || String(err))
  }
}

function onShowCreate() {
  newProject.value = { name: '', description: '', type: 'document', rootPath: '' }
  createOpen.value = true
}

async function onCreate() {
  if (!newProject.value.name.trim()) {
    message.warning('请输入项目名称')
    return
  }
  creating.value = true
  try {
    const r = await callProjectTopic(
      'project.init',
      {
        name: newProject.value.name.trim(),
        description: newProject.value.description || null,
        type: newProject.value.type,
        rootPath: newProject.value.rootPath || null,
      },
      `project init "${newProject.value.name.trim()}" --type ${newProject.value.type} --json`,
      8000,
    )
    if (r?.id) {
      message.success(`已创建项目 '${r.name}'`)
      createOpen.value = false
      await loadAll()
    } else {
      message.error('创建失败')
    }
  } catch (err) {
    message.error(err.message || String(err))
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  loadAll()
})
</script>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
}
.page-sub {
  margin: 0;
  color: #888;
  font-size: 13px;
}
</style>
