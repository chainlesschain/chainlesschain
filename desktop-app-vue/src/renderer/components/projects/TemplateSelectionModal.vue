<template>
  <a-modal
    :open="open"
    :title="title"
    :width="1200"
    :footer="null"
    class="template-selection-modal"
    @cancel="handleCancel"
  >
    <div class="modal-content">
      <!-- 搜索和筛选栏 -->
      <div class="filter-bar">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索模板名称或描述..."
          style="width: 300px"
          @search="handleSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>

        <a-select
          v-model:value="selectedCategory"
          placeholder="选择分类"
          style="width: 200px"
          allow-clear
          @change="handleCategoryChange"
        >
          <a-select-option value="">
            全部分类
          </a-select-option>
          <a-select-option
            v-for="category in categories"
            :key="category.value"
            :value="category.value"
          >
            {{ category.label }}
          </a-select-option>
        </a-select>

        <a-select
          v-model:value="selectedProjectType"
          placeholder="项目类型"
          style="width: 200px"
          allow-clear
          @change="handleProjectTypeChange"
        >
          <a-select-option value="">
            全部类型
          </a-select-option>
          <a-select-option
            v-for="type in projectTypes"
            :key="type.value"
            :value="type.value"
          >
            {{ type.label }}
          </a-select-option>
        </a-select>

        <div class="template-count">
          共 <strong>{{ filteredTemplates.length }}</strong> 个模板
        </div>
      </div>

      <!-- 模板列表 -->
      <div class="template-list">
        <a-spin :spinning="loading">
          <a-row :gutter="[16, 16]">
            <a-col
              v-for="template in paginatedTemplates"
              :key="template.id"
              :xs="24"
              :sm="12"
              :md="8"
              :lg="6"
            >
              <div
                class="template-card"
                :class="{ selected: selectedTemplate?.id === template.id }"
                @click="handleSelectTemplate(template)"
              >
                <div class="template-header">
                  <div class="template-icon">
                    <FileTextOutlined v-if="!template.icon" />
                    <component
                      :is="template.icon"
                      v-else
                    />
                  </div>
                  <div class="template-meta">
                    <a-tag
                      :color="getCategoryColor(template.category)"
                      size="small"
                    >
                      {{ getCategoryLabel(template.category) }}
                    </a-tag>
                  </div>
                </div>

                <div class="template-body">
                  <h4 class="template-title">
                    {{ template.display_name || template.name }}
                  </h4>
                  <p class="template-description">
                    {{ template.description || '暂无描述' }}
                  </p>
                </div>

                <div class="template-footer">
                  <div class="template-stats">
                    <span>
                      <EyeOutlined />
                      {{ template.usage_count || 0 }}
                    </span>
                    <span v-if="template.rating">
                      <StarFilled style="color: #faad14" />
                      {{ template.rating }}
                    </span>
                  </div>
                  <a-tag
                    v-if="template.source === 'builtin'"
                    color="blue"
                    size="small"
                  >
                    内置
                  </a-tag>
                </div>
              </div>
            </a-col>
          </a-row>

          <!-- 空状态 -->
          <a-empty
            v-if="filteredTemplates.length === 0"
            description="没有找到匹配的模板"
          />
        </a-spin>
      </div>

      <!-- 分页 -->
      <div
        v-if="filteredTemplates.length > pageSize"
        class="pagination-wrapper"
      >
        <a-pagination
          v-model:current="currentPage"
          v-model:page-size="pageSize"
          :total="filteredTemplates.length"
          :show-size-changer="true"
          :show-total="(total) => `共 ${total} 项`"
          :page-size-options="['12', '24', '48', '96']"
        />
      </div>

      <!-- 底部操作栏 -->
      <div class="modal-footer">
        <a-button @click="handleCancel">
          取消
        </a-button>
        <a-space>
          <a-button
            type="default"
            :disabled="!selectedTemplate"
            @click="handlePreview"
          >
            <EyeOutlined />
            预览模板
          </a-button>
          <a-button
            type="primary"
            :disabled="!selectedTemplate"
            @click="handleConfirm"
          >
            <CheckOutlined />
            使用此模板
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 模板预览抽屉 -->
    <a-drawer
      v-model:open="showPreviewDrawer"
      title="模板预览"
      :width="600"
      :destroy-on-close="true"
    >
      <div
        v-if="selectedTemplate"
        class="template-preview"
      >
        <a-descriptions
          :column="1"
          bordered
          size="small"
        >
          <a-descriptions-item label="模板名称">
            {{ selectedTemplate.display_name || selectedTemplate.name }}
          </a-descriptions-item>
          <a-descriptions-item label="分类">
            {{ getCategoryLabel(selectedTemplate.category) }}
            <span v-if="selectedTemplate.subcategory">
              / {{ selectedTemplate.subcategory }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="项目类型">
            {{ getProjectTypeLabel(selectedTemplate.project_type) }}
          </a-descriptions-item>
          <a-descriptions-item label="描述">
            {{ selectedTemplate.description || '暂无描述' }}
          </a-descriptions-item>
          <a-descriptions-item label="使用次数">
            {{ selectedTemplate.usage_count || 0 }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="selectedTemplate.tags?.length"
            label="标签"
          >
            <a-space>
              <a-tag
                v-for="tag in selectedTemplate.tags"
                :key="tag"
              >
                {{ tag }}
              </a-tag>
            </a-space>
          </a-descriptions-item>
        </a-descriptions>

        <a-divider>提示词模板</a-divider>
        <div class="prompt-template">
          <pre>{{ selectedTemplate.prompt_template || '暂无提示词模板' }}</pre>
        </div>

        <a-divider>变量定义</a-divider>
        <div class="template-variables">
          <a-table
            v-if="selectedTemplate.variables_schema?.length"
            :columns="variableColumns"
            :data-source="selectedTemplate.variables_schema"
            :pagination="false"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'required'">
                <a-tag :color="record.required ? 'red' : 'default'">
                  {{ record.required ? '必填' : '可选' }}
                </a-tag>
              </template>
            </template>
          </a-table>
          <a-empty
            v-else
            description="无变量定义"
            :image="simpleImage"
          />
        </div>
      </div>
    </a-drawer>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useTemplateStore } from '@/stores/template';
import {
  SearchOutlined,
  FileTextOutlined,
  EyeOutlined,
  StarFilled,
  CheckOutlined,
} from '@ant-design/icons-vue';
import { Empty } from 'ant-design-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: '选择项目模板',
  },
});

const emit = defineEmits(['cancel', 'confirm']);

const templateStore = useTemplateStore();
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

// 状态
const loading = ref(false);
const searchKeyword = ref('');
const selectedCategory = ref('');
const selectedProjectType = ref('');
const selectedTemplate = ref(null);
const showPreviewDrawer = ref(false);
const currentPage = ref(1);
const pageSize = ref(12);

// 分类选项
const categories = [
  // 职业专用分类
  { label: '🏥 医疗', value: 'medical' },
  { label: '⚖️ 法律', value: 'legal' },
  { label: '👨‍🏫 教育', value: 'education' },
  { label: '🔬 研究', value: 'research' },
  // 通用分类
  { label: '写作', value: 'writing' },
  { label: 'PPT', value: 'ppt' },
  { label: 'Excel', value: 'excel' },
  { label: 'Web开发', value: 'web' },
  { label: '设计', value: 'design' },
  { label: '数据分析', value: 'data-analysis' },
  { label: '报告', value: 'report' },
  { label: '代码', value: 'code' },
  { label: '文档', value: 'document' },
  { label: '其他', value: 'other' },
];

// 项目类型选项
const projectTypes = [
  { label: '文档', value: 'document' },
  { label: '演示文稿', value: 'presentation' },
  { label: '电子表格', value: 'spreadsheet' },
  { label: 'Web应用', value: 'web' },
  { label: '应用程序', value: 'app' },
  { label: '数据分析', value: 'data' },
];

// 变量表格列定义
const variableColumns = [
  { title: '变量名', dataIndex: 'name', key: 'name' },
  { title: '标签', dataIndex: 'label', key: 'label' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '是否必填', key: 'required', dataIndex: 'required' },
  { title: '默认值', dataIndex: 'default', key: 'default' },
];

// 过滤后的模板
const filteredTemplates = computed(() => {
  let result = templateStore.templates;

  // 按搜索关键词过滤
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.name?.toLowerCase().includes(keyword) ||
        t.display_name?.toLowerCase().includes(keyword) ||
        t.description?.toLowerCase().includes(keyword)
    );
  }

  // 按分类过滤
  if (selectedCategory.value) {
    result = result.filter((t) => t.category === selectedCategory.value);
  }

  // 按项目类型过滤
  if (selectedProjectType.value) {
    result = result.filter((t) => t.project_type === selectedProjectType.value);
  }

  return result;
});

// 分页后的模板
const paginatedTemplates = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  return filteredTemplates.value.slice(start, end);
});

// 加载模板
const loadTemplates = async () => {
  loading.value = true;
  try {
    await templateStore.fetchTemplates();
  } catch (error) {
    message.error('加载模板失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 处理搜索
const handleSearch = () => {
  currentPage.value = 1;
};

// 处理分类变更
const handleCategoryChange = () => {
  currentPage.value = 1;
};

// 处理项目类型变更
const handleProjectTypeChange = () => {
  currentPage.value = 1;
};

// 选择模板
const handleSelectTemplate = (template) => {
  selectedTemplate.value = template;
};

// 预览模板
const handlePreview = () => {
  if (!selectedTemplate.value) {
    message.warning('请先选择一个模板');
    return;
  }
  showPreviewDrawer.value = true;
};

// 确认选择
const handleConfirm = () => {
  if (!selectedTemplate.value) {
    message.warning('请先选择一个模板');
    return;
  }
  emit('confirm', selectedTemplate.value);
};

// 取消
const handleCancel = () => {
  emit('cancel');
};

// 获取分类颜色
const getCategoryColor = (category) => {
  const colorMap = {
    writing: 'blue',
    ppt: 'orange',
    excel: 'green',
    web: 'purple',
    design: 'pink',
    'data-analysis': 'cyan',
    report: 'geekblue',
    code: 'volcano',
    document: 'gold',
    other: 'default',
  };
  return colorMap[category] || 'default';
};

// 获取分类标签
const getCategoryLabel = (category) => {
  const categoryObj = categories.find((c) => c.value === category);
  return categoryObj ? categoryObj.label : category;
};

// 获取项目类型标签
const getProjectTypeLabel = (type) => {
  const typeObj = projectTypes.find((t) => t.value === type);
  return typeObj ? typeObj.label : type;
};

// 监听打开状态
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      // 打开时加载模板
      if (templateStore.templates.length === 0) {
        loadTemplates();
      }
      // 重置选择
      selectedTemplate.value = null;
      searchKeyword.value = '';
      selectedCategory.value = '';
      selectedProjectType.value = '';
      currentPage.value = 1;
    }
  }
);

// 组件挂载时加载模板
onMounted(() => {
  if (props.open && templateStore.templates.length === 0) {
    loadTemplates();
  }
});
</script>

<style scoped>
.template-selection-modal :deep(.ant-modal-body) {
  padding: 0;
}

.modal-content {
  display: flex;
  flex-direction: column;
  height: 70vh;
}

/* 筛选栏 */
.filter-bar {
  padding: 16px 24px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.template-count {
  margin-left: auto;
  color: #666;
  font-size: 14px;
}

.template-count strong {
  color: #1890ff;
  font-size: 16px;
}

/* 模板列表 */
.template-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.template-card {
  background: white;
  border: 2px solid #f0f0f0;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.template-card:hover {
  border-color: #1890ff;
  box-shadow: 0 4px 12px rgba(24, 144, 255, 0.15);
  transform: translateY(-2px);
}

.template-card.selected {
  border-color: #1890ff;
  background: #e6f7ff;
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.template-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 20px;
}

.template-body {
  flex: 1;
  margin-bottom: 12px;
}

.template-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-description {
  font-size: 13px;
  color: #6b7280;
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.template-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #666;
}

.template-stats span {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 分页 */
.pagination-wrapper {
  padding: 16px 24px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: center;
}

/* 底部操作栏 */
.modal-footer {
  padding: 12px 24px;
  background: #fafafa;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 模板预览 */
.template-preview {
  padding: 16px 0;
}

.prompt-template {
  background: #f5f5f5;
  border-radius: 4px;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.prompt-template pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.template-variables {
  margin-top: 12px;
}
</style>
