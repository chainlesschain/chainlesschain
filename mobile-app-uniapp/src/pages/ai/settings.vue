<template>
  <view class="settings-container">
    <!-- 头部 -->
    <view class="header">
      <view class="back-btn" @click="goBack">
        <text class="icon">‹</text>
      </view>
      <text class="title">AI 设置</text>
      <view class="placeholder"></view>
    </view>

    <!-- 内容 -->
    <scroll-view class="content" scroll-y>
      <!-- 当前提供商 -->
      <view class="section">
        <view class="section-header">
          <text class="section-title">当前提供商</text>
        </view>
        <view class="provider-card" @click="showProviderSelector = true">
          <view class="provider-info">
            <text class="provider-icon">{{ getProviderIcon(currentProvider) }}</text>
            <view class="provider-details">
              <text class="provider-name">{{ getProviderName(currentProvider) }}</text>
              <text class="provider-model">{{ currentConfig?.model || '未配置' }}</text>
            </view>
          </view>
          <text class="provider-arrow">›</text>
        </view>
      </view>

      <!-- API 配置 -->
      <view class="section">
        <view class="section-header">
          <text class="section-title">API 配置</text>
        </view>

        <view class="setting-item">
          <text class="setting-label">API Key</text>
          <input
            class="setting-input"
            v-model="currentConfig.apiKey"
            type="text"
            placeholder="请输入 API Key"
            :password="!showApiKey"
          />
          <view class="toggle-btn" @click="showApiKey = !showApiKey">
            <text>{{ showApiKey ? '👁️' : '🔒' }}</text>
          </view>
        </view>

        <view class="setting-item" v-if="needsSecretKey">
          <text class="setting-label">Secret Key</text>
          <input
            class="setting-input"
            v-model="currentConfig.secretKey"
            type="text"
            placeholder="请输入 Secret Key"
            :password="!showSecretKey"
          />
          <view class="toggle-btn" @click="showSecretKey = !showSecretKey">
            <text>{{ showSecretKey ? '👁️' : '🔒' }}</text>
          </view>
        </view>

        <view class="setting-item" v-if="needsBaseURL">
          <text class="setting-label">Base URL</text>
          <input
            class="setting-input"
            v-model="currentConfig.baseURL"
            type="text"
            placeholder="例如: https://api.openai.com/v1"
          />
        </view>
      </view>

      <!-- 模型设置 -->
      <view class="section">
        <view class="section-header">
          <text class="section-title">模型设置</text>
        </view>

        <view class="setting-item">
          <text class="setting-label">模型</text>
          <picker
            class="setting-picker"
            :value="modelIndex"
            :range="availableModels"
            @change="handleModelChange"
          >
            <view class="picker-value">
              {{ currentConfig.model || '选择模型' }}
            </view>
          </picker>
        </view>

        <view class="setting-item">
          <text class="setting-label">温度</text>
          <view class="slider-container">
            <slider
              class="setting-slider"
              :value="currentConfig.temperature * 100"
              @change="handleTemperatureChange"
              min="0"
              max="100"
              show-value
            />
            <text class="slider-desc">{{ getTemperatureDesc(currentConfig.temperature) }}</text>
          </view>
        </view>

        <view class="setting-item">
          <text class="setting-label">最大令牌数</text>
          <input
            class="setting-input"
            v-model.number="currentConfig.maxTokens"
            type="number"
            placeholder="例如: 2000"
          />
        </view>
      </view>

      <!-- 高级选项 -->
      <view class="section">
        <view class="section-header">
          <text class="section-title">高级选项</text>
        </view>

        <view class="setting-item">
          <text class="setting-label">流式输出</text>
          <switch
            class="setting-switch"
            :checked="currentConfig.stream"
            @change="handleStreamChange"
          />
        </view>

        <view class="setting-item">
          <text class="setting-label">超时时间 (秒)</text>
          <input
            class="setting-input"
            v-model.number="currentConfig.timeout"
            type="number"
            placeholder="例如: 60"
          />
        </view>
      </view>

      <!-- 测试连接 -->
      <view class="section">
        <button class="test-btn" @click="testConnection" :disabled="testing">
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <view class="test-result" v-if="testResult">
          <text :class="testResult.success ? 'success' : 'error'">
            {{ testResult.message }}
          </text>
        </view>
      </view>

      <!-- 操作按钮 -->
      <view class="actions">
        <button class="save-btn" @click="saveSettings" :disabled="saving">
          {{ saving ? '保存中...' : '保存设置' }}
        </button>
        <button class="reset-btn" @click="resetToDefault">
          恢复默认
        </button>
      </view>
    </scroll-view>

    <!-- 提供商选择器 -->
    <view v-if="showProviderSelector" class="modal-overlay" @click="showProviderSelector = false">
      <view class="provider-selector" @click.stop>
        <view class="selector-header">
          <text class="selector-title">选择提供商</text>
          <text class="selector-close" @click="showProviderSelector = false">✕</text>
        </view>
        <scroll-view class="selector-content" scroll-y>
          <view
            class="provider-option"
            v-for="provider in providers"
            :key="provider.id"
            :class="{ active: provider.id === currentProvider }"
            @click="selectProvider(provider.id)"
          >
            <text class="option-icon">{{ provider.icon }}</text>
            <view class="option-info">
              <text class="option-name">{{ provider.name }}</text>
              <text class="option-desc">{{ provider.desc }}</text>
            </view>
            <text class="option-check" v-if="provider.id === currentProvider">✓</text>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { llm } from '@/services/llm'

export default {
  data() {
    return {
      currentProvider: 'openai',
      currentConfig: {
        apiKey: '',
        secretKey: '',
        baseURL: '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2000,
        stream: false,
        timeout: 60
      },
      showApiKey: false,
      showSecretKey: false,
      showProviderSelector: false,
      testing: false,
      saving: false,
      testResult: null,
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          icon: '🤖',
          desc: 'GPT-3.5, GPT-4'
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          icon: '🔮',
          desc: 'DeepSeek Chat'
        },
        {
          id: 'volcengine',
          name: '火山引擎',
          icon: '🌋',
          desc: '豆包大模型'
        },
        {
          id: 'baidu_qianfan',
          name: '百度千帆',
          icon: '🎯',
          desc: '文心一言'
        },
        {
          id: 'aliyun_dashscope',
          name: '阿里云',
          icon: '☁️',
          desc: '通义千问'
        },
        {
          id: 'tencent_hunyuan',
          name: '腾讯混元',
          icon: '🌐',
          desc: '混元大模型'
        },
        {
          id: 'xfyun_xinghuo',
          name: '讯飞星火',
          icon: '✨',
          desc: '星火认知大模型'
        },
        {
          id: 'zhipu_ai',
          name: '智谱AI',
          icon: '🧠',
          desc: 'GLM-4'
        },
        {
          id: 'ollama',
          name: 'Ollama',
          icon: '🦙',
          desc: '本地模型'
        },
        {
          id: 'custom',
          name: '自定义',
          icon: '⚙️',
          desc: 'OpenAI 兼容 API'
        }
      ],
      modelsByProvider: {
        openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'],
        deepseek: ['deepseek-chat', 'deepseek-coder'],
        volcengine: ['deepseek-v4-1-flash-260910', 'doubao-pro-32k', 'doubao-lite-32k'],
        baidu_qianfan: ['ERNIE-Speed-128K', 'ERNIE-Lite-8K'],
        aliyun_dashscope: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
        tencent_hunyuan: ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro'],
        xfyun_xinghuo: ['generalv3.5', 'generalv3', 'generalv2'],
        zhipu_ai: ['glm-4-flash', 'glm-4', 'glm-3-turbo'],
        ollama: ['qwen2:7b', 'llama3:8b', 'mistral:7b'],
        custom: ['custom-model']
      }
    }
  },

  computed: {
    needsSecretKey() {
      return ['baidu_qianfan', 'tencent_hunyuan', 'xfyun_xinghuo'].includes(this.currentProvider)
    },

    needsBaseURL() {
      return ['openai', 'deepseek', 'ollama', 'custom'].includes(this.currentProvider)
    },

    availableModels() {
      return this.modelsByProvider[this.currentProvider] || []
    },

    modelIndex() {
      return this.availableModels.indexOf(this.currentConfig.model)
    }
  },

  async onLoad() {
    await this.loadSettings()
  },

  methods: {
    async loadSettings() {
      try {
        // 从 llm 服务加载当前配置
        this.currentProvider = llm.provider
        this.currentConfig = { ...llm.config[llm.provider] }
      } catch (error) {
        console.error('加载设置失败:', error)
      }
    },

    async saveSettings() {
      try {
        this.saving = true

        // 验证必填字段
        if (!this.currentConfig.apiKey) {
          uni.showToast({
            title: 'API Key 不能为空',
            icon: 'none'
          })
          return
        }

        // 更新配置
        llm.config[this.currentProvider] = { ...this.currentConfig }
        llm.provider = this.currentProvider

        // 保存到本地存储
        uni.setStorageSync('llm_provider', this.currentProvider)
        uni.setStorageSync('llm_config', llm.config)

        uni.showToast({
          title: '保存成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('保存设置失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      } finally {
        this.saving = false
      }
    },

    async testConnection() {
      try {
        this.testing = true
        this.testResult = null

        // 临时应用配置
        const originalProvider = llm.provider
        const originalConfig = { ...llm.config[this.currentProvider] }

        llm.provider = this.currentProvider
        llm.config[this.currentProvider] = { ...this.currentConfig }

        // 测试连接
        const response = await llm.query('你好', [], { temperature: 0.7 })

        this.testResult = {
          success: true,
          message: `连接成功！模型响应: ${response.content.substring(0, 50)}...`
        }

        // 恢复原配置
        llm.provider = originalProvider
        llm.config[this.currentProvider] = originalConfig
      } catch (error) {
        this.testResult = {
          success: false,
          message: `连接失败: ${error.message}`
        }
      } finally {
        this.testing = false
      }
    },

    selectProvider(providerId) {
      this.currentProvider = providerId
      this.currentConfig = {
        ...llm.config[providerId],
        apiKey: llm.config[providerId]?.apiKey || '',
        secretKey: llm.config[providerId]?.secretKey || '',
        baseURL: llm.config[providerId]?.baseURL || '',
        model: llm.config[providerId]?.model || this.modelsByProvider[providerId][0],
        temperature: llm.config[providerId]?.temperature || 0.7,
        maxTokens: llm.config[providerId]?.maxTokens || 2000,
        stream: llm.config[providerId]?.stream || false,
        timeout: llm.config[providerId]?.timeout || 60
      }
      this.showProviderSelector = false
      this.testResult = null
    },

    handleModelChange(e) {
      this.currentConfig.model = this.availableModels[e.detail.value]
    },

    handleTemperatureChange(e) {
      this.currentConfig.temperature = e.detail.value / 100
    },

    handleStreamChange(e) {
      this.currentConfig.stream = e.detail.value
    },

    resetToDefault() {
      uni.showModal({
        title: '恢复默认',
        content: '确定要恢复默认设置吗？',
        success: (res) => {
          if (res.confirm) {
            this.currentProvider = 'openai'
            this.currentConfig = {
              apiKey: '',
              secretKey: '',
              baseURL: 'https://api.openai.com/v1',
              model: 'gpt-3.5-turbo',
              temperature: 0.7,
              maxTokens: 2000,
              stream: false,
              timeout: 60
            }
            uni.showToast({
              title: '已恢复默认',
              icon: 'success'
            })
          }
        }
      })
    },

    getProviderIcon(providerId) {
      const provider = this.providers.find(p => p.id === providerId)
      return provider?.icon || '🤖'
    },

    getProviderName(providerId) {
      const provider = this.providers.find(p => p.id === providerId)
      return provider?.name || '未知'
    },

    getTemperatureDesc(temp) {
      if (temp < 0.3) return '精确，适合事实性回答'
      if (temp < 0.7) return '平衡，适合一般对话'
      return '创造性，适合创意内容'
    },

    goBack() {
      uni.navigateBack()
    }
  }
}
</script>

<style scoped>
.settings-container {
  min-height: 100vh;
  background: #f5f5f5;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
}

.back-btn {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-btn .icon {
  font-size: 24px;
  font-weight: bold;
  color: #333;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.placeholder {
  width: 32px;
}

.content {
  padding: 16px;
}

.section {
  margin-bottom: 24px;
}

.section-header {
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.provider-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
}

.provider-card:active {
  transform: scale(0.98);
}

.provider-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.provider-icon {
  font-size: 32px;
}

.provider-details {
  display: flex;
  flex-direction: column;
}

.provider-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.provider-model {
  font-size: 13px;
  color: #999;
}

.provider-arrow {
  font-size: 24px;
  color: #ccc;
}

.setting-item {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.setting-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.setting-input {
  width: 100%;
  height: 40px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
}

.toggle-btn {
  position: absolute;
  right: 28px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.setting-picker {
  width: 100%;
}

.picker-value {
  height: 40px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-size: 14px;
  color: #333;
}

.slider-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-slider {
  width: 100%;
}

.slider-desc {
  font-size: 12px;
  color: #999;
}

.setting-switch {
  transform: scale(0.8);
}

.test-btn {
  width: 100%;
  height: 44px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 8px;
  font-size: 16px;
  border: none;
}

.test-btn:disabled {
  opacity: 0.5;
}

.test-result {
  margin-top: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #f5f5f5;
}

.test-result .success {
  color: #52c41a;
}

.test-result .error {
  color: #ff4d4f;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

.save-btn,
.reset-btn {
  width: 100%;
  height: 44px;
  border-radius: 8px;
  font-size: 16px;
  border: none;
}

.save-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.save-btn:disabled {
  opacity: 0.5;
}

.reset-btn {
  background: #f5f5f5;
  color: #666;
}

/* 提供商选择器 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 1000;
}

.provider-selector {
  background: white;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  width: 100%;
  max-height: 70vh;
  overflow: hidden;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #f0f0f0;
}

.selector-title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.selector-close {
  font-size: 24px;
  color: #999;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.selector-content {
  max-height: calc(70vh - 60px);
  padding: 12px;
}

.provider-option {
  display: flex;
  align-items: center;
  padding: 16px;
  border-radius: 12px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: background 0.2s;
}

.provider-option:active {
  background: #f5f5f5;
}

.provider-option.active {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
}

.option-icon {
  font-size: 32px;
  margin-right: 12px;
}

.option-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.option-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.option-desc {
  font-size: 13px;
  color: #999;
}

.option-check {
  font-size: 20px;
  color: #667eea;
}
</style>
