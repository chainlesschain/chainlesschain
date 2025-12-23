<template>
  <div class="manual-project-form">
    <div class="form-container">
      <!-- 说明 -->
      <div class="form-header">
        <h2>
          <FormOutlined />
          手动创建项目
        </h2>
        <p>手动配置项目基本信息，系统将创建空白项目</p>
      </div>

      <!-- 表单 -->
      <a-form
        :model="formData"
        :rules="rules"
        layout="vertical"
        @finish="handleSubmit"
        ref="formRef"
      >
        <!-- 项目名称 -->
        <a-form-item label="项目名称" name="name" required>
          <a-input
            v-model:value="formData.name"
            placeholder="输入项目名称"
            size="large"
          />
        </a-form-item>

        <!-- 项目描述 -->
        <a-form-item label="项目描述" name="description">
          <a-textarea
            v-model:value="formData.description"
            placeholder="简要描述项目用途和目标..."
            :rows="4"
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <!-- 项目类型 -->
        <a-form-item label="项目类型" name="projectType" required>
          <a-radio-group v-model:value="formData.projectType" size="large">
            <a-radio-button value="web">
              <CodeOutlined />
              Web开发
            </a-radio-button>
            <a-radio-button value="document">
              <FileTextOutlined />
              文档处理
            </a-radio-button>
            <a-radio-button value="data">
              <BarChartOutlined />
              数据分析
            </a-radio-button>
            <a-radio-button value="app">
              <AppstoreOutlined />
              应用开发
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- 项目标签 -->
        <a-form-item label="项目标签" name="tags">
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
        <a-form-item label="初始状态" name="status">
          <a-radio-group v-model:value="formData.status">
            <a-radio value="draft">草稿</a-radio>
            <a-radio value="active">进行中</a-radio>
          </a-radio-group>
        </a-form-item>

        <!-- 提交按钮 -->
        <a-form-item>
          <div class="form-actions">
            <a-button type="primary" html-type="submit" size="large" :loading="creating">
              <PlusOutlined />
              创建项目
            </a-button>
            <a-button size="large" @click="handleReset">
              重置
            </a-button>
          </div>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import {
  FormOutlined,
  CodeOutlined,
  FileTextOutlined,
  BarChartOutlined,
  AppstoreOutlined,
  PlusOutlined,
} from '@ant-design/icons-vue';

const emit = defineEmits(['create']);
const authStore = useAuthStore();

// 响应式状态
const formRef = ref(null);
const creating = ref(false);

const formData = reactive({
  name: '',
  description: '',
  projectType: 'web', // 手动创建时保持默认值，用户可以自行选择
  tags: [],
  status: 'active',
});

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
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'fullstack', label: '全栈' },
  { value: 'mobile', label: '移动端' },
  { value: 'desktop', label: '桌面端' },
  { value: 'ai', label: 'AI' },
  { value: 'ml', label: '机器学习' },
  { value: 'data', label: '数据分析' },
  { value: 'visualization', label: '可视化' },
  { value: 'api', label: 'API' },
  { value: 'cms', label: 'CMS' },
  { value: 'blog', label: '博客' },
  { value: 'dashboard', label: '看板' },
  { value: 'admin', label: '管理后台' },
];

// 提交表单
const handleSubmit = async () => {
  creating.value = true;

  // 构建用户提示（userPrompt）- 后端必填字段
  const userPrompt = formData.description
    ? `创建一个${formData.name}项目：${formData.description}`
    : `创建一个${formData.name}项目`;

  const createData = {
    userPrompt: userPrompt,  // 后端必填字段
    name: formData.name || 'New Project',
    projectType: formData.projectType || 'general',  // 确保有默认值
    status: formData.status || 'active',  // 确保有默认值
    tags: JSON.stringify(formData.tags || []),  // 确保是数组
    userId: authStore.currentUser?.id || 'default-user',
  };

  // 只有当description存在且不为空时才添加（避免undefined导致IPC序列化错误）
  if (formData.description && formData.description.trim()) {
    createData.description = formData.description.trim();
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
};
</script>

<style scoped>
.manual-project-form {
  max-width: 700px;
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

/* 表单 */
.form-hint {
  margin-top: 8px;
  font-size: 13px;
  color: #9ca3af;
}

/* 项目类型按钮组 */
:deep(.ant-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

:deep(.ant-radio-button-wrapper) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: 6px;
}

:deep(.ant-radio-button-wrapper .anticon) {
  font-size: 16px;
}

/* 操作按钮 */
.form-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding-top: 24px;
}
</style>
