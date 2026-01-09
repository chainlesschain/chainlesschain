<template>
  <div class="notification-center">
    <!-- 通知图标按钮 -->
    <a-badge :count="unreadCount" :overflow-count="99">
      <a-button
        type="text"
        size="large"
        class="notification-trigger"
        @click="togglePanel"
      >
        <BellOutlined :style="{ fontSize: '20px' }" />
      </a-button>
    </a-badge>

    <!-- 通知面板 -->
    <a-drawer
      v-model:open="panelVisible"
      title="通知中心"
      placement="right"
      :width="400"
      :body-style="{ padding: 0 }"
    >
      <!-- 头部操作栏 -->
      <div class="notification-header">
        <a-space>
          <a-button
            size="small"
            :type="filter === 'all' ? 'primary' : 'default'"
            @click="filter = 'all'"
          >
            全部 ({{ notifications.length }})
          </a-button>
          <a-button
            size="small"
            :type="filter === 'unread' ? 'primary' : 'default'"
            @click="filter = 'unread'"
          >
            未读 ({{ unreadCount }})
          </a-button>
        </a-space>
        <a-space>
          <a-button size="small" @click="markAllAsRead" :disabled="unreadCount === 0">
            全部已读
          </a-button>
          <a-button size="small" danger @click="clearRead">
            清空已读
          </a-button>
        </a-space>
      </div>

      <!-- 通知列表 -->
      <div class="notification-list">
        <a-empty
          v-if="filteredNotifications.length === 0"
          description="暂无通知"
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
        />

        <div
          v-for="notification in filteredNotifications"
          :key="notification.id"
          class="notification-item"
          :class="{
            'notification-unread': !notification.read,
            [`notification-${notification.type}`]: true,
            [`notification-priority-${notification.priority}`]: true,
          }"
          @click="handleNotificationClick(notification)"
        >
          <!-- 通知图标 -->
          <div class="notification-icon">
            <component :is="getNotificationIcon(notification.type)" />
          </div>

          <!-- 通知内容 -->
          <div class="notification-content">
            <div class="notification-title">
              {{ notification.title || notification.message }}
            </div>
            <div v-if="notification.description" class="notification-description">
              {{ notification.description }}
            </div>
            <div class="notification-meta">
              <span class="notification-time">{{ formatTime(notification.timestamp) }}</span>
              <a-tag
                v-if="notification.priority !== 'normal'"
                :color="getPriorityColor(notification.priority)"
                size="small"
              >
                {{ getPriorityLabel(notification.priority) }}
              </a-tag>
            </div>

            <!-- 操作按钮 -->
            <div v-if="notification.actions && notification.actions.length > 0" class="notification-actions">
              <a-button
                v-for="(action, index) in notification.actions"
                :key="index"
                size="small"
                type="link"
                @click.stop="handleActionClick(action, notification)"
              >
                {{ action.text }}
              </a-button>
            </div>
          </div>

          <!-- 删除按钮 -->
          <div class="notification-remove">
            <a-button
              type="text"
              size="small"
              danger
              @click.stop="remove(notification.id)"
            >
              <CloseOutlined />
            </a-button>
          </div>
        </div>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Empty } from 'ant-design-vue';
import {
  BellOutlined,
  CloseOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import { useNotifications } from '@/utils/notificationManager';

// 使用通知管理器
const {
  notifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  remove,
  clearRead,
} = useNotifications();

// 面板状态
const panelVisible = ref(false);
const filter = ref('all');

// 过滤后的通知列表
const filteredNotifications = computed(() => {
  if (filter.value === 'unread') {
    return notifications.value.filter(n => !n.read);
  }
  return notifications.value;
});

// 切换面板
const togglePanel = () => {
  panelVisible.value = !panelVisible.value;
};

// 获取通知图标
const getNotificationIcon = (type) => {
  const iconMap = {
    info: InfoCircleOutlined,
    success: CheckCircleOutlined,
    warning: WarningOutlined,
    error: CloseCircleOutlined,
  };
  return iconMap[type] || InfoCircleOutlined;
};

// 获取优先级颜色
const getPriorityColor = (priority) => {
  const colorMap = {
    low: 'default',
    normal: 'blue',
    high: 'orange',
    urgent: 'red',
  };
  return colorMap[priority] || 'blue';
};

// 获取优先级标签
const getPriorityLabel = (priority) => {
  const labelMap = {
    low: '低',
    normal: '普通',
    high: '高',
    urgent: '紧急',
  };
  return labelMap[priority] || '普通';
};

// 格式化时间
const formatTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return '刚刚';
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  } else if (diff < 7 * day) {
    return `${Math.floor(diff / day)} 天前`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
};

// 处理通知点击
const handleNotificationClick = (notification) => {
  markAsRead(notification.id);
  if (notification.onClick) {
    notification.onClick(notification);
  }
};

// 处理操作按钮点击
const handleActionClick = (action, notification) => {
  if (action.onClick) {
    action.onClick(notification);
  }
  markAsRead(notification.id);
};
</script>

<style scoped>
.notification-center {
  display: inline-block;
}

.notification-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.notification-list {
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

.notification-item {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;
}

.notification-item:hover {
  background-color: #fafafa;
}

.notification-unread {
  background-color: #e6f7ff;
}

.notification-unread::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background-color: #1890ff;
}

.notification-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 18px;
}

.notification-info .notification-icon {
  background-color: #e6f7ff;
  color: #1890ff;
}

.notification-success .notification-icon {
  background-color: #f6ffed;
  color: #52c41a;
}

.notification-warning .notification-icon {
  background-color: #fffbe6;
  color: #faad14;
}

.notification-error .notification-icon {
  background-color: #fff2f0;
  color: #ff4d4f;
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-title {
  font-weight: 500;
  margin-bottom: 4px;
  color: #262626;
}

.notification-description {
  font-size: 13px;
  color: #8c8c8c;
  margin-bottom: 8px;
  line-height: 1.5;
}

.notification-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #8c8c8c;
}

.notification-actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.notification-remove {
  flex-shrink: 0;
}

.notification-priority-urgent {
  border-left: 3px solid #ff4d4f;
}

.notification-priority-high {
  border-left: 3px solid #faad14;
}
</style>
