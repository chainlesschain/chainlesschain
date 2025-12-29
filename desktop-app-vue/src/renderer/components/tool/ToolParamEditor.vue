<template>
  <div class="tool-param-editor">
    <a-tabs v-model:activeKey="editMode">
      <!-- 可视化编辑模式 -->
      <a-tab-pane key="visual" tab="可视化编辑">
        <div class="visual-editor">
          <a-space direction="vertical" style="width: 100%">
            <a-button type="primary" @click="addParameter">
              <template #icon><PlusOutlined /></template>
              添加参数
            </a-button>

            <div v-if="parameters.length === 0" class="empty-hint">
              暂无参数,点击上方按钮添加参数
            </div>

            <a-card
              v-for="(param, index) in parameters"
              :key="index"
              size="small"
              class="param-card"
            >
              <template #title>
                <a-input
                  v-model:value="param.name"
                  placeholder="参数名称"
                  style="width: 200px"
                  @change="updateSchema"
                />
              </template>

              <template #extra>
                <a-space>
                  <a-checkbox
                    v-model:checked="param.required"
                    @change="updateSchema"
                  >
                    必填
                  </a-checkbox>
                  <a-button
                    type="text"
                    danger
                    size="small"
                    @click="removeParameter(index)"
                  >
                    <template #icon><DeleteOutlined /></template>
                  </a-button>
                </a-space>
              </template>

              <a-form layout="vertical">
                <a-row :gutter="16">
                  <a-col :span="12">
                    <a-form-item label="类型">
                      <a-select
                        v-model:value="param.type"
                        @change="updateSchema"
                      >
                        <a-select-option value="string">字符串</a-select-option>
                        <a-select-option value="number">数字</a-select-option>
                        <a-select-option value="boolean">布尔值</a-select-option>
                        <a-select-option value="object">对象</a-select-option>
                        <a-select-option value="array">数组</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>

                  <a-col :span="12">
                    <a-form-item label="默认值">
                      <a-input
                        v-model:value="param.default"
                        placeholder="可选"
                        @change="updateSchema"
                      />
                    </a-form-item>
                  </a-col>
                </a-row>

                <a-form-item label="描述">
                  <a-textarea
                    v-model:value="param.description"
                    :rows="2"
                    placeholder="参数说明"
                    @change="updateSchema"
                  />
                </a-form-item>

                <a-form-item v-if="param.type === 'string'" label="枚举值(可选)">
                  <a-select
                    v-model:value="param.enum"
                    mode="tags"
                    placeholder="输入可选值"
                    @change="updateSchema"
                  />
                </a-form-item>
              </a-form>
            </a-card>
          </a-space>
        </div>
      </a-tab-pane>

      <!-- JSON编辑模式 -->
      <a-tab-pane key="json" tab="JSON编辑">
        <a-textarea
          v-model:value="jsonText"
          :rows="15"
          placeholder="输入JSON Schema"
          @blur="parseJsonToVisual"
        />
        <div v-if="jsonError" class="error-message">
          {{ jsonError }}
        </div>

        <div class="json-hint">
          <p>JSON Schema示例:</p>
          <pre>{{JSON.stringify(exampleSchema, null, 2)}}</pre>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  value: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['update:value', 'error']);

const editMode = ref('visual');
const parameters = ref([]);
const jsonText = ref('{}');
const jsonError = ref('');

// 示例Schema
const exampleSchema = {
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: '文件路径'
    },
    content: {
      type: 'string',
      description: '文件内容'
    }
  },
  required: ['filePath']
};

// 初始化
const initFromValue = (schema) => {
  if (!schema || !schema.properties) {
    parameters.value = [];
    jsonText.value = '{}';
    return;
  }

  // 从schema转换为参数列表
  const props = schema.properties || {};
  const required = schema.required || [];

  parameters.value = Object.entries(props).map(([name, config]) => ({
    name,
    type: config.type || 'string',
    description: config.description || '',
    default: config.default !== undefined ? String(config.default) : '',
    enum: config.enum || [],
    required: required.includes(name),
  }));

  jsonText.value = JSON.stringify(schema, null, 2);
};

// 添加参数
const addParameter = () => {
  parameters.value.push({
    name: '',
    type: 'string',
    description: '',
    default: '',
    enum: [],
    required: false,
  });
  updateSchema();
};

// 删除参数
const removeParameter = (index) => {
  parameters.value.splice(index, 1);
  updateSchema();
};

// 更新Schema
const updateSchema = () => {
  try {
    const properties = {};
    const required = [];

    parameters.value.forEach(param => {
      if (!param.name) return;

      const propConfig = {
        type: param.type,
        description: param.description,
      };

      if (param.default) {
        propConfig.default = param.default;
      }

      if (param.enum && param.enum.length > 0) {
        propConfig.enum = param.enum;
      }

      properties[param.name] = propConfig;

      if (param.required) {
        required.push(param.name);
      }
    });

    const schema = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      schema.required = required;
    }

    jsonText.value = JSON.stringify(schema, null, 2);
    emit('update:value', schema);
    emit('error', null);
  } catch (error) {
    emit('error', `生成Schema失败: ${error.message}`);
  }
};

// 从JSON解析到可视化
const parseJsonToVisual = () => {
  try {
    const schema = JSON.parse(jsonText.value);

    if (schema.type !== 'object' || !schema.properties) {
      throw new Error('Schema必须是object类型且包含properties字段');
    }

    initFromValue(schema);
    emit('update:value', schema);
    emit('error', null);
    jsonError.value = '';
  } catch (error) {
    jsonError.value = `JSON解析错误: ${error.message}`;
    emit('error', jsonError.value);
  }
};

// 监听value变化
watch(
  () => props.value,
  (newValue) => {
    if (newValue && Object.keys(newValue).length > 0) {
      initFromValue(newValue);
    }
  },
  { immediate: true, deep: true }
);
</script>

<style scoped>
.tool-param-editor {
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  padding: 16px;
}

.visual-editor {
  min-height: 300px;
}

.param-card {
  margin-bottom: 12px;
}

.empty-hint {
  text-align: center;
  padding: 40px 0;
  color: #8c8c8c;
}

.error-message {
  color: #ff4d4f;
  font-size: 12px;
  margin-top: 8px;
  padding: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
}

.json-hint {
  margin-top: 16px;
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
  font-size: 12px;
}

.json-hint pre {
  background: white;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}
</style>
