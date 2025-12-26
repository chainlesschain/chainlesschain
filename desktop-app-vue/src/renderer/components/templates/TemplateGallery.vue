<template>
  <div class="template-gallery">
    <!-- 加载状态 -->
    <div v-if="templateStore.loading" class="loading-container">
      <a-spin size="large" tip="加载模板中..." />
    </div>

    <!-- 模板网格 -->
    <div v-else-if="displayTemplates.length > 0" class="template-grid">
      <TemplateCard
        v-for="template in displayTemplates"
        :key="template.id"
        :template="template"
        :compact="compact"
        @use="handleTemplateUse"
        @click="handleTemplateClick"
      />
    </div>

    <!-- 空状态 -->
    <a-empty
      v-else
      class="empty-state"
      :description="emptyDescription"
    >
      <template #image>
        <FileTextOutlined style="font-size: 64px; color: #d9d9d9" />
      </template>
      <template #extra>
        <a-button type="primary" @click="handleCreateCustom">
          创建自定义项目
        </a-button>
      </template>
    </a-empty>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { FileTextOutlined } from '@ant-design/icons-vue'
import { useTemplateStore } from '@/stores/template'
import TemplateCard from './TemplateCard.vue'

const props = defineProps({
  category: {
    type: String,
    default: null
  },
  subcategory: {
    type: String,
    default: null
  },
  compact: {
    type: Boolean,
    default: false
  },
  limit: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['template-use', 'template-click', 'create-custom'])

const router = useRouter()
const templateStore = useTemplateStore()

const emptyDescription = computed(() => {
  if (props.category) {
    return `暂无"${getCategoryName(props.category)}"分类的模板`
  }
  return '暂无可用模板'
})

const displayTemplates = computed(() => {
  const templates = templateStore.filteredTemplates
  if (props.limit && props.limit > 0) {
    return templates.slice(0, props.limit)
  }
  return templates
})

// 监听分类变化
watch(
  [() => props.category, () => props.subcategory],
  async ([newCategory, newSubcategory]) => {
    console.log('[TemplateGallery] 分类变化:', { newCategory, newSubcategory })

    if (newCategory) {
      try {
        await templateStore.loadTemplatesByCategory(newCategory, newSubcategory)
      } catch (error) {
        console.error('[TemplateGallery] 加载模板失败:', error)
        message.error('加载模板失败: ' + error.message)
      }
    }
  },
  { immediate: true }
)

// 组件挂载时加载模板
onMounted(async () => {
  // 如果没有指定分类，加载所有模板
  if (!props.category && templateStore.templates.length === 0) {
    try {
      await templateStore.fetchTemplates()
    } catch (error) {
      console.error('[TemplateGallery] 初始化加载失败:', error)
      message.error('加载模板失败')
    }
  }
})

function handleTemplateUse(template) {
  console.log('[TemplateGallery] 使用模板:', template.display_name)
  emit('template-use', template)
}

function handleTemplateClick(template) {
  console.log('[TemplateGallery] 点击模板:', template.display_name)
  emit('template-click', template)
}

function handleCreateCustom() {
  emit('create-custom')
  router.push('/projects/new')
}

function getCategoryName(category) {
  const categoryNames = {
    writing: '写作',
    ppt: 'PPT',
    excel: 'Excel',
    web: '网页',
    design: '设计',
    podcast: '播客',
    resume: '简历',
    research: '研究',
    marketing: '营销',
    education: '教育',
    lifestyle: '生活',
    travel: '旅行'
  }
  return categoryNames[category] || category
}
</script>

<style lang="scss" scoped>
.template-gallery {
  width: 100%;
  min-height: 300px;

  .loading-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 400px;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
    padding: 24px 0;
    animation: fadeIn 0.3s ease-in;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    padding: 48px 24px;

    :deep(.ant-empty-description) {
      color: #86868b;
      font-size: 14px;
    }

    :deep(.ant-btn) {
      margin-top: 16px;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;

      &:hover {
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
      }
    }
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// 响应式调整
@media (max-width: 768px) {
  .template-gallery {
    .template-grid {
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
      padding: 16px 0;
    }
  }
}

@media (min-width: 1400px) {
  .template-gallery {
    .template-grid {
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
    }
  }
}
</style>
