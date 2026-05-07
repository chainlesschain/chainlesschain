<template>
  <a-tooltip title="通知">
    <a-badge :count="unreadCount" :overflow-count="99" :offset="[-4, 4]">
      <button
        type="button"
        class="notif-bell-btn"
        aria-label="通知"
        @click="onOpen"
      >
        <BellOutlined />
      </button>
    </a-badge>
  </a-tooltip>

  <a-drawer
    v-model:open="visible"
    title="通知中心"
    placement="right"
    :width="400"
    :body-style="{ padding: 0 }"
  >
    <div class="notif-toolbar">
      <a-space>
        <a-radio-group v-model:value="filter" size="small" button-style="solid">
          <a-radio-button value="all">全部 ({{ notifications.length }})</a-radio-button>
          <a-radio-button value="unread">未读 ({{ unreadCount }})</a-radio-button>
        </a-radio-group>
      </a-space>
      <a-space>
        <a-button size="small" :loading="loading" @click="refreshList">
          <template #icon><ReloadOutlined /></template>
        </a-button>
        <a-button
          size="small"
          :disabled="unreadCount === 0"
          @click="onMarkAllRead"
        >
          全部已读
        </a-button>
      </a-space>
    </div>

    <div class="notif-body">
      <a-empty
        v-if="!loading && filtered.length === 0"
        description="暂无通知"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        style="padding: 60px 0;"
      />
      <a-spin v-else-if="loading" style="display: block; padding: 60px;" />
      <ul v-else class="notif-list">
        <li
          v-for="n in filtered"
          :key="n.id"
          class="notif-item"
          :class="{ unread: !n.is_read }"
          @click="onItemClick(n)"
        >
          <div class="notif-row">
            <div class="notif-title">{{ n.title || n.message || '(无标题)' }}</div>
            <span class="notif-time">{{ formatTime(n.created_at) }}</span>
          </div>
          <div v-if="n.message && n.title" class="notif-message">
            {{ n.message }}
          </div>
        </li>
      </ul>
    </div>
  </a-drawer>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Empty } from 'ant-design-vue'
import { BellOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import { useNotifications } from '../composables/useNotifications.js'
import { useShellMode } from '../composables/useShellMode.js'

const visible = ref(false)
const filter = ref('all')
const loading = ref(false)

const { notifications, unreadCount, refresh, markRead, markAllRead } =
  useNotifications()

// 桌面托盘菜单"通知中心"通过 App.vue 的 routeTrayAction 派发 window
// CustomEvent — 任何路由下 bell 都能自我打开,不依赖 router-view 切页。
function _onOpenEvent() {
  onOpen()
}
onMounted(() => {
  window.addEventListener('cc:open-notification-drawer', _onOpenEvent)
})
onUnmounted(() => {
  window.removeEventListener('cc:open-notification-drawer', _onOpenEvent)
})

const filtered = computed(() => {
  if (filter.value === 'unread') {
    return notifications.value.filter((n) => !n.is_read)
  }
  return notifications.value
})

async function refreshList() {
  if (!useShellMode().isEmbedded) {
    return
  }
  loading.value = true
  try {
    await refresh({ limit: 100 })
  } catch {
    /* surfacing in-drawer would dwarf the bell — silent skip */
  } finally {
    loading.value = false
  }
}

async function onOpen() {
  visible.value = true
  await refreshList()
}

async function onItemClick(n) {
  if (n.is_read) return
  try {
    await markRead(n.id)
  } catch {
    /* noop — counter refresh is best-effort */
  }
}

async function onMarkAllRead() {
  try {
    await markAllRead()
  } catch (err) {
    console.warn('[NotificationBell] markAllRead failed:', err?.message || err)
  }
}

function formatTime(ts) {
  if (!ts) return ''
  const n = typeof ts === 'string' ? Date.parse(ts) : Number(ts)
  if (!Number.isFinite(n)) return String(ts)
  const diff = Date.now() - n
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  return new Date(n).toLocaleDateString()
}
</script>

<style scoped>
.notif-bell-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  color: var(--text-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: background 0.15s, transform 0.15s;
}
.notif-bell-btn:hover {
  background: var(--bg-card-hover);
  transform: scale(1.1);
}

.notif-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-card);
}

.notif-body {
  max-height: calc(100vh - 130px);
  overflow-y: auto;
}

.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.notif-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s;
}
.notif-item:hover {
  background: var(--bg-card-hover);
}
.notif-item.unread {
  background: rgba(22, 119, 255, 0.08);
}
.notif-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.notif-title {
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.notif-message {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
