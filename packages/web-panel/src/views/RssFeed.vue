<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">RSS 订阅</h2>
        <p class="page-sub">订阅源 / 文章阅读</p>
      </div>
      <a-space>
        <a-button type="primary" @click="showAddModal = true">
          <template #icon><PlusOutlined /></template>
          添加订阅
        </a-button>
        <a-button ghost :loading="refreshingAll" @click="refreshAllFeeds">
          <template #icon><ReloadOutlined /></template>
          全部刷新
        </a-button>
      </a-space>
    </div>

    <!-- Stats Cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="6" v-for="stat in statsCards" :key="stat.label">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);" size="small">
          <a-statistic
            :title="stat.label"
            :value="stat.value"
            :value-style="{ color: stat.color, fontSize: '20px' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Section 1: Feed Sources -->
    <h3 style="color: var(--text-primary); margin-bottom: 12px;">订阅源管理</h3>

    <div v-if="feedsLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>

    <a-row v-else-if="feeds.length > 0" :gutter="[16, 16]" style="margin-bottom: 24px;">
      <a-col :xs="24" :sm="12" :md="8" :lg="6" v-for="feed in feeds" :key="feed.id || feed.url">
        <a-card
          style="background: var(--bg-card); border-color: var(--border-color);"
          size="small"
          :hoverable="true"
        >
          <template #title>
            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
              <ReadOutlined style="color: #1677ff; flex-shrink: 0;" />
              <span style="color: #e0e0e0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {{ feed.title || '未命名订阅' }}
              </span>
            </div>
          </template>
          <template #extra>
            <a-dropdown>
              <a-button size="small" type="text" style="color: var(--text-muted);">...</a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item @click="refreshFeed(feed)">
                    <ReloadOutlined /> 刷新
                  </a-menu-item>
                  <a-menu-item @click="removeFeed(feed)" danger>
                    <DeleteOutlined /> 删除
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>
          <p style="color: var(--text-muted); font-size: 11px; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <LinkOutlined /> {{ feed.url || '-' }}
          </p>
          <div style="display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 12px;">
            <span>{{ feed.itemCount ?? '-' }} 篇文章</span>
            <span>{{ formatTime(feed.lastUpdated) }}</span>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <div v-else style="text-align: center; padding: 40px; color: var(--text-muted); margin-bottom: 24px;">
      <ReadOutlined style="font-size: 40px; margin-bottom: 12px; display: block;" />
      暂无订阅源，点击"添加订阅"开始
    </div>

    <!-- Section 2: Articles -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
      <h3 style="color: var(--text-primary); margin: 0;">文章列表</h3>
      <a-space>
        <a-select
          v-model:value="selectedFeedId"
          style="min-width: 180px;"
          placeholder="筛选订阅源"
          allow-clear
          @change="loadArticles"
        >
          <a-select-option value="">全部订阅</a-select-option>
          <a-select-option v-for="feed in feeds" :key="feed.id" :value="feed.id">
            {{ feed.title || feed.url }}
          </a-select-option>
        </a-select>
        <a-button :loading="articlesLoading" @click="loadArticles">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-space>
    </div>

    <div v-if="articlesLoading" style="text-align: center; padding: 60px;"><a-spin size="large" /></div>

    <a-table
      v-else
      :columns="articleColumns"
      :data-source="articles"
      :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
      size="small"
      style="background: var(--bg-card);"
      :row-class-name="() => 'rss-row'"
      :expandable="{ expandedRowKeys: expandedKeys, onExpand: onExpandArticle }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <a
            v-if="record.link"
            :href="record.link"
            target="_blank"
            rel="noopener noreferrer"
            style="color: #1677ff; font-weight: 500;"
          >
            <LinkOutlined style="margin-right: 4px;" />{{ record.title }}
          </a>
          <span v-else style="color: #e0e0e0; font-weight: 500;">{{ record.title }}</span>
        </template>
        <template v-if="column.key === 'source'">
          <a-tag color="blue" style="font-size: 10px;">{{ record.source || '-' }}</a-tag>
        </template>
        <template v-if="column.key === 'publishedAt'">
          <span style="color: var(--text-secondary); font-size: 12px;">{{ formatTime(record.publishedAt) }}</span>
        </template>
        <template v-if="column.key === 'status'">
          <a-tag :color="record.read ? 'default' : 'green'">{{ record.read ? '已读' : '未读' }}</a-tag>
        </template>
        <template v-if="column.key === 'actions'">
          <a-button
            v-if="!record.read"
            size="small"
            type="link"
            @click.stop="markRead(record)"
          >
            标记已读
          </a-button>
          <span v-else style="color: var(--text-muted); font-size: 12px;">--</span>
        </template>
      </template>
      <template #expandedRowRender="{ record }">
        <div style="padding: 8px 16px; color: var(--text-secondary); font-size: 13px; line-height: 1.8; max-height: 300px; overflow-y: auto;">
          <div v-if="record.summary" style="margin-bottom: 8px;">
            <strong style="color: var(--text-primary);">摘要: </strong>{{ record.summary }}
          </div>
          <div v-if="record.content" v-html="record.content" style="color: var(--text-secondary);"></div>
          <div v-if="!record.summary && !record.content" style="color: var(--text-muted);">暂无内容预览</div>
        </div>
      </template>
      <template #emptyText>
        <div style="padding: 40px; color: var(--text-muted); text-align: center;">
          <ReadOutlined style="font-size: 40px; margin-bottom: 12px; display: block;" />
          暂无文章
        </div>
      </template>
    </a-table>

    <!-- Add Feed Modal -->
    <a-modal
      v-model:open="showAddModal"
      title="添加订阅源"
      :confirm-loading="adding"
      @ok="addFeed"
      ok-text="添加"
      cancel-text="取消"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item label="URL" required>
          <a-input v-model:value="newFeedUrl" placeholder="输入 RSS 订阅源地址，如 https://example.com/feed.xml" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ReadOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined, LinkOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const ws = useWsStore()

// --- State ---
const feedsLoading = ref(false)
const articlesLoading = ref(false)
const refreshingAll = ref(false)
const adding = ref(false)
const feeds = ref([])
const articles = ref([])
const selectedFeedId = ref('')
const showAddModal = ref(false)
const newFeedUrl = ref('')
const expandedKeys = ref([])

// --- Stats ---
const statsCards = computed(() => {
  const totalFeeds = feeds.value.length
  const totalArticles = articles.value.length
  const unread = articles.value.filter(a => !a.read).length
  const lastRefreshFeed = feeds.value
    .filter(f => f.lastUpdated)
    .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))[0]
  const lastRefresh = lastRefreshFeed ? formatTime(lastRefreshFeed.lastUpdated) : '-'
  return [
    { label: '订阅源数', value: totalFeeds, color: '#1677ff' },
    { label: '文章总数', value: totalArticles, color: '#52c41a' },
    { label: '未读文章', value: unread, color: '#faad14' },
    { label: '最近刷新', value: lastRefresh, color: '#13c2c2' },
  ]
})

// --- Article Table Columns ---
const articleColumns = [
  { title: '标题', key: 'title', dataIndex: 'title', ellipsis: true },
  { title: '来源', key: 'source', dataIndex: 'source', width: '140px' },
  { title: '发布时间', key: 'publishedAt', dataIndex: 'publishedAt', width: '160px' },
  { title: '状态', key: 'status', width: '80px' },
  { title: '操作', key: 'actions', width: '100px' },
]

// --- Helpers ---
function formatTime(t) {
  if (!t) return '-'
  try {
    const d = new Date(t)
    if (isNaN(d.getTime())) return t
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return t
  }
}

function safeParseJson(output) {
  try {
    // Try to find JSON array or object in output
    const jsonMatch = output.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (jsonMatch) return JSON.parse(jsonMatch[1])
  } catch {
    /* ignore */
  }
  return null
}

// --- Load Feeds ---
async function loadFeeds() {
  feedsLoading.value = true
  try {
    const { output } = await ws.execute('rss list --json', 20000)
    const parsed = safeParseJson(output)
    if (Array.isArray(parsed)) {
      feeds.value = parsed.map((f, i) => ({
        key: f.id || f.url || i,
        id: f.id || String(i),
        title: f.title || f.name || '',
        url: f.url || f.feedUrl || '',
        itemCount: f.itemCount ?? f.articleCount ?? f.count ?? 0,
        lastUpdated: f.lastUpdated || f.updatedAt || f.lastRefresh || '',
      }))
    } else {
      feeds.value = parseFeedListText(output)
    }
  } catch (e) {
    message.error('加载订阅源失败: ' + e.message)
  } finally {
    feedsLoading.value = false
  }
}

function parseFeedListText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ feed/i) || trimmed.startsWith('RSS') || trimmed.startsWith('No ')) continue
    const m = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+[-–]\s+(.+))?$/)
    if (m) {
      result.push({
        key: m[1],
        id: m[1],
        title: m[2].trim(),
        url: (m[3] || '').trim(),
        itemCount: 0,
        lastUpdated: '',
      })
    } else if (trimmed.length > 5) {
      result.push({
        key: String(result.length),
        id: String(result.length),
        title: trimmed.slice(0, 80),
        url: '',
        itemCount: 0,
        lastUpdated: '',
      })
    }
  }
  return result
}

// --- Load Articles ---
async function loadArticles() {
  articlesLoading.value = true
  expandedKeys.value = []
  try {
    let cmd = 'rss articles --limit 30 --json'
    if (selectedFeedId.value) cmd = `rss articles --feed ${selectedFeedId.value} --limit 30 --json`
    const { output } = await ws.execute(cmd, 20000)
    const parsed = safeParseJson(output)
    if (Array.isArray(parsed)) {
      articles.value = parsed.map((a, i) => ({
        key: a.id || String(i),
        id: a.id || String(i),
        title: a.title || '无标题',
        link: a.link || a.url || '',
        source: a.source || a.feedTitle || a.feedName || '',
        publishedAt: a.publishedAt || a.pubDate || a.date || '',
        read: !!a.read,
        summary: a.summary || a.description || '',
        content: a.content || '',
      }))
    } else {
      articles.value = parseArticlesText(output)
    }
  } catch (e) {
    message.error('加载文章失败: ' + e.message)
  } finally {
    articlesLoading.value = false
  }
}

function parseArticlesText(output) {
  const result = []
  const lines = output.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('─') || trimmed.match(/^\d+ article/i) || trimmed.startsWith('No ')) continue
    const m = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+[-–]\s+(.+))?$/)
    if (m) {
      result.push({
        key: m[1],
        id: m[1],
        title: m[2].trim(),
        link: '',
        source: (m[3] || '').trim(),
        publishedAt: '',
        read: false,
        summary: '',
        content: '',
      })
    }
  }
  return result
}

// --- Add Feed ---
async function addFeed() {
  const url = newFeedUrl.value.trim()
  if (!url) { message.warning('请输入订阅源地址'); return }
  adding.value = true
  try {
    const { output } = await ws.execute(`rss add "${url}"`, 30000)
    if (output.includes('error') || output.includes('失败') || output.includes('Error')) {
      message.error('添加失败: ' + output.slice(0, 120))
    } else {
      message.success('订阅源已添加')
      showAddModal.value = false
      newFeedUrl.value = ''
      await loadFeeds()
      await loadArticles()
    }
  } catch (e) {
    message.error('添加失败: ' + e.message)
  } finally {
    adding.value = false
  }
}

// --- Refresh Feed ---
async function refreshFeed(feed) {
  try {
    message.loading({ content: `正在刷新 ${feed.title || feed.id}...`, key: 'refreshFeed' })
    await ws.execute(`rss refresh ${feed.id}`, 30000)
    message.success({ content: '刷新完成', key: 'refreshFeed' })
    await loadFeeds()
    await loadArticles()
  } catch (e) {
    message.error({ content: '刷新失败: ' + e.message, key: 'refreshFeed' })
  }
}

// --- Remove Feed ---
async function removeFeed(feed) {
  try {
    message.loading({ content: `正在删除 ${feed.title || feed.id}...`, key: 'removeFeed' })
    const { output } = await ws.execute(`rss remove ${feed.id}`, 20000)
    if (output.includes('error') || output.includes('失败')) {
      message.error({ content: '删除失败: ' + output.slice(0, 120), key: 'removeFeed' })
    } else {
      message.success({ content: '已删除订阅源', key: 'removeFeed' })
      await loadFeeds()
      await loadArticles()
    }
  } catch (e) {
    message.error({ content: '删除失败: ' + e.message, key: 'removeFeed' })
  }
}

// --- Refresh All ---
async function refreshAllFeeds() {
  refreshingAll.value = true
  try {
    message.loading({ content: '正在刷新所有订阅源...', key: 'refreshAll' })
    await ws.execute('rss refresh-all', 60000)
    message.success({ content: '全部刷新完成', key: 'refreshAll' })
    await loadFeeds()
    await loadArticles()
  } catch (e) {
    message.error({ content: '刷新失败: ' + e.message, key: 'refreshAll' })
  } finally {
    refreshingAll.value = false
  }
}

// --- Mark Read ---
async function markRead(article) {
  try {
    await ws.execute(`rss mark-read ${article.id}`, 10000)
    article.read = true
    message.success('已标记已读')
  } catch (e) {
    message.error('操作失败: ' + e.message)
  }
}

// --- Expand Article ---
function onExpandArticle(expanded, record) {
  expandedKeys.value = expanded ? [record.key] : []
}

onMounted(async () => {
  await loadFeeds()
  await loadArticles()
})
</script>

<style scoped>
:deep(.rss-row:hover td) { background: var(--bg-card-hover) !important; cursor: pointer; }
:deep(.ant-card-head) { border-color: var(--border-color) !important; color: var(--text-primary) !important; }
:deep(.ant-select-selector) { background: var(--bg-card) !important; border-color: var(--border-color) !important; color: var(--text-primary) !important; }
</style>
