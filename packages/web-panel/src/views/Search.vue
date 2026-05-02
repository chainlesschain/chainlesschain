<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('search.title') }}</h2>
        <p class="page-sub">{{ t('search.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loadingIndex" @click="loadIndex">
          <template #icon><ReloadOutlined /></template>
          {{ t('search.refreshIndex') }}
        </a-button>
      </a-space>
    </div>

    <!-- noDb banner -->
    <a-alert
      v-if="errorState.noDb"
      type="info"
      show-icon
      :message="t('search.noDb.message')"
      :description="t('search.noDb.description')"
      style="margin-bottom: 16px;"
    />

    <!-- Search bar -->
    <a-card size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;" :body-style="{ padding: '14px 16px' }">
      <a-form layout="vertical" :model="form" @submit.prevent="runSearch">
        <a-row :gutter="12">
          <a-col :span="14">
            <a-input
              v-model:value="form.query"
              size="large"
              :placeholder="t('search.form.queryPlaceholder')"
              allow-clear
              @press-enter="runSearch"
            >
              <template #prefix><SearchOutlined /></template>
            </a-input>
          </a-col>
          <a-col :span="4">
            <a-radio-group v-model:value="form.mode" size="large" button-style="solid">
              <a-radio-button v-for="m in SEARCH_MODES" :key="m" :value="m">{{ modeLabel(m) }}</a-radio-button>
            </a-radio-group>
          </a-col>
          <a-col :span="3">
            <a-input-number v-model:value="form.topK" :min="1" :max="50" :placeholder="t('search.form.topKPlaceholder')" size="large" style="width: 100%;" />
          </a-col>
          <a-col :span="3">
            <a-button type="primary" size="large" :loading="searching" block @click="runSearch">
              <template #icon><ThunderboltOutlined /></template>
              {{ t('search.form.submit') }}
            </a-button>
          </a-col>
        </a-row>
      </a-form>

      <!-- Recent queries chips -->
      <div v-if="recentQueries.length" class="recent-row">
        <span class="recent-label">{{ t('search.recent.label') }}</span>
        <a-tag
          v-for="q in recentQueries"
          :key="q"
          color="blue"
          class="recent-chip"
          @click="rerunQuery(q)"
        >
          {{ q }}
        </a-tag>
        <a-button size="small" type="link" danger @click="clearRecent">{{ t('search.recent.clear') }}</a-button>
      </div>
    </a-card>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('search.stats.indexedNotes')" :value="indexSummary.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><BookOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('search.stats.categories')" :value="indexSummary.categories.length" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><AppstoreOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('search.stats.tags')"
            :value="indexSummary.tags.length"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><TagsOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('search.stats.results')"
            :value="results.length"
            :value-style="{ color: results.length > 0 ? '#52c41a' : '#888', fontSize: '20px' }"
          >
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('search.stats.topScore')"
            :value="topScore"
            :precision="3"
            :value-style="{ color: scoreColor(topScore), fontSize: '20px' }"
          >
            <template #prefix><TrophyOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="search-tabs">
      <!-- ── Results tab ───────────────────────────────────────── -->
      <a-tab-pane key="results" :tab="t('search.tabs.results')">
        <a-empty v-if="!searched" :description="t('search.results.promptEmpty')" :image="EMPTY_IMG" style="padding: 40px 0;" />
        <a-empty v-else-if="!results.length" :description="t('search.results.noMatch', { query: currentQuery })" :image="EMPTY_IMG" style="padding: 40px 0;" />
        <a-list v-else :data-source="results" item-layout="vertical" size="large">
          <template #renderItem="{ item }">
            <a-list-item class="result-row">
              <template #actions>
                <a-button type="link" size="small" @click="viewNote(item.id)">
                  <template #icon><EyeOutlined /></template>
                  {{ t('search.results.viewFull') }}
                </a-button>
              </template>
              <template #extra>
                <div class="score-block">
                  <a-progress
                    type="circle"
                    :percent="Math.round(Math.min(1, item.score) * 100)"
                    :stroke-color="scoreColor(item.score)"
                    :format="() => item.score.toFixed(3)"
                    :width="60"
                  />
                </div>
              </template>
              <a-list-item-meta>
                <template #title>
                  <span class="result-title">{{ item.title || t('search.results.noTitle') }}</span>
                  <a-tag :color="categoryColor(item.category)" style="margin-left: 8px;">{{ item.category }}</a-tag>
                </template>
                <template #description>
                  <span style="color: var(--text-muted); font-size: 11px; font-family: monospace;">{{ item.id.slice(0, 16) }}</span>
                  <span style="margin-left: 8px; color: var(--text-secondary); font-size: 11px;">{{ formatSearchTime(item.createdAt) }}</span>
                </template>
              </a-list-item-meta>
              <div v-if="item.snippet" class="result-snippet">
                <span v-html="highlightSnippet(item.snippet, currentQuery)" />
              </div>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <!-- ── Index browser tab ────────────────────────────────── -->
      <a-tab-pane key="index" :tab="t('search.tabs.index')">
        <div class="filter-bar">
          <a-radio-group v-model:value="indexCategoryFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ t('search.index.allCategories') }}</a-radio-button>
            <a-radio-button v-for="c in indexSummary.categories.slice(0, 6)" :key="c.name" :value="c.name">
              {{ c.name }} ({{ c.count }})
            </a-radio-button>
          </a-radio-group>
          <a-input
            v-model:value="indexTagFilter"
            :placeholder="t('search.index.tagFilterPlaceholder')"
            allow-clear
            size="small"
            style="max-width: 180px;"
          />
        </div>

        <!-- Top tags chips -->
        <div v-if="indexSummary.tags.length" class="tag-row">
          <span class="tag-row-label">{{ t('search.index.topTagsLabel') }}</span>
          <a-tag
            v-for="tag in indexSummary.tags.slice(0, 12)"
            :key="tag.name"
            :color="indexTagFilter === tag.name ? 'blue' : 'default'"
            class="tag-chip"
            @click="indexTagFilter = (indexTagFilter === tag.name ? '' : tag.name)"
          >
            {{ tag.name }} <span class="tag-count">{{ tag.count }}</span>
          </a-tag>
        </div>

        <a-table
          :columns="noteColumns"
          :data-source="filteredNotes"
          :pagination="{ pageSize: 20, showTotal: (count) => t('search.totals.rows', { count }) }"
          size="small"
          :loading="loadingIndex"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'title'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.title || t('search.results.noTitle') }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace; margin-top: 2px;">
                {{ record.id.slice(0, 16) }}
              </div>
            </template>
            <template v-if="column.key === 'category'">
              <a-tag :color="categoryColor(record.category)">{{ record.category }}</a-tag>
            </template>
            <template v-if="column.key === 'tags'">
              <a-tag v-for="tag in record.tags.slice(0, 4)" :key="tag" color="default" style="font-size: 11px;">{{ tag }}</a-tag>
              <span v-if="record.tags.length > 4" style="color: var(--text-muted); font-size: 11px;">+{{ record.tags.length - 4 }}</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatSearchTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewNote(record.id)">{{ t('search.index.rowAction.view') }}</a-button>
              <a-button size="small" type="link" @click="searchSimilar(record)">{{ t('search.index.rowAction.similar') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <BookOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ indexCategoryFilter || indexTagFilter ? t('search.empty.filtered') : t('search.empty.noNotes') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Note detail modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showNoteModal"
      :title="t('search.note.title', { title: currentNote?.title || '' })"
      :width="780"
      :footer="null"
    >
      <div v-if="loadingNote" style="padding: 40px; text-align: center;">
        <a-spin />
      </div>
      <div v-else-if="currentNote" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="t('search.note.id')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentNote.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('search.note.category')">
            <a-tag :color="categoryColor(currentNote.category)">{{ currentNote.category }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="t('search.note.tags')">
            <a-tag v-for="tag in currentNote.tags" :key="tag" color="default">{{ tag }}</a-tag>
            <span v-if="!currentNote.tags.length" style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item :label="t('search.note.createdAt')">{{ formatSearchTime(currentNote.createdAt) }}</a-descriptions-item>
          <a-descriptions-item :label="t('search.note.updatedAt')">{{ formatSearchTime(currentNote.updatedAt) }}</a-descriptions-item>
        </a-descriptions>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">{{ t('search.note.content') }}</h4>
        <div v-if="currentNote.content" class="note-content">
          <span v-html="highlightContent(currentNote.content, currentQuery)" />
        </div>
        <a-empty v-else :description="t('search.note.emptyContent')" :image="EMPTY_IMG" />
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  BookOutlined,
  AppstoreOutlined,
  TagsOutlined,
  FileTextOutlined,
  TrophyOutlined,
  EyeOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseSearchResults,
  parseNotes,
  parseNote,
  buildIndexSummary,
  detectSearchError,
  formatSearchTime,
  SEARCH_MODES,
} from '../utils/search-parser.js'

const { t } = useI18n()
const ws = useWsStore()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE
const RECENT_LS = 'cc.web-panel.search.recent'
const RECENT_MAX = 8

const loadingIndex = ref(false)
const loadingNote = ref(false)
const searching = ref(false)
const searched = ref(false)

const notes = ref([])
const results = ref([])
const errorState = ref({ noDb: false, error: '' })

const form = reactive({ query: '', mode: 'hybrid', topK: 10 })
const currentQuery = ref('')
const recentQueries = ref(loadRecent())

const activeTab = ref('results')
const indexCategoryFilter = ref('')
const indexTagFilter = ref('')

const showNoteModal = ref(false)
const currentNote = ref(null)

const indexSummary = computed(() => buildIndexSummary(notes.value))

const topScore = computed(() => {
  if (!results.value.length) return 0
  return Math.max(...results.value.map(r => r.score))
})

const noteColumns = computed(() => [
  { title: t('search.noteColumns.title'), key: 'title' },
  { title: t('search.noteColumns.category'), key: 'category', width: '120px' },
  { title: t('search.noteColumns.tags'), key: 'tags', width: '240px' },
  { title: t('search.noteColumns.createdAt'), key: 'createdAt', width: '180px' },
  { title: t('search.noteColumns.action'), key: 'action', width: '180px' },
])

const filteredNotes = computed(() => {
  let rows = notes.value
  if (indexCategoryFilter.value) rows = rows.filter(n => n.category === indexCategoryFilter.value)
  if (indexTagFilter.value.trim()) {
    const q = indexTagFilter.value.trim().toLowerCase()
    rows = rows.filter(n => n.tags.some(tag => tag.toLowerCase().includes(q)))
  }
  return rows
})

function modeLabel(m) {
  const key = `search.mode.${m}`
  const v = t(key)
  return v === key ? m : v
}

function categoryColor(c) {
  const palette = ['blue', 'green', 'purple', 'orange', 'cyan', 'magenta', 'gold', 'volcano']
  let h = 0
  for (let i = 0; i < (c || '').length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function scoreColor(s) {
  if (s >= 0.7) return '#52c41a'
  if (s >= 0.5) return '#1677ff'
  if (s >= 0.3) return '#faad14'
  return '#ff4d4f'
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlightSnippet(snippet, query) {
  if (!query || !snippet) return escapeHtml(snippet)
  const tokens = query.split(/\s+/).filter(Boolean)
  let html = escapeHtml(snippet)
  for (const tok of tokens) {
    const re = new RegExp(`(${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    html = html.replace(re, '<mark>$1</mark>')
  }
  return html
}

function highlightContent(content, query) {
  if (!query) return escapeHtml(content)
  return highlightSnippet(content, query)
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_LS)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(s => typeof s === 'string').slice(0, RECENT_MAX)
    }
  } catch { /* corrupt — ignore */ }
  return []
}

function pushRecent(q) {
  const trimmed = q.trim()
  if (!trimmed) return
  const dedup = [trimmed, ...recentQueries.value.filter(x => x !== trimmed)]
  recentQueries.value = dedup.slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_LS, JSON.stringify(recentQueries.value)) } catch { /* ignore */ }
}

function clearRecent() {
  recentQueries.value = []
  try { localStorage.removeItem(RECENT_LS) } catch { /* ignore */ }
}

function rerunQuery(q) {
  form.query = q
  runSearch()
}

async function loadIndex() {
  loadingIndex.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const { output } = await ws.execute('note list -n 500 --json', 12000).catch(() => ({ output: '' }))
    const err = detectSearchError(output)
    if (err.noDb) {
      errorState.value = err
      notes.value = []
      return
    }
    notes.value = parseNotes(output)
  } catch (e) {
    message.error(t('search.messages.loadIndexFailed', { err: e?.message || e }))
  } finally {
    loadingIndex.value = false
  }
}

async function runSearch() {
  const q = form.query.trim()
  if (!q) {
    message.warning(t('search.messages.queryRequired'))
    return
  }
  searching.value = true
  errorState.value = { noDb: false, error: '' }
  try {
    const parts = [
      `search ${shellQuote(q)}`,
      `--mode ${form.mode}`,
      `--top-k ${form.topK || 10}`,
      '--json',
    ]
    const { output } = await ws.execute(parts.join(' '), 15000)
    const err = detectSearchError(output)
    if (err.noDb) {
      errorState.value = err
      results.value = []
      searched.value = true
      currentQuery.value = q
      return
    }
    results.value = parseSearchResults(output)
    currentQuery.value = q
    searched.value = true
    pushRecent(q)
    activeTab.value = 'results'
  } catch (e) {
    message.error(t('search.messages.searchFailed', { err: e?.message || e }))
  } finally {
    searching.value = false
  }
}

function shellQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`
}

function searchSimilar(record) {
  form.query = record.title
  form.mode = 'vector'
  runSearch()
}

async function viewNote(id) {
  showNoteModal.value = true
  loadingNote.value = true
  currentNote.value = null
  try {
    const { output } = await ws.execute(`note show ${id} --json`, 8000)
    const err = detectSearchError(output)
    if (err.noDb) {
      message.error(t('search.messages.needInit'))
      return
    }
    currentNote.value = parseNote(output)
    if (!currentNote.value) {
      message.error(t('search.messages.noteLoadFailed'))
    }
  } catch (e) {
    message.error(t('search.messages.loadFailed', { err: e?.message || e }))
  } finally {
    loadingNote.value = false
  }
}

onMounted(loadIndex)
</script>

<style scoped>
.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.search-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.recent-label {
  color: var(--text-secondary);
  font-size: 12px;
}
.recent-chip {
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}
.recent-chip:hover { opacity: 0.85; }

.tag-row {
  margin: 4px 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.tag-row-label {
  color: var(--text-secondary);
  font-size: 12px;
}
.tag-chip {
  cursor: pointer;
  user-select: none;
  font-size: 11px;
}
.tag-count {
  color: var(--text-muted);
  margin-left: 4px;
}

.result-row {
  border-bottom: 1px solid var(--border-color);
}
.result-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}
.result-snippet {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  margin-top: 6px;
  word-break: break-word;
}
.result-snippet :deep(mark) {
  background: rgba(250, 173, 20, .25);
  color: inherit;
  border-radius: 2px;
  padding: 0 2px;
}

.score-block {
  display: flex;
  align-items: center;
  justify-content: center;
}

.note-content {
  padding: 12px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  white-space: pre-wrap;
  max-height: 480px;
  overflow: auto;
}
.note-content :deep(mark) {
  background: rgba(250, 173, 20, .25);
  color: inherit;
  border-radius: 2px;
  padding: 0 2px;
}
</style>
