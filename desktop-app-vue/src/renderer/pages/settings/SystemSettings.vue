<template>
  <div class="system-settings">
    <div class="settings-header">
      <h1>
        <SettingOutlined />
        系统设置
      </h1>
      <p>配置应用程序的各项参数</p>
    </div>

    <a-spin :spinning="loading">
      <a-tabs v-model:activeKey="activeTab" type="card">
        <!-- 项目配置 -->
        <a-tab-pane key="project" tab="项目存储">
          <template #tab>
            <FolderOutlined />
            项目存储
          </template>
          <a-card title="项目存储配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="项目根目录">
                <a-input
                  v-model:value="config.project.rootPath"
                  placeholder="项目文件存储的根目录路径"
                />
                <template #extra>
                  <a-space>
                    <a-button size="small" @click="handleSelectFolder('project.rootPath')">
                      <FolderOpenOutlined />
                      选择目录
                    </a-button>
                    <span style="color: #999;">修改后需重启应用生效</span>
                  </a-space>
                </template>
              </a-form-item>

              <a-form-item label="最大项目大小">
                <a-input-number
                  v-model:value="config.project.maxSizeMB"
                  :min="100"
                  :max="10000"
                  :step="100"
                  addon-after="MB"
                  style="width: 200px;"
                />
              </a-form-item>

              <a-form-item label="自动同步">
                <a-switch v-model:checked="config.project.autoSync" />
                <span style="margin-left: 8px;">自动同步项目到后端服务器</span>
              </a-form-item>

              <a-form-item label="同步间隔" v-if="config.project.autoSync">
                <a-input-number
                  v-model:value="config.project.syncIntervalSeconds"
                  :min="60"
                  :max="3600"
                  :step="60"
                  addon-after="秒"
                  style="width: 200px;"
                />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- LLM 配置 -->
        <a-tab-pane key="llm" tab="AI 模型">
          <template #tab>
            <RobotOutlined />
            AI 模型
          </template>
          <a-card title="LLM 服务配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="服务提供商">
                <a-select v-model:value="config.llm.provider" style="width: 100%;">
                  <a-select-option value="ollama">Ollama（本地）</a-select-option>
                  <a-select-option value="openai">OpenAI</a-select-option>
                  <a-select-option value="volcengine">火山引擎（豆包）</a-select-option>
                  <a-select-option value="dashscope">阿里通义千问</a-select-option>
                  <a-select-option value="zhipu">智谱 AI</a-select-option>
                  <a-select-option value="deepseek">DeepSeek</a-select-option>
                </a-select>
              </a-form-item>

              <!-- Ollama 配置 -->
              <a-divider v-if="config.llm.provider === 'ollama'">Ollama 配置</a-divider>
              <template v-if="config.llm.provider === 'ollama'">
                <a-form-item label="服务地址">
                  <a-input v-model:value="config.llm.ollamaHost" placeholder="http://localhost:11434" />
                </a-form-item>
                <a-form-item label="模型名称">
                  <a-input v-model:value="config.llm.ollamaModel" placeholder="qwen2:7b" />
                </a-form-item>
              </template>

              <!-- OpenAI 配置 -->
              <a-divider v-if="config.llm.provider === 'openai'">OpenAI 配置</a-divider>
              <template v-if="config.llm.provider === 'openai'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.openaiApiKey" placeholder="sk-..." />
                </a-form-item>
                <a-form-item label="API 地址">
                  <a-input v-model:value="config.llm.openaiBaseUrl" placeholder="https://api.openai.com/v1" />
                </a-form-item>
                <a-form-item label="模型">
                  <a-input v-model:value="config.llm.openaiModel" placeholder="gpt-3.5-turbo" />
                </a-form-item>
              </template>

              <!-- 火山引擎配置 -->
              <a-divider v-if="config.llm.provider === 'volcengine'">火山引擎（豆包）配置</a-divider>
              <template v-if="config.llm.provider === 'volcengine'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.volcengineApiKey" />
                </a-form-item>
                <a-form-item label="模型">
                  <a-input v-model:value="config.llm.volcengineModel" placeholder="doubao-seed-1-6-lite-251015" />
                </a-form-item>
              </template>

              <!-- 阿里通义千问配置 -->
              <a-divider v-if="config.llm.provider === 'dashscope'">阿里通义千问配置</a-divider>
              <template v-if="config.llm.provider === 'dashscope'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.dashscopeApiKey" />
                </a-form-item>
                <a-form-item label="模型">
                  <a-select v-model:value="config.llm.dashscopeModel" style="width: 100%;">
                    <a-select-option value="qwen-turbo">Qwen Turbo（推荐）</a-select-option>
                    <a-select-option value="qwen-plus">Qwen Plus</a-select-option>
                    <a-select-option value="qwen-max">Qwen Max</a-select-option>
                  </a-select>
                </a-form-item>
              </template>

              <!-- 智谱 AI 配置 -->
              <a-divider v-if="config.llm.provider === 'zhipu'">智谱 AI 配置</a-divider>
              <template v-if="config.llm.provider === 'zhipu'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.zhipuApiKey" />
                </a-form-item>
                <a-form-item label="模型">
                  <a-input v-model:value="config.llm.zhipuModel" placeholder="glm-4" />
                </a-form-item>
              </template>

              <!-- DeepSeek 配置 -->
              <a-divider v-if="config.llm.provider === 'deepseek'">DeepSeek 配置</a-divider>
              <template v-if="config.llm.provider === 'deepseek'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.deepseekApiKey" />
                </a-form-item>
                <a-form-item label="模型">
                  <a-input v-model:value="config.llm.deepseekModel" placeholder="deepseek-chat" />
                </a-form-item>
              </template>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 向量数据库配置 -->
        <a-tab-pane key="vector" tab="向量数据库">
          <template #tab>
            <DatabaseOutlined />
            向量数据库
          </template>
          <a-card title="Qdrant 向量数据库配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="服务地址">
                <a-input v-model:value="config.vector.qdrantHost" placeholder="http://localhost:6333" />
              </a-form-item>

              <a-form-item label="端口">
                <a-input-number v-model:value="config.vector.qdrantPort" :min="1" :max="65535" style="width: 200px;" />
              </a-form-item>

              <a-form-item label="集合名称">
                <a-input v-model:value="config.vector.qdrantCollection" placeholder="chainlesschain_vectors" />
              </a-form-item>

              <a-form-item label="Embedding 模型">
                <a-input v-model:value="config.vector.embeddingModel" placeholder="bge-base-zh-v1.5" />
              </a-form-item>

              <a-form-item label="向量维度">
                <a-input-number v-model:value="config.vector.embeddingDimension" :min="128" :max="2048" style="width: 200px;" />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- Git 配置 -->
        <a-tab-pane key="git" tab="Git 同步">
          <template #tab>
            <GithubOutlined />
            Git 同步
          </template>
          <a-card title="Git 同步配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="启用 Git 同步">
                <a-switch v-model:checked="config.git.enabled" />
              </a-form-item>

              <template v-if="config.git.enabled">
                <a-form-item label="自动同步">
                  <a-switch v-model:checked="config.git.autoSync" />
                  <span style="margin-left: 8px;">自动提交和推送</span>
                </a-form-item>

                <a-form-item label="同步间隔" v-if="config.git.autoSync">
                  <a-input-number
                    v-model:value="config.git.autoSyncInterval"
                    :min="60"
                    :max="3600"
                    :step="60"
                    addon-after="秒"
                    style="width: 200px;"
                  />
                </a-form-item>

                <a-form-item label="用户名">
                  <a-input v-model:value="config.git.userName" placeholder="Your Name" />
                </a-form-item>

                <a-form-item label="邮箱">
                  <a-input v-model:value="config.git.userEmail" placeholder="your.email@example.com" />
                </a-form-item>

                <a-form-item label="远程仓库 URL">
                  <a-input v-model:value="config.git.remoteUrl" placeholder="https://github.com/username/repo.git" />
                </a-form-item>
              </template>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 后端服务配置 -->
        <a-tab-pane key="backend" tab="后端服务">
          <template #tab>
            <CloudServerOutlined />
            后端服务
          </template>
          <a-card title="后端服务地址配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="项目服务">
                <a-input v-model:value="config.backend.projectServiceUrl" placeholder="http://localhost:9090" />
              </a-form-item>

              <a-form-item label="AI 服务">
                <a-input v-model:value="config.backend.aiServiceUrl" placeholder="http://localhost:8001" />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 安全配置 -->
        <a-tab-pane key="security" tab="安全">
          <template #tab>
            <LockOutlined />
            安全
          </template>
          <a-card title="数据库加密配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="SQLCipher 密钥">
                <a-input-password
                  v-model:value="config.database.sqlcipherKey"
                  placeholder="留空使用默认密钥"
                />
                <template #extra>
                  <a-alert
                    message="警告"
                    description="修改加密密钥后，旧数据将无法访问。请谨慎操作！"
                    type="warning"
                    show-icon
                    style="margin-top: 8px;"
                  />
                </template>
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>
      </a-tabs>

      <!-- 操作按钮 -->
      <div class="settings-actions">
        <a-space size="large">
          <a-button type="primary" size="large" :loading="saving" @click="handleSave">
            <SaveOutlined />
            保存配置
          </a-button>

          <a-button size="large" @click="handleReset">
            <ReloadOutlined />
            重置为默认值
          </a-button>

          <a-button size="large" @click="handleExportEnv">
            <ExportOutlined />
            导出为 .env 文件
          </a-button>

          <a-button size="large" @click="handleCancel">
            取消
          </a-button>
        </a-space>
      </div>
    </a-spin>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  SettingOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  DatabaseOutlined,
  GithubOutlined,
  CloudServerOutlined,
  LockOutlined,
  SaveOutlined,
  ReloadOutlined,
  ExportOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const activeTab = ref('project');
const config = ref({
  project: {
    rootPath: '',
    maxSizeMB: 1000,
    allowedFileTypes: [],
    autoSync: true,
    syncIntervalSeconds: 300,
  },
  llm: {
    provider: 'volcengine',
    ollamaHost: '',
    ollamaModel: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    volcengineApiKey: '',
    volcengineModel: '',
    dashscopeApiKey: '',
    dashscopeModel: '',
    zhipuApiKey: '',
    zhipuModel: '',
    deepseekApiKey: '',
    deepseekModel: '',
  },
  vector: {
    qdrantHost: '',
    qdrantPort: 6333,
    qdrantCollection: '',
    embeddingModel: '',
    embeddingDimension: 768,
  },
  git: {
    enabled: false,
    autoSync: false,
    autoSyncInterval: 300,
    userName: '',
    userEmail: '',
    remoteUrl: '',
  },
  backend: {
    projectServiceUrl: '',
    aiServiceUrl: '',
  },
  database: {
    sqlcipherKey: '',
  },
});

// 加载配置
const loadConfig = async () => {
  loading.value = true;
  try {
    const allConfig = await window.electronAPI.config.getAll();
    config.value = allConfig;
  } catch (error) {
    console.error('加载配置失败:', error);
    message.error('加载配置失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 保存配置
const handleSave = async () => {
  saving.value = true;
  try {
    await window.electronAPI.config.update(config.value);
    message.success('配置已保存，部分修改需要重启应用生效');
  } catch (error) {
    console.error('保存配置失败:', error);
    message.error('保存配置失败：' + error.message);
  } finally {
    saving.value = false;
  }
};

// 重置配置
const handleReset = () => {
  Modal.confirm({
    title: '确认重置',
    content: '确定要将所有配置重置为默认值吗？此操作不可撤销！',
    okText: '重置',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.config.reset();
        await loadConfig();
        message.success('配置已重置为默认值');
      } catch (error) {
        console.error('重置配置失败:', error);
        message.error('重置配置失败：' + error.message);
      }
    },
  });
};

// 导出为 .env 文件
const handleExportEnv = async () => {
  try {
    // 这里应该弹出文件选择对话框，暂时使用默认路径
    const envPath = 'C:\\code\\chainlesschain\\desktop-app-vue\\.env';
    await window.electronAPI.config.exportEnv(envPath);
    message.success('配置已导出到 .env 文件');
  } catch (error) {
    console.error('导出配置失败:', error);
    message.error('导出配置失败：' + error.message);
  }
};

// 选择文件夹（占位，需要实现文件选择对话框）
const handleSelectFolder = (path) => {
  message.info('文件夹选择功能开发中...');
};

// 取消
const handleCancel = () => {
  router.back();
};

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.system-settings {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  flex-shrink: 0;
  padding: 24px 24px 0;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.settings-header h1 {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-header p {
  margin: 0 0 24px 0;
  color: #666;
  font-size: 14px;
}

:deep(.ant-spin-nested-loading),
:deep(.ant-spin-container) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.ant-tabs) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 24px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

:deep(.ant-tabs-nav) {
  flex-shrink: 0;
  margin-bottom: 16px;
}

:deep(.ant-tabs-content-holder) {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

:deep(.ant-tabs-content) {
  height: 100%;
}

.settings-actions {
  flex-shrink: 0;
  margin-top: 16px;
  margin-bottom: 24px;
  padding: 24px;
  background: #f5f5f5;
  border-radius: 8px;
  text-align: center;
}

:deep(.ant-card) {
  margin-bottom: 16px;
}

:deep(.ant-divider) {
  margin: 16px 0;
}
</style>
