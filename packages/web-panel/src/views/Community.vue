<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">社区</h2>
        <p class="page-sub">联系人 · 好友 · 帖子（去中心化社交平台）</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" @click="showPostModal = true">
          <template #icon><EditOutlined /></template>
          发布帖子
        </a-button>
        <a-button @click="showContactModal = true">
          <template #icon><UserAddOutlined /></template>
          添加联系人
        </a-button>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="联系人" :value="stats.contacts" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><TeamOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="好友" :value="stats.friends" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><HeartOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="帖子" :value="stats.posts" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic title="消息" :value="stats.messages" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><MessageOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            title="待处理请求"
            :value="stats.pendingRequests"
            :value-style="{ color: stats.pendingRequests > 0 ? '#ff4d4f' : '#888', fontSize: '20px' }"
          >
            <template #prefix><BellOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="community-tabs">
      <!-- ── Posts tab ─────────────────────────────────────────────── -->
      <a-tab-pane key="posts" tab="帖子">
        <div v-if="loading && !posts.length" style="text-align: center; padding: 60px;">
          <a-spin size="large" />
        </div>
        <div v-else-if="!posts.length" style="text-align: center; padding: 60px; color: var(--text-muted);">
          <FileTextOutlined style="font-size: 40px; margin-bottom: 12px; display: block;" />
          暂无帖子，点击"发布帖子"创建第一条
        </div>
        <div v-else class="post-feed">
          <a-card
            v-for="post in posts"
            :key="post.key"
            class="post-card"
            :body-style="{ padding: '16px' }"
          >
            <div class="post-head">
              <a-avatar :style="{ backgroundColor: avatarColor(post.author) }">
                {{ post.author.slice(0, 1).toUpperCase() }}
              </a-avatar>
              <div class="post-meta">
                <div class="post-author">{{ post.author }}</div>
                <div class="post-time">{{ formatTime(post.createdAt) }}</div>
              </div>
              <a-button size="small" type="text" @click="likePost(post)">
                <template #icon><LikeOutlined /></template>
                {{ post.likes }}
              </a-button>
            </div>
            <div class="post-body">{{ post.content }}</div>
          </a-card>
        </div>
      </a-tab-pane>

      <!-- ── Friends tab ───────────────────────────────────────────── -->
      <a-tab-pane key="friends" tab="好友">
        <a-table
          :columns="friendColumns"
          :data-source="friendRows"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'contact'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.contactName || record.contactId }}</span>
              <div v-if="record.contactName" style="color: var(--text-secondary); font-size: 11px; font-family: monospace;">
                {{ record.contactId }}
              </div>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'action'">
              <a-popconfirm title="移除该好友？" ok-text="移除" cancel-text="取消" @confirm="removeFriend(record)">
                <a-button size="small" type="link" danger>移除</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <HeartOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无好友。在"联系人"标签页给联系人发送好友请求。
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Contacts tab ──────────────────────────────────────────── -->
      <a-tab-pane key="contacts" tab="联系人">
        <a-table
          :columns="contactColumns"
          :data-source="contacts"
          :pagination="{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'name'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.name }}</span>
            </template>
            <template v-if="column.key === 'did'">
              <span v-if="record.did" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">
                {{ shortDid(record.did) }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'email'">
              <span v-if="record.email" style="color: var(--text-secondary); font-size: 12px;">{{ record.email }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button
                v-if="!isFriend(record.id)"
                size="small"
                type="link"
                :loading="addingFriend === record.id"
                @click="sendFriendRequest(record)"
              >
                添加好友
              </a-button>
              <a-tag v-else color="green" style="font-size: 11px;">已是好友</a-tag>
              <a-popconfirm title="删除该联系人？" ok-text="删除" cancel-text="取消" @confirm="deleteContact(record)">
                <a-button size="small" type="link" danger style="margin-left: 4px;">删除</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <TeamOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              暂无联系人，点击"添加联系人"创建
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Publish post modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showPostModal"
      title="发布帖子"
      :confirm-loading="publishing"
      ok-text="发布"
      cancel-text="取消"
      @ok="publishPost"
      @cancel="resetPostForm"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item label="作者">
          <a-input v-model:value="postForm.author" placeholder="可选，留空则使用 cli-user" />
        </a-form-item>
        <a-form-item label="内容" required>
          <a-textarea
            v-model:value="postForm.content"
            placeholder="说点什么..."
            :auto-size="{ minRows: 4, maxRows: 10 }"
            :maxlength="2000"
            show-count
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Add contact modal ───────────────────────────────────────── -->
    <a-modal
      v-model:open="showContactModal"
      title="添加联系人"
      :confirm-loading="addingContact"
      ok-text="添加"
      cancel-text="取消"
      @ok="addContact"
      @cancel="resetContactForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item label="姓名" required>
          <a-input v-model:value="contactForm.name" placeholder="联系人显示名称" />
        </a-form-item>
        <a-form-item label="DID">
          <a-input v-model:value="contactForm.did" placeholder="did:key:... (可选)" />
        </a-form-item>
        <a-form-item label="邮箱">
          <a-input v-model:value="contactForm.email" placeholder="可选" />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="contactForm.notes" :auto-size="{ minRows: 2, maxRows: 4 }" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  EditOutlined,
  UserAddOutlined,
  TeamOutlined,
  HeartOutlined,
  FileTextOutlined,
  MessageOutlined,
  BellOutlined,
  LikeOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import {
  parseSocialStats,
  parseContacts,
  parseFriends,
  parsePosts,
  STATS_DEFAULTS,
} from '../utils/community-parser.js'

const ws = useWsStore()

const loading = ref(false)
const publishing = ref(false)
const addingContact = ref(false)
const addingFriend = ref('') // contactId of in-flight request

const stats = ref({ ...STATS_DEFAULTS })
const contacts = ref([])
const friends = ref([])
const posts = ref([])

const activeTab = ref('posts')
const showPostModal = ref(false)
const showContactModal = ref(false)

const postForm = reactive({ author: '', content: '' })
const contactForm = reactive({ name: '', did: '', email: '', notes: '' })

const contactColumns = [
  { title: '姓名', key: 'name', dataIndex: 'name', width: '160px' },
  { title: 'DID', key: 'did', dataIndex: 'did' },
  { title: '邮箱', key: 'email', dataIndex: 'email', width: '200px' },
  { title: '创建时间', key: 'createdAt', dataIndex: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '180px' },
]

const friendColumns = [
  { title: '联系人', key: 'contact' },
  { title: '状态', key: 'status', width: '120px' },
  { title: '建立时间', key: 'createdAt', dataIndex: 'createdAt', width: '160px' },
  { title: '操作', key: 'action', width: '100px' },
]

// Join friends with contact name for display.
const friendRows = computed(() =>
  friends.value.map(f => {
    const c = contacts.value.find(x => x.id === f.contactId)
    return { ...f, contactName: c ? c.name : '' }
  }),
)

const friendIds = computed(() => new Set(friends.value.map(f => f.contactId)))

function isFriend(contactId) {
  return friendIds.value.has(contactId)
}

function avatarColor(name) {
  // Stable per-author color from name hash.
  const palette = ['#1677ff', '#52c41a', '#722ed1', '#faad14', '#ff4d4f', '#13c2c2', '#eb2f96']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function shortDid(did) {
  if (!did) return ''
  return did.length > 28 ? did.slice(0, 16) + '...' + did.slice(-8) : did
}

function formatTime(ts) {
  if (!ts) return '—'
  // Already-formatted dates pass through; ISO timestamps get a friendly form.
  if (typeof ts !== 'string') return String(ts)
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString('zh-CN', { hour12: false })
}

function statusColor(status) {
  return { accepted: 'green', pending: 'orange', blocked: 'red' }[status] || 'default'
}

function statusLabel(status) {
  return { accepted: '已接受', pending: '待处理', blocked: '已屏蔽' }[status] || status
}

async function loadAll() {
  loading.value = true
  try {
    const [statsRes, contactsRes, friendsRes, postsRes] = await Promise.all([
      ws.execute('social stats --json', 10000).catch(() => ({ output: '' })),
      ws.execute('social contact list --json', 10000).catch(() => ({ output: '' })),
      ws.execute('social friend list --json', 10000).catch(() => ({ output: '' })),
      ws.execute('social post list --json', 10000).catch(() => ({ output: '' })),
    ])
    stats.value = parseSocialStats(statsRes.output)
    contacts.value = parseContacts(contactsRes.output)
    friends.value = parseFriends(friendsRes.output)
    posts.value = parsePosts(postsRes.output).sort((a, b) => {
      // Most recent first when timestamps are present.
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
  } catch (e) {
    message.error('加载社区数据失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function publishPost() {
  const content = postForm.content.trim()
  if (!content) {
    message.warning('请输入帖子内容')
    return
  }
  publishing.value = true
  try {
    const escaped = content.replace(/"/g, '\\"')
    const author = postForm.author.trim()
    const cmd = author
      ? `social post publish "${escaped}" --author "${author.replace(/"/g, '\\"')}"`
      : `social post publish "${escaped}"`
    const { output } = await ws.execute(cmd, 15000)
    if (/error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error('发布失败: ' + output.slice(0, 120))
      return
    }
    message.success('帖子已发布')
    showPostModal.value = false
    resetPostForm()
    await loadAll()
  } catch (e) {
    message.error('发布失败: ' + (e?.message || e))
  } finally {
    publishing.value = false
  }
}

async function addContact() {
  const name = contactForm.name.trim()
  if (!name) {
    message.warning('请输入联系人姓名')
    return
  }
  addingContact.value = true
  try {
    const parts = [`social contact add "${name.replace(/"/g, '\\"')}"`]
    if (contactForm.did.trim()) parts.push(`--did "${contactForm.did.trim().replace(/"/g, '\\"')}"`)
    if (contactForm.email.trim()) parts.push(`--email "${contactForm.email.trim().replace(/"/g, '\\"')}"`)
    if (contactForm.notes.trim()) parts.push(`--notes "${contactForm.notes.trim().replace(/"/g, '\\"')}"`)
    const { output } = await ws.execute(parts.join(' '), 15000)
    if (/error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error('添加失败: ' + output.slice(0, 120))
      return
    }
    message.success('联系人已添加')
    showContactModal.value = false
    resetContactForm()
    await loadAll()
  } catch (e) {
    message.error('添加失败: ' + (e?.message || e))
  } finally {
    addingContact.value = false
  }
}

async function deleteContact(record) {
  try {
    const { output } = await ws.execute(`social contact delete ${record.id}`, 10000)
    if (/error|失败/i.test(output)) {
      message.error('删除失败: ' + output.slice(0, 120))
      return
    }
    message.success('联系人已删除')
    await loadAll()
  } catch (e) {
    message.error('删除失败: ' + (e?.message || e))
  }
}

async function sendFriendRequest(record) {
  addingFriend.value = record.id
  try {
    const { output } = await ws.execute(`social friend add ${record.id}`, 10000)
    if (/error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error('好友请求失败: ' + output.slice(0, 120))
      return
    }
    message.success('好友请求已发送')
    await loadAll()
    activeTab.value = 'friends'
  } catch (e) {
    message.error('好友请求失败: ' + (e?.message || e))
  } finally {
    addingFriend.value = ''
  }
}

async function removeFriend(record) {
  try {
    const { output } = await ws.execute(`social friend remove ${record.contactId}`, 10000)
    if (/error|失败/i.test(output)) {
      message.error('移除失败: ' + output.slice(0, 120))
      return
    }
    message.success('已移除好友')
    await loadAll()
  } catch (e) {
    message.error('移除失败: ' + (e?.message || e))
  }
}

async function likePost(post) {
  try {
    await ws.execute(`social post like ${post.id}`, 10000)
    // Optimistic update; refresh in background to reconcile.
    post.likes++
    loadAll()
  } catch (e) {
    message.error('点赞失败: ' + (e?.message || e))
  }
}

function resetPostForm() {
  postForm.author = ''
  postForm.content = ''
}
function resetContactForm() {
  contactForm.name = ''
  contactForm.did = ''
  contactForm.email = ''
  contactForm.notes = ''
}

onMounted(loadAll)
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

.community-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.post-feed {
  display: grid;
  gap: 12px;
}
.post-card {
  background: var(--bg-card);
  border-color: var(--border-color);
}
.post-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.post-meta {
  flex: 1;
  min-width: 0;
}
.post-author {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
}
.post-time {
  color: var(--text-secondary);
  font-size: 11px;
  margin-top: 1px;
}
.post-body {
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
