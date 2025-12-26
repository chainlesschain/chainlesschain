<template>
  <a-modal
    :open="open"
    :width="1000"
    :footer="null"
    :maskClosable="true"
    @cancel="handleClose"
    class="template-detail-modal"
  >
    <div class="modal-content">
      <!-- 模板封面预览 -->
      <div class="template-preview">
        <div class="preview-image" :style="{ backgroundImage: `url(${previewImageUrl})` }">
          <div v-if="!template.cover_image_url" class="preview-placeholder">
            <div class="placeholder-icon">
              <component :is="typeIcon" />
            </div>
            <div class="placeholder-content">
              <h2>{{ template.name }}</h2>
              <p v-if="template.subtitle">{{ template.subtitle }}</p>
              <div class="template-meta-info">
                <div class="meta-item">
                  <UserOutlined />
                  <span>{{ template.author || '[汇报人/单位]' }}</span>
                </div>
                <div class="meta-item">
                  <CalendarOutlined />
                  <span>{{ template.date || '[日期]' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 目录导航（如果模板有目录） -->
      <div v-if="templateSections.length > 0" class="template-sections">
        <h3>
          <UnorderedListOutlined />
          目录导航
        </h3>
        <div class="sections-list">
          <div
            v-for="(section, index) in templateSections"
            :key="index"
            class="section-item"
          >
            <span class="section-number">{{ index + 1 }}</span>
            <span class="section-title">{{ section }}</span>
          </div>
        </div>
      </div>

      <!-- 模板描述 -->
      <div class="template-description">
        <h3>模板说明</h3>
        <p>{{ template.description }}</p>

        <div class="template-features">
          <div class="feature-item">
            <CheckCircleOutlined />
            <span>{{ getProjectTypeLabel(template.project_type) }}</span>
          </div>
          <div class="feature-item" v-if="template.is_builtin">
            <CheckCircleOutlined />
            <span>官方内置模板</span>
          </div>
          <div class="feature-item">
            <CheckCircleOutlined />
            <span>已被使用 {{ template.usage_count || 0 }} 次</span>
          </div>
        </div>
      </div>

      <!-- 底部操作按钮 -->
      <div class="modal-footer">
        <a-button size="large" @click="handleClose">
          继续提问
        </a-button>
        <a-button type="primary" size="large" @click="handleUseTemplate">
          <ThunderboltOutlined />
          做同款
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { computed } from 'vue';
import {
  UserOutlined,
  CalendarOutlined,
  UnorderedListOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  CodeOutlined,
  BarChartOutlined,
  AppstoreOutlined,
  FileOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  template: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['close', 'use']);

// 项目类型图标映射
const typeIcons = {
  web: CodeOutlined,
  document: FileTextOutlined,
  data: BarChartOutlined,
  app: AppstoreOutlined,
  ppt: FileOutlined,
  excel: BarChartOutlined,
  write: FileTextOutlined,
  design: AppstoreOutlined,
  video: FileOutlined,
  image: FileOutlined,
};

// 项目类型标签映射
const projectTypeLabels = {
  web: 'Web开发',
  document: '文档处理',
  data: '数据分析',
  app: '应用开发',
  ppt: 'PPT演示',
  excel: 'Excel表格',
  write: '写作',
  design: '设计',
  video: '视频',
  image: '图像',
};

// 计算属性
const typeIcon = computed(() => {
  return typeIcons[props.template.project_type] || FileTextOutlined;
});

const previewImageUrl = computed(() => {
  return props.template.cover_image_url || '';
});

const templateSections = computed(() => {
  try {
    const config = JSON.parse(props.template.config_json || '{}');
    return config.sections || config.toc || [];
  } catch {
    return [];
  }
});

const getProjectTypeLabel = (type) => {
  return projectTypeLabels[type] || type;
};

// 事件处理
const handleClose = () => {
  emit('close');
};

const handleUseTemplate = () => {
  emit('use', props.template);
};
</script>

<style scoped lang="scss">
.template-detail-modal {
  :deep(.ant-modal-content) {
    border-radius: 12px;
    overflow: hidden;
  }

  :deep(.ant-modal-body) {
    padding: 0;
  }
}

.modal-content {
  display: flex;
  flex-direction: column;
}

/* 模板预览 */
.template-preview {
  width: 100%;
  background: #f5f7fa;
}

.preview-image {
  width: 100%;
  height: 400px;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  position: relative;
}

.preview-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: white;
}

.placeholder-icon {
  font-size: 80px;
  margin-bottom: 24px;
  opacity: 0.9;
}

.placeholder-content {
  text-align: center;
  max-width: 600px;

  h2 {
    font-size: 36px;
    font-weight: 600;
    margin: 0 0 16px 0;
    color: white;
  }

  p {
    font-size: 18px;
    color: rgba(255, 255, 255, 0.9);
    margin: 0 0 24px 0;
  }
}

.template-meta-info {
  display: flex;
  gap: 32px;
  justify-content: center;
  margin-top: 24px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.95);

  .anticon {
    font-size: 18px;
  }
}

/* 目录导航 */
.template-sections {
  padding: 32px;
  background: white;
  border-bottom: 1px solid #e5e7eb;

  h3 {
    font-size: 20px;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 20px 0;
    display: flex;
    align-items: center;
    gap: 8px;

    .anticon {
      font-size: 22px;
      color: #667eea;
    }
  }
}

.sections-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.section-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
  font-size: 14px;
  color: #374151;
  transition: all 0.3s;

  &:hover {
    background: #f3f4f6;
    transform: translateX(4px);
  }
}

.section-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #667eea;
  color: white;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.section-title {
  flex: 1;
  font-weight: 500;
}

/* 模板描述 */
.template-description {
  padding: 32px;
  background: white;

  h3 {
    font-size: 18px;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 16px 0;
  }

  p {
    font-size: 15px;
    line-height: 1.8;
    color: #6b7280;
    margin: 0 0 24px 0;
  }
}

.template-features {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #f0f9ff;
  border-radius: 20px;
  font-size: 14px;
  color: #0369a1;

  .anticon {
    font-size: 16px;
    color: #0284c7;
  }
}

/* 底部操作 */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 32px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;

  .ant-btn {
    min-width: 120px;
  }
}
</style>
