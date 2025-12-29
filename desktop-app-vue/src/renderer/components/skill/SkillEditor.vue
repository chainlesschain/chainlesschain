<template>
  <a-modal
    :open="open"
    :title="skill ? '编辑技能' : '创建技能'"
    :width="720"
    :confirm-loading="saving"
    @ok="handleSave"
    @cancel="handleCancel"
  >
    <a-form
      :model="form"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
    >
      <!-- 基本信息 -->
      <a-form-item label="技能名称" required>
        <a-input
          v-model:value="form.name"
          placeholder="输入技能名称,如:代码开发"
          :maxlength="50"
        />
      </a-form-item>

      <a-form-item label="显示名称">
        <a-input
          v-model:value="form.display_name"
          placeholder="输入显示名称(支持多语言),如:Code Development"
          :maxlength="100"
        />
      </a-form-item>

      <a-form-item label="描述">
        <a-textarea
          v-model:value="form.description"
          :rows="3"
          placeholder="描述技能的功能和用途"
          :maxlength="500"
          show-count
        />
      </a-form-item>

      <!-- 分类和标签 -->
      <a-form-item label="分类" required>
        <a-select v-model:value="form.category" placeholder="选择分类">
          <a-select-option value="code">代码开发</a-select-option>
          <a-select-option value="web">Web开发</a-select-option>
          <a-select-option value="data">数据处理</a-select-option>
          <a-select-option value="content">内容创作</a-select-option>
          <a-select-option value="document">文档处理</a-select-option>
          <a-select-option value="media">媒体处理</a-select-option>
          <a-select-option value="ai">AI功能</a-select-option>
          <a-select-option value="system">系统操作</a-select-option>
          <a-select-option value="network">网络请求</a-select-option>
          <a-select-option value="automation">自动化</a-select-option>
          <a-select-option value="project">项目管理</a-select-option>
          <a-select-option value="template">模板应用</a-select-option>
        </a-select>
      </a-form-item>

      <a-form-item label="标签">
        <a-select
          v-model:value="form.tags"
          mode="tags"
          placeholder="输入标签,回车添加"
          :max-tag-count="5"
        />
      </a-form-item>

      <a-form-item label="图标">
        <a-input
          v-model:value="form.icon"
          placeholder="图标名称或路径,如:code"
        />
      </a-form-item>

      <!-- 配置选项 -->
      <a-form-item label="配置">
        <a-textarea
          v-model:value="configJson"
          :rows="5"
          placeholder='输入JSON配置,如: {"defaultLanguage": "javascript"}'
          @blur="validateConfig"
        />
        <div v-if="configError" class="error-message">
          {{ configError }}
        </div>
      </a-form-item>

      <!-- 状态 -->
      <a-form-item label="启用状态">
        <a-switch v-model:checked="form.enabled" />
        <span style="margin-left: 10px">
          {{ form.enabled ? '已启用' : '已禁用' }}
        </span>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  skill: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['update:open', 'save']);

// 表单数据
const form = ref({
  name: '',
  display_name: '',
  description: '',
  category: 'code',
  icon: '',
  tags: [],
  config: {},
  enabled: true,
});

// 配置JSON字符串
const configJson = ref('{}');
const configError = ref('');
const saving = ref(false);

// 验证配置JSON
const validateConfig = () => {
  try {
    const parsed = JSON.parse(configJson.value);
    form.value.config = parsed;
    configError.value = '';
    return true;
  } catch (error) {
    configError.value = `JSON格式错误: ${error.message}`;
    return false;
  }
};

// 监听skill prop变化,填充表单
watch(
  () => props.skill,
  (newSkill) => {
    if (newSkill) {
      // 编辑模式
      form.value = {
        id: newSkill.id,
        name: newSkill.name || '',
        display_name: newSkill.display_name || '',
        description: newSkill.description || '',
        category: newSkill.category || 'code',
        icon: newSkill.icon || '',
        tags: typeof newSkill.tags === 'string'
          ? JSON.parse(newSkill.tags || '[]')
          : (newSkill.tags || []),
        config: typeof newSkill.config === 'string'
          ? JSON.parse(newSkill.config || '{}')
          : (newSkill.config || {}),
        enabled: newSkill.enabled === 1,
      };

      configJson.value = JSON.stringify(form.value.config, null, 2);
    } else {
      // 创建模式
      form.value = {
        name: '',
        display_name: '',
        description: '',
        category: 'code',
        icon: '',
        tags: [],
        config: {},
        enabled: true,
      };
      configJson.value = '{}';
    }
    configError.value = '';
  },
  { immediate: true }
);

// 保存
const handleSave = async () => {
  // 验证必填字段
  if (!form.value.name) {
    message.error('请输入技能名称');
    return;
  }

  if (!form.value.category) {
    message.error('请选择分类');
    return;
  }

  // 验证配置JSON
  if (!validateConfig()) {
    message.error('配置JSON格式错误');
    return;
  }

  saving.value = true;

  try {
    // 准备保存的数据
    const saveData = {
      ...form.value,
      enabled: form.value.enabled ? 1 : 0,
      tags: JSON.stringify(form.value.tags),
      config: JSON.stringify(form.value.config),
    };

    emit('save', saveData);

    // 如果父组件没有处理保存逻辑,这里关闭对话框
    setTimeout(() => {
      saving.value = false;
    }, 300);
  } catch (error) {
    console.error('保存失败:', error);
    message.error('保存失败: ' + error.message);
    saving.value = false;
  }
};

// 取消
const handleCancel = () => {
  emit('update:open', false);
};
</script>

<style scoped>
.error-message {
  color: #ff4d4f;
  font-size: 12px;
  margin-top: 4px;
}
</style>
