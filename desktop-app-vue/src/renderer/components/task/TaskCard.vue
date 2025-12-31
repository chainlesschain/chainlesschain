<template>
  <div class="task-card" :class="[`priority-${task.priority}`, { 'is-overdue': isOverdue }]" @click="handleClick">
    <!-- 卡片头部 -->
    <div class="task-card-header">
      <div class="task-title">
        {{ task.title }}
      </div>
      <a-dropdown :trigger="['click']" @click.stop>
        <a-button type="text" size="small" class="task-action-btn">
          <more-outlined />
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="edit" @click="handleEdit">
              <edit-outlined /> 编辑
            </a-menu-item>
            <a-menu-item key="assign" @click="handleAssign">
              <user-outlined /> 分配
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item key="delete" danger @click="handleDelete">
              <delete-outlined /> 删除
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>

    <!-- 任务描述 -->
    <div class="task-description" v-if="task.description && showDescription">
      {{ truncateText(task.description, 100) }}
    </div>

    <!-- 标签 -->
    <div class="task-labels" v-if="task.labels && task.labels.length > 0">
      <a-tag
        v-for="(label, index) in task.labels.slice(0, 3)"
        :key="index"
        size="small"
        :color="getLabelColor(label)"
      >
        {{ label }}
      </a-tag>
      <a-tag v-if="task.labels.length > 3" size="small">
        +{{ task.labels.length - 3 }}
      </a-tag>
    </div>

    <!-- 卡片底部 -->
    <div class="task-card-footer">
      <div class="footer-left">
        <!-- 优先级标识 -->
        <a-tooltip :title="`优先级: ${getPriorityLabel(task.priority)}`">
          <span class="priority-badge" :class="`priority-${task.priority}`">
            <flag-outlined />
          </span>
        </a-tooltip>

        <!-- 截止日期 -->
        <a-tooltip :title="getDueDateTooltip()" v-if="task.due_date">
          <span class="due-date" :class="{ 'is-overdue': isOverdue, 'is-soon': isSoon }">
            <calendar-outlined />
            {{ formatDueDate(task.due_date) }}
          </span>
        </a-tooltip>

        <!-- 评论数量 -->
        <span class="comment-count" v-if="task.comment_count > 0">
          <message-outlined />
          {{ task.comment_count }}
        </span>

        <!-- 附件数量 -->
        <span class="attachment-count" v-if="task.attachment_count > 0">
          <paperclip-outlined />
          {{ task.attachment_count }}
        </span>
      </div>

      <div class="footer-right">
        <!-- 分配的用户头像 -->
        <a-tooltip :title="getAssignedUserName()" v-if="task.assigned_to">
          <a-avatar :size="24" :style="{ backgroundColor: getAvatarColor(task.assigned_to) }">
            {{ getAvatarText(task.assigned_to) }}
          </a-avatar>
        </a-tooltip>

        <!-- 协作者数量 -->
        <a-avatar-group v-if="task.collaborators && task.collaborators.length > 0" :max-count="2" :size="24">
          <a-tooltip :title="collaborator" v-for="(collaborator, index) in task.collaborators" :key="index">
            <a-avatar :style="{ backgroundColor: getAvatarColor(collaborator) }">
              {{ getAvatarText(collaborator) }}
            </a-avatar>
          </a-tooltip>
        </a-avatar-group>
      </div>
    </div>

    <!-- 进度条（如果有预估工时） -->
    <div class="task-progress" v-if="task.estimate_hours && task.actual_hours">
      <a-progress
        :percent="Math.min(Math.round((task.actual_hours / task.estimate_hours) * 100), 100)"
        :size="'small'"
        :show-info="false"
        :status="task.actual_hours > task.estimate_hours ? 'exception' : 'normal'"
      />
      <span class="progress-text">
        {{ task.actual_hours }}h / {{ task.estimate_hours }}h
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Modal } from 'ant-design-vue';
import {
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  FlagOutlined,
  CalendarOutlined,
  MessageOutlined,
  PaperclipOutlined
} from '@ant-design/icons-vue';
import { useTaskStore } from '../../stores/task';

// Props
const props = defineProps({
  task: {
    type: Object,
    required: true
  },
  showDescription: {
    type: Boolean,
    default: true
  }
});

// Emits
const emit = defineEmits(['click', 'edit', 'delete', 'assign']);

// Stores
const taskStore = useTaskStore();

// Computed
const isOverdue = computed(() => {
  if (!props.task.due_date || props.task.status === 'completed') return false;
  return props.task.due_date < Date.now();
});

const isSoon = computed(() => {
  if (!props.task.due_date || props.task.status === 'completed') return false;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return props.task.due_date < Date.now() + threeDays && props.task.due_date > Date.now();
});

// Methods
function handleClick() {
  emit('click', props.task);
}

function handleEdit(e) {
  e?.domEvent?.stopPropagation();
  emit('edit', props.task);
}

function handleAssign(e) {
  e?.domEvent?.stopPropagation();
  emit('assign', props.task);
}

function handleDelete(e) {
  e?.domEvent?.stopPropagation();

  Modal.confirm({
    title: '确认删除',
    content: `确定要删除任务"${props.task.title}"吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const success = await taskStore.deleteTask(props.task.id);
      if (success) {
        emit('delete', props.task);
      }
    }
  });
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function getPriorityLabel(priority) {
  const labels = {
    urgent: '紧急',
    high: '高',
    medium: '中',
    low: '低'
  };
  return labels[priority] || priority;
}

function getLabelColor(label) {
  // 根据标签名称生成颜色
  const colors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta'];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatDueDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === -1) return '昨天';
  if (days > 0 && days < 7) return `${days}天后`;
  if (days < 0 && days > -7) return `${Math.abs(days)}天前`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getDueDateTooltip() {
  const date = new Date(props.task.due_date);
  return `截止日期: ${date.toLocaleString('zh-CN')}`;
}

function getAssignedUserName() {
  // TODO: 从用户信息获取真实姓名
  return props.task.assigned_to;
}

function getAvatarColor(did) {
  // 根据 DID 生成颜色
  const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = did.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getAvatarText(did) {
  // TODO: 从用户信息获取真实姓名首字母
  return did.substring(0, 2).toUpperCase();
}
</script>

<style scoped lang="less">
.task-card {
  background: #fff;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
  position: relative;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border-color: #1890ff;
  }

  // 优先级左侧边框
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 4px 0 0 4px;
  }

  &.priority-urgent::before {
    background-color: #f5222d;
  }

  &.priority-high::before {
    background-color: #faad14;
  }

  &.priority-medium::before {
    background-color: #1890ff;
  }

  &.priority-low::before {
    background-color: #52c41a;
  }

  &.is-overdue {
    background-color: #fff2f0;
    border-color: #ffccc7;
  }

  .task-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;

    .task-title {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      color: #262626;
      line-height: 1.5;
      word-break: break-word;
    }

    .task-action-btn {
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.3s;
    }
  }

  &:hover .task-action-btn {
    opacity: 1;
  }

  .task-description {
    font-size: 13px;
    color: #8c8c8c;
    line-height: 1.5;
    margin-bottom: 8px;
  }

  .task-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }

  .task-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: #8c8c8c;
    margin-top: 8px;

    .footer-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;

      .priority-badge {
        display: inline-flex;
        align-items: center;

        &.priority-urgent {
          color: #f5222d;
        }

        &.priority-high {
          color: #faad14;
        }

        &.priority-medium {
          color: #1890ff;
        }

        &.priority-low {
          color: #52c41a;
        }
      }

      .due-date {
        display: inline-flex;
        align-items: center;
        gap: 4px;

        &.is-overdue {
          color: #f5222d;
        }

        &.is-soon {
          color: #faad14;
        }
      }

      .comment-count,
      .attachment-count {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
    }

    .footer-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .task-progress {
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;

    .ant-progress {
      flex: 1;
      margin: 0;
    }

    .progress-text {
      font-size: 12px;
      color: #8c8c8c;
      flex-shrink: 0;
    }
  }
}
</style>
