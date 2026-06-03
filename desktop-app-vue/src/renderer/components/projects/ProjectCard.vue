<template>
  <div
    class="project-card"
    @click="handleView"
  >
    <!-- 封面图 -->
    <div class="card-cover">
      <img
        v-if="project.cover_image_url"
        :src="project.cover_image_url"
        alt="Project cover"
      >
      <div
        v-else
        class="cover-placeholder"
      >
        <component
          :is="projectTypeIcon"
          class="placeholder-icon"
        />
      </div>

      <!-- 状态标签 -->
      <div
        class="status-badge"
        :class="`status-${project.status}`"
      >
        {{ statusText }}
      </div>
    </div>

    <!-- 卡片内容 -->
    <div class="card-content">
      <!-- 项目名称 -->
      <h3 class="project-name">
        {{ project.name }}
      </h3>

      <!-- 项目描述 -->
      <p class="project-description">
        {{ truncatedDescription }}
      </p>

      <!-- 标签 -->
      <div
        v-if="tags.length > 0"
        class="project-tags"
      >
        <a-tag
          v-for="tag in tags.slice(0, 3)"
          :key="tag"
          color="blue"
        >
          {{ tag }}
        </a-tag>
        <a-tag
          v-if="tags.length > 3"
          color="default"
        >
          +{{ tags.length - 3 }}
        </a-tag>
      </div>

      <!-- 项目元信息 -->
      <div class="project-meta">
        <div class="meta-item">
          <FileOutlined />
          <span>{{ project.file_count || 0 }} 文件</span>
        </div>
        <div class="meta-item">
          <ClockCircleOutlined />
          <span>{{ formattedUpdateTime }}</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="card-actions">
        <a-button
          type="primary"
          size="small"
          @click.stop="handleView"
        >
          <EyeOutlined />
          查看
        </a-button>
        <a-button
          size="small"
          @click.stop="handleEdit"
        >
          <EditOutlined />
          编辑
        </a-button>
        <a-button
          danger
          size="small"
          @click.stop="handleDelete"
        >
          <DeleteOutlined />
        </a-button>
      </div>
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

// 计算属性
const projectTypeIcon = computed(() => {
  return projectTypeIcons[props.project.project_type] || CodeOutlined;
});

const statusText = computed(() => {
  return statusTexts[props.project.status] || '未知';
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
  return desc.length > 80 ? desc.substring(0, 80) + '...' : desc;
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
.project-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s;
  cursor: pointer;
  border: 2px solid transparent;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.project-card:hover {
  border-color: #667eea;
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
  transform: translateY(-4px);
}

/* 封面 */
.card-cover {
  position: relative;
  width: 100%;
  height: 180px;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.placeholder-icon {
  font-size: 64px;
  color: rgba(255, 255, 255, 0.8);
}

/* 状态标签 */
.status-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  color: white;
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

/* 卡片内容 */
.card-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
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

.project-description {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 44px;
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
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
  margin-top: auto;
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

/* 操作按钮 */
.card-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
}

.card-actions button {
  flex: 1;
}

.card-actions button:last-child {
  flex: 0 0 auto;
  padding: 0 8px;
}
</style>
