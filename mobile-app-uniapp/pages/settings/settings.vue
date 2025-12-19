<template>
  <view class="settings-container">
    <scroll-view class="content" scroll-y>
      <!-- LLM 配置 -->
      <view class="section">
        <text class="section-title">AI 模型配置</text>

        <view class="setting-item">
          <text class="label">服务提供商</text>
          <picker
            mode="selector"
            :range="providers"
            range-key="label"
            :value="selectedProviderIndex"
            @change="handleProviderChange"
          >
            <view class="picker">
              <text>{{ getProviderLabel(llmConfig.provider) }}</text>
              <text class="arrow">▼</text>
            </view>
          </picker>
        </view>

        <view class="setting-item" v-if="llmConfig.provider !== 'ollama'">
          <text class="label">API Key</text>
          <input
            class="input"
            type="text"
            v-model="llmConfig.apiKey"
            placeholder="请输入 API Key"
            :password="!showApiKey"
          />
          <text class="toggle-btn" @click="showApiKey = !showApiKey">
            {{ showApiKey ? '👁️' : '👁️‍🗨️' }}
          </text>
        </view>

        <view class="setting-item" v-if="llmConfig.provider !== 'ollama'">
          <text class="label">API Base URL</text>
          <input
            class="input"
            type="text"
            v-model="llmConfig.baseURL"
            placeholder="默认官方地址"
          />
        </view>

        <view class="setting-item">
          <text class="label">模型名称</text>
          <input
            class="input"
            type="text"
            v-model="llmConfig.model"
            :placeholder="getDefaultModel(llmConfig.provider)"
          />
        </view>

        <view class="setting-item slider-item">
          <text class="label">Temperature</text>
          <slider
            class="slider"
            :value="llmConfig.temperature * 100"
            @change="handleTemperatureChange"
            min="0"
            max="200"
            show-value
          />
          <text class="value">{{ llmConfig.temperature }}</text>
        </view>

        <button class="save-btn" @click="saveLLMConfig">
          <text>保存配置</text>
        </button>
      </view>

      <!-- 账户信息 -->
      <view class="section">
        <text class="section-title">账户信息</text>

        <view class="info-item">
          <text class="info-label">设备 ID</text>
          <text class="info-value">{{ deviceInfo.deviceId || '未知' }}</text>
        </view>

        <view class="info-item">
          <text class="info-label">PIN 码状态</text>
          <text class="info-value status-ok">✓ 已设置</text>
        </view>

        <view class="info-item">
          <text class="info-label">SIMKey 状态</text>
          <text class="info-value status-pending">⊙ 未连接（模拟模式）</text>
        </view>
      </view>

      <!-- 数据管理 -->
      <view class="section">
        <text class="section-title">数据管理</text>

        <button class="action-btn" @click="handleClearCache">
          <text>清除缓存</text>
        </button>

        <button class="action-btn danger" @click="handleResetData">
          <text>重置所有数据</text>
        </button>
      </view>

      <!-- 关于 -->
      <view class="section">
        <text class="section-title">关于</text>

        <view class="info-item">
          <text class="info-label">应用名称</text>
          <text class="info-value">ChainlessChain</text>
        </view>

        <view class="info-item">
          <text class="info-label">版本号</text>
          <text class="info-value">v0.1.0</text>
        </view>

        <view class="info-item">
          <text class="info-label">平台</text>
          <text class="info-value">{{ deviceInfo.platform || 'H5' }}</text>
        </view>
      </view>

      <!-- 退出登录 -->
      <view class="section">
        <button class="logout-btn" @click="handleLogout">
          <text>退出登录</text>
        </button>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { llm } from '@/services/llm'

export default {
  data() {
    return {
      llmConfig: {
        provider: 'openai',
        apiKey: '',
        baseURL: '',
        model: '',
        temperature: 0.7
      },
      showApiKey: false,
      providers: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'ollama', label: 'Ollama (本地)' },
        { value: 'custom', label: '自定义' }
      ],
      deviceInfo: {}
    }
  },
  computed: {
    selectedProviderIndex() {
      return this.providers.findIndex(p => p.value === this.llmConfig.provider)
    }
  },
  onLoad() {
    this.loadLLMConfig()
    this.loadDeviceInfo()
  },
  methods: {
    loadLLMConfig() {
      // 从 LLM 服务加载配置
      this.llmConfig.provider = llm.provider
      const config = llm.config[llm.provider]
      this.llmConfig.apiKey = config.apiKey || ''
      this.llmConfig.baseURL = config.baseURL || ''
      this.llmConfig.model = config.model || ''
      this.llmConfig.temperature = config.temperature || 0.7
    },
    loadDeviceInfo() {
      const systemInfo = uni.getSystemInfoSync()
      this.deviceInfo = {
        deviceId: systemInfo.deviceId,
        platform: systemInfo.platform,
        system: systemInfo.system
      }
    },
    getProviderLabel(value) {
      const provider = this.providers.find(p => p.value === value)
      return provider ? provider.label : value
    },
    getDefaultModel(provider) {
      const defaults = {
        openai: 'gpt-3.5-turbo',
        deepseek: 'deepseek-chat',
        ollama: 'qwen2:7b',
        custom: ''
      }
      return defaults[provider] || ''
    },
    handleProviderChange(e) {
      const index = e.detail.value
      this.llmConfig.provider = this.providers[index].value

      // 设置默认模型
      if (!this.llmConfig.model) {
        this.llmConfig.model = this.getDefaultModel(this.llmConfig.provider)
      }
    },
    handleTemperatureChange(e) {
      this.llmConfig.temperature = (e.detail.value / 100).toFixed(2)
    },
    async saveLLMConfig() {
      try {
        // 验证必填字段
        if (this.llmConfig.provider !== 'ollama' && !this.llmConfig.apiKey) {
          uni.showToast({
            title: '请输入 API Key',
            icon: 'none'
          })
          return
        }

        // 保存到 LLM 服务
        await llm.setProvider(this.llmConfig.provider)
        await llm.setConfig({
          apiKey: this.llmConfig.apiKey,
          baseURL: this.llmConfig.baseURL,
          model: this.llmConfig.model,
          temperature: parseFloat(this.llmConfig.temperature)
        })

        uni.showToast({
          title: '配置已保存',
          icon: 'success'
        })
      } catch (error) {
        console.error('保存配置失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      }
    },
    handleClearCache() {
      uni.showModal({
        title: '清除缓存',
        content: '确定要清除缓存吗？',
        success: (res) => {
          if (res.confirm) {
            // 清除缓存逻辑
            uni.showToast({
              title: '缓存已清除',
              icon: 'success'
            })
          }
        }
      })
    },
    handleResetData() {
      uni.showModal({
        title: '危险操作',
        content: '此操作将删除所有数据且无法恢复，确定继续吗？',
        confirmColor: '#ff4d4f',
        success: (res) => {
          if (res.confirm) {
            // 清除所有数据
            uni.clearStorageSync()
            uni.showToast({
              title: '数据已重置',
              icon: 'success'
            })

            setTimeout(() => {
              uni.reLaunch({
                url: '/pages/login/login'
              })
            }, 1500)
          }
        }
      })
    },
    handleLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出登录吗？',
        success: (res) => {
          if (res.confirm) {
            // 清除登录状态
            uni.removeStorageSync('isLoggedIn')

            uni.reLaunch({
              url: '/pages/login/login'
            })
          }
        }
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.settings-container {
  min-height: 100vh;
  background-color: #f8f8f8;
}

.content {
  height: 100vh;
  padding: 24rpx 24rpx 120rpx 24rpx;
}

.section {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;

  .section-title {
    display: block;
    font-size: 32rpx;
    font-weight: bold;
    color: #333;
    margin-bottom: 32rpx;
  }

  .setting-item {
    margin-bottom: 32rpx;
    position: relative;

    &:last-child {
      margin-bottom: 0;
    }

    .label {
      display: block;
      font-size: 28rpx;
      color: #666;
      margin-bottom: 16rpx;
    }

    .input {
      width: 100%;
      height: 72rpx;
      padding: 0 24rpx;
      background-color: #f5f5f5;
      border-radius: 8rpx;
      font-size: 28rpx;
    }

    .picker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 72rpx;
      padding: 0 24rpx;
      background-color: #f5f5f5;
      border-radius: 8rpx;
      font-size: 28rpx;

      .arrow {
        font-size: 20rpx;
        color: #999;
      }
    }

    .toggle-btn {
      position: absolute;
      right: 24rpx;
      bottom: 20rpx;
      font-size: 32rpx;
      cursor: pointer;
    }

    &.slider-item {
      .slider {
        margin: 16rpx 0;
      }

      .value {
        font-size: 24rpx;
        color: #999;
      }
    }
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx 0;
    border-bottom: 1rpx solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }

    .info-label {
      font-size: 28rpx;
      color: #666;
    }

    .info-value {
      font-size: 28rpx;
      color: #333;

      &.status-ok {
        color: #52c41a;
      }

      &.status-pending {
        color: #fa8c16;
      }
    }
  }

  .save-btn,
  .action-btn,
  .logout-btn {
    width: 100%;
    height: 88rpx;
    border-radius: 44rpx;
    font-size: 30rpx;
    font-weight: 500;
    border: none;
    margin-top: 32rpx;
  }

  .save-btn {
    background-color: #3cc51f;
    color: #ffffff;
  }

  .action-btn {
    background-color: #1890ff;
    color: #ffffff;
    margin-top: 16rpx;

    &.danger {
      background-color: #ff4d4f;
    }

    &:first-child {
      margin-top: 0;
    }
  }

  .logout-btn {
    background-color: #f5f5f5;
    color: #666;
    margin-top: 0;
  }

  button::after {
    border: none;
  }
}
</style>
