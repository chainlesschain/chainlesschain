<template>
  <div class="manual-project-form">
    <div class="form-container">
      <!-- 说明 -->
      <div class="form-header">
        <h2>
          <FormOutlined />
          手动创建项目
        </h2>
        <p>选择项目类型和模板，快速创建项目</p>
      </div>

      <!-- 表单 -->
      <a-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        layout="vertical"
        @finish="handleSubmit"
      >
        <!-- 项目名称 -->
        <a-form-item
          label="项目名称"
          name="name"
          required
        >
          <a-input
            v-model:value="formData.name"
            placeholder="输入项目名称"
            size="large"
          />
        </a-form-item>

        <!-- 项目描述 -->
        <a-form-item
          label="项目描述"
          name="description"
        >
          <a-textarea
            v-model:value="formData.description"
            placeholder="简要描述项目用途和目标..."
            :rows="3"
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <!-- 项目类型 -->
        <a-form-item
          label="项目类型"
          name="projectType"
          required
        >
          <div class="project-type-grid">
            <div
              v-for="type in projectTypes"
              :key="type.type"
              class="project-type-card"
              :class="{ 'selected': formData.projectType === type.type }"
              @click="selectProjectType(type.type)"
            >
              <div class="type-icon" :style="{ backgroundColor: type.color + '20', color: type.color }">
                <component :is="getIconComponent(type.icon)" />
              </div>
              <div class="type-info">
                <div class="type-name">{{ type.name }}</div>
                <div class="type-desc">{{ type.description }}</div>
              </div>
            </div>
          </div>
        </a-form-item>

        <!-- 模板选择 -->
        <a-form-item
          label="选择模板"
          name="templateId"
        >
          <div class="template-section">
            <div class="template-tabs">
              <a-radio-group v-model:value="templateFilter" size="small">
                <a-radio-button value="all">全部</a-radio-button>
                <a-radio-button value="recommended">推荐</a-radio-button>
                <a-radio-button value="custom">自定义</a-radio-button>
              </a-radio-group>
            </div>

            <div class="template-list">
              <div
                v-for="template in filteredTemplates"
                :key="template.id"
                class="template-card"
                :class="{ 'selected': formData.templateId === template.id }"
                @click="selectTemplate(template)"
              >
                <div class="template-icon">
                  <component :is="getIconComponent(template.icon)" />
                </div>
                <div class="template-info">
                  <div class="template-name">{{ template.name }}</div>
                  <div class="template-desc">{{ template.description }}</div>
                  <div class="template-tags" v-if="template.tags && template.tags.length">
                    <a-tag v-for="tag in template.tags.slice(0, 3)" :key="tag" size="small">
                      {{ tag }}
                    </a-tag>
                  </div>
                </div>
                <div class="template-badge" v-if="template.isCustom">
                  <a-tag color="orange" size="small">自定义</a-tag>
                </div>
              </div>
            </div>

            <!-- 模板预览 -->
            <div class="template-preview" v-if="selectedTemplatePreview">
              <div class="preview-header">
                <span>模板预览</span>
                <a-button type="link" size="small" @click="showFullPreview = true">
                  查看详情
                </a-button>
              </div>
              <div class="preview-tree">
                <a-tree
                  :tree-data="selectedTemplatePreview.fileTree"
                  :default-expand-all="true"
                  :selectable="false"
                >
                  <template #title="{ name, type }">
                    <span class="tree-node">
                      <FolderOutlined v-if="type === 'directory'" />
                      <FileOutlined v-else />
                      {{ name }}
                    </span>
                  </template>
                </a-tree>
              </div>
            </div>
          </div>
        </a-form-item>

        <!-- 项目标签 -->
        <a-form-item
          label="项目标签"
          name="tags"
        >
          <a-select
            v-model:value="formData.tags"
            mode="tags"
            placeholder="添加标签（回车添加）"
            size="large"
            :options="commonTags"
          />
          <div class="form-hint">
            为项目添加标签便于分类和搜索
          </div>
        </a-form-item>

        <!-- 初始状态 -->
        <a-form-item
          label="初始状态"
          name="status"
        >
          <a-radio-group v-model:value="formData.status">
            <a-radio value="draft">
              草稿
            </a-radio>
            <a-radio value="active">
              进行中
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <!-- 提交按钮 -->
        <a-form-item>
          <div class="form-actions">
            <a-button
              type="primary"
              html-type="submit"
              size="large"
              :loading="creating"
            >
              <PlusOutlined />
              创建项目
            </a-button>
            <a-button
              size="large"
              @click="handleReset"
            >
              重置
            </a-button>
          </div>
        </a-form-item>
      </a-form>
    </div>

    <!-- 模板详情弹窗 -->
    <a-modal
      v-model:open="showFullPreview"
      title="模板详情"
      width="600px"
      :footer="null"
    >
      <div v-if="selectedTemplatePreview" class="full-preview">
        <div class="preview-info">
          <h3>{{ selectedTemplatePreview.name }}</h3>
          <p>{{ selectedTemplatePreview.description }}</p>
          <div class="preview-stats">
            <span><FolderOutlined /> {{ selectedTemplatePreview.directoryCount }} 个目录</span>
            <span><FileOutlined /> {{ selectedTemplatePreview.fileCount }} 个文件</span>
          </div>
        </div>
        <a-divider />
        <div class="preview-tree-full">
          <a-tree
            :tree-data="selectedTemplatePreview.fileTree"
            :default-expand-all="true"
            :selectable="false"
          >
            <template #title="{ name, type }">
              <span class="tree-node">
                <FolderOutlined v-if="type === 'directory'" />
                <FileOutlined v-else />
                {{ name }}
              </span>
            </template>
          </a-tree>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  FormOutlined,
  PlusOutlined,
  FolderOutlined,
  FileOutlined,
  AndroidOutlined,
  AppleOutlined,
  GlobalOutlined,
  DesktopOutlined,
  ApiOutlined,
  BarChartOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  ClusterOutlined,
  ToolOutlined,
  FolderOpenOutlined,
  CodeOutlined,
  AppstoreOutlined,
} from '@ant-design/icons-vue';

const emit = defineEmits(['create']);
const authStore = useAuthStore();

// 响应式状态
const formRef = ref(null);
const creating = ref(false);
const templateFilter = ref('all');
const showFullPreview = ref(false);
const selectedTemplatePreview = ref(null);
const templates = ref([]);
const projectTypes = ref([]);

const formData = reactive({
  name: '',
  description: '',
  projectType: 'web',
  templateId: '',
  tags: [],
  status: 'active',
});

// 项目类型到图标的映射
const iconMap = {
  'android': AndroidOutlined,
  'apple': AppleOutlined,
  'global': GlobalOutlined,
  'desktop': DesktopOutlined,
  'api': ApiOutlined,
  'bar-chart': BarChartOutlined,
  'file-text': FileTextOutlined,
  'thunderbolt': ThunderboltOutlined,
  'robot': RobotOutlined,
  'cluster': ClusterOutlined,
  'tool': ToolOutlined,
  'folder': FolderOpenOutlined,
  'code': CodeOutlined,
  'mobile': AppstoreOutlined,
  'cloud-server': ApiOutlined,
  'fund': BarChartOutlined,
  'node': CodeOutlined,
  'react': CodeOutlined,
  'vue': CodeOutlined,
  'python': CodeOutlined,
  'kotlin': CodeOutlined,
  'spring': CodeOutlined,
  'flutter': AppstoreOutlined,
  'express': CodeOutlined,
  'file': FileTextOutlined,
};

// 获取图标组件
const getIconComponent = (iconName) => {
  return iconMap[iconName] || FolderOpenOutlined;
};

// 表单验证规则
const rules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { min: 2, max: 100, message: '项目名称长度应在2-100个字符之间', trigger: 'blur' },
  ],
  description: [
    { max: 500, message: '描述不能超过500个字符', trigger: 'blur' },
  ],
  projectType: [
    { required: true, message: '请选择项目类型', trigger: 'change' },
  ],
};

// 常用标签
const commonTags = [
  { value: 'vue', label: 'Vue' },
  { value: 'react', label: 'React' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'node', label: 'Node.js' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
  { value: 'flutter', label: 'Flutter' },
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'fullstack', label: '全栈' },
  { value: 'mobile', label: '移动端' },
  { value: 'desktop', label: '桌面端' },
  { value: 'ai', label: 'AI' },
  { value: 'ml', label: '机器学习' },
  { value: 'data', label: '数据分析' },
  { value: 'iot', label: 'IoT' },
  { value: 'api', label: 'API' },
  { value: 'game', label: '游戏' },
];

// 过滤后的模板列表
const filteredTemplates = computed(() => {
  let result = templates.value;

  // 按项目类型筛选
  if (formData.projectType) {
    result = result.filter(t => t.projectType === formData.projectType || !t.projectType);
  }

  // 按筛选条件筛选
  if (templateFilter.value === 'recommended') {
    // 推荐模板逻辑
    result = result.slice(0, 5);
  } else if (templateFilter.value === 'custom') {
    result = result.filter(t => t.isCustom);
  }

  return result;
});

// 选择项目类型
const selectProjectType = (type) => {
  formData.projectType = type;
  formData.templateId = ''; // 清空已选模板
  selectedTemplatePreview.value = null;
};

// 选择模板
const selectTemplate = async (template) => {
  formData.templateId = template.id;

  // 获取模板预览
  try {
    const result = await window.electronAPI?.invoke('template-library:preview', template.id);
    if (result && result.success) {
      selectedTemplatePreview.value = result.preview;
    }
  } catch (error) {
    console.error('获取模板预览失败:', error);
  }
};

// 加载项目类型和模板
const loadData = async () => {
  try {
    // 加载项目类型
    const typesResult = await window.electronAPI?.invoke('project-types:get-all');
    if (typesResult && typesResult.success) {
      projectTypes.value = typesResult.projectTypes;
    } else {
      // 使用默认的12种项目类型
      projectTypes.value = [
        { type: 'android', name: 'Android应用', icon: 'android', description: 'Android移动应用开发', color: '#3DDC84' },
        { type: 'ios', name: 'iOS应用', icon: 'apple', description: 'iOS移动应用开发', color: '#007AFF' },
        { type: 'web', name: 'Web应用', icon: 'global', description: 'Web前端或全栈应用', color: '#61DAFB' },
        { type: 'desktop', name: '桌面应用', icon: 'desktop', description: '跨平台桌面应用', color: '#9B59B6' },
        { type: 'api', name: 'API服务', icon: 'api', description: '后端API服务开发', color: '#27AE60' },
        { type: 'data', name: '数据分析', icon: 'bar-chart', description: '数据分析与可视化', color: '#F39C12' },
        { type: 'document', name: '文档项目', icon: 'file-text', description: '文档编写与管理', color: '#3498DB' },
        { type: 'game', name: '游戏开发', icon: 'thunderbolt', description: '游戏应用开发', color: '#E74C3C' },
        { type: 'ai', name: 'AI/ML项目', icon: 'robot', description: '人工智能与机器学习', color: '#8E44AD' },
        { type: 'iot', name: 'IoT项目', icon: 'cluster', description: '物联网应用开发', color: '#1ABC9C' },
        { type: 'embedded', name: '嵌入式开发', icon: 'tool', description: '嵌入式系统开发', color: '#34495E' },
        { type: 'other', name: '其他', icon: 'folder', description: '其他类型项目', color: '#95A5A6' },
      ];
    }

    // 加载模板
    const templatesResult = await window.electronAPI?.invoke('template:get-all');
    if (templatesResult && templatesResult.success) {
      templates.value = templatesResult.templates;
    } else {
      // 使用默认模板
      templates.value = [
        { id: 'empty', name: '空白项目', description: '一个空白项目', icon: 'file', projectType: 'other', tags: ['blank'] },
        { id: 'react-webapp', name: 'React Web应用', description: 'React + TypeScript + Vite', icon: 'react', projectType: 'web', tags: ['react', 'vite'] },
        { id: 'vue-webapp', name: 'Vue Web应用', description: 'Vue 3 + TypeScript + Vite', icon: 'vue', projectType: 'web', tags: ['vue', 'vite'] },
        { id: 'nodejs-api', name: 'Node.js API', description: 'Express + TypeScript', icon: 'node', projectType: 'api', tags: ['node', 'express'] },
        { id: 'python-datascience', name: 'Python数据科学', description: 'Jupyter + Pandas', icon: 'python', projectType: 'data', tags: ['python', 'jupyter'] },
        { id: 'android-app', name: 'Android应用', description: 'Kotlin MVVM', icon: 'android', projectType: 'android', tags: ['kotlin', 'android'] },
        { id: 'flutter-app', name: 'Flutter应用', description: '跨平台移动应用', icon: 'flutter', projectType: 'android', tags: ['flutter', 'dart'] },
        { id: 'spring-boot', name: 'Spring Boot API', description: 'Spring Boot + Kotlin', icon: 'spring', projectType: 'api', tags: ['spring', 'kotlin'] },
        { id: 'express-api', name: 'Express API', description: 'Express.js 轻量API', icon: 'express', projectType: 'api', tags: ['express', 'javascript'] },
        { id: 'django-web', name: 'Django Web应用', description: 'Python Web框架', icon: 'python', projectType: 'web', tags: ['django', 'python'] },
        { id: 'kotlin-multiplatform', name: 'Kotlin Multiplatform', description: '跨平台Kotlin项目', icon: 'kotlin', projectType: 'desktop', tags: ['kotlin', 'kmp'] },
      ];
    }
  } catch (error) {
    console.error('加载数据失败:', error);
  }
};

// 提交表单
const handleSubmit = async () => {
  creating.value = true;

  try {
    // 如果选择了模板，使用模板创建
    if (formData.templateId) {
      const result = await window.electronAPI?.invoke('project:create-from-template', {
        templateId: formData.templateId,
        name: formData.name,
        description: formData.description,
        userId: authStore.currentUser?.id || 'default-user',
      });

      if (result && result.success) {
        emit('create', {
          projectId: result.projectId,
          name: formData.name,
          projectType: formData.projectType,
          templateId: formData.templateId,
          isTemplateCreate: true,
        });
      } else {
        throw new Error(result?.error || '创建失败');
      }
    } else {
      // 普通创建（不使用模板）
      const userPrompt = formData.description
        ? `创建一个${formData.name}项目：${formData.description}`
        : `创建一个${formData.name}项目`;

      const createData = {
        userPrompt: userPrompt,
        name: formData.name || 'New Project',
        projectType: formData.projectType || 'other',
        status: formData.status || 'active',
        tags: JSON.stringify(formData.tags || []),
        userId: authStore.currentUser?.id || 'default-user',
      };

      if (formData.description && formData.description.trim()) {
        createData.description = formData.description.trim();
      }

      emit('create', createData);
    }
  } catch (error) {
    console.error('创建项目失败:', error);
  } finally {
    setTimeout(() => {
      creating.value = false;
    }, 500);
  }
};

// 重置表单
const handleReset = () => {
  formRef.value?.resetFields();
  formData.templateId = '';
  selectedTemplatePreview.value = null;
};

// 初始化
onMounted(() => {
  loadData();
});

// 监听描述变化，推荐模板
watch(() => formData.description, async (newDesc) => {
  if (newDesc && newDesc.length > 10 && templateFilter.value === 'recommended') {
    try {
      const result = await window.electronAPI?.invoke('template-library:recommend', newDesc, 5);
      if (result && result.success) {
        // 更新推荐模板
      }
    } catch (error) {
      console.error('获取推荐模板失败:', error);
    }
  }
});
</script>

<style scoped>
.manual-project-form {
  max-width: 900px;
  margin: 0 auto;
}

.form-container {
  padding: 20px 0;
}

/* 头部 */
.form-header {
  margin-bottom: 32px;
  text-align: center;
}

.form-header h2 {
  font-size: 28px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.form-header h2 :deep(.anticon) {
  font-size: 32px;
  color: #667eea;
}

.form-header p {
  font-size: 16px;
  color: #6b7280;
  margin: 0;
}

/* 项目类型网格 */
.project-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.project-type-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.project-type-card:hover {
  border-color: #667eea;
  background-color: #f9fafb;
}

.project-type-card.selected {
  border-color: #667eea;
  background-color: #eef2ff;
}

.type-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.type-info {
  flex: 1;
  min-width: 0;
}

.type-name {
  font-weight: 500;
  color: #1f2937;
  font-size: 14px;
}

.type-desc {
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 模板选择 */
.template-section {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.template-tabs {
  margin-bottom: 16px;
}

.template-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.template-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.template-card:hover {
  border-color: #667eea;
  background-color: #f9fafb;
}

.template-card.selected {
  border-color: #667eea;
  background-color: #eef2ff;
}

.template-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background-color: #f3f4f6;
  color: #667eea;
  flex-shrink: 0;
}

.template-info {
  flex: 1;
  min-width: 0;
}

.template-name {
  font-weight: 500;
  color: #1f2937;
  font-size: 14px;
  margin-bottom: 2px;
}

.template-desc {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
}

.template-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.template-badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

/* 模板预览 */
.template-preview {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
  color: #374151;
}

.preview-tree {
  max-height: 200px;
  overflow-y: auto;
  background-color: #f9fafb;
  border-radius: 6px;
  padding: 8px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 表单 */
.form-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #9ca3af;
}

/* 操作按钮 */
.form-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding-top: 24px;
}

/* 弹窗预览 */
.full-preview .preview-info h3 {
  margin: 0 0 8px 0;
  color: #1f2937;
}

.full-preview .preview-info p {
  margin: 0 0 12px 0;
  color: #6b7280;
}

.full-preview .preview-stats {
  display: flex;
  gap: 16px;
  color: #6b7280;
  font-size: 14px;
}

.full-preview .preview-stats span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.preview-tree-full {
  max-height: 400px;
  overflow-y: auto;
}
</style>
