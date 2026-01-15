<template>
  <div class="conversation-list">
    <!-- 搜索框 -->
    <div class="conversation-search">
      <a-input-search
        v-model:value="searchText"
        placeholder="搜索会话..."
        allow-clear
      >
        <template #prefix><SearchOutlined /></template>
      </a-input-search>
    </div>

    <!-- 会话列表 -->
    <div class="conversation-items">
      <a-spin :spinning="loading">
        <a-empty v-if="filteredSessions.length === 0" description="暂无会话" />

        <div
          v-for="session in filteredSessions"
          :key="session.id"
          class="conversation-item"
          :class="{ active: session.id === currentSessionId, unread: session.unread_count > 0 }"
          @click="handleSessionClick(session)"
        >
          <!-- 头像 -->
          <div class="conversation-avatar">
            <a-badge :count="session.unread_count" :overflow-count="99">
              <a-badge :dot="getOnlineStatus(session.participant_did) === 'online'" :offset="[-5, 40]">
                <a-avatar :size="48">
                  <template #icon><UserOutlined /></template>
                </a-avatar>
              </a-badge>
            </a-badge>
          </div>

          <!-- 会话信息 -->
          <div class="conversation-info">
            <div class="conversation-top">
              <div class="conversation-name">{{ session.friend_nickname || shortenDid(session.participant_did) }}</div>
              <div class="conversation-time">{{ formatTime(session.last_message_time) }}</div>
            </div>

            <div class="conversation-bottom">
              <div class="conversation-last-message">{{ session.last_message || '暂无消息' }}</div>
              <a-tag v-if="session.is_pinned" color="blue" size="small">置顶</a-tag>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="conversation-actions">
            <a-dropdown :trigger="['click']" @click.stop>
              <a-button type="text" size="small">
                <template #icon><MoreOutlined /></template>
              </a-button>
              <template #overlay>
                <a-menu @click="handleMenuClick($event, session)">
                  <a-menu-item key="pin">
                    <PushpinOutlined /> {{ session.is_pinned ? '取消置顶' : '置顶会话' }}
                  </a-menu-item>
                  <a-menu-item key="markRead" v-if="session.unread_count > 0">
                    <CheckOutlined /> 标记已读
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="delete" danger>
                    <DeleteOutlined /> 删除会话
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </div>
      </a-spin>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useSocialStore } from '../../stores/social'
import {
  SearchOutlined,
  UserOutlined,
  MoreOutlined,
  PushpinOutlined,
  CheckOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue'
import { message as antdMessage } from 'ant-design-vue'

const socialStore = useSocialStore()

const props = defineProps({
  sessions: {
    type: Array,
    default: () => []
  },
  currentSessionId: {
    type: String,
    default: null
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['session-click', 'pin-session', 'mark-read', 'delete-session'])

// 状态
const searchText = ref('')

// 计算属性
const filteredSessions = computed(() => {
  if (!searchText.value) {
    // 按置顶和时间排序
    return [...props.sessions].sort((a, b) => {
      // 置顶的排在前面
      if (a.is_pinned !== b.is_pinned) {
        return b.is_pinned - a.is_pinned
      }
      // 按最后消息时间降序
      return (b.last_message_time || 0) - (a.last_message_time || 0)
    })
  }

  const keyword = searchText.value.toLowerCase()
  return props.sessions.filter(session => {
    const nickname = (session.friend_nickname || '').toLowerCase()
    const did = (session.participant_did || '').toLowerCase()
    const lastMessage = (session.last_message || '').toLowerCase()
    return nickname.includes(keyword) || did.includes(keyword) || lastMessage.includes(keyword)
  }).sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) {
      return b.is_pinned - a.is_pinned
    }
    return (b.last_message_time || 0) - (a.last_message_time || 0)
  })
})

// 方法
const handleSessionClick = (session) => {
  emit('session-click', session)
}

const handleMenuClick = ({ key }, session) => {
  switch (key) {
    case 'pin':
      emit('pin-session', session)
      break
    case 'markRead':
      emit('mark-read', session)
      break
    case 'delete':
      emit('delete-session', session)
      break
  }
}

const shortenDid = (did) => {
  if (!did) return '未知用户'
  if (did.length <= 20) return did
  return `${did.substring(0, 10)}...${did.substring(did.length - 6)}`
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''

  const now = Date.now()
  const diff = now - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  const date = new Date(timestamp)

  // 1分钟内
  if (diff < minute) {
    return '刚刚'
  }

  // 1小时内
  if (diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`
  }

  // 今天
  if (diff < day && new Date().getDate() === date.getDate()) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  // 昨天
  const yesterday = new Date(now - day)
  if (yesterday.getDate() === date.getDate()) {
    return '昨天'
  }

  // 一周内
  if (diff < 7 * day) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return weekdays[date.getDay()]
  }

  // 今年
  if (new Date().getFullYear() === date.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  // 更早
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

const getOnlineStatus = (did) => {
  const friend = socialStore.friends.find(f => f.friend_did === did)
  if (friend && friend.onlineStatus) {
    return friend.onlineStatus.status || 'offline'
  }
  return 'offline'
}
</script>

<style scoped>
.conversation-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #fff;
}

.conversation-search {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.conversation-items {
  flex: 1;
  overflow-y: auto;
}

.conversation-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;
}

.conversation-item:hover {
  background-color: #f5f5f5;
}

.conversation-item.active {
  background-color: #e6f7ff;
}

.conversation-item.unread {
  background-color: #f0f9ff;
}

.conversation-item.unread:hover {
  background-color: #e6f4ff;
}

.conversation-avatar {
  flex-shrink: 0;
}

.conversation-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conversation-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.conversation-name {
  font-size: 15px;
  font-weight: 500;
  color: #262626;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.conversation-time {
  font-size: 11px;
  color: #8c8c8c;
  flex-shrink: 0;
}

.conversation-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conversation-last-message {
  flex: 1;
  font-size: 13px;
  color: #595959;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-item.unread .conversation-last-message {
  font-weight: 500;
  color: #262626;
}

.conversation-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.conversation-item:hover .conversation-actions {
  opacity: 1;
}

/* 滚动条样式 */
.conversation-items::-webkit-scrollbar {
  width: 6px;
}

.conversation-items::-webkit-scrollbar-thumb {
  background-color: #d9d9d9;
  border-radius: 3px;
}

.conversation-items::-webkit-scrollbar-thumb:hover {
  background-color: #bfbfbf;
}

.conversation-items::-webkit-scrollbar-track {
  background-color: transparent;
}

/* 响应式 */
@media (max-width: 768px) {
  .conversation-item {
    padding: 10px 12px;
  }

  .conversation-avatar :deep(.ant-avatar) {
    width: 40px;
    height: 40px;
  }

  .conversation-name {
    font-size: 14px;
  }

  .conversation-last-message {
    font-size: 12px;
  }
}
</style>
