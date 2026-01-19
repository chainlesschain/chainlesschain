<template>
  <div class="prompt-templates-container">
    <a-card
      title="提示词模板库"
      :bordered="false"
    >
      <!-- 工具栏 -->
      <template #extra>
        <a-space>
          <a-input-search
            v-model:value="searchQuery"
            placeholder="搜索模板..."
            style="width: 250px"
            @search="handleSearch"
          >
            <template #enterButton>
              <a-button>
                <search-outlined />
              </a-button>
            </template>
          </a-input-search>

          <a-select
            v-model:value="selectedCategory"
            style="width: 150px"
            placeholder="选择分类"
            allow-clear
            @change="handleCategoryChange"
          >
            <a-select-option value="">
              全部分类
            </a-select-option>
            <a-select-option
              v-for="category in categories"
              :key="category"
              :value="category"
            >
              {{ getCategoryLabel(category) }}
            </a-select-option>
          </a-select>

          <a-button
            type="primary"
            @click="showCreateModal"
          >
            <plus-outlined /> 创建模板
          </a-button>

          <a-button @click="loadTemplates">
            <reload-outlined /> 刷新
          </a-button>
        </a-space>
      </template>

      <!-- 统计信息 -->
      <a-row
        :gutter="16"
        style="margin-bottom: 24px"
      >
        <a-col :span="6">
          <a-statistic
            title="模板总数"
            :value="statistics.total"
            :value-style="{ fontSize: '20px' }"
          >
            <template #prefix>
              <file-text-outlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="系统模板"
            :value="statistics.system"
            :value-style="{ fontSize: '20px', color: '#1890ff' }"
          >
            <template #prefix>
              <tag-outlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="自定义模板"
            :value="statistics.custom"
            :value-style="{ fontSize: '20px', color: '#52c41a' }"
          >
            <template #prefix>
              <user-outlined />
            </template>
          </a-statistic>
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="使用次数"
            :value="totalUsageCount"
            :value-style="{ fontSize: '20px', color: '#faad14' }"
          >
            <template #prefix>
              <line-chart-outlined />
            </template>
          </a-statistic>
        </a-col>
      </a-row>

      <!-- 模板标签页 -->
      <a-tabs
        v-model:active-key="activeTab"
        @change="handleTabChange"
      >
        <a-tab-pane
          key="all"
          tab="全部模板"
        >
          <template-list
            :templates="filteredTemplates"
            :loading="loading"
            @use="handleUseTemplate"
            @edit="handleEditTemplate"
            @delete="handleDeleteTemplate"
            @export="handleExportTemplate"
          />
        </a-tab-pane>

        <a-tab-pane
          key="system"
          tab="系统模板"
        >
          <template-list
            :templates="systemTemplates"
            :loading="loading"
            @use="handleUseTemplate"
          />
        </a-tab-pane>

        <a-tab-pane
          key="custom"
          tab="自定义模板"
        >
          <template-list
            :templates="customTemplates"
            :loading="loading"
            @use="handleUseTemplate"
            @edit="handleEditTemplate"
            @delete="handleDeleteTemplate"
            @export="handleExportTemplate"
          />
        </a-tab-pane>

        <a-tab-pane
          key="most-used"
          tab="常用模板"
        >
          <template-list
            :templates="mostUsedTemplates"
            :loading="loading"
            @use="handleUseTemplate"
            @edit="handleEditTemplate"
            @delete="handleDeleteTemplate"
          />
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 创建/编辑模板对话框 -->
    <a-modal
      v-model:open="templateModalVisible"
      :title="editingTemplate ? '编辑模板' : '创建模板'"
      width="800px"
      @ok="handleSaveTemplate"
      @cancel="handleCancelTemplate"
    >
      <a-form
        :model="templateForm"
        layout="vertical"
      >
        <a-form-item
          label="模板名称"
          required
        >
          <a-input
            v-model:value="templateForm.name"
            placeholder="输入模板名称"
          />
        </a-form-item>

        <a-form-item label="模板描述">
          <a-textarea
            v-model:value="templateForm.description"
            placeholder="输入模板描述"
            :rows="2"
          />
        </a-form-item>

        <a-form-item label="分类">
          <a-select
            v-model:value="templateForm.category"
            placeholder="选择分类"
          >
            <a-select-option value="general">
              通用
            </a-select-option>
            <a-select-option value="writing">
              写作
            </a-select-option>
            <a-select-option value="translation">
              翻译
            </a-select-option>
            <a-select-option value="analysis">
              分析
            </a-select-option>
            <a-select-option value="programming">
              编程
            </a-select-option>
            <a-select-option value="creative">
              创意
            </a-select-option>
            <a-select-option value="qa">
              问答
            </a-select-option>
            <a-select-option value="rag">
              RAG
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          label="模板内容"
          required
        >
          <a-textarea
            v-model:value="templateForm.template"
            placeholder="输入模板内容，使用 {{变量名}} 定义变量"
            :rows="8"
            @change="extractVariables"
          />
          <div style="margin-top: 8px; color: #666; font-size: 12px">
            提示：使用 {{ 变量名 }} 定义变量，例如 {{ content }}, {{ question }}
          </div>
        </a-form-item>

        <a-form-item label="变量列表">
          <a-tag
            v-for="variable in templateForm.variables"
            :key="variable"
            color="blue"
            style="margin-right: 8px; margin-bottom: 8px"
          >
            {{ variable }}
          </a-tag>
          <span
            v-if="templateForm.variables.length === 0"
            style="color: #999"
          >
            暂无变量
          </span>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 使用模板对话框 -->
    <a-modal
      v-model:open="useTemplateModalVisible"
      title="使用模板"
      width="800px"
      @ok="handleFillTemplate"
      @cancel="useTemplateModalVisible = false"
    >
      <div v-if="currentTemplate">
        <a-alert
          :message="currentTemplate.name"
          :description="currentTemplate.description"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />

        <a-form layout="vertical">
          <a-form-item
            v-for="variable in currentTemplate.variables"
            :key="variable"
            :label="variable"
            required
          >
            <a-textarea
              v-model:value="variableValues[variable]"
              :placeholder="`输入 ${variable} 的值`"
              :rows="3"
            />
          </a-form-item>
        </a-form>

        <a-divider>预览</a-divider>

        <div
          v-if="filledPrompt"
          style="
            background: #f5f5f5;
            padding: 16px;
            border-radius: 4px;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
          "
        >
          {{ filledPrompt }}
        </div>
      </div>
    </a-modal>

    <!-- 导入模板对话框 -->
    <a-modal
      v-model:open="importModalVisible"
      title="导入模板"
      @ok="handleImportTemplate"
      @cancel="importModalVisible = false"
    >
      <a-textarea
        v-model:value="importData"
        placeholder="粘贴导出的模板 JSON 数据"
        :rows="10"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, toRaw } from 'vue';
import { message } from 'ant-design-vue';
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  FileTextOutlined,
  TagOutlined,
  UserOutlined,
  LineChartOutlined,
} from '@ant-design/icons-vue';
import TemplateList from './PromptTemplateList.vue';

// 数据状态
const loading = ref(false);
const templates = ref([]);
const categories = ref([]);
const statistics = ref({
  total: 0,
  system: 0,
  custom: 0,
  byCategory: {},
  mostUsed: [],
});

// 筛选和搜索
const searchQuery = ref('');
const selectedCategory = ref('');
const activeTab = ref('all');

// 模板表单
const templateModalVisible = ref(false);
const editingTemplate = ref(null);
const templateForm = ref({
  name: '',
  description: '',
  template: '',
  category: 'general',
  variables: [],
});

// 使用模板
const useTemplateModalVisible = ref(false);
const currentTemplate = ref(null);
const variableValues = ref({});
const filledPrompt = ref('');

// 导入
const importModalVisible = ref(false);
const importData = ref('');

// 计算属性
const filteredTemplates = computed(() => {
  let result = templates.value;

  if (selectedCategory.value) {
    result = result.filter(t => t.category === selectedCategory.value);
  }

  return result;
});

const systemTemplates = computed(() => {
  return templates.value.filter(t => t.is_system);
});

const customTemplates = computed(() => {
  return templates.value.filter(t => !t.is_system);
});

const mostUsedTemplates = computed(() => {
  return [...templates.value].sort((a, b) => b.usage_count - a.usage_count).slice(0, 10);
});

const totalUsageCount = computed(() => {
  return templates.value.reduce((sum, t) => sum + t.usage_count, 0);
});

// 方法
const loadTemplates = async () => {
  loading.value = true;
  try {
    templates.value = await window.electronAPI.promptTemplate.getAll();
    categories.value = await window.electronAPI.promptTemplate.getCategories();
    statistics.value = await window.electronAPI.promptTemplate.getStatistics();
  } catch (error) {
    console.error('加载模板失败:', error);
    message.error('加载模板失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const handleSearch = async () => {
  if (!searchQuery.value.trim()) {
    await loadTemplates();
    return;
  }

  loading.value = true;
  try {
    templates.value = await window.electronAPI.promptTemplate.search(searchQuery.value);
    message.info(`找到 ${templates.value.length} 个模板`);
  } catch (error) {
    console.error('搜索失败:', error);
    message.error('搜索失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const handleCategoryChange = () => {
  // 分类变化时重新加载
  loadTemplates();
};

const handleTabChange = () => {
  // 标签页变化时清空搜索
  searchQuery.value = '';
  selectedCategory.value = '';
};

const showCreateModal = () => {
  editingTemplate.value = null;
  templateForm.value = {
    name: '',
    description: '',
    template: '',
    category: 'general',
    variables: [],
  };
  templateModalVisible.value = true;
};

const handleEditTemplate = async (template) => {
  editingTemplate.value = template;
  templateForm.value = {
    name: template.name,
    description: template.description,
    template: template.template,
    category: template.category,
    variables: [...template.variables],
  };
  templateModalVisible.value = true;
};

const buildTemplatePayload = () => {
  const raw = toRaw(templateForm.value);
  return {
    name: raw.name || '',
    description: raw.description || '',
    template: raw.template || '',
    category: raw.category || 'general',
    variables: Array.isArray(raw.variables) ? [...raw.variables] : [],
  };
};

const handleSaveTemplate = async () => {
  if (!templateForm.value.name || !templateForm.value.template) {
    message.warning('请填写模板名称和内容');
    return;
  }

  try {
    const payload = buildTemplatePayload();
    if (editingTemplate.value) {
      // 更新
      await window.electronAPI.promptTemplate.update(
        editingTemplate.value.id,
        payload
      );
      message.success('模板已更新');
    } else {
      // 创建
      await window.electronAPI.promptTemplate.create(payload);
      message.success('模板已创建');
    }

    templateModalVisible.value = false;
    await loadTemplates();
  } catch (error) {
    console.error('保存模板失败:', error);
    message.error('保存模板失败: ' + error.message);
  }
};

const handleCancelTemplate = () => {
  templateModalVisible.value = false;
  editingTemplate.value = null;
};

const handleDeleteTemplate = async (template) => {
  try {
    await window.electronAPI.promptTemplate.delete(template.id);
    message.success('模板已删除');
    await loadTemplates();
  } catch (error) {
    console.error('删除模板失败:', error);
    message.error('删除模板失败: ' + error.message);
  }
};

const handleUseTemplate = (template) => {
  currentTemplate.value = template;
  variableValues.value = {};

  // 初始化变量值
  template.variables.forEach(v => {
    variableValues.value[v] = '';
  });

  useTemplateModalVisible.value = true;
};

const handleFillTemplate = async () => {
  try {
    const values = { ...toRaw(variableValues.value) };
    filledPrompt.value = await window.electronAPI.promptTemplate.fill(
      currentTemplate.value.id,
      values
    );

    // 复制到剪贴板
    await navigator.clipboard.writeText(filledPrompt.value);
    message.success('提示词已生成并复制到剪贴板');

    useTemplateModalVisible.value = false;
    await loadTemplates(); // 刷新使用次数
  } catch (error) {
    console.error('填充模板失败:', error);
    message.error('填充模板失败: ' + error.message);
  }
};

const handleExportTemplate = async (template) => {
  try {
    const exportData = await window.electronAPI.promptTemplate.export(template.id);
    const jsonString = JSON.stringify(exportData, null, 2);

    await navigator.clipboard.writeText(jsonString);
    message.success('模板已导出到剪贴板');
  } catch (error) {
    console.error('导出模板失败:', error);
    message.error('导出模板失败: ' + error.message);
  }
};

const showImportModal = () => {
  importData.value = '';
  importModalVisible.value = true;
};

const handleImportTemplate = async () => {
  try {
    const data = JSON.parse(importData.value);
    await window.electronAPI.promptTemplate.import(data);
    message.success('模板已导入');
    importModalVisible.value = false;
    await loadTemplates();
  } catch (error) {
    console.error('导入模板失败:', error);
    message.error('导入模板失败: ' + error.message);
  }
};

const extractVariables = () => {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = templateForm.value.template.matchAll(regex);
  const variables = new Set();

  for (const match of matches) {
    variables.add(match[1].trim());
  }

  templateForm.value.variables = Array.from(variables);
};

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

// 监听变量值变化，实时预览
watch(variableValues, () => {
  if (!currentTemplate.value) {return;}

  let result = currentTemplate.value.template;

  for (const [key, value] of Object.entries(variableValues.value)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || `{{${key}}}`);
  }

  filledPrompt.value = result;
}, { deep: true });

// 组件挂载时加载数据
onMounted(() => {
  loadTemplates();
});
</script>

<style scoped>
.prompt-templates-container {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

:deep(.ant-card-head-title) {
  font-weight: 600;
}

:deep(.ant-statistic-title) {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
}

:deep(.ant-tabs-tab) {
  font-size: 15px;
}
</style>
