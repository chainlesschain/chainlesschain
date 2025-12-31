<template>
  <a-modal
    :open="visible"
    :closable="canSkip"
    :maskClosable="false"
    :width="800"
    :footer="null"
    @cancel="handleCancel"
    class="global-settings-wizard"
  >
    <a-steps :current="currentStep" class="wizard-steps" size="small">
      <a-step title="欢迎" />
      <a-step title="版本选择" />
      <a-step title="项目路径" />
      <a-step title="数据库" />
      <a-step title="AI配置" />
      <a-step title="完成" />
    </a-steps>

    <div class="wizard-content">
      <!-- 步骤 0: 欢迎 -->
      <div v-if="currentStep === 0" class="step-panel">
        <a-result status="success" title="欢迎使用 ChainlessChain">
          <template #icon>
            <RocketOutlined style="color: #1890ff" />
          </template>
          <template #subTitle>
            <div class="welcome-text">
              <p>ChainlessChain 是您的个人AI知识管理系统</p>
              <p>在开始使用前，让我们快速配置一些关键设置</p>
            </div>
          </template>
          <template #extra>
            <a-space direction="vertical" size="large" style="width: 100%">
              <a-alert
                message="首次设置向导"
                description="这个向导将帮助您配置项目存储路径、数据库位置和AI服务。整个过程只需2-3分钟。"
                type="info"
                show-icon
              />
            </a-space>
          </template>
        </a-result>
      </div>

      <!-- 步骤 1: 版本选择 -->
      <div v-if="currentStep === 1" class="step-panel">
        <EditionSelector
          v-model="formState.edition"
          @update:enterpriseConfig="handleEnterpriseConfig"
        />
      </div>

      <!-- 步骤 2: 项目路径 -->
      <div v-if="currentStep === 2" class="step-panel">
        <PathSelector
          v-model="formState.projectPath"
          label="项目文件存储根目录"
          description="您的知识库项目将存储在此目录下"
          :defaultPath="defaultPaths.project"
        />
      </div>

      <!-- 步骤 3: 数据库路径 -->
      <div v-if="currentStep === 3" class="step-panel">
        <PathSelector
          v-model="formState.databasePath"
          label="数据库文件存储位置"
          description="SQLite数据库文件将存储在此目录下"
          :defaultPath="defaultPaths.database"
        />
      </div>

      <!-- 步骤 4: LLM 配置 -->
      <div v-if="currentStep === 4" class="step-panel">
        <LLMQuickSetup v-model="formState.llm" />
      </div>

      <!-- 步骤 5: 完成 -->
      <div v-if="currentStep === 5" class="step-panel">
        <a-result status="success" title="配置完成">
          <template #icon>
            <CheckCircleOutlined style="color: #52c41a" />
          </template>
          <template #subTitle>
            <p>请确认您的配置信息</p>
          </template>
          <template #extra>
            <a-descriptions bordered size="small" :column="1">
              <a-descriptions-item label="版本">
                {{ formState.edition === 'personal' ? '个人版' : '企业版' }}
              </a-descriptions-item>
              <a-descriptions-item label="项目路径">
                {{ formState.projectPath || defaultPaths.project || '使用默认路径' }}
              </a-descriptions-item>
              <a-descriptions-item label="数据库路径">
                {{ formState.databasePath || defaultPaths.database || '使用默认路径' }}
              </a-descriptions-item>
              <a-descriptions-item label="AI提供商">
                {{ getLLMProviderName() }}
              </a-descriptions-item>
              <a-descriptions-item v-if="formState.edition === 'enterprise'" label="企业服务器">
                {{ formState.enterpriseConfig.serverUrl || '未配置' }}
              </a-descriptions-item>
            </a-descriptions>
          </template>
        </a-result>
      </div>
    </div>

    <div class="wizard-actions">
      <a-button v-if="currentStep > 0" @click="prevStep">
        上一步
      </a-button>
      <a-button
        v-if="currentStep < 5"
        type="primary"
        @click="nextStep"
      >
        下一步
      </a-button>
      <a-button
        v-if="currentStep === 5"
        type="primary"
        :loading="saving"
        @click="handleComplete"
      >
        完成设置
      </a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  RocketOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';
import EditionSelector from './settings/EditionSelector.vue';
import PathSelector from './settings/PathSelector.vue';
import LLMQuickSetup from './settings/LLMQuickSetup.vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  canSkip: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['complete', 'cancel']);

const currentStep = ref(0);
const saving = ref(false);

const formState = reactive({
  edition: 'personal',
  projectPath: '',
  databasePath: '',
  llm: {
    mode: 'simple',
    provider: 'ollama',
    apiKey: '',
    baseUrl: '',
    model: '',
  },
  enterpriseConfig: {
    serverUrl: '',
    tenantId: '',
    apiKey: '',
  },
});

const defaultPaths = reactive({
  project: '',
  database: '',
});

onMounted(async () => {
  try {
    // 加载默认路径
    const dbConfig = await window.electronAPI.db.getConfig();
    defaultPaths.database = dbConfig.defaultPath;

    const projectPath = await window.electronAPI.config.get('project.rootPath');
    defaultPaths.project = projectPath || '';
  } catch (error) {
    console.error('加载默认配置失败:', error);
  }
});

const nextStep = () => {
  if (currentStep.value < 5) {
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
};

const handleEnterpriseConfig = (config) => {
  formState.enterpriseConfig = config;
};

const getLLMProviderName = () => {
  if (formState.llm.mode === 'skip') {
    return '稍后配置';
  }

  const providers = {
    ollama: 'Ollama (本地)',
    volcengine: '火山引擎',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    zhipu: '智谱AI',
    qianfan: '百度千帆',
  };

  return providers[formState.llm.provider] || formState.llm.provider;
};

const handleComplete = async () => {
  try {
    saving.value = true;

    // 构建配置对象
    const config = {
      edition: formState.edition,
      paths: {
        projectRoot: formState.projectPath || defaultPaths.project,
        database: formState.databasePath || defaultPaths.database,
      },
      llm: formState.llm.mode !== 'skip'
        ? {
            provider: formState.llm.provider,
            apiKey: formState.llm.apiKey,
            baseUrl: formState.llm.baseUrl,
            model: formState.llm.model,
          }
        : null,
      enterprise:
        formState.edition === 'enterprise'
          ? formState.enterpriseConfig
          : null,
    };

    // 保存并应用配置
    const result = await window.electronAPI.initialSetup.complete(config);

    if (result.success) {
      message.success('设置已保存');
      emit('complete');
    } else {
      message.error('保存设置失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    console.error('保存配置失败:', error);
    message.error('保存配置失败: ' + error.message);
  } finally {
    saving.value = false;
  }
};

const handleCancel = () => {
  if (props.canSkip) {
    emit('cancel');
  }
};
</script>

<style scoped>
.global-settings-wizard :deep(.ant-modal-body) {
  padding: 24px;
}

.wizard-steps {
  margin-bottom: 30px;
}

.wizard-content {
  min-height: 400px;
  padding: 20px 0;
}

.step-panel {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.welcome-text {
  font-size: 16px;
  line-height: 1.8;
  color: #595959;
}

.welcome-text p {
  margin: 8px 0;
}

.wizard-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}

.wizard-actions .ant-btn {
  min-width: 100px;
}
</style>
