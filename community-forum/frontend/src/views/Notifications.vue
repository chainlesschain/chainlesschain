<template>
  <div class="notifications-page">
    <div class="page-header">
      <h1>通知中心</h1>
      <div class="header-actions">
        <el-button
          v-if="unreadCount > 0"
          size="small"
          @click="markAllAsRead"
        >
          全部已读
        </el-button>
        <el-dropdown @command="handleFilter">
          <el-button size="small">
            {{ filterLabel }}
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="all">全部通知</el-dropdown-item>
              <el-dropdown-item command="unread">未读通知</el-dropdown-item>
              <el-dropdown-item command="read">已读通知</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <el-card class="notifications-card">
      <!-- 统计信息 -->
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-label">全部</span>
          <el-badge :value="totalCount" :max="99" class="stat-badge" />
        </div>
        <div class="stat-item">
          <span class="stat-label">未读</span>
          <el-badge :value="unreadCount" :max="99" type="danger" class="stat-badge" />
        </div>
      </div>

      <el-divider />

      <!-- 通知Tab -->
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="全部" name="all">
          <div v-if="filteredNotifications.length > 0" class="notifications-list">
            <div
              v-for="notification in filteredNotifications"
              :key="notification.id"
              class="notification-item"
              :class="{ unread: !notification.isRead }"
              @click="handleNotificationClick(notification)"
            >
              <div class="notification-icon" :style="{ background: getIconColor(notification.type) }">
                <el-icon :size="20">
                  <component :is="getIcon(notification.type)" />
                </el-icon>
              </div>

              <div class="notification-content">
                <div class="notification-header">
                  <span class="notification-title">{{ notification.title }}</span>
                  <span class="notification-time">{{ formatRelativeTime(notification.createdAt) }}</span>
                </div>
                <p class="notification-message">{{ notification.message }}</p>
                <div v-if="notification.post" class="notification-link">
                  相关帖子: {{ notification.post.title }}
                </div>
              </div>

              <div class="notification-actions">
                <el-button
                  v-if="!notification.isRead"
                  size="small"
                  text
                  type="primary"
                  @click.stop="markAsRead(notification.id)"
                >
                  标记已读
                </el-button>
                <el-button
                  size="small"
                  text
                  type="danger"
                  @click.stop="deleteNotification(notification.id)"
                >
                  删除
                </el-button>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无通知" />
        </el-tab-pane>

        <el-tab-pane label="系统通知" name="system">
          <div v-if="systemNotifications.length > 0" class="notifications-list">
            <div
              v-for="notification in systemNotifications"
              :key="notification.id"
              class="notification-item"
              :class="{ unread: !notification.isRead }"
            >
              <div class="notification-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">
                <el-icon :size="20"><BellFilled /></el-icon>
              </div>
              <div class="notification-content">
                <div class="notification-header">
                  <span class="notification-title">{{ notification.title }}</span>
                  <span class="notification-time">{{ formatRelativeTime(notification.createdAt) }}</span>
                </div>
                <p class="notification-message">{{ notification.message }}</p>
              </div>
              <div class="notification-actions">
                <el-button
                  v-if="!notification.isRead"
                  size="small"
                  text
                  type="primary"
                  @click.stop="markAsRead(notification.id)"
                >
                  标记已读
                </el-button>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无系统通知" />
        </el-tab-pane>

        <el-tab-pane label="互动通知" name="interaction">
          <div v-if="interactionNotifications.length > 0" class="notifications-list">
            <div
              v-for="notification in interactionNotifications"
              :key="notification.id"
              class="notification-item"
              :class="{ unread: !notification.isRead }"
              @click="handleNotificationClick(notification)"
            >
              <div class="notification-icon" :style="{ background: getIconColor(notification.type) }">
                <el-icon :size="20">
                  <component :is="getIcon(notification.type)" />
                </el-icon>
              </div>
              <div class="notification-content">
                <div class="notification-header">
                  <span class="notification-title">{{ notification.title }}</span>
                  <span class="notification-time">{{ formatRelativeTime(notification.createdAt) }}</span>
                </div>
                <p class="notification-message">{{ notification.message }}</p>
                <div v-if="notification.post" class="notification-link">
                  {{ notification.post.title }}
                </div>
              </div>
              <div class="notification-actions">
                <el-button
                  v-if="!notification.isRead"
                  size="small"
                  text
                  type="primary"
                  @click.stop="markAsRead(notification.id)"
                >
                  标记已读
                </el-button>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无互动通知" />
        </el-tab-pane>
      </el-tabs>

      <!-- 分页 -->
      <div v-if="filteredNotifications.length > 0" class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadNotifications"
          @size-change="loadNotifications"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown, BellFilled, ChatDotRound, Star, User, Message
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const router = useRouter()
const userStore = useUserStore()

const activeTab = ref('all')
const filterType = ref('all')
const notifications = ref([])
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

// 过滤标签
const filterLabel = computed(() => {
  const labels = {
    all: '全部通知',
    unread: '未读通知',
    read: '已读通知'
  }
  return labels[filterType.value]
})

// 统计
const totalCount = computed(() => notifications.value.length)
const unreadCount = computed(() => notifications.value.filter(n => !n.isRead).length)

// 过滤后的通知
const filteredNotifications = computed(() => {
  let filtered = notifications.value

  if (filterType.value === 'unread') {
    filtered = filtered.filter(n => !n.isRead)
  } else if (filterType.value === 'read') {
    filtered = filtered.filter(n => n.isRead)
  }

  if (activeTab.value === 'system') {
    filtered = filtered.filter(n => n.type === 'system')
  } else if (activeTab.value === 'interaction') {
    filtered = filtered.filter(n => n.type !== 'system')
  }

  return filtered
})

// 系统通知
const systemNotifications = computed(() =>
  notifications.value.filter(n => n.type === 'system')
)

// 互动通知
const interactionNotifications = computed(() =>
  notifications.value.filter(n => n.type !== 'system')
)

// 获取图标
const getIcon = (type) => {
  const icons = {
    system: BellFilled,
    reply: ChatDotRound,
    like: Star,
    follow: User,
    mention: Message
  }
  return icons[type] || BellFilled
}

// 获取图标颜色
const getIconColor = (type) => {
  const colors = {
    system: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    reply: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    like: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    follow: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    mention: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)'
  }
  return colors[type] || colors.system
}

// 格式化相对时间
const formatRelativeTime = (date) => {
  return dayjs(date).fromNow()
}

// 加载通知
const loadNotifications = async () => {
  try {
    // 这里应该调用API
    // const response = await getNotifications(pagination)

    // 模拟数据
    const mockNotifications = [
      {
        id: 1,
        type: 'reply',
        title: '新回复',
        message: '用户"技术达人"回复了你的帖子',
        post: { id: 1, title: '如何开始使用ChainlessChain？' },
        isRead: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      },
      {
        id: 2,
        type: 'like',
        title: '收到点赞',
        message: '你的帖子"AI训练经验分享"获得了5个新的赞',
        post: { id: 2, title: 'AI训练经验分享' },
        isRead: false,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 3,
        type: 'follow',
        title: '新粉丝',
        message: '用户"AI爱好者"关注了你',
        post: null,
        isRead: false,
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 4,
        type: 'system',
        title: '系统公告',
        message: 'ChainlessChain社区论坛已更新至v1.2版本，新增了更多功能！',
        post: null,
        isRead: true,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 5,
        type: 'mention',
        title: '提到了你',
        message: '用户"开发者123"在评论中提到了你',
        post: { id: 3, title: '关于去中心化AI的讨论' },
        isRead: true,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 6,
        type: 'reply',
        title: '新回复',
        message: '你的帖子收到了新的回复',
        post: { id: 4, title: 'U盾使用教程' },
        isRead: true,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 7,
        type: 'system',
        title: '维护通知',
        message: '系统将于明天凌晨2:00-4:00进行维护，期间可能无法访问',
        post: null,
        isRead: false,
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      }
    ]

    notifications.value = mockNotifications
    pagination.total = mockNotifications.length
  } catch (error) {
    ElMessage.error('加载通知失败')
  }
}

// 处理过滤
const handleFilter = (command) => {
  filterType.value = command
}

// 处理Tab切换
const handleTabChange = () => {
  pagination.page = 1
}

// 点击通知
const handleNotificationClick = (notification) => {
  if (!notification.isRead) {
    markAsRead(notification.id)
  }

  if (notification.post) {
    router.push(`/posts/${notification.post.id}`)
  }
}

// 标记为已读
const markAsRead = async (id) => {
  try {
    // 这里应该调用API
    // await markNotificationAsRead(id)

    const notification = notifications.value.find(n => n.id === id)
    if (notification) {
      notification.isRead = true
    }
    ElMessage.success('已标记为已读')
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

// 全部标记为已读
const markAllAsRead = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要将所有 ${unreadCount.value} 条未读通知标记为已读吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'info'
      }
    )

    // 这里应该调用API
    // await markAllNotificationsAsRead()

    notifications.value.forEach(n => {
      n.isRead = true
    })
    ElMessage.success('已全部标记为已读')
  } catch (error) {
    // 用户取消
  }
}

// 删除通知
const deleteNotification = async (id) => {
  try {
    await ElMessageBox.confirm(
      '确定要删除这条通知吗？',
      '提示',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 这里应该调用API
    // await deleteNotification(id)

    notifications.value = notifications.value.filter(n => n.id !== id)
    ElMessage.success('删除成功')
  } catch (error) {
    // 用户取消
  }
}

onMounted(() => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }
  loadNotifications()
})
</script>

<style scoped lang="scss">
.notifications-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }
}

.notifications-card {
  .stats-bar {
    display: flex;
    gap: 32px;
    padding: 16px 0;

    .stat-item {
      display: flex;
      align-items: center;
      gap: 8px;

      .stat-label {
        font-size: 14px;
        color: var(--el-text-color-secondary);
      }

      .stat-badge {
        :deep(.el-badge__content) {
          transform: translateY(0);
          position: relative;
          top: 0;
          right: 0;
        }
      }
    }
  }

  .notifications-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;

    .notification-item {
      display: flex;
      gap: 16px;
      padding: 16px;
      background: var(--el-fill-color-light);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s;

      &.unread {
        background: var(--el-color-primary-light-9);
        border-left: 3px solid var(--el-color-primary);
      }

      &:hover {
        background: var(--el-fill-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .notification-icon {
        width: 48px;
        height: 48px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        color: white;
      }

      .notification-content {
        flex: 1;
        min-width: 0;

        .notification-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;

          .notification-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--el-text-color-primary);
          }

          .notification-time {
            font-size: 12px;
            color: var(--el-text-color-disabled);
            white-space: nowrap;
          }
        }

        .notification-message {
          margin: 0 0 8px;
          font-size: 14px;
          line-height: 1.6;
          color: var(--el-text-color-regular);
        }

        .notification-link {
          font-size: 13px;
          color: var(--el-color-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .notification-actions {
        display: flex;
        flex-direction: column;
        gap: 4px;
        justify-content: center;
      }
    }
  }

  .pagination {
    display: flex;
    justify-content: center;
    margin-top: 24px;
  }
}

@media (max-width: 768px) {
  .notifications-page {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    h1 {
      font-size: 22px;
    }

    .header-actions {
      width: 100%;

      .el-button {
        flex: 1;
      }
    }
  }

  .notifications-card {
    .notifications-list {
      .notification-item {
        flex-direction: column;

        .notification-icon {
          align-self: flex-start;
        }

        .notification-content {
          .notification-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
        }

        .notification-actions {
          flex-direction: row;
          align-self: stretch;

          .el-button {
            flex: 1;
          }
        }
      }
    }
  }
}
</style>
