<template>
  <div class="notification-center">
    <!-- 通知中心头部 -->
    <div class="notification-header">
      <h3>通知中心</h3>
      <div class="notification-actions">
        <a-button
          v-if="unreadNotifications.length > 0"
          type="link"
          size="small"
          @click="handleMarkAllRead"
        >
          全部已读
        </a-button>
        <a-button type="link" size="small" danger @click="handleClearAll">
          清空
        </a-button>
      </div>
    </div>

    <!-- 通知过滤标签 -->
    <div class="notification-filters">
      <a-radio-group
        v-model:value="currentFilter"
        button-style="solid"
        size="small"
      >
        <a-radio-button value="all">
          全部 ({{ notifications.length }})
        </a-radio-button>
        <a-radio-button value="unread">
          未读 ({{ unreadNotifications.length }})
        </a-radio-button>
        <a-radio-button value="friend_request"> 好友请求 </a-radio-button>
        <a-radio-button value="message"> 消息 </a-radio-button>
        <a-radio-button value="like"> 点赞 </a-radio-button>
        <a-radio-button value="comment"> 评论 </a-radio-button>
      </a-radio-group>
    </div>

    <!-- 通知列表 -->
    <div class="notification-list">
      <a-spin :spinning="loading">
        <a-empty
          v-if="filteredNotifications.length === 0"
          description="暂无通知"
        />

        <div
          v-for="notification in filteredNotifications"
          :key="notification.id"
          class="notification-item"
          :class="{ unread: notification.is_read === 0 }"
          @click="handleNotificationClick(notification)"
        >
          <!-- 通知图标 -->
          <div class="notification-icon" :class="`type-${notification.type}`">
            <component :is="getNotificationIcon(notification.type)" />
          </div>

          <!-- 通知内容 -->
          <div class="notification-content">
            <div class="notification-title">
              {{ notification.title }}
            </div>
            <div class="notification-body">
              {{ notification.content }}
            </div>
            <div class="notification-time">
              {{ formatTime(notification.created_at) }}
            </div>
          </div>

          <!-- 未读标记 -->
          <div v-if="notification.is_read === 0" class="notification-badge" />

          <!-- 操作按钮 -->
          <div class="notification-actions-btn">
            <a-dropdown :trigger="['click']">
              <a-button type="text" size="small">
                <template #icon>
                  <MoreOutlined />
                </template>
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item
                    v-if="notification.is_read === 0"
                    @click.stop="handleMarkAsRead(notification.id)"
                  >
                    <CheckOutlined /> 标记已读
                  </a-menu-item>
                  <a-menu-item @click.stop="handleDelete(notification.id)">
                    <DeleteOutlined /> 删除
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
import { logger, createLogger } from "@/utils/logger";

import { ref, computed, onMounted, watch } from "vue";
import { useSocialStore } from "../../stores/social";
import {
  BellOutlined,
  UserAddOutlined,
  MessageOutlined,
  HeartOutlined,
  CommentOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  CheckOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";

const socialStore = useSocialStore();

// 状态
const loading = ref(false);
const currentFilter = ref("all");

// 计算属性
const notifications = computed(() => socialStore.notifications);
const unreadNotifications = computed(() => socialStore.unreadNotificationsList);

const filteredNotifications = computed(() => {
  if (currentFilter.value === "all") {
    return notifications.value || [];
  } else if (currentFilter.value === "unread") {
    return unreadNotifications.value || [];
  } else {
    return (notifications.value || []).filter(
      (n) => n?.type === currentFilter.value,
    );
  }
});

// 方法
const loadNotifications = async () => {
  loading.value = true;
  try {
    await socialStore.loadNotifications();
  } catch (error) {
    // IPC 未就绪时静默处理（socialStore 内部会处理重试）
    if (
      !error.message?.includes("No handler registered") &&
      !error.message?.includes("interrupted")
    ) {
      logger.error("加载通知失败:", error);
      message.error("加载通知失败");
    }
  } finally {
    loading.value = false;
  }
};

const handleNotificationClick = async (notification) => {
  if (!notification) {
    return;
  }

  // 标记为已读
  if (notification.is_read === 0) {
    await handleMarkAsRead(notification.id);
  }

  // 根据通知类型执行相应操作
  if (notification.data) {
    try {
      const data =
        typeof notification.data === "string"
          ? JSON.parse(notification.data)
          : notification.data;

      if (notification.type === "message" && data?.sessionId) {
        // 跳转到聊天窗口
        const sessions = socialStore.chatSessions || [];
        const session = sessions.find((s) => s?.id === data.sessionId);
        if (session) {
          const friends = socialStore.friends || [];
          const friend = friends.find(
            (f) => f?.friend_did === session.participant_did,
          );
          if (friend) {
            await socialStore.openChatWithFriend(friend);
          }
        }
      } else if (notification.type === "friend_request") {
        // 可以跳转到好友管理页面
        logger.info("打开好友管理页面");
      }
    } catch (error) {
      logger.error("处理通知数据失败:", error);
    }
  }
};

const handleMarkAsRead = async (id) => {
  try {
    await socialStore.markNotificationAsRead(id);
  } catch (error) {
    logger.error("标记已读失败:", error);
    message.error("操作失败");
  }
};

const handleMarkAllRead = async () => {
  try {
    await socialStore.markAllNotificationsAsRead();
    message.success("已全部标记为已读");
  } catch (error) {
    logger.error("全部标记已读失败:", error);
    message.error("操作失败");
  }
};

const handleDelete = async (id) => {
  try {
    if (!Array.isArray(socialStore.notifications)) {
      logger.warn("handleDelete: notifications 不是数组");
      return;
    }
    const index = socialStore.notifications.findIndex((n) => n.id === id);
    if (index > -1) {
      socialStore.notifications.splice(index, 1);
    }
    message.success("已删除");
  } catch (error) {
    logger.error("删除通知失败:", error);
    message.error("删除失败");
  }
};

const handleClearAll = () => {
  if (notifications.value.length === 0) {
    message.info("暂无通知");
    return;
  }

  socialStore.clearAllNotifications();
  message.success("已清空所有通知");
};

const getNotificationIcon = (type) => {
  const iconMap = {
    friend_request: UserAddOutlined,
    message: MessageOutlined,
    like: HeartOutlined,
    comment: CommentOutlined,
    system: InfoCircleOutlined,
  };
  return iconMap[type] || BellOutlined;
};

const formatTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "刚刚";
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)}小时前`;
  } else if (diff < 7 * day) {
    return `${Math.floor(diff / day)}天前`;
  } else {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
};

// 生命周期
onMounted(() => {
  loadNotifications();
});

// 监听通知变化
watch(
  () => socialStore.notifications.length,
  () => {
    // 通知数量变化时，可以添加一些提示
  },
);
</script>

<style scoped>
.notification-center {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.notification-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.notification-actions {
  display: flex;
  gap: 8px;
}

.notification-filters {
  padding: 12px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.notification-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 20px;
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;
}

.notification-item:hover {
  background-color: #f5f5f5;
}

.notification-item.unread {
  background-color: #e6f7ff;
}

.notification-item.unread:hover {
  background-color: #d9f0ff;
}

.notification-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.notification-icon.type-friend_request {
  background-color: #e6f7ff;
  color: #1890ff;
}

.notification-icon.type-message {
  background-color: #f0f5ff;
  color: #597ef7;
}

.notification-icon.type-like {
  background-color: #fff0f6;
  color: #eb2f96;
}

.notification-icon.type-comment {
  background-color: #f6ffed;
  color: #52c41a;
}

.notification-icon.type-system {
  background-color: #fff7e6;
  color: #fa8c16;
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-title {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
}

.notification-body {
  font-size: 13px;
  color: #595959;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.notification-time {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}

.notification-badge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #ff4d4f;
  position: absolute;
  top: 16px;
  right: 56px;
}

.notification-actions-btn {
  opacity: 0;
  transition: opacity 0.2s;
}

.notification-item:hover .notification-actions-btn {
  opacity: 1;
}

/* 滚动条样式 */
.notification-list::-webkit-scrollbar {
  width: 6px;
}

.notification-list::-webkit-scrollbar-thumb {
  background-color: #d9d9d9;
  border-radius: 3px;
}

.notification-list::-webkit-scrollbar-thumb:hover {
  background-color: #bfbfbf;
}

.notification-list::-webkit-scrollbar-track {
  background-color: transparent;
}
</style>
