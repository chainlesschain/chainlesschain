<template>
  <div class="template-variables-form">
    <a-form
      ref="formRef"
      :model="formData"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
      @finish="handleSubmit"
    >
      <!-- 动态生成表单字段 -->
      <a-form-item
        v-for="variable in variables"
        :key="variable.name"
        :label="variable.label || variable.name"
        :name="variable.name"
        :rules="getFieldRules(variable)"
        :help="variable.help"
      >
        <!-- 文本输入 -->
        <a-input
          v-if="variable.type === 'text'"
          v-model:value="formData[variable.name]"
          :placeholder="variable.placeholder || `请输入${variable.label || variable.name}`"
          :maxlength="variable.max"
          :disabled="variable.disabled"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 数字输入 -->
        <a-input-number
          v-else-if="variable.type === 'number'"
          v-model:value="formData[variable.name]"
          :min="variable.min"
          :max="variable.max"
          :step="variable.step || 1"
          :placeholder="variable.placeholder"
          :disabled="variable.disabled"
          style="width: 100%"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 多行文本 -->
        <a-textarea
          v-else-if="variable.type === 'textarea'"
          v-model:value="formData[variable.name]"
          :placeholder="variable.placeholder || `请输入${variable.label || variable.name}`"
          :maxlength="variable.max"
          :rows="variable.rows || 4"
          :disabled="variable.disabled"
          :show-count="!!variable.max"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 邮箱输入 -->
        <a-input
          v-else-if="variable.type === 'email'"
          v-model:value="formData[variable.name]"
          type="email"
          :placeholder="variable.placeholder || '请输入邮箱地址'"
          :disabled="variable.disabled"
          @change="handleFieldChange(variable.name)"
        >
          <template #prefix>
            <MailOutlined style="color: rgba(0, 0, 0, 0.25)" />
          </template>
        </a-input>

        <!-- URL输入 -->
        <a-input
          v-else-if="variable.type === 'url'"
          v-model:value="formData[variable.name]"
          type="url"
          :placeholder="variable.placeholder || '请输入URL地址'"
          :disabled="variable.disabled"
          @change="handleFieldChange(variable.name)"
        >
          <template #prefix>
            <LinkOutlined style="color: rgba(0, 0, 0, 0.25)" />
          </template>
        </a-input>

        <!-- 日期选择 -->
        <a-date-picker
          v-else-if="variable.type === 'date'"
          v-model:value="formData[variable.name]"
          :placeholder="variable.placeholder || '请选择日期'"
          :disabled="variable.disabled"
          style="width: 100%"
          format="YYYY-MM-DD"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 下拉选择 -->
        <a-select
          v-else-if="variable.type === 'select'"
          v-model:value="formData[variable.name]"
          :placeholder="variable.placeholder || '请选择'"
          :disabled="variable.disabled"
          :options="variable.options"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 单选框组 -->
        <a-radio-group
          v-else-if="variable.type === 'radio'"
          v-model:value="formData[variable.name]"
          :disabled="variable.disabled"
          @change="handleFieldChange(variable.name)"
        >
          <a-radio
            v-for="option in variable.options"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </a-radio>
        </a-radio-group>

        <!-- 多选框组 -->
        <a-checkbox-group
          v-else-if="variable.type === 'checkbox'"
          v-model:value="formData[variable.name]"
          :disabled="variable.disabled"
          :options="variable.options"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 开关 -->
        <a-switch
          v-else-if="variable.type === 'switch'"
          v-model:checked="formData[variable.name]"
          :disabled="variable.disabled"
          @change="handleFieldChange(variable.name)"
        >
          <template v-if="variable.checkedText" #checkedChildren>{{ variable.checkedText }}</template>
          <template v-if="variable.uncheckedText" #unCheckedChildren>{{ variable.uncheckedText }}</template>
        </a-switch>

        <!-- 默认文本输入 -->
        <a-input
          v-else
          v-model:value="formData[variable.name]"
          :placeholder="variable.placeholder || `请输入${variable.label || variable.name}`"
          :disabled="variable.disabled"
          @change="handleFieldChange(variable.name)"
        />

        <!-- 变量说明 -->
        <template v-if="variable.description" #extra>
          <div class="field-description">{{ variable.description }}</div>
        </template>
      </a-form-item>

      <!-- 预览区域 -->
      <a-form-item v-if="showPreview && previewTemplate" label="预览" :wrapper-col="{ span: 18, offset: 6 }">
        <div class="preview-area">
          <div class="preview-title">
            <EyeOutlined /> 渲染预览
          </div>
          <div class="preview-content">
            <pre>{{ previewContent }}</pre>
          </div>
        </div>
      </a-form-item>

      <!-- 操作按钮 -->
      <a-form-item v-if="showSubmit" :wrapper-col="{ span: 18, offset: 6 }">
        <a-space>
          <a-button type="primary" html-type="submit" :loading="submitting">
            {{ submitText || '确定' }}
          </a-button>
          <a-button v-if="showCancel" @click="handleCancel">
            取消
          </a-button>
          <a-button v-if="showReset" @click="handleReset">
            重置
          </a-button>
        </a-space>
      </a-form-item>
    </a-form>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed, onMounted } from 'vue';
import { MailOutlined, LinkOutlined, EyeOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  // 模板对象（包含variables定义）
  template: {
    type: Object,
    required: true
  },
  // v-model支持
  modelValue: {
    type: Object,
    default: () => ({})
  },
  // 是否显示提交按钮
  showSubmit: {
    type: Boolean,
    default: true
  },
  // 是否显示取消按钮
  showCancel: {
    type: Boolean,
    default: false
  },
  // 是否显示重置按钮
  showReset: {
    type: Boolean,
    default: true
  },
  // 提交按钮文本
  submitText: {
    type: String,
    default: '确定'
  },
  // 是否显示预览
  showPreview: {
    type: Boolean,
    default: false
  },
  // 预览模板字符串
  previewTemplate: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:modelValue', 'submit', 'cancel', 'validate', 'change']);

const formRef = ref(null);
const formData = reactive({});
const submitting = ref(false);
const previewContent = ref('');

// 获取变量定义
const variables = computed(() => {
  return props.template?.variables || [];
});

// 初始化表单数据
const initFormData = () => {
  // 先清空
  Object.keys(formData).forEach(key => delete formData[key]);

  // 设置默认值
  variables.value.forEach(variable => {
    let defaultValue = props.modelValue[variable.name];

    if (defaultValue === undefined) {
      if (variable.default !== undefined) {
        defaultValue = variable.default;
      } else {
        // 根据类型设置默认值
        switch (variable.type) {
          case 'number':
            defaultValue = 0;
            break;
          case 'checkbox':
            defaultValue = [];
            break;
          case 'switch':
            defaultValue = false;
            break;
          default:
            defaultValue = '';
        }
      }
    }

    formData[variable.name] = defaultValue;
  });
};

// 获取字段验证规则
const getFieldRules = (variable) => {
  const rules = [];

  // 必填验证
  if (variable.required) {
    rules.push({
      required: true,
      message: `${variable.label || variable.name} 为必填项`
    });
  }

  // 类型验证
  switch (variable.type) {
    case 'email':
      rules.push({
        type: 'email',
        message: '邮箱格式不正确'
      });
      break;
    case 'url':
      rules.push({
        type: 'url',
        message: 'URL格式不正确'
      });
      break;
    case 'number':
      if (variable.min !== undefined) {
        rules.push({
          type: 'number',
          min: variable.min,
          message: `不能小于 ${variable.min}`
        });
      }
      if (variable.max !== undefined) {
        rules.push({
          type: 'number',
          max: variable.max,
          message: `不能大于 ${variable.max}`
        });
      }
      break;
  }

  // 长度验证
  if (variable.min !== undefined && (variable.type === 'text' || variable.type === 'textarea')) {
    rules.push({
      min: variable.min,
      message: `长度不能少于 ${variable.min} 个字符`
    });
  }
  if (variable.max !== undefined && (variable.type === 'text' || variable.type === 'textarea')) {
    rules.push({
      max: variable.max,
      message: `长度不能超过 ${variable.max} 个字符`
    });
  }

  // 正则验证
  if (variable.pattern) {
    rules.push({
      pattern: new RegExp(variable.pattern),
      message: variable.patternMessage || '格式不正确'
    });
  }

  return rules;
};

// 字段值变化处理
const handleFieldChange = (fieldName) => {
  // 发出change事件
  emit('change', fieldName, formData[fieldName]);

  // 更新v-model
  emit('update:modelValue', { ...formData });

  // 更新预览
  if (props.showPreview && props.previewTemplate) {
    updatePreview();
  }
};

// 更新预览
const updatePreview = async () => {
  try {
    const result = await window.electron.invoke('template:preview', {
      template: props.previewTemplate,
      variables: formData
    });

    if (result.success) {
      previewContent.value = result.preview;
    } else {
      previewContent.value = `预览失败: ${result.error}`;
    }
  } catch (error) {
    console.error('预览失败:', error);
    previewContent.value = `预览失败: ${error.message}`;
  }
};

// 表单提交
const handleSubmit = async () => {
  try {
    submitting.value = true;

    // 验证表单
    await formRef.value.validate();

    // 发出submit事件
    emit('submit', { ...formData });
  } catch (error) {
    console.error('表单验证失败:', error);
    message.error('请检查表单填写');
  } finally {
    submitting.value = false;
  }
};

// 取消
const handleCancel = () => {
  emit('cancel');
};

// 重置
const handleReset = () => {
  formRef.value.resetFields();
  initFormData();
};

// 验证表单（供外部调用）
const validate = async () => {
  try {
    await formRef.value.validate();
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: error.errorFields };
  }
};

// 监听template变化
watch(() => props.template, () => {
  initFormData();
}, { immediate: true });

// 监听modelValue变化
watch(() => props.modelValue, (newVal) => {
  if (newVal && typeof newVal === 'object') {
    Object.assign(formData, newVal);
  }
}, { deep: true });

// 初始化
onMounted(() => {
  initFormData();
  if (props.showPreview && props.previewTemplate) {
    updatePreview();
  }
});

// 暴露给父组件的方法
defineExpose({
  validate,
  reset: handleReset,
  getFormData: () => ({ ...formData })
});
</script>

<style scoped>
.template-variables-form {
  width: 100%;
}

.field-description {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.preview-area {
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  overflow: hidden;
}

.preview-title {
  background: #fafafa;
  padding: 8px 12px;
  border-bottom: 1px solid #d9d9d9;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-content {
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  background: #fff;
}

.preview-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
}
</style>
