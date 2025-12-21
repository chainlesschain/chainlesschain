<template>
  <div class="template-card" @click="handleUse">
    <!-- 卡片头部 -->
    <div class="card-header">
      <div class="template-icon">
        <component :is="typeIcon" />
      </div>
      <div v-if="template.is_builtin" class="builtin-badge">
        内置模板
      </div>
    </div>

    <!-- 卡片内容 -->
    <div class="card-content">
      <h3>{{ template.name }}</h3>
      <p class="template-description">{{ template.description }}</p>

      <!-- 模板元信息 -->
      <div class="template-meta">
        <div class="meta-item">
          <FileOutlined />
          <span>{{ fileCount }} 文件</span>
        </div>
        <div class="meta-item">
          <ThunderboltOutlined />
          <span>{{ template.usage_count || 0 }} 次使用</span>
        </div>
      </div>

      <!-- 使用按钮 -->
      <a-button type="primary" block @click.stop="handleUse">
        <PlusOutlined />
        使用此模板
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  FileOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  template: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['use']);

// 项目类型图标映射
const typeIcons = {
  web: CodeOutlined,
  document: FileTextOutlined,
  data: BarChartOutlined,
  app: AppstoreOutlined,
};

// 计算属性
const typeIcon = computed(() => {
  return typeIcons[props.template.project_type] || CodeOutlined;
});

const fileCount = computed(() => {
  try {
    const structure = JSON.parse(props.template.file_structure || '[]');
    return Array.isArray(structure) ? structure.length : 0;
  } catch {
    return 0;
  }
});

// 使用模板
const handleUse = () => {
  emit('use', props.template);
};
</script>

<style scoped>
.template-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s;
  cursor: pointer;
  border: 2px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.template-card:hover {
  border-color: #667eea;
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
  transform: translateY(-4px);
}

/* 卡片头部 */
.card-header {
  position: relative;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.template-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.template-icon :deep(.anticon) {
  font-size: 32px;
  color: white;
}

.builtin-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.9);
  color: #667eea;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

/* 卡片内容 */
.card-content {
  padding: 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-content h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.template-description {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
  margin: 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 63px;
}

/* 模板元信息 */
.template-meta {
  display: flex;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
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
</style>
