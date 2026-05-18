<template>
  <div class="template-list">
    <!-- 加载状态 -->
    <div
      v-if="loading"
      class="loading-container"
    >
      <a-spin size="large">
        <template #tip>
          <span style="margin-top: 8px">加载模板中...</span>
        </template>
      </a-spin>
    </div>

    <!-- 空状态 -->
    <a-empty
      v-else-if="!loading && templates.length === 0"
      description="暂无模板"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
    >
      <a-button
        type="primary"
        @click="$emit('create')"
      >
        <plus-outlined /> 创建第一个模板
      </a-button>
    </a-empty>

    <!-- 模板网格 -->
    <a-row
      v-else
      :gutter="[16, 16]"
    >
      <a-col
        v-for="template in templates"
        :key="template.id"
        :xs="24"
        :sm="12"
        :lg="8"
        :xl="6"
      >
        <a-card
          :hoverable="true"
          class="template-card"
          :class="{ 'system-template': template.is_system }"
        >
          <!-- 卡片头部 -->
          <template #title>
            <div class="template-header">
              <a-tooltip :title="template.name">
                <span class="template-name">{{ template.name }}</span>
              </a-tooltip>
              <a-tag
                v-if="template.is_system"
                color="blue"
                style="margin-left: 8px"
              >
                系统
              </a-tag>
            </div>
          </template>

          <!-- 卡片操作按钮 -->
          <template #extra>
            <a-dropdown :trigger="['click']">
              <a-button
                type="text"
                size="small"
              >
                <ellipsis-outlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item
                    key="use"
                    @click="$emit('use', template)"
                  >
                    <play-circle-outlined /> 使用模板
                  </a-menu-item>
                  <a-menu-item
                    v-if="!template.is_system"
                    key="edit"
                    @click="$emit('edit', template)"
                  >
                    <edit-outlined /> 编辑模板
                  </a-menu-item>
                  <a-menu-item
                    key="export"
                    @click="$emit('export', template)"
                  >
                    <export-outlined /> 导出模板
                  </a-menu-item>
                  <a-menu-divider v-if="!template.is_system" />
                  <a-menu-item
                    v-if="!template.is_system"
                    key="delete"
                    danger
                    @click="handleDelete(template)"
                  >
                    <delete-outlined /> 删除模板
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>

          <!-- 卡片内容 -->
          <div class="template-content">
            <!-- 描述 -->
            <p class="template-description">
              {{ template.description || '暂无描述' }}
            </p>

            <!-- 分类和变量 -->
            <div class="template-meta">
              <a-space wrap>
                <a-tag color="green">
                  <folder-outlined /> {{ getCategoryLabel(template.category) }}
                </a-tag>
                <a-tag
                  v-if="template.variables && template.variables.length > 0"
                  color="orange"
                >
                  <api-outlined /> {{ template.variables.length }} 个变量
                </a-tag>
              </a-space>
            </div>

            <!-- 统计信息 -->
            <div class="template-stats">
              <a-space>
                <a-tooltip title="使用次数">
                  <span class="stat-item">
                    <fire-outlined :style="{ color: '#faad14' }" />
                    {{ template.usage_count || 0 }}
                  </span>
                </a-tooltip>
                <a-tooltip :title="`创建于 ${formatDate(template.created_at)}`">
                  <span class="stat-item">
                    <clock-circle-outlined :style="{ color: '#1890ff' }" />
                    {{ formatRelativeTime(template.created_at) }}
                  </span>
                </a-tooltip>
              </a-space>
            </div>

            <!-- 操作按钮 -->
            <div class="template-actions">
              <a-button
                type="primary"
                block
                @click="$emit('use', template)"
              >
                <play-circle-outlined /> 使用模板
              </a-button>
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { Empty } from 'ant-design-vue';
import {
  PlusOutlined,
  EllipsisOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ExportOutlined,
  FolderOutlined,
  ApiOutlined,
  FireOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';
import { Modal, message } from 'ant-design-vue';

// Props
defineProps({
  templates: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

// Emits
const emit = defineEmits(['use', 'edit', 'delete', 'export', 'create']);

// 分类标签映射
const getCategoryLabel = (category) => {
  const labels = {
    general: '通用',
    writing: '写作',
    translation: '翻译',
    analysis: '分析',
    programming: '编程',
    creative: '创意',
    qa: '问答',
    rag: 'RAG',
  };
  return labels[category] || category;
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) {return '未知';}
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 格式化相对时间
const formatRelativeTime = (timestamp) => {
  if (!timestamp) {return '未知';}

  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) {return `${years} 年前`;}
  if (months > 0) {return `${months} 个月前`;}
  if (days > 0) {return `${days} 天前`;}
  if (hours > 0) {return `${hours} 小时前`;}
  if (minutes > 0) {return `${minutes} 分钟前`;}
  return '刚刚';
};

// 删除确认
const handleDelete = (template) => {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除模板 "${template.name}" 吗？此操作无法撤销。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => {
      emit('delete', template);
    },
  });
};
</script>

<style scoped>
.template-list {
  min-height: 400px;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.template-card {
  height: 100%;
  transition: all 0.3s ease;
  border-radius: 8px;
}

.template-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.system-template {
  border: 1px solid #1890ff;
}

.template-header {
  display: flex;
  align-items: center;
  overflow: hidden;
}

.template-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 600;
}

.template-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.template-description {
  color: rgba(0, 0, 0, 0.65);
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
  min-height: 44px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-meta {
  padding: 8px 0;
  border-top: 1px solid #f0f0f0;
}

.template-stats {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.template-actions {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

:deep(.ant-card-head) {
  min-height: 48px;
  padding: 0 16px;
}

:deep(.ant-card-head-title) {
  padding: 12px 0;
}

:deep(.ant-card-body) {
  padding: 16px;
}

:deep(.ant-empty) {
  padding: 60px 0;
}
</style>
