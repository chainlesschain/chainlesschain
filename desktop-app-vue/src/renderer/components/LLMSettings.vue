<template>
  <div class="llm-settings">
    <a-card title="LLM 服务设置" :loading="loading">
      <a-form
        :model="form"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
        @finish="handleSave"
      >
        <!-- 提供商选择 -->
        <a-form-item label="服务提供商">
          <a-radio-group v-model:value="form.provider" @change="handleProviderChange">
            <a-radio-button value="ollama">Ollama (本地)</a-radio-button>
            <a-radio-button value="openai">OpenAI</a-radio-button>
            <a-radio-button value="deepseek">DeepSeek</a-radio-button>
            <a-radio-button value="custom">自定义API</a-radio-button>
          </a-radio-group>
          <div class="form-hint">
            选择LLM服务提供商
          </div>
        </a-form-item>

        <!-- Ollama 配置 -->
        <template v-if="form.provider === 'ollama'">
          <a-divider orientation="left">Ollama 配置</a-divider>

          <a-form-item label="服务地址">
            <a-input
              v-model:value="form.ollama.url"
              placeholder="http://localhost:11434"
            />
            <div class="form-hint">
              Ollama 服务的地址，默认为 http://localhost:11434
            </div>
          </a-form-item>

          <a-form-item label="模型">
            <a-select
              v-model:value="form.ollama.model"
              placeholder="选择或输入模型名称"
              :loading="modelsLoading"
              show-search
              allow-clear
              @dropdown-visible-change="handleModelsDropdown"
            >
              <a-select-option
                v-for="model in availableModels"
                :key="model.name"
                :value="model.name"
              >
                {{ model.name }}
                <span v-if="model.size" class="model-size">
                  ({{ formatSize(model.size) }})
                </span>
              </a-select-option>
            </a-select>
            <div class="form-hint">
              选择已安装的模型，如 llama2, llama3, mistral 等
            </div>
          </a-form-item>
        </template>

        <!-- OpenAI 配置 -->
        <template v-if="form.provider === 'openai'">
          <a-divider orientation="left">OpenAI 配置</a-divider>

          <a-form-item label="API Key" required>
            <a-input-password
              v-model:value="form.openai.apiKey"
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <div class="form-hint">
              OpenAI API 密钥
            </div>
          </a-form-item>

          <a-form-item label="API 地址">
            <a-input
              v-model:value="form.openai.baseURL"
              placeholder="https://api.openai.com/v1"
            />
            <div class="form-hint">
              默认为官方API地址，使用代理时可修改
            </div>
          </a-form-item>

          <a-form-item label="模型">
            <a-select
              v-model:value="form.openai.model"
              placeholder="选择模型"
            >
              <a-select-option value="gpt-4">GPT-4</a-select-option>
              <a-select-option value="gpt-4-turbo">GPT-4 Turbo</a-select-option>
              <a-select-option value="gpt-3.5-turbo">GPT-3.5 Turbo</a-select-option>
              <a-select-option value="gpt-4o">GPT-4o</a-select-option>
              <a-select-option value="gpt-4o-mini">GPT-4o Mini</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="Organization ID">
            <a-input
              v-model:value="form.openai.organization"
              placeholder="org-xxxxxxxxxxxxxxxx (可选)"
            />
            <div class="form-hint">
              组织ID（可选）
            </div>
          </a-form-item>
        </template>

        <!-- DeepSeek 配置 -->
        <template v-if="form.provider === 'deepseek'">
          <a-divider orientation="left">DeepSeek 配置</a-divider>

          <a-form-item label="API Key" required>
            <a-input-password
              v-model:value="form.deepseek.apiKey"
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <div class="form-hint">
              DeepSeek API 密钥
            </div>
          </a-form-item>

          <a-form-item label="模型">
            <a-select
              v-model:value="form.deepseek.model"
              placeholder="选择模型"
            >
              <a-select-option value="deepseek-chat">DeepSeek Chat</a-select-option>
              <a-select-option value="deepseek-coder">DeepSeek Coder</a-select-option>
            </a-select>
          </a-form-item>
        </template>

        <!-- 自定义 API 配置 -->
        <template v-if="form.provider === 'custom'">
          <a-divider orientation="left">自定义 API 配置</a-divider>

          <a-form-item label="服务名称">
            <a-input
              v-model:value="form.custom.name"
              placeholder="自定义服务名称"
            />
          </a-form-item>

          <a-form-item label="API 地址" required>
            <a-input
              v-model:value="form.custom.baseURL"
              placeholder="https://api.example.com/v1"
            />
            <div class="form-hint">
              兼容 OpenAI API 格式的服务地址
            </div>
          </a-form-item>

          <a-form-item label="API Key">
            <a-input-password
              v-model:value="form.custom.apiKey"
              placeholder="API密钥（如需要）"
            />
          </a-form-item>

          <a-form-item label="模型名称" required>
            <a-input
              v-model:value="form.custom.model"
              placeholder="model-name"
            />
            <div class="form-hint">
              模型标识符
            </div>
          </a-form-item>
        </template>

        <!-- 通用选项 -->
        <a-divider orientation="left">生成参数</a-divider>

        <a-form-item label="Temperature">
          <a-slider
            v-model:value="form.options.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            :marks="{ 0: '0', 1: '1', 2: '2' }"
          />
          <div class="form-hint">
            控制随机性。值越高，输出越随机；值越低，输出越确定。推荐 0.7
          </div>
        </a-form-item>

        <a-form-item label="Top P">
          <a-slider
            v-model:value="form.options.top_p"
            :min="0"
            :max="1"
            :step="0.05"
            :marks="{ 0: '0', 0.5: '0.5', 1: '1' }"
          />
          <div class="form-hint">
            核采样参数。推荐 0.9
          </div>
        </a-form-item>

        <a-form-item label="Top K">
          <a-input-number
            v-model:value="form.options.top_k"
            :min="1"
            :max="100"
            style="width: 120px"
          />
          <div class="form-hint">
            仅保留概率最高的K个词。推荐 40
          </div>
        </a-form-item>

        <a-form-item label="最大Token数">
          <a-input-number
            v-model:value="form.options.max_tokens"
            :min="100"
            :max="32000"
            :step="100"
            style="width: 150px"
          />
          <div class="form-hint">
            单次生成的最大token数量
          </div>
        </a-form-item>

        <a-form-item label="超时时间">
          <a-input-number
            v-model:value="timeoutSeconds"
            :min="10"
            :max="300"
            style="width: 120px"
          />
          <span class="unit-text">秒</span>
          <div class="form-hint">
            API请求超时时间
          </div>
        </a-form-item>

        <!-- 系统提示词 -->
        <a-divider orientation="left">系统设置</a-divider>

        <a-form-item label="系统提示词">
          <a-textarea
            v-model:value="form.systemPrompt"
            :rows="4"
            placeholder="输入系统提示词..."
          />
          <div class="form-hint">
            定义AI助手的角色和行为
          </div>
        </a-form-item>

        <a-form-item label="启用流式输出">
          <a-switch v-model:checked="form.streamEnabled" />
          <div class="form-hint">
            启用后，响应将逐字显示
          </div>
        </a-form-item>

        <a-form-item label="自动保存对话">
          <a-switch v-model:checked="form.autoSaveConversations" />
          <div class="form-hint">
            自动保存对话历史到数据库
          </div>
        </a-form-item>

        <!-- 操作按钮 -->
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-space>
            <a-button type="primary" html-type="submit" :loading="saving">
              保存设置
            </a-button>
            <a-button @click="handleTest" :loading="testing">
              测试连接
            </a-button>
            <a-button @click="handleReset">
              恢复默认
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 连接状态 -->
    <a-card title="服务状态" class="status-card" style="margin-top: 16px">
      <a-descriptions bordered :column="2">
        <a-descriptions-item label="服务状态">
          <a-tag v-if="status.available" color="success">可用</a-tag>
          <a-tag v-else color="error">不可用</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="当前提供商">
          {{ getProviderName(status.provider) }}
        </a-descriptions-item>
        <a-descriptions-item label="可用模型数" v-if="status.models">
          {{ status.models.length }}
        </a-descriptions-item>
        <a-descriptions-item label="错误信息" v-if="status.error" :span="2">
          <a-typography-text type="danger">{{ status.error }}</a-typography-text>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';

// 状态
const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const modelsLoading = ref(false);
const availableModels = ref([]);
const status = ref({
  available: false,
  provider: '',
  models: [],
  error: null,
});

// 表单数据
const form = reactive({
  provider: 'ollama',

  ollama: {
    url: 'http://localhost:11434',
    model: 'llama2',
  },

  openai: {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    organization: '',
  },

  deepseek: {
    apiKey: '',
    model: 'deepseek-chat',
  },

  custom: {
    name: 'Custom Provider',
    apiKey: '',
    baseURL: '',
    model: '',
  },

  options: {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    timeout: 120000,
  },

  systemPrompt: 'You are a helpful AI assistant for a knowledge management system.',
  streamEnabled: true,
  autoSaveConversations: true,
});

// 超时时间（秒）
const timeoutSeconds = computed({
  get: () => Math.round(form.options.timeout / 1000),
  set: (val) => {
    form.options.timeout = val * 1000;
  },
});

// 加载配置
const loadConfig = async () => {
  loading.value = true;
  try {
    const config = await window.electronAPI.llm.getConfig();
    if (config) {
      Object.assign(form, config);
    }
  } catch (error) {
    console.error('加载配置失败:', error);
    message.error('加载配置失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 保存配置
const handleSave = async () => {
  saving.value = true;
  try {
    await window.electronAPI.llm.setConfig(form);
    message.success('配置已保存');
    await checkStatus();
  } catch (error) {
    console.error('保存配置失败:', error);
    message.error('保存配置失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

// 测试连接
const handleTest = async () => {
  testing.value = true;
  try {
    // 先保存配置
    await window.electronAPI.llm.setConfig(form);

    // 检查状态
    const result = await window.electronAPI.llm.checkStatus();

    if (result.available) {
      message.success('连接成功！服务正常运行');
      status.value = result;
    } else {
      message.error('连接失败: ' + (result.error || '未知错误'));
      status.value = result;
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    message.error('测试连接失败: ' + error.message);
  } finally {
    testing.value = false;
  }
};

// 恢复默认设置
const handleReset = () => {
  form.provider = 'ollama';
  form.ollama = {
    url: 'http://localhost:11434',
    model: 'llama2',
  };
  form.openai = {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    organization: '',
  };
  form.deepseek = {
    apiKey: '',
    model: 'deepseek-chat',
  };
  form.custom = {
    name: 'Custom Provider',
    apiKey: '',
    baseURL: '',
    model: '',
  };
  form.options = {
    temperature: 0.7,
    top_p: 0.9,
    top_k: 40,
    max_tokens: 2000,
    timeout: 120000,
  };
  form.systemPrompt = 'You are a helpful AI assistant for a knowledge management system.';
  form.streamEnabled = true;
  form.autoSaveConversations = true;

  message.info('已恢复默认设置');
};

// 检查服务状态
const checkStatus = async () => {
  try {
    const result = await window.electronAPI.llm.checkStatus();
    status.value = result;
  } catch (error) {
    console.error('检查状态失败:', error);
  }
};

// 加载可用模型
const loadModels = async () => {
  if (form.provider !== 'ollama') return;

  modelsLoading.value = true;
  try {
    const models = await window.electronAPI.llm.listModels();
    availableModels.value = models;
  } catch (error) {
    console.error('加载模型列表失败:', error);
  } finally {
    modelsLoading.value = false;
  }
};

// 模型下拉框显示时加载
const handleModelsDropdown = (visible) => {
  if (visible && availableModels.value.length === 0) {
    loadModels();
  }
};

// 提供商改变时
const handleProviderChange = () => {
  if (form.provider === 'ollama') {
    loadModels();
  }
};

// 获取提供商名称
const getProviderName = (provider) => {
  const names = {
    ollama: 'Ollama (本地)',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    custom: '自定义API',
  };
  return names[provider] || provider;
};

// 格式化大小
const formatSize = (bytes) => {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)}GB`;
};

// 组件挂载时
onMounted(() => {
  loadConfig();
  checkStatus();
});
</script>

<style scoped>
.llm-settings {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.form-hint {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-top: 4px;
}

.unit-text {
  margin-left: 8px;
  color: rgba(0, 0, 0, 0.45);
}

.model-size {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-left: 4px;
}

.status-card :deep(.ant-descriptions-item-label) {
  font-weight: 500;
}
</style>
