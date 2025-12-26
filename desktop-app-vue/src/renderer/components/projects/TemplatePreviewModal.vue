<template>
  <a-modal
    v-model:open="visible"
    title="模板预览"
    width="800px"
    :footer="null"
    @cancel="handleClose"
  >
    <div class="template-preview-modal" v-if="template">
      <!-- 模板预览图 -->
      <div class="preview-image">
        <img
          v-if="template.preview_image"
          :src="template.preview_image"
          :alt="template.name"
        />
        <div v-else class="no-image">
          <FileTextOutlined style="font-size: 64px; color: #ccc" />
          <p>暂无预览图</p>
        </div>
      </div>

      <!-- 模板信息 -->
      <div class="template-info">
        <h2>{{ template.name }}</h2>
        <p class="description">{{ template.description }}</p>

        <a-divider />

        <a-descriptions :column="2" size="small">
          <a-descriptions-item label="模板类型">
            <a-tag :color="getTypeColor(template.project_type)">
              {{ getTypeText(template.project_type) }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDate(template.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="使用次数">
            {{ template.use_count || 0 }} 次
          </a-descriptions-item>
          <a-descriptions-item label="评分">
            <a-rate :value="template.rating || 4.5" disabled allow-half />
          </a-descriptions-item>
        </a-descriptions>

        <!-- 模板标签 -->
        <div class="template-tags" v-if="template.tags && template.tags.length > 0">
          <a-tag v-for="tag in template.tags" :key="tag" color="blue">
            {{ tag }}
          </a-tag>
        </div>

        <!-- 操作按钮 -->
        <div class="actions">
          <a-button type="primary" size="large" block @click="handleUseTemplate">
            <template #icon><ThunderboltOutlined /></template>
            做同款
          </a-button>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch } from 'vue';
import { FileTextOutlined, ThunderboltOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  template: {
    type: Object,
    default: null
  },
  modelValue: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'use-template', 'close']);

const visible = ref(props.modelValue);

watch(() => props.modelValue, (newVal) => {
  visible.value = newVal;
});

watch(visible, (newVal) => {
  emit('update:modelValue', newVal);
});

const handleClose = () => {
  visible.value = false;
  emit('close');
};

const handleUseTemplate = () => {
  emit('use-template', props.template);
  handleClose();
};

const getTypeColor = (type) => {
  const colors = {
    'web': 'blue',
    'document': 'green',
    'data': 'orange',
    'presentation': 'purple',
    'video': 'red',
    'image': 'cyan'
  };
  return colors[type] || 'default';
};

const getTypeText = (type) => {
  const texts = {
    'web': '网页开发',
    'document': '文档处理',
    'data': '数据分析',
    'presentation': '演示文稿',
    'video': '视频制作',
    'image': '图像设计'
  };
  return texts[type] || type;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN');
};
</script>

<style scoped>
.template-preview-modal {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.preview-image {
  width: 100%;
  height: 400px;
  background: #f5f5f5;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.no-image {
  text-align: center;
  color: #999;
}

.template-info h2 {
  margin: 0 0 12px 0;
  font-size: 24px;
  font-weight: 600;
}

.description {
  color: #666;
  margin-bottom: 16px;
  line-height: 1.6;
}

.template-tags {
  margin: 16px 0;
}

.actions {
  margin-top: 24px;
}
</style>
