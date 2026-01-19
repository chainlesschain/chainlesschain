<template>
  <div class="llm-quick-setup">
    <a-typography-title :level="4">
      AI 模型配置
    </a-typography-title>
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
    <div
      v-if="currentMode === 'simple'"
      class="config-panel"
    >
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
            <a-select-option value="anthropic">
              <ThunderboltOutlined /> Claude (Anthropic)
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
            <a
              :href="getApiKeyLink()"
              target="_blank"
            >
              <LinkOutlined /> 获取API密钥
            </a>
          </template>
        </a-form-item>

        <!-- 测试连接按钮 -->
        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              :loading="testing"
              @click="testConnection"
            >
              测试连接
            </a-button>
            <a-tag
              v-if="testResult"
              :color="testResult.success ? 'success' : 'error'"
            >
              {{ testResult.message }}
            </a-tag>
          </a-space>
        </a-form-item>
      </a-form>
    </div>

    <!-- 高级模式 -->
    <div
      v-if="currentMode === 'advanced'"
      class="config-panel"
    >
      <a-alert
        message="高级模式"
        description="完整配置所有AI参数，适合高级用户"
        type="warning"
        show-icon
        class="mode-alert"
      />

      <a-form layout="vertical">
        <a-form-item label="AI 提供商">
          <a-select
            v-model:value="formData.provider"
            @change="handleProviderChange"
          >
            <a-select-option value="ollama">
              Ollama (本地)
            </a-select-option>
            <a-select-option value="volcengine">
              火山引擎
            </a-select-option>
            <a-select-option value="openai">
              OpenAI
            </a-select-option>
            <a-select-option value="anthropic">
              Claude (Anthropic)
            </a-select-option>
            <a-select-option value="deepseek">
              DeepSeek
            </a-select-option>
            <a-select-option value="zhipu">
              智谱AI
            </a-select-option>
            <a-select-option value="qianfan">
              百度千帆
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item
          v-if="needsApiKey"
          label="API密钥"
          required
        >
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

        <!-- 测试连接按钮 -->
        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              :loading="testing"
              @click="testConnection"
            >
              测试连接
            </a-button>
            <a-tag
              v-if="testResult"
              :color="testResult.success ? 'success' : 'error'"
            >
              {{ testResult.message }}
            </a-tag>
          </a-space>
        </a-form-item>
      </a-form>
    </div>

    <!-- 跳过模式 -->
    <div
      v-if="currentMode === 'skip'"
      class="config-panel"
    >
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
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, reactive } from 'vue';
import { message } from 'ant-design-vue';
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

// 测试连接相关
const testing = ref(false);
const testResult = ref(null);

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

// 测试连接
const testConnection = async () => {
  testing.value = true;
  testResult.value = null;

  try {
    // 验证必填字段
    if (formData.provider !== 'ollama' && !formData.apiKey) {
      throw new Error('请先输入 API Key');
    }

    // 如果没有window.electronAPI，提示错误
    if (!window.electronAPI || !window.electronAPI.llm) {
      throw new Error('LLM API 不可用');
    }

    // 构建完整的LLM配置对象
    const llmConfig = {
      provider: formData.provider,
      options: {
        temperature: 0.7,
        timeout: 120000,
      },
    };

    // 根据提供商添加特定配置
    switch (formData.provider) {
      case 'ollama':
        llmConfig.ollama = {
          url: formData.baseUrl || 'http://localhost:11434',
          model: formData.model || 'llama2',
        };
        break;
      case 'openai':
        llmConfig.openai = {
          apiKey: formData.apiKey,
          baseURL: formData.baseUrl || 'https://api.openai.com/v1',
          model: formData.model || 'gpt-3.5-turbo',
        };
        break;
      case 'anthropic':
        llmConfig.anthropic = {
          apiKey: formData.apiKey,
          baseURL: formData.baseUrl || 'https://api.anthropic.com',
          model: formData.model || 'claude-3-5-sonnet-20241022',
          version: '2023-06-01',
        };
        break;
      case 'volcengine':
        llmConfig.volcengine = {
          apiKey: formData.apiKey,
          baseURL: formData.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
          model: formData.model || 'doubao-pro-4k',
        };
        break;
      case 'deepseek':
        llmConfig.deepseek = {
          apiKey: formData.apiKey,
          baseURL: formData.baseUrl || 'https://api.deepseek.com/v1',
          model: formData.model || 'deepseek-chat',
        };
        break;
      case 'zhipu':
        llmConfig.zhipu = {
          apiKey: formData.apiKey,
          model: formData.model || 'glm-4',
        };
        break;
      case 'qianfan':
        llmConfig.qianfan = {
          apiKey: formData.apiKey,
          model: formData.model || 'ERNIE-Bot-turbo',
        };
        break;
    }

    // 先保存配置到LLM服务
    await window.electronAPI.llm.setConfig(llmConfig);

    // 然后测试连接
    const result = await window.electronAPI.llm.checkStatus();

    if (result.available) {
      testResult.value = {
        success: true,
        message: '连接成功！',
      };
      message.success('LLM 服务连接成功');
    } else {
      testResult.value = {
        success: false,
        message: '连接失败: ' + (result.error || '未知错误'),
      };
      message.error('连接失败');
    }
  } catch (error) {
    logger.error('测试连接失败:', error);
    testResult.value = {
      success: false,
      message: '测试失败: ' + error.message,
    };
    message.error('测试失败：' + error.message);
  } finally {
    testing.value = false;
  }
};

const getApiKeyLink = () => {
  const links = {
    volcengine: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    openai: 'https://platform.openai.com/api-keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
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
    anthropic: 'claude-3-5-sonnet-20241022',
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
