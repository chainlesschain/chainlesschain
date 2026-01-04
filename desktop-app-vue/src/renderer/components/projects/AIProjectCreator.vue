<template>
  <div class="ai-project-creator">
    <div class="creator-container">
      <!-- 说明 -->
      <div class="creator-header">
        <h2>
          <RobotOutlined />
          AI辅助项目创建
        </h2>
        <p>用自然语言描述您的需求，AI将为您生成完整的项目结构和代码</p>
      </div>

      <!-- 模板选择区域 -->
      <div class="template-section">
        <div class="section-header">
          <h3>快速开始</h3>
          <a-button type="link" @click="showTemplateModal = true">
            <FileTextOutlined />
            浏览所有模板
          </a-button>
        </div>

        <!-- 已选择的模板 -->
        <div v-if="selectedTemplate" class="selected-template-banner">
          <div class="banner-content">
            <div class="banner-icon">
              <CheckCircleFilled style="color: #52c41a; font-size: 24px" />
            </div>
            <div class="banner-info">
              <div class="banner-title">
                已选择模板：{{ selectedTemplate.display_name || selectedTemplate.name }}
              </div>
              <div class="banner-description">
                {{ selectedTemplate.description }}
              </div>
            </div>
            <a-button type="text" danger @click="clearTemplate">
              <CloseCircleOutlined />
              清除
            </a-button>
          </div>
        </div>

        <!-- 示例卡片 -->
        <div class="examples-section">
          <a-row :gutter="[16, 16]">
            <a-col :span="8" v-for="example in examples" :key="example.title">
              <div class="example-card" @click="fillExample(example)">
                <div class="example-icon">
                  <component :is="example.icon" />
                </div>
                <h4>{{ example.title }}</h4>
                <p>{{ example.description }}</p>
              </div>
            </a-col>
          </a-row>
        </div>
      </div>

      <!-- 创建表单 -->
      <a-form
        :model="formData"
        :rules="rules"
        layout="vertical"
        @finish="handleSubmit"
        ref="formRef"
      >
        <!-- 需求描述 -->
        <a-form-item label="需求描述" name="userPrompt" required>
          <a-textarea
            v-model:value="formData.userPrompt"
            placeholder="详细描述您的项目需求，包括功能、技术栈、设计风格等..."
            :rows="8"
            :maxlength="1000"
            show-count
          />
          <div class="form-hint">
            提示：描述越详细，AI生成的项目越符合您的需求
          </div>
        </a-form-item>

        <a-row :gutter="16">
          <!-- 项目名称 -->
          <a-col :span="12">
            <a-form-item label="项目名称（可选）" name="name">
              <a-input
                v-model:value="formData.name"
                placeholder="留空由AI自动生成"
              />
            </a-form-item>
          </a-col>

          <!-- 项目类型 -->
          <a-col :span="12">
            <a-form-item label="项目类型" name="projectType" required>
              <a-select v-model:value="formData.projectType" placeholder="选择项目类型">
                <a-select-option value="web">
                  <CodeOutlined /> Web开发
                </a-select-option>
                <a-select-option value="document">
                  <FileTextOutlined /> 文档处理
                </a-select-option>
                <a-select-option value="data">
                  <BarChartOutlined /> 数据分析
                </a-select-option>
                <a-select-option value="app">
                  <AppstoreOutlined /> 应用开发
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <!-- 技能和工具选择（可选） -->
        <a-form-item label="技能和工具配置（可选）">
          <a-collapse :bordered="false" ghost>
            <a-collapse-panel key="1" header="配置可用的技能和工具">
              <SkillToolSelector
                v-model="selectedSkillsAndTools"
                :project-type="formData.projectType"
              />
            </a-collapse-panel>
          </a-collapse>
        </a-form-item>

        <!-- 提交按钮 -->
        <a-form-item>
          <div class="form-actions">
            <a-button type="primary" html-type="submit" size="large" :loading="creating">
              <RobotOutlined />
              创建项目
            </a-button>
            <a-button size="large" @click="handleReset">
              重置
            </a-button>
          </div>
        </a-form-item>
      </a-form>
    </div>

    <!-- 模板选择对话框 -->
    <TemplateSelectionModal
      :open="showTemplateModal"
      @confirm="handleTemplateConfirm"
      @cancel="handleTemplateCancel"
    />
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { message } from 'ant-design-vue';
import { useAuthStore } from '@/stores/auth';
import { useTemplateStore } from '@/stores/template';
import {
  RobotOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
} from '@ant-design/icons-vue';
import TemplateSelectionModal from './TemplateSelectionModal.vue';
import SkillToolSelector from './SkillToolSelector.vue';

const emit = defineEmits(['create']);
const authStore = useAuthStore();
const templateStore = useTemplateStore();

// 响应式状态
const formRef = ref(null);
const creating = ref(false);
const showTemplateModal = ref(false);
const selectedTemplate = ref(null);
const templateVariables = ref({});
const selectedSkillsAndTools = ref({
  skills: [],
  tools: [],
});

const formData = reactive({
  userPrompt: '',
  name: '',
  projectType: '', // 留空让后端AI自动识别项目类型
});

// 表单验证规则
const rules = {
  userPrompt: [
    { required: true, message: '请输入项目需求描述', trigger: 'blur' },
    { min: 20, message: '需求描述至少20个字符', trigger: 'blur' },
  ],
  // projectType不再必填，留空时让后端AI自动识别
};

// 示例需求
const examples = [
  {
    title: 'Todo应用',
    description: '创建一个待办事项管理应用',
    icon: CodeOutlined,
    prompt: '创建一个现代化的待办事项管理应用，使用Vue3 + TypeScript开发。功能包括：添加、删除、编辑任务，设置优先级，标记完成状态，支持分类和搜索。界面要简洁美观，支持暗黑模式。',
    type: 'web',
  },
  {
    title: '博客系统',
    description: '个人技术博客网站',
    icon: FileTextOutlined,
    prompt: '开发一个个人技术博客系统，支持Markdown编写文章，代码高亮显示，文章分类和标签，评论功能，全文搜索。界面采用简约风格，响应式设计支持移动端访问。',
    type: 'web',
  },
  {
    title: '数据看板',
    description: '数据可视化分析看板',
    icon: BarChartOutlined,
    prompt: '构建一个数据可视化分析看板，展示销售数据、用户增长、收入趋势等指标。使用ECharts图表库，包含折线图、柱状图、饼图、地图等多种图表类型，支持时间范围筛选和数据导出。',
    type: 'data',
  },
];

// 填充示例
const fillExample = (example) => {
  formData.userPrompt = example.prompt;
  formData.projectType = example.type;
  formData.name = '';
};

// 提交表单
const handleSubmit = async () => {
  creating.value = true;

  // 构建 createData，避免传递 undefined 值（Electron IPC 不支持）
  const createData = {
    userPrompt: formData.userPrompt || '',  // 确保不是 undefined
    projectType: formData.projectType || 'general',  // 使用驼峰命名与后端一致，确保有默认值
    userId: authStore.currentUser?.id || 'default-user',
  };

  // 只有当 name 有值时才添加到 createData
  if (formData.name && formData.name.trim()) {
    createData.name = formData.name.trim();
  }

  // 添加技能和工具配置
  if (selectedSkillsAndTools.value.skills.length > 0) {
    createData.skills = selectedSkillsAndTools.value.skills;
  }
  if (selectedSkillsAndTools.value.tools.length > 0) {
    createData.tools = selectedSkillsAndTools.value.tools;
  }

  // 如果有选择的模板，也添加到 createData
  if (selectedTemplate.value) {
    createData.templateId = selectedTemplate.value.id;
  }

  emit('create', createData);

  // 延迟重置creating状态，等待父组件显示进度
  setTimeout(() => {
    creating.value = false;
  }, 500);
};

// 重置表单
const handleReset = () => {
  formRef.value?.resetFields();
  clearTemplate();
};

// 处理模板选择确认
const handleTemplateConfirm = async (template) => {
  try {
    selectedTemplate.value = template;
    showTemplateModal.value = false;

    // 如果模板有变量定义，需要先收集变量值
    if (template.variables && template.variables.length > 0) {
      // 初始化变量默认值
      templateVariables.value = {};
      template.variables.forEach((variable) => {
        templateVariables.value[variable.name] = variable.default || '';
      });

      // 渲染提示词模板（使用默认值）
      await renderAndFillPrompt();
    } else {
      // 没有变量，直接使用提示词模板
      formData.userPrompt = template.prompt_template || '';
    }

    // 设置项目类型
    if (template.project_type) {
      formData.projectType = template.project_type;
    }

    // 设置建议的项目名称
    if (!formData.name) {
      formData.name = `基于${template.display_name || template.name}的新项目`;
    }

    message.success(`已选择模板：${template.display_name || template.name}`);
  } catch (error) {
    console.error('处理模板选择失败:', error);
    message.error('处理模板失败：' + error.message);
  }
};

// 渲染并填充提示词
const renderAndFillPrompt = async () => {
  try {
    if (!selectedTemplate.value) return;

    const renderedPrompt = await templateStore.renderPrompt(
      selectedTemplate.value.id,
      templateVariables.value
    );
    formData.userPrompt = renderedPrompt;
  } catch (error) {
    console.error('渲染提示词失败:', error);
    // 如果渲染失败，直接使用原始模板
    formData.userPrompt = selectedTemplate.value.prompt_template || '';
  }
};

// 清除模板选择
const clearTemplate = () => {
  selectedTemplate.value = null;
  templateVariables.value = {};
  formData.userPrompt = '';
  formData.projectType = '';
};

// 取消模板选择
const handleTemplateCancel = () => {
  showTemplateModal.value = false;
};
</script>

<style scoped>
.ai-project-creator {
  max-width: 900px;
  margin: 0 auto;
}

.creator-container {
  padding: 20px 0;
}

/* 头部 */
.creator-header {
  margin-bottom: 32px;
  text-align: center;
}

.creator-header h2 {
  font-size: 28px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.creator-header h2 :deep(.anticon) {
  font-size: 32px;
  color: #667eea;
}

.creator-header p {
  font-size: 16px;
  color: #6b7280;
  margin: 0;
}

/* 模板选择区域 */
.template-section {
  margin-bottom: 40px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h3 {
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  margin: 0;
}

/* 已选择模板横幅 */
.selected-template-banner {
  background: linear-gradient(135deg, #e6f7ff 0%, #f0f9ff 100%);
  border: 2px solid #91d5ff;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.banner-icon {
  flex-shrink: 0;
}

.banner-info {
  flex: 1;
}

.banner-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 4px;
}

.banner-description {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
}

/* 示例卡片 */
.examples-section {
  margin-bottom: 16px;
}

.examples-section h3 {
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 16px 0;
}

.example-card {
  background: #f9fafb;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s;
  border: 2px solid transparent;
  height: 100%;
}

.example-card:hover {
  background: white;
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  transform: translateY(-2px);
}

.example-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}

.example-icon :deep(.anticon) {
  font-size: 24px;
  color: white;
}

.example-card h4 {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.example-card p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

/* 表单 */
.form-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #9ca3af;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding-top: 24px;
}
</style>
