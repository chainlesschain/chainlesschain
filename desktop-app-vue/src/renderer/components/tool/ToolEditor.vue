<template>
  <a-modal
    :open="visible"
    :title="tool ? '编辑工具' : '创建工具'"
    :width="800"
    :confirm-loading="saving"
    @ok="handleSave"
    @cancel="handleCancel"
  >
    <a-form
      :model="form"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
    >
      <a-tabs v-model:activeKey="activeTab">
        <!-- 基本信息 -->
        <a-tab-pane key="basic" tab="基本信息">
          <a-form-item label="工具名称" required>
            <a-input
              v-model:value="form.name"
              placeholder="工具标识,如:file_reader"
              :maxlength="50"
              :disabled="!!tool"
            />
            <div class="form-hint">工具的唯一标识,创建后不可修改</div>
          </a-form-item>

          <a-form-item label="显示名称">
            <a-input
              v-model:value="form.display_name"
              placeholder="显示名称,如:文件读取"
              :maxlength="100"
            />
          </a-form-item>

          <a-form-item label="描述">
            <a-textarea
              v-model:value="form.description"
              :rows="3"
              placeholder="描述工具的功能和用途"
              :maxlength="500"
              show-count
            />
          </a-form-item>

          <a-form-item label="工具类型" required>
            <a-select v-model:value="form.tool_type" placeholder="选择工具类型">
              <a-select-option value="function">函数</a-select-option>
              <a-select-option value="api">API</a-select-option>
              <a-select-option value="command">命令</a-select-option>
              <a-select-option value="script">脚本</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="分类" required>
            <a-select v-model:value="form.category" placeholder="选择分类">
              <a-select-option value="file">文件操作</a-select-option>
              <a-select-option value="code">代码处理</a-select-option>
              <a-select-option value="data">数据处理</a-select-option>
              <a-select-option value="network">网络请求</a-select-option>
              <a-select-option value="system">系统操作</a-select-option>
              <a-select-option value="ai">AI功能</a-select-option>
              <a-select-option value="format">格式化</a-select-option>
              <a-select-option value="version-control">版本控制</a-select-option>
              <a-select-option value="web">Web开发</a-select-option>
              <a-select-option value="project">项目管理</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="风险等级">
            <a-slider
              v-model:value="form.risk_level"
              :min="1"
              :max="5"
              :marks="{ 1: '低', 3: '中', 5: '高' }"
            />
          </a-form-item>

          <a-form-item label="状态">
            <a-space>
              <a-switch v-model:checked="form.enabled" />
              <span>{{ form.enabled ? '已启用' : '已禁用' }}</span>
              <a-divider type="vertical" />
              <a-switch v-model:checked="form.deprecated" />
              <span>{{ form.deprecated ? '已废弃' : '未废弃' }}</span>
            </a-space>
          </a-form-item>
        </a-tab-pane>

        <!-- 参数Schema -->
        <a-tab-pane key="params" tab="参数Schema">
          <a-form-item label="参数Schema" :wrapper-col="{ span: 24 }">
            <ToolParamEditor
              v-model:value="form.parameters_schema"
              @error="handleSchemaError"
            />
          </a-form-item>
        </a-tab-pane>

        <!-- 返回值和示例 -->
        <a-tab-pane key="return" tab="返回值和示例">
          <a-form-item label="返回值Schema">
            <a-textarea
              v-model:value="returnSchemaJson"
              :rows="8"
              placeholder="输入JSON Schema"
              @blur="validateReturnSchema"
            />
            <div v-if="returnSchemaError" class="error-message">
              {{ returnSchemaError }}
            </div>
          </a-form-item>

          <a-form-item label="使用示例">
            <a-textarea
              v-model:value="examplesJson"
              :rows="8"
              placeholder='输入使用示例JSON数组,如: [{"description":"示例1","params":{}}]'
              @blur="validateExamples"
            />
            <div v-if="examplesError" class="error-message">
              {{ examplesError }}
            </div>
          </a-form-item>
        </a-tab-pane>

        <!-- 权限和配置 -->
        <a-tab-pane key="config" tab="权限和配置">
          <a-form-item label="所需权限">
            <a-select
              v-model:value="form.required_permissions"
              mode="tags"
              placeholder="输入权限标识,如:file:read"
            >
              <a-select-option value="file:read">file:read</a-select-option>
              <a-select-option value="file:write">file:write</a-select-option>
              <a-select-option value="network:http">network:http</a-select-option>
              <a-select-option value="system:execute">system:execute</a-select-option>
              <a-select-option value="database:read">database:read</a-select-option>
              <a-select-option value="database:write">database:write</a-select-option>
              <a-select-option value="ai:search">ai:search</a-select-option>
              <a-select-option value="git:init">git:init</a-select-option>
              <a-select-option value="git:commit">git:commit</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="配置选项">
            <a-textarea
              v-model:value="configJson"
              :rows="6"
              placeholder='输入JSON配置,如: {"timeout": 30000}'
              @blur="validateConfig"
            />
            <div v-if="configError" class="error-message">
              {{ configError }}
            </div>
          </a-form-item>

          <a-form-item label="处理函数路径" v-if="!tool || !tool.is_builtin">
            <a-input
              v-model:value="form.handler_path"
              placeholder="处理函数路径(用于动态加载)"
            />
          </a-form-item>
        </a-tab-pane>
      </a-tabs>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, watch } from 'vue';
import { message } from 'ant-design-vue';
import ToolParamEditor from './ToolParamEditor.vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  tool: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['update:visible', 'save']);

const activeTab = ref('basic');

// 表单数据
const form = ref({
  name: '',
  display_name: '',
  description: '',
  tool_type: 'function',
  category: 'file',
  parameters_schema: {},
  return_schema: {},
  enabled: true,
  deprecated: false,
  config: {},
  examples: [],
  required_permissions: [],
  risk_level: 1,
  handler_path: '',
});

// JSON字符串
const returnSchemaJson = ref('{}');
const examplesJson = ref('[]');
const configJson = ref('{}');

// 错误信息
const returnSchemaError = ref('');
const examplesError = ref('');
const configError = ref('');
const saving = ref(false);

// 验证函数
const validateReturnSchema = () => {
  try {
    const parsed = JSON.parse(returnSchemaJson.value);
    form.value.return_schema = parsed;
    returnSchemaError.value = '';
    return true;
  } catch (error) {
    returnSchemaError.value = `JSON格式错误: ${error.message}`;
    return false;
  }
};

const validateExamples = () => {
  try {
    const parsed = JSON.parse(examplesJson.value);
    if (!Array.isArray(parsed)) {
      throw new Error('示例必须是数组');
    }
    form.value.examples = parsed;
    examplesError.value = '';
    return true;
  } catch (error) {
    examplesError.value = `格式错误: ${error.message}`;
    return false;
  }
};

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

const handleSchemaError = (error) => {
  if (error) {
    message.error(error);
  }
};

// 监听tool prop变化
watch(
  () => props.tool,
  (newTool) => {
    if (newTool) {
      // 编辑模式
      form.value = {
        id: newTool.id,
        name: newTool.name || '',
        display_name: newTool.display_name || '',
        description: newTool.description || '',
        tool_type: newTool.tool_type || 'function',
        category: newTool.category || 'file',
        parameters_schema: typeof newTool.parameters_schema === 'string'
          ? JSON.parse(newTool.parameters_schema || '{}')
          : (newTool.parameters_schema || {}),
        return_schema: typeof newTool.return_schema === 'string'
          ? JSON.parse(newTool.return_schema || '{}')
          : (newTool.return_schema || {}),
        enabled: newTool.enabled === 1,
        deprecated: newTool.deprecated === 1,
        config: typeof newTool.config === 'string'
          ? JSON.parse(newTool.config || '{}')
          : (newTool.config || {}),
        examples: typeof newTool.examples === 'string'
          ? JSON.parse(newTool.examples || '[]')
          : (newTool.examples || []),
        required_permissions: typeof newTool.required_permissions === 'string'
          ? JSON.parse(newTool.required_permissions || '[]')
          : (newTool.required_permissions || []),
        risk_level: newTool.risk_level || 1,
        handler_path: newTool.handler_path || '',
      };

      returnSchemaJson.value = JSON.stringify(form.value.return_schema, null, 2);
      examplesJson.value = JSON.stringify(form.value.examples, null, 2);
      configJson.value = JSON.stringify(form.value.config, null, 2);
    } else {
      // 创建模式
      form.value = {
        name: '',
        display_name: '',
        description: '',
        tool_type: 'function',
        category: 'file',
        parameters_schema: {},
        return_schema: {},
        enabled: true,
        deprecated: false,
        config: {},
        examples: [],
        required_permissions: [],
        risk_level: 1,
        handler_path: '',
      };

      returnSchemaJson.value = '{}';
      examplesJson.value = '[]';
      configJson.value = '{}';
    }

    // 清除错误
    returnSchemaError.value = '';
    examplesError.value = '';
    configError.value = '';
    activeTab.value = 'basic';
  },
  { immediate: true }
);

// 保存
const handleSave = async () => {
  // 验证必填字段
  if (!form.value.name) {
    message.error('请输入工具名称');
    return;
  }

  if (!form.value.category) {
    message.error('请选择分类');
    return;
  }

  // 验证JSON
  if (!validateReturnSchema() || !validateExamples() || !validateConfig()) {
    message.error('请检查JSON格式');
    return;
  }

  saving.value = true;

  try {
    // 准备保存的数据
    const saveData = {
      ...form.value,
      enabled: form.value.enabled ? 1 : 0,
      deprecated: form.value.deprecated ? 1 : 0,
      parameters_schema: JSON.stringify(form.value.parameters_schema),
      return_schema: JSON.stringify(form.value.return_schema),
      config: JSON.stringify(form.value.config),
      examples: JSON.stringify(form.value.examples),
      required_permissions: JSON.stringify(form.value.required_permissions),
    };

    emit('save', saveData);

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
  emit('update:visible', false);
};
</script>

<style scoped>
.error-message {
  color: #ff4d4f;
  font-size: 12px;
  margin-top: 4px;
}

.form-hint {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}
</style>
