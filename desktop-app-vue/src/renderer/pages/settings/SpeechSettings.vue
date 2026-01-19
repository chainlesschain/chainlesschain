<template>
  <div class="speech-settings">
    <a-card
      title="语音识别设置"
      :bordered="false"
    >
      <a-form
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <!-- 识别引擎选择 -->
        <a-form-item label="识别引擎">
          <a-radio-group
            v-model:value="config.defaultEngine"
            button-style="solid"
            @change="handleEngineChange"
          >
            <a-radio-button value="whisper-local">
              <CloudServerOutlined />
              Whisper Local (离线)
            </a-radio-button>
            <a-radio-button value="whisper-api">
              <ApiOutlined />
              Whisper API (云端)
            </a-radio-button>
            <a-radio-button value="webspeech">
              <SoundOutlined />
              Web Speech API
            </a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- Whisper Local 配置 -->
        <template v-if="config.defaultEngine === 'whisper-local'">
          <a-divider>Whisper Local 配置</a-divider>

          <a-form-item label="服务地址">
            <a-input
              v-model:value="config.whisperLocal.serverUrl"
              placeholder="http://localhost:8002"
            >
              <template #suffix>
                <a-button
                  type="link"
                  size="small"
                  :loading="testing"
                  @click="testConnection"
                >
                  测试连接
                </a-button>
              </template>
            </a-input>
            <template #extra>
              <a-space>
                <a-tag
                  v-if="connectionStatus === 'success'"
                  color="success"
                >
                  <CheckCircleOutlined />
                  连接正常
                </a-tag>
                <a-tag
                  v-else-if="connectionStatus === 'error'"
                  color="error"
                >
                  <CloseCircleOutlined />
                  连接失败
                </a-tag>
                <a-tag
                  v-else
                  color="default"
                >
                  <QuestionCircleOutlined />
                  未测试
                </a-tag>
              </a-space>
            </template>
          </a-form-item>

          <a-form-item label="模型大小">
            <a-select
              v-model:value="config.whisperLocal.modelSize"
              style="width: 200px;"
            >
              <a-select-option value="tiny">
                Tiny (75MB) - 最快
              </a-select-option>
              <a-select-option value="base">
                Base (140MB) - 推荐
              </a-select-option>
              <a-select-option value="small">
                Small (460MB) - 更准确
              </a-select-option>
              <a-select-option value="medium">
                Medium (1.5GB) - 高准确度
              </a-select-option>
              <a-select-option value="large">
                Large (2.9GB) - 最高质量
              </a-select-option>
            </a-select>
            <template #extra>
              <a-space
                direction="vertical"
                size="small"
                style="margin-top: 8px;"
              >
                <div v-if="modelInfo">
                  <a-tag color="blue">
                    速度: {{ modelInfo.speed }}
                  </a-tag>
                  <a-tag color="green">
                    准确度: {{ modelInfo.accuracy }}
                  </a-tag>
                </div>
                <span style="color: #999;">
                  {{ modelDescription }}
                </span>
              </a-space>
            </template>
          </a-form-item>

          <a-form-item label="默认语言">
            <a-select
              v-model:value="config.whisperLocal.defaultLanguage"
              style="width: 200px;"
            >
              <a-select-option value="zh">
                中文
              </a-select-option>
              <a-select-option value="en">
                English
              </a-select-option>
              <a-select-option value="ja">
                日本語
              </a-select-option>
              <a-select-option value="ko">
                한국어
              </a-select-option>
              <a-select-option value="auto">
                自动检测
              </a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="超时时间">
            <a-input-number
              v-model:value="config.whisperLocal.timeout"
              :min="30000"
              :max="300000"
              :step="10000"
              style="width: 200px;"
            />
            <span style="margin-left: 8px;">毫秒</span>
          </a-form-item>

          <a-alert
            message="离线语音识别"
            description="Whisper Local 使用本地服务器进行语音识别，完全离线运行，保护隐私。需要先启动 Whisper 服务。"
            type="info"
            show-icon
            style="margin-bottom: 16px;"
          />
        </template>

        <!-- Whisper API 配置 -->
        <template v-if="config.defaultEngine === 'whisper-api'">
          <a-divider>Whisper API 配置</a-divider>

          <a-form-item label="API 密钥">
            <a-input-password
              v-model:value="config.whisperAPI.apiKey"
              placeholder="sk-..."
            />
          </a-form-item>

          <a-form-item label="API 地址">
            <a-input
              v-model:value="config.whisperAPI.baseURL"
              placeholder="https://api.openai.com/v1"
            />
          </a-form-item>

          <a-form-item label="模型">
            <a-input
              v-model:value="config.whisperAPI.model"
              placeholder="whisper-1"
              disabled
            />
          </a-form-item>

          <a-alert
            message="云端语音识别"
            description="使用 OpenAI Whisper API 进行语音识别，需要网络连接和 API 密钥。"
            type="warning"
            show-icon
          />
        </template>

        <!-- Web Speech API 配置 -->
        <template v-if="config.defaultEngine === 'webspeech'">
          <a-divider>Web Speech API 配置</a-divider>

          <a-form-item label="语言">
            <a-select
              v-model:value="config.webSpeech.lang"
              style="width: 200px;"
            >
              <a-select-option value="zh-CN">
                中文（简体）
              </a-select-option>
              <a-select-option value="zh-TW">
                中文（繁体）
              </a-select-option>
              <a-select-option value="en-US">
                English (US)
              </a-select-option>
              <a-select-option value="en-GB">
                English (UK)
              </a-select-option>
              <a-select-option value="ja-JP">
                日本語
              </a-select-option>
              <a-select-option value="ko-KR">
                한국어
              </a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="连续识别">
            <a-switch v-model:checked="config.webSpeech.continuous" />
            <span style="margin-left: 8px;">持续监听语音输入</span>
          </a-form-item>

          <a-form-item label="临时结果">
            <a-switch v-model:checked="config.webSpeech.interimResults" />
            <span style="margin-left: 8px;">显示识别过程中的临时结果</span>
          </a-form-item>

          <a-alert
            message="浏览器语音识别"
            description="使用浏览器内置的语音识别功能，需要网络连接。不同浏览器支持程度不同。"
            type="info"
            show-icon
          />
        </template>

        <!-- 通用设置 -->
        <a-divider>通用设置</a-divider>

        <a-form-item label="自动保存">
          <a-switch v-model:checked="config.knowledgeIntegration.autoSaveToKnowledge" />
          <span style="margin-left: 8px;">自动保存转录结果到知识库</span>
        </a-form-item>

        <a-form-item label="自动索引">
          <a-switch v-model:checked="config.knowledgeIntegration.autoAddToIndex" />
          <span style="margin-left: 8px;">自动添加到 RAG 索引</span>
        </a-form-item>

        <a-form-item label="快捷键">
          <a-input
            v-model:value="config.hotkey"
            placeholder="Ctrl+Shift+V"
            disabled
          />
          <template #extra>
            <span style="color: #999;">按下快捷键开始语音输入</span>
          </template>
        </a-form-item>

        <!-- 操作按钮 -->
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-space>
            <a-button
              type="primary"
              :loading="saving"
              @click="handleSave"
            >
              <SaveOutlined />
              保存设置
            </a-button>
            <a-button @click="handleReset">
              <ReloadOutlined />
              重置默认
            </a-button>
            <a-button @click="handleTest">
              <SoundOutlined />
              测试语音识别
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- 服务状态卡片 -->
    <a-card
      v-if="config.defaultEngine === 'whisper-local'"
      title="服务状态"
      :bordered="false"
      style="margin-top: 16px;"
    >
      <a-descriptions
        :column="2"
        bordered
        size="small"
      >
        <a-descriptions-item label="服务地址">
          {{ config.whisperLocal.serverUrl }}
        </a-descriptions-item>
        <a-descriptions-item label="连接状态">
          <a-badge
            :status="connectionStatus === 'success' ? 'success' : 'error'"
            :text="connectionStatus === 'success' ? '正常' : '断开'"
          />
        </a-descriptions-item>
        <a-descriptions-item label="当前模型">
          {{ config.whisperLocal.modelSize }}
        </a-descriptions-item>
        <a-descriptions-item label="设备">
          {{ serviceInfo.device || 'CPU' }}
        </a-descriptions-item>
        <a-descriptions-item
          label="已加载模型"
          :span="2"
        >
          <a-space>
            <a-tag
              v-for="model in serviceInfo.models_loaded"
              :key="model"
              color="blue"
            >
              {{ model }}
            </a-tag>
            <span v-if="!serviceInfo.models_loaded || serviceInfo.models_loaded.length === 0">
              无
            </span>
          </a-space>
        </a-descriptions-item>
      </a-descriptions>

      <a-divider />

      <a-space>
        <a-button
          :loading="testing"
          @click="testConnection"
        >
          <ReloadOutlined />
          刷新状态
        </a-button>
        <a-button @click="openServiceDocs">
          <FileTextOutlined />
          查看文档
        </a-button>
        <a-button @click="openAPIDoc">
          <ApiOutlined />
          API 文档
        </a-button>
      </a-space>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  CloudServerOutlined,
  ApiOutlined,
  SoundOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  ReloadOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';

// 配置数据
const config = reactive({
  defaultEngine: 'whisper-local',
  whisperLocal: {
    serverUrl: 'http://localhost:8002',
    modelSize: 'base',
    defaultLanguage: 'zh',
    timeout: 120000,
  },
  whisperAPI: {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    model: 'whisper-1',
  },
  webSpeech: {
    lang: 'zh-CN',
    continuous: true,
    interimResults: true,
  },
  knowledgeIntegration: {
    autoSaveToKnowledge: true,
    autoAddToIndex: true,
  },
  hotkey: 'Ctrl+Shift+V',
});

// 状态
const testing = ref(false);
const saving = ref(false);
const connectionStatus = ref('unknown');
const serviceInfo = reactive({
  device: '',
  models_loaded: [],
});

// 模型信息
const modelInfo = computed(() => {
  const models = {
    tiny: { speed: '很快', accuracy: '基础' },
    base: { speed: '快', accuracy: '良好' },
    small: { speed: '中等', accuracy: '较好' },
    medium: { speed: '慢', accuracy: '高' },
    large: { speed: '很慢', accuracy: '最高' },
  };
  return models[config.whisperLocal.modelSize];
});

const modelDescription = computed(() => {
  const descriptions = {
    tiny: '最快的模型，适合快速测试和实时转录',
    base: '推荐用于日常使用，速度和准确度平衡',
    small: '更高的准确度，适合重要内容转录',
    medium: '专业级准确度，适合会议记录等场景',
    large: '最高质量，适合对准确度要求极高的场景',
  };
  return descriptions[config.whisperLocal.modelSize];
});

// 测试连接
const testConnection = async () => {
  testing.value = true;
  connectionStatus.value = 'unknown';

  try {
    const response = await fetch(`${config.whisperLocal.serverUrl}/health`);
    if (response.ok) {
      const data = await response.json();
      connectionStatus.value = 'success';
      serviceInfo.device = data.device;
      serviceInfo.models_loaded = data.models_loaded || [];
      message.success('连接成功！');
    } else {
      connectionStatus.value = 'error';
      message.error('连接失败：服务器响应错误');
    }
  } catch (error) {
    connectionStatus.value = 'error';
    message.error(`连接失败：${error.message}`);
  } finally {
    testing.value = false;
  }
};

// 保存设置
const handleSave = async () => {
  saving.value = true;
  try {
    // 调用 IPC 保存配置
    await window.electron.ipcRenderer.invoke('speech:updateConfig', config);
    message.success('设置已保存');
  } catch (error) {
    message.error(`保存失败：${error.message}`);
  } finally {
    saving.value = false;
  }
};

// 重置设置
const handleReset = () => {
  config.defaultEngine = 'whisper-local';
  config.whisperLocal.serverUrl = 'http://localhost:8002';
  config.whisperLocal.modelSize = 'base';
  config.whisperLocal.defaultLanguage = 'zh';
  config.whisperLocal.timeout = 120000;
  message.info('已重置为默认设置');
};

// 测试语音识别
const handleTest = () => {
  message.info('打开语音识别测试窗口...');
  // TODO: 打开测试窗口
};

// 引擎切换
const handleEngineChange = () => {
  message.info(`已切换到 ${config.defaultEngine} 引擎`);
};

// 打开文档
const openServiceDocs = () => {
  window.open('file:///Users/mac/Documents/code2/chainlesschain/backend/whisper-service/README.md');
};

const openAPIDoc = () => {
  window.open(`${config.whisperLocal.serverUrl}/docs`);
};

// 加载配置
onMounted(async () => {
  try {
    const savedConfig = await window.electron.ipcRenderer.invoke('speech:getConfig');
    if (savedConfig) {
      Object.assign(config, savedConfig);
    }
    // 自动测试连接
    if (config.defaultEngine === 'whisper-local') {
      await testConnection();
    }
  } catch (error) {
    logger.error('加载配置失败:', error);
  }
});
</script>

<style scoped>
.speech-settings {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

:deep(.ant-form-item-extra) {
  margin-top: 8px;
}

:deep(.ant-alert) {
  margin-top: 16px;
}
</style>
