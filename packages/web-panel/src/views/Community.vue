<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('community.title') }}</h2>
        <p class="page-sub">{{ t('community.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ t('community.refresh') }}
        </a-button>
        <a-button type="primary" @click="showPostModal = true">
          <template #icon><EditOutlined /></template>
          {{ t('community.publishButton') }}
        </a-button>
        <a-button @click="showContactModal = true">
          <template #icon><UserAddOutlined /></template>
          {{ t('community.addContactButton') }}
        </a-button>
      </a-space>
    </div>

    <!-- Stats overview -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('community.stats.contacts')" :value="stats.contacts" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><TeamOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('community.stats.friends')" :value="stats.friends" :value-style="{ color: '#52c41a', fontSize: '20px' }">
            <template #prefix><HeartOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('community.stats.posts')" :value="stats.posts" :value-style="{ color: '#722ed1', fontSize: '20px' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="t('community.stats.messages')" :value="stats.messages" :value-style="{ color: '#faad14', fontSize: '20px' }">
            <template #prefix><MessageOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="t('community.stats.pendingRequests')"
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
      <a-tab-pane key="posts" :tab="t('community.tabs.posts')">
        <div v-if="loading && !posts.length" style="text-align: center; padding: 60px;">
          <a-spin size="large" />
        </div>
        <div v-else-if="!posts.length" style="text-align: center; padding: 60px; color: var(--text-muted);">
          <FileTextOutlined style="font-size: 40px; margin-bottom: 12px; display: block;" />
          {{ t('community.posts.emptyText') }}
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
      <a-tab-pane key="friends" :tab="t('community.tabs.friends')">
        <a-table
          :columns="friendColumns"
          :data-source="friendRows"
          :pagination="{ pageSize: 20, showTotal: (count) => t('community.totals.rows', { count }) }"
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
              <a-popconfirm :title="t('community.friends.removeConfirm')" :ok-text="t('community.friends.removeOk')" :cancel-text="t('common.cancel')" @confirm="removeFriend(record)">
                <a-button size="small" type="link" danger>{{ t('community.friends.remove') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <HeartOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ t('community.friends.emptyText') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Contacts tab ──────────────────────────────────────────── -->
      <a-tab-pane key="contacts" :tab="t('community.tabs.contacts')">
        <a-table
          :columns="contactColumns"
          :data-source="contacts"
          :pagination="{ pageSize: 20, showTotal: (count) => t('community.totals.rows', { count }) }"
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
                {{ t('community.contacts.addFriend') }}
              </a-button>
              <a-tag v-else color="green" style="font-size: 11px;">{{ t('community.contacts.alreadyFriend') }}</a-tag>
              <a-popconfirm :title="t('community.contacts.deleteConfirm')" :ok-text="t('community.contacts.deleteOk')" :cancel-text="t('common.cancel')" @confirm="deleteContact(record)">
                <a-button size="small" type="link" danger style="margin-left: 4px;">{{ t('community.contacts.delete') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <TeamOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ t('community.contacts.emptyText') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Publish post modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showPostModal"
      :title="t('community.posts.publishTitle')"
      :confirm-loading="publishing"
      :ok-text="t('community.posts.publishOk')"
      :cancel-text="t('common.cancel')"
      @ok="publishPost"
      @cancel="resetPostForm"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }" style="margin-top: 16px;">
        <a-form-item :label="t('community.posts.authorLabel')">
          <a-input v-model:value="postForm.author" :placeholder="t('community.posts.authorPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('community.posts.contentLabel')" required>
          <a-textarea
            v-model:value="postForm.content"
            :placeholder="t('community.posts.contentPlaceholder')"
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
      :title="t('community.contacts.addTitle')"
      :confirm-loading="addingContact"
      :ok-text="t('community.contacts.addOk')"
      :cancel-text="t('common.cancel')"
      @ok="addContact"
      @cancel="resetContactForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="t('community.contacts.nameLabel')" required>
          <a-input v-model:value="contactForm.name" :placeholder="t('community.contacts.namePlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('community.contacts.didLabel')">
          <a-input v-model:value="contactForm.did" :placeholder="t('community.contacts.didPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('community.contacts.emailLabel')">
          <a-input v-model:value="contactForm.email" :placeholder="t('community.contacts.emailPlaceholder')" />
        </a-form-item>
        <a-form-item :label="t('community.contacts.notesLabel')">
          <a-textarea v-model:value="contactForm.notes" :auto-size="{ minRows: 2, maxRows: 4 }" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t, locale } = useI18n()
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

const contactColumns = computed(() => [
  { title: t('community.contactColumns.name'), key: 'name', dataIndex: 'name', width: '160px' },
  { title: t('community.contactColumns.did'), key: 'did', dataIndex: 'did' },
  { title: t('community.contactColumns.email'), key: 'email', dataIndex: 'email', width: '200px' },
  { title: t('community.contactColumns.createdAt'), key: 'createdAt', dataIndex: 'createdAt', width: '160px' },
  { title: t('community.contactColumns.action'), key: 'action', width: '180px' },
])

const friendColumns = computed(() => [
  { title: t('community.friendColumns.contact'), key: 'contact' },
  { title: t('community.friendColumns.status'), key: 'status', width: '120px' },
  { title: t('community.friendColumns.createdAt'), key: 'createdAt', dataIndex: 'createdAt', width: '160px' },
  { title: t('community.friendColumns.action'), key: 'action', width: '100px' },
])

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
  if (typeof ts !== 'string') return String(ts)
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const localeTag = locale.value === 'zh-CN' ? 'zh-CN' : 'en-US'
  return d.toLocaleString(localeTag, { hour12: false })
}

function statusColor(status) {
  return { accepted: 'green', pending: 'orange', blocked: 'red' }[status] || 'default'
}

function statusLabel(status) {
  const key = `community.status.${status}`
  const v = t(key)
  return v === key ? status : v
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
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
  } catch (e) {
    message.error(t('community.messages.loadFailed', { err: e?.message || e }))
  } finally {
    loading.value = false
  }
}

async function publishPost() {
  const content = postForm.content.trim()
  if (!content) {
    message.warning(t('community.messages.contentRequired'))
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
      message.error(t('community.messages.publishFailed', { err: output.slice(0, 120) }))
      return
    }
    message.success(t('community.messages.publishOk'))
    showPostModal.value = false
    resetPostForm()
    await loadAll()
  } catch (e) {
    message.error(t('community.messages.publishFailed', { err: e?.message || e }))
  } finally {
    publishing.value = false
  }
}

async function addContact() {
  const name = contactForm.name.trim()
  if (!name) {
    message.warning(t('community.messages.nameRequired'))
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
      message.error(t('community.messages.addFailed', { err: output.slice(0, 120) }))
      return
    }
    message.success(t('community.messages.addOk'))
    showContactModal.value = false
    resetContactForm()
    await loadAll()
  } catch (e) {
    message.error(t('community.messages.addFailed', { err: e?.message || e }))
  } finally {
    addingContact.value = false
  }
}

async function deleteContact(record) {
  try {
    const { output } = await ws.execute(`social contact delete ${record.id}`, 10000)
    if (/error|失败/i.test(output)) {
      message.error(t('community.messages.deleteFailed', { err: output.slice(0, 120) }))
      return
    }
    message.success(t('community.messages.deleteOk'))
    await loadAll()
  } catch (e) {
    message.error(t('community.messages.deleteFailed', { err: e?.message || e }))
  }
}

async function sendFriendRequest(record) {
  addingFriend.value = record.id
  try {
    const { output } = await ws.execute(`social friend add ${record.id}`, 10000)
    if (/error|失败/i.test(output) && !/"id"/.test(output)) {
      message.error(t('community.messages.friendRequestFailed', { err: output.slice(0, 120) }))
      return
    }
    message.success(t('community.messages.friendRequestOk'))
    await loadAll()
    activeTab.value = 'friends'
  } catch (e) {
    message.error(t('community.messages.friendRequestFailed', { err: e?.message || e }))
  } finally {
    addingFriend.value = ''
  }
}

async function removeFriend(record) {
  try {
    const { output } = await ws.execute(`social friend remove ${record.contactId}`, 10000)
    if (/error|失败/i.test(output)) {
      message.error(t('community.messages.removeFailed', { err: output.slice(0, 120) }))
      return
    }
    message.success(t('community.messages.removeOk'))
    await loadAll()
  } catch (e) {
    message.error(t('community.messages.removeFailed', { err: e?.message || e }))
  }
}

async function likePost(post) {
  try {
    await ws.execute(`social post like ${post.id}`, 10000)
    post.likes++
    loadAll()
  } catch (e) {
    message.error(t('community.messages.likeFailed', { err: e?.message || e }))
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
