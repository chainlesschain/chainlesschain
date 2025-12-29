<template>
  <div class="tool-tester">
    <a-alert
      message="工具测试"
      :description="`测试工具: ${tool.display_name || tool.name}`"
      type="info"
      show-icon
      style="margin-bottom: 16px"
    />

    <!-- 参数输入 -->
    <div class="params-section">
      <h4>输入参数</h4>

      <div v-if="paramFields.length > 0">
        <a-form :model="localParams" layout="vertical">
          <a-form-item
            v-for="field in paramFields"
            :key="field.name"
            :label="field.name"
            :required="field.required"
          >
            <template #label>
              <span>{{ field.name }}</span>
              <a-tag v-if="field.required" color="red" size="small" style="margin-left: 8px">
                必填
              </a-tag>
              <span v-if="field.description" style="color: #8c8c8c; font-size: 12px; margin-left: 8px">
                ({{ field.description }})
              </span>
            </template>

            <!-- 根据类型渲染不同的输入组件 -->
            <a-input
              v-if="field.type === 'string'"
              v-model:value="localParams[field.name]"
              :placeholder="`输入${field.name}`"
            />

            <a-input-number
              v-else-if="field.type === 'number'"
              v-model:value="localParams[field.name]"
              :placeholder="`输入${field.name}`"
              style="width: 100%"
            />

            <a-switch
              v-else-if="field.type === 'boolean'"
              v-model:checked="localParams[field.name]"
            />

            <a-textarea
              v-else-if="field.type === 'array' || field.type === 'object'"
              v-model:value="localParams[field.name]"
              :placeholder="`输入JSON格式的${field.name}`"
              :rows="3"
            />

            <a-input
              v-else
              v-model:value="localParams[field.name]"
              :placeholder="`输入${field.name}`"
            />
          </a-form-item>
        </a-form>
      </div>

      <a-empty v-else description="该工具无需参数" :image="simpleImage" size="small" />

      <!-- JSON 编辑器 -->
      <a-divider>或使用 JSON 编辑器</a-divider>

      <a-textarea
        v-model:value="jsonParams"
        :rows="6"
        placeholder="JSON 格式的参数"
        @blur="syncFromJson"
      />
      <div v-if="jsonError" style="color: #ff4d4f; margin-top: 8px; font-size: 12px">
        {{ jsonError }}
      </div>
    </div>

    <!-- 测试结果 -->
    <div v-if="localResult !== null" class="result-section">
      <a-divider>测试结果</a-divider>

      <a-alert
        :message="localResult?.success !== false ? '执行成功' : '执行失败'"
        :type="localResult?.success !== false ? 'success' : 'error'"
        show-icon
        style="margin-bottom: 16px"
      />

      <div class="result-content">
        <pre>{{ JSON.stringify(localResult, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Empty } from 'ant-design-vue';

const props = defineProps({
  tool: {
    type: Object,
    required: true,
  },
  params: {
    type: Object,
    default: () => ({}),
  },
  result: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['update:params', 'update:result']);

const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

const localParams = ref({ ...props.params });
const localResult = ref(props.result);
const jsonParams = ref('');
const jsonError = ref('');

// 解析参数Schema
const parsedSchema = computed(() => {
  if (typeof props.tool.parameters_schema === 'string') {
    try {
      return JSON.parse(props.tool.parameters_schema);
    } catch {
      return {};
    }
  }
  return props.tool.parameters_schema || {};
});

// 参数字段列表
const paramFields = computed(() => {
  const schema = parsedSchema.value;
  return Object.entries(schema).map(([name, param]) => ({
    name,
    type: param.type || 'string',
    required: param.required || false,
    description: param.description || '',
  }));
});

// 初始化JSON
const initJson = () => {
  try {
    jsonParams.value = JSON.stringify(localParams.value, null, 2);
    jsonError.value = '';
  } catch {
    jsonParams.value = '{}';
  }
};

// 从JSON同步
const syncFromJson = () => {
  try {
    const parsed = JSON.parse(jsonParams.value);
    localParams.value = parsed;
    jsonError.value = '';
    emit('update:params', parsed);
  } catch (error) {
    jsonError.value = '无效的 JSON 格式';
  }
};

// 监听参数变化
watch(
  () => localParams.value,
  (newVal) => {
    emit('update:params', newVal);
    initJson();
  },
  { deep: true }
);

// 监听结果变化
watch(
  () => props.result,
  (newVal) => {
    localResult.value = newVal;
  }
);

// 初始化
initJson();
</script>

<style scoped lang="scss">
.tool-tester {
  .params-section {
    h4 {
      margin-bottom: 16px;
      font-weight: 600;
    }
  }

  .result-section {
    margin-top: 24px;

    .result-content {
      background: #f5f5f5;
      border: 1px solid #d9d9d9;
      border-radius: 4px;
      padding: 12px;
      max-height: 400px;
      overflow: auto;

      pre {
        margin: 0;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.5;
        color: #262626;
      }
    }
  }
}
</style>
