<template>
  <div
    class="project-list-item"
    @click="handleView"
  >
    <!-- 左侧：项目信息 -->
    <div class="item-left">
      <!-- 项目图标 -->
      <div class="project-icon">
        <component :is="projectTypeIcon" />
      </div>

      <!-- 项目详情 -->
      <div class="project-info">
        <div class="info-header">
          <h4 class="project-name">
            {{ project.name }}
          </h4>
          <div
            class="status-badge"
            :class="`status-${project.status}`"
          >
            {{ statusText }}
          </div>
        </div>

        <p class="project-description">
          {{ truncatedDescription }}
        </p>

        <!-- 标签和元信息 -->
        <div class="project-footer">
          <div
            v-if="tags.length > 0"
            class="project-tags"
          >
            <a-tag
              v-for="tag in tags.slice(0, 4)"
              :key="tag"
              color="blue"
              size="small"
            >
              {{ tag }}
            </a-tag>
            <a-tag
              v-if="tags.length > 4"
              color="default"
              size="small"
            >
              +{{ tags.length - 4 }}
            </a-tag>
          </div>

          <div class="project-meta">
            <div class="meta-item">
              <FileOutlined />
              <span>{{ project.file_count || 0 }} 文件</span>
            </div>
            <div class="meta-item">
              <CloudOutlined
                v-if="project.sync_status === 'synced'"
                style="color: #10b981"
              />
              <CloudSyncOutlined
                v-else-if="project.sync_status === 'pending'"
                style="color: #f59e0b"
              />
              <ExclamationCircleOutlined
                v-else-if="project.sync_status === 'error'"
                style="color: #ef4444"
              />
              <span>{{ syncStatusText }}</span>
            </div>
            <div class="meta-item">
              <ClockCircleOutlined />
              <span>{{ formattedUpdateTime }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右侧：操作按钮 -->
    <div class="item-right">
      <a-button
        type="primary"
        @click.stop="handleView"
      >
        <EyeOutlined />
        查看
      </a-button>
      <a-button @click.stop="handleEdit">
        <EditOutlined />
        编辑
      </a-button>
      <a-button
        danger
        @click.stop="handleDelete"
      >
        <DeleteOutlined />
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  FileOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreOutlined as AppIcon,
  CloudOutlined,
  CloudSyncOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons-vue';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const props = defineProps({
  project: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['view', 'edit', 'delete']);

// 项目类型图标映射
const projectTypeIcons = {
  web: CodeOutlined,
  document: FileTextOutlined,
  data: BarChartOutlined,
  app: AppIcon,
};

// 状态文本映射
const statusTexts = {
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  archived: '已归档',
};

// 同步状态文本映射
const syncStatusTexts = {
  synced: '已同步',
  pending: '待同步',
  conflict: '冲突',
  error: '错误',
};

// 计算属性
const projectTypeIcon = computed(() => {
  return projectTypeIcons[props.project.project_type] || CodeOutlined;
});

const statusText = computed(() => {
  return statusTexts[props.project.status] || '未知';
});

const syncStatusText = computed(() => {
  return syncStatusTexts[props.project.sync_status] || '未知';
});

const tags = computed(() => {
  try {
    return JSON.parse(props.project.tags || '[]');
  } catch {
    return [];
  }
});

const truncatedDescription = computed(() => {
  const desc = props.project.description || '暂无描述';
  return desc.length > 150 ? desc.substring(0, 150) + '...' : desc;
});

const formattedUpdateTime = computed(() => {
  try {
    const timestamp = props.project.updated_at;
    if (!timestamp) {return '未知';}

    return formatDistanceToNow(new Date(timestamp), {
      addSuffix: true,
      locale: zhCN,
    });
  } catch {
    return '未知';
  }
});

// 事件处理
const handleView = () => {
  emit('view', props.project.id);
};

const handleEdit = () => {
  emit('edit', props.project.id);
};

const handleDelete = () => {
  emit('delete', props.project.id);
};
</script>

<style scoped>
.project-list-item {
  background: white;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  transition: all 0.3s;
  cursor: pointer;
  border: 2px solid transparent;
}

.project-list-item:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  transform: translateX(4px);
}

/* 左侧内容 */
.item-left {
  flex: 1;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-width: 0;
}

/* 项目图标 */
.project-icon {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.project-icon :deep(.anticon) {
  font-size: 28px;
  color: white;
}

/* 项目信息 */
.project-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-name {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态标签 */
.status-badge {
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.status-draft {
  background: #9ca3af;
}

.status-active {
  background: #10b981;
}

.status-completed {
  background: #3b82f6;
}

.status-archived {
  background: #6b7280;
}

.project-description {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 项目底部信息 */
.project-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

/* 标签 */
.project-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 元信息 */
.project-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
}

.meta-item :deep(.anticon) {
  font-size: 14px;
}

/* 右侧操作 */
.item-right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 响应式布局 */
@media (max-width: 768px) {
  .project-list-item {
    flex-direction: column;
    align-items: stretch;
  }

  .item-right {
    justify-content: flex-end;
  }
}
</style>
