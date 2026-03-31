<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">笔记管理</h2>
        <p class="page-sub">个人知识库 · {{ notes.length }} 条笔记</p>
      </div>
      <a-space>
        <a-button @click="showAdd = true" type="primary">
          <template #icon><PlusOutlined /></template>
          新建笔记
        </a-button>
        <a-button ghost :loading="loading" @click="loadNotes">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- Search -->
    <div style="margin-bottom: 16px; display: flex; gap: 10px;">
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索笔记..."
        allow-clear
        style="max-width: 400px;"
        :loading="searching"
        @search="doSearch"
        @clear="clearSearch"
      />
      <a-tag v-if="isSearchMode" color="blue" closable @close="clearSearch">
        搜索: {{ searchQuery }}
      </a-tag>
    </div>

    <!-- Loading -->
    <div v-if="loading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>

    <!-- Notes Table -->
    <a-table
      v-else
      :columns="columns"
      :data-source="displayNotes"
      :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
      size="small"
      style="background: var(--bg-card);"
      :row-class-name="() => 'note-row'"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <span style="color: #e0e0e0; font-weight: 500;">{{ record.title }}</span>
        </template>
        <template v-if="column.key === 'tags'">
          <a-tag v-for="tag in record.tags" :key="tag" color="blue" style="font-size: 10px; margin: 1px;">
            {{ tag }}
          </a-tag>
        </template>
        <template v-if="column.key === 'content'">
          <span style="color: var(--text-secondary); font-size: 12px;">{{ record.preview }}</span>
        </template>
        <template v-if="column.key === 'actions'">
          <a-button size="small" type="link" @click="viewNote(record)">查看</a-button>
        </template>
      </template>
      <template #emptyText>
        <div style="padding: 40px; color: var(--text-muted); text-align: center;">
          <FileTextOutlined style="font-size: 40px; margin-bottom: 12px; display: block;" />
          {{ error || '暂无笔记，点击"新建笔记"添加' }}
        </div>
      </template>
    </a-table>

    <!-- Add Note Modal -->
    <a-modal
      v-model:open="showAdd"
      title="新建笔记"
      :confirm-loading="adding"
      @ok="addNote"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item label="标题" required>
          <a-input v-model:value="newNote.title" placeholder="笔记标题" />
        </a-form-item>
        <a-form-item label="内容">
          <a-textarea v-model:value="newNote.content" :rows="5" placeholder="笔记内容..." />
        </a-form-item>
        <a-form-item label="标签">
          <a-input v-model:value="newNote.tags" placeholder="用逗号分隔，如: work,ideas" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- View Note Modal -->
    <a-modal
      v-model:open="showView"
      :title="viewingNote?.title"
      :footer="null"
      width="700px"
    >
      <div v-if="viewingNote" style="max-height: 60vh; overflow-y: auto;">
        <div style="margin-bottom: 10px;">
          <a-tag v-for="tag in viewingNote.tags" :key="tag" color="blue">{{ tag }}</a-tag>
        </div>
        <pre style="white-space: pre-wrap; color: #ccc; font-family: inherit; line-height: 1.7; background: var(--bg-base); padding: 16px; border-radius: 6px; border: 1px solid var(--border-color);">{{ viewingNote.content || viewingNote.preview }}</pre>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { PlusOutlined, ReloadOutlined, FileTextOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

const loading = ref(false)
const searching = ref(false)
const adding = ref(false)
const error = ref('')
const notes = ref([])
const searchResults = ref([])
const isSearchMode = ref(false)
const searchQuery = ref('')
const showAdd = ref(false)
const showView = ref(false)
const viewingNote = ref(null)
const newNote = ref({ title: '', content: '', tags: '' })

const displayNotes = computed(() => isSearchMode.value ? searchResults.value : notes.value)

const columns = [
  { title: '标题', dataIndex: 'title', key: 'title', width: '30%' },
  { title: '预览', key: 'content', ellipsis: true },
  { title: '标签', key: 'tags', width: '20%' },
  { title: '操作', key: 'actions', width: '80px' },
]

async function loadNotes() {
  loading.value = true
  error.value = ''
  try {
    const { output } = await ws.execute('note list', 20000)
    notes.value = parseNoteList(output)
  } catch (e) {
    error.value = `加载失败: ${e.message}`
  } finally {
    loading.value = false
  }
}

function parseNoteList(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.startsWith('Note') || trimmed.match(/^\d+ note/i)) continue
    // Format: "ID. Title [tags] - preview" or "Title"
    const m = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+\[([^\]]+)\])?\s*(?:-\s*(.*))?$/)
    if (m) {
      result.push({
        key: m[1],
        id: m[1],
        title: m[2].trim(),
        tags: m[3] ? m[3].split(',').map(t => t.trim()) : [],
        preview: (m[4] || '').trim().slice(0, 100),
        content: ''
      })
    } else if (trimmed.length > 2 && !trimmed.startsWith('✖') && !trimmed.startsWith('[')) {
      result.push({
        key: result.length,
        id: String(result.length),
        title: trimmed,
        tags: [],
        preview: '',
        content: ''
      })
    }
  }
  return result
}

async function doSearch() {
  if (!searchQuery.value.trim()) { clearSearch(); return }
  searching.value = true
  isSearchMode.value = true
  try {
    const { output } = await ws.execute(`note search "${searchQuery.value}"`, 15000)
    searchResults.value = parseNoteList(output)
  } catch (e) {
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

function clearSearch() {
  searchQuery.value = ''
  isSearchMode.value = false
  searchResults.value = []
}

async function addNote() {
  if (!newNote.value.title.trim()) { message.warning('请输入标题'); return }
  adding.value = true
  try {
    let cmd = `note add "${newNote.value.title}"`
    if (newNote.value.content) cmd += ` -c "${newNote.value.content.replace(/"/g, '\\"')}"`
    if (newNote.value.tags) cmd += ` -t "${newNote.value.tags}"`
    const { output } = await ws.execute(cmd, 15000)
    if (output.includes('✖') || output.toLowerCase().includes('error')) {
      message.error('添加失败: ' + output.slice(0, 100))
    } else {
      message.success('笔记已添加')
      showAdd.value = false
      newNote.value = { title: '', content: '', tags: '' }
      await loadNotes()
    }
  } catch (e) {
    message.error('添加失败: ' + e.message)
  } finally {
    adding.value = false
  }
}

function viewNote(record) {
  viewingNote.value = record
  showView.value = true
}

onMounted(loadNotes)
</script>

<style scoped>
:deep(.note-row:hover td) { background: var(--bg-card-hover) !important; cursor: pointer; }
</style>
