<template>
  <div class="llm-quick-setup">
    <a-typography-title :level="4">AI 模型配置</a-typography-title>
    <a-typography-paragraph type="secondary">
      配置您的 AI 模型服务。可以选择简化配置、高级配置或稍后设置。
    </a-typography-paragraph>

    <!-- 模式选择 -->
    <a-segmented
      v-model:value="currentMode"
      :options="modeOptions"
      block
      size="large"
      class="mode-selector"
    />

    <!-- 简化模式 -->
    <div v-if="currentMode === 'simple'" class="config-panel">
      <a-alert
        message="简化模式"
        description="只需选择一个AI提供商，其他参数将使用默认值"
        type="info"
        show-icon
        class="mode-alert"
      />

      <a-form layout="vertical">
        <a-form-item label="选择 AI 提供商">
          <a-select
            v-model:value="formData.provider"
            size="large"
            @change="handleProviderChange"
          >
            <a-select-option value="ollama">
              <RobotOutlined /> Ollama (本地)
            </a-select-option>
            <a-select-option value="volcengine">
              <CloudOutlined /> 火山引擎 (豆包)
            </a-select-option>
            <a-select-option value="openai">
              <OpenAIOutlined /> OpenAI
            </a-select-option>
            <a-select-option value="deepseek">
              <ThunderboltOutlined /> DeepSeek
            </a-select-option>
            <a-select-option value="zhipu">
              <BulbOutlined /> 智谱AI (GLM)
            </a-select-option>
            <a-select-option value="qianfan">
              <DatabaseOutlined /> 百度千帆
            </a-select-option>
          </a-select>
        </a-form-item>

        <!-- 云端提供商需要 API Key -->
        <a-form-item
          v-if="needsApiKey"
          label="API密钥"
          required
        >
          <a-input-password
            v-model:value="formData.apiKey"
            placeholder="输入您的API密钥"
            @change="emitUpdate"
          />
          <template #extra>
            <a :href="getApiKeyLink()" target="_blank">
              <LinkOutlined /> 获取API密钥
            </a>
          </template>
        </a-form-item>
      </a-form>
    </div>

    <!-- 高级模式 -->
    <div v-if="currentMode === 'advanced'" class="config-panel">
      <a-alert
        message="高级模式"
        description="完整配置所有AI参数，适合高级用户"
        type="warning"
        show-icon
        class="mode-alert"
      />

      <a-form layout="vertical">
        <a-form-item label="AI 提供商">
          <a-select v-model:value="formData.provider" @change="handleProviderChange">
            <a-select-option value="ollama">Ollama (本地)</a-select-option>
            <a-select-option value="volcengine">火山引擎</a-select-option>
            <a-select-option value="openai">OpenAI</a-select-option>
            <a-select-option value="deepseek">DeepSeek</a-select-option>
            <a-select-option value="zhipu">智谱AI</a-select-option>
            <a-select-option value="qianfan">百度千帆</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item v-if="needsApiKey" label="API密钥" required>
          <a-input-password
            v-model:value="formData.apiKey"
            placeholder="输入API密钥"
            @change="emitUpdate"
          />
        </a-form-item>

        <a-form-item label="Base URL（可选）">
          <a-input
            v-model:value="formData.baseUrl"
            placeholder="自定义API服务地址"
            @change="emitUpdate"
          />
        </a-form-item>

        <a-form-item label="模型名称（可选）">
          <a-input
            v-model:value="formData.model"
            :placeholder="getDefaultModel()"
            @change="emitUpdate"
          />
        </a-form-item>
      </a-form>
    </div>

    <!-- 跳过模式 -->
    <div v-if="currentMode === 'skip'" class="config-panel">
      <a-result
        status="info"
        title="稍后配置"
        sub-title="将使用默认的 Ollama 本地服务，您可以在系统设置中随时修改"
      >
        <template #icon>
          <ClockCircleOutlined />
        </template>
      </a-result>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, reactive } from 'vue';
import {
  RobotOutlined,
  CloudOutlined,
  ThunderboltOutlined,
  BulbOutlined,
  DatabaseOutlined,
  LinkOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({
      mode: 'simple',
      provider: 'ollama',
      apiKey: '',
      baseUrl: '',
      model: '',
    }),
  },
});

const emit = defineEmits(['update:modelValue']);

const currentMode = ref(props.modelValue.mode || 'simple');
const formData = reactive({
  provider: props.modelValue.provider || 'ollama',
  apiKey: props.modelValue.apiKey || '',
  baseUrl: props.modelValue.baseUrl || '',
  model: props.modelValue.model || '',
});

const modeOptions = [
  {
    label: '简化配置',
    value: 'simple',
  },
  {
    label: '高级配置',
    value: 'advanced',
  },
  {
    label: '稍后设置',
    value: 'skip',
  },
];

const needsApiKey = computed(() => {
  return formData.provider !== 'ollama';
});

watch(currentMode, () => {
  emitUpdate();
});

const handleProviderChange = () => {
  // 切换提供商时清空 API Key
  if (formData.provider === 'ollama') {
    formData.apiKey = '';
    formData.baseUrl = '';
  }
  emitUpdate();
};

const emitUpdate = () => {
  emit('update:modelValue', {
    mode: currentMode.value,
    provider: formData.provider,
    apiKey: formData.apiKey,
    baseUrl: formData.baseUrl,
    model: formData.model,
  });
};

const getApiKeyLink = () => {
  const links = {
    volcengine: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    openai: 'https://platform.openai.com/api-keys',
    deepseek: 'https://platform.deepseek.com/api_keys',
    zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
    qianfan: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
  };
  return links[formData.provider] || '#';
};

const getDefaultModel = () => {
  const models = {
    ollama: 'llama2',
    volcengine: 'doubao-pro-4k',
    openai: 'gpt-3.5-turbo',
    deepseek: 'deepseek-chat',
    zhipu: 'glm-4',
    qianfan: 'ERNIE-Bot-turbo',
  };
  return models[formData.provider] || '';
};
</script>

<style scoped>
.llm-quick-setup {
  padding: 20px 0;
}

.mode-selector {
  margin: 20px 0;
}

.config-panel {
  margin-top: 24px;
}

.mode-alert {
  margin-bottom: 20px;
}
</style>
