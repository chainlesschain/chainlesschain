<template>
  <view class="settings-container">
    <scroll-view class="content" scroll-y>
      <!-- 个人信息 -->
      <view class="section">
        <text class="section-title">个人信息</text>

        <view class="profile-section">
          <view class="avatar-section">
            <view class="avatar-display" @click="showAvatarModal = true">
              <text class="avatar-emoji">{{ userProfile.avatar }}</text>
            </view>
            <text class="avatar-hint">点击更换头像</text>
          </view>

          <view class="setting-item">
            <view class="label-row">
              <text class="label">昵称</text>
              <text class="char-count">{{ userProfile.nickname.length }}/20</text>
            </view>
            <input
              class="input"
              type="text"
              v-model="userProfile.nickname"
              placeholder="输入你的昵称"
              maxlength="20"
            />
          </view>

          <view class="setting-item">
            <view class="label-row">
              <text class="label">个人简介</text>
              <text class="char-count">{{ userProfile.bio.length }}/100</text>
            </view>
            <textarea
              class="textarea"
              v-model="userProfile.bio"
              placeholder="介绍一下自己..."
              maxlength="100"
            />
          </view>

          <button class="save-btn" @click="saveProfile">
            <text>保存个人信息</text>
          </button>
        </view>
      </view>

      <!-- 外观设置 -->
      <view class="section">
        <text class="section-title">外观设置</text>

        <view class="setting-item">
          <text class="label">主题模式</text>
          <view class="theme-options">
            <view
              class="theme-option"
              :class="{ active: theme === 'light' }"
              @click="switchTheme('light')"
            >
              <text class="theme-icon">☀️</text>
              <text class="theme-name">浅色</text>
            </view>
            <view
              class="theme-option"
              :class="{ active: theme === 'dark' }"
              @click="switchTheme('dark')"
            >
              <text class="theme-icon">🌙</text>
              <text class="theme-name">深色</text>
            </view>
            <view
              class="theme-option"
              :class="{ active: theme === 'auto' }"
              @click="switchTheme('auto')"
            >
              <text class="theme-icon">🤖</text>
              <text class="theme-name">跟随系统</text>
            </view>
          </view>
        </view>
      </view>

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
          <text class="label">{{ getApiKeyLabel(llmConfig.provider) }}</text>
          <input
            class="input"
            type="text"
            v-model="llmConfig.apiKey"
            :placeholder="'请输入 ' + getApiKeyLabel(llmConfig.provider)"
            :password="!showApiKey"
          />
          <text class="toggle-btn" @click="showApiKey = !showApiKey">
            {{ showApiKey ? '👁️' : '👁️‍🗨️' }}
          </text>
        </view>

        <view class="setting-item" v-if="needsSecretKey(llmConfig.provider)">
          <text class="label">{{ getSecretKeyLabel(llmConfig.provider) }}</text>
          <input
            class="input"
            type="text"
            v-model="llmConfig.secretKey"
            :placeholder="'请输入 ' + getSecretKeyLabel(llmConfig.provider)"
            :password="!showSecretKey"
          />
          <text class="toggle-btn" @click="showSecretKey = !showSecretKey">
            {{ showSecretKey ? '👁️' : '👁️‍🗨️' }}
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

        <view class="button-group">
          <button class="action-btn secondary" @click="testLLMConnection" :disabled="testingConnection">
            <text>{{ testingConnection ? '测试中...' : '测试连接' }}</text>
          </button>
          <button class="save-btn" @click="saveLLMConfig">
            <text>保存配置</text>
          </button>
        </view>
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

        <button class="action-btn" @click="showChangePinModal = true">
          <text>修改 PIN 码</text>
        </button>
      </view>

      <!-- 通知设置 -->
      <view class="section">
        <text class="section-title">通知设置</text>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">消息通知</text>
            <text class="switch-desc">接收好友消息和系统通知</text>
          </view>
          <switch :checked="notificationSettings.messageNotification" @change="toggleNotification('messageNotification', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">交易通知</text>
            <text class="switch-desc">接收知识交易相关通知</text>
          </view>
          <switch :checked="notificationSettings.tradeNotification" @change="toggleNotification('tradeNotification', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">动态通知</text>
            <text class="switch-desc">接收好友动态更新通知</text>
          </view>
          <switch :checked="notificationSettings.socialNotification" @change="toggleNotification('socialNotification', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">通知声音</text>
            <text class="switch-desc">接收通知时播放提示音</text>
          </view>
          <switch :checked="notificationSettings.notificationSound" @change="toggleNotification('notificationSound', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">振动提醒</text>
            <text class="switch-desc">接收通知时振动提醒</text>
          </view>
          <switch :checked="notificationSettings.notificationVibration" @change="toggleNotification('notificationVibration', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">勿扰模式</text>
            <text class="switch-desc">在指定时间段内不接收通知</text>
          </view>
          <switch :checked="notificationSettings.doNotDisturbEnabled" @change="toggleNotification('doNotDisturbEnabled', $event)" />
        </view>

        <view v-if="notificationSettings.doNotDisturbEnabled" class="dnd-time-settings">
          <view class="time-picker-row">
            <text class="time-label">开始时间</text>
            <picker mode="time" :value="notificationSettings.doNotDisturbStart" @change="handleDndStartChange">
              <view class="time-picker">
                <text>{{ notificationSettings.doNotDisturbStart }}</text>
                <text class="arrow">▼</text>
              </view>
            </picker>
          </view>

          <view class="time-picker-row">
            <text class="time-label">结束时间</text>
            <picker mode="time" :value="notificationSettings.doNotDisturbEnd" @change="handleDndEndChange">
              <view class="time-picker">
                <text>{{ notificationSettings.doNotDisturbEnd }}</text>
                <text class="arrow">▼</text>
              </view>
            </picker>
          </view>
        </view>

        <button class="action-btn" @click="goToNotificationCenter">
          <text>📬 通知中心</text>
        </button>
      </view>

      <!-- 隐私设置 -->
      <view class="section">
        <text class="section-title">隐私设置</text>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">公开个人资料</text>
            <text class="switch-desc">允许其他用户查看你的个人信息</text>
          </view>
          <switch :checked="privacySettings.publicProfile" @change="togglePrivacy('publicProfile', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">显示在线状态</text>
            <text class="switch-desc">让好友知道你是否在线</text>
          </view>
          <switch :checked="privacySettings.showOnlineStatus" @change="togglePrivacy('showOnlineStatus', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">交易记录公开</text>
            <text class="switch-desc">允许其他用户查看你的交易历史</text>
          </view>
          <switch :checked="privacySettings.publicTradeHistory" @change="togglePrivacy('publicTradeHistory', $event)" />
        </view>

        <view class="switch-item">
          <view class="switch-info">
            <text class="switch-label">数据本地加密</text>
            <text class="switch-desc">使用PIN码加密本地数据</text>
          </view>
          <switch :checked="privacySettings.encryptLocalData" @change="togglePrivacy('encryptLocalData', $event)" />
        </view>
      </view>

      <!-- 数据管理 -->
      <view class="section">
        <text class="section-title">数据管理</text>

        <view class="data-stats">
          <view class="stat-row">
            <text class="stat-label">知识条目</text>
            <text class="stat-value">{{ dataStats.knowledgeCount }} 条</text>
          </view>
          <view class="stat-row">
            <text class="stat-label">AI 对话</text>
            <text class="stat-value">{{ dataStats.conversationCount }} 个</text>
          </view>
          <view class="stat-row">
            <text class="stat-label">消息记录</text>
            <text class="stat-value">{{ dataStats.messageCount }} 条</text>
          </view>
          <view class="stat-row">
            <text class="stat-label">缓存大小</text>
            <text class="stat-value">{{ cacheSize }}</text>
          </view>
        </view>

        <button class="action-btn backup" @click="handleBackup">
          <text>💾 数据备份与恢复</text>
        </button>

        <button class="action-btn import-export" @click="handleImportExport">
          <text>📦 导入/导出知识</text>
        </button>

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

        <view class="about-logo">
          <image class="logo-image" src="/static/logo.png" mode="aspectFit"></image>
          <text class="app-name">ChainlessChain</text>
          <text class="app-desc">去中心化个人AI助手平台</text>
        </view>

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

        <view class="info-item">
          <text class="info-label">首次使用</text>
          <text class="info-value">{{ appStats.firstUseDate }}</text>
        </view>

        <view class="info-item">
          <text class="info-label">使用天数</text>
          <text class="info-value">{{ appStats.usageDays }} 天</text>
        </view>

        <view class="info-item">
          <text class="info-label">启动次数</text>
          <text class="info-value">{{ appStats.launchCount }} 次</text>
        </view>
      </view>

      <!-- 退出登录 -->
      <view class="section">
        <button class="logout-btn" @click="handleLogout">
          <text>退出登录</text>
        </button>
      </view>
    </scroll-view>

    <!-- 头像选择弹窗 -->
    <view class="modal" v-if="showAvatarModal" @click="showAvatarModal = false">
      <view class="modal-content avatar-modal" @click.stop>
        <text class="modal-title">选择头像</text>

        <view class="avatar-grid">
          <view
            class="avatar-option"
            v-for="(emoji, index) in avatarOptions"
            :key="index"
            @click="selectAvatar(emoji)"
            :class="{ active: userProfile.avatar === emoji }"
          >
            <text class="avatar-emoji-large">{{ emoji }}</text>
          </view>
        </view>

        <button class="modal-btn" @click="showAvatarModal = false">
          <text>取消</text>
        </button>
      </view>
    </view>

    <!-- 修改PIN码弹窗 -->
    <view class="modal" v-if="showChangePinModal" @click="closeChangePinModal">
      <view class="modal-content pin-modal" @click.stop>
        <text class="modal-title">修改 PIN 码</text>

        <view class="pin-form">
          <view class="form-item-full">
            <text class="form-label">当前 PIN 码</text>
            <input
              class="form-input"
              type="number"
              maxlength="6"
              v-model="pinForm.currentPin"
              placeholder="输入当前PIN码"
              :password="true"
            />
          </view>

          <view class="form-item-full">
            <text class="form-label">新 PIN 码</text>
            <input
              class="form-input"
              type="number"
              maxlength="6"
              v-model="pinForm.newPin"
              placeholder="输入新PIN码（4-6位数字）"
              :password="true"
            />
          </view>

          <view class="form-item-full">
            <text class="form-label">确认新 PIN 码</text>
            <input
              class="form-input"
              type="number"
              maxlength="6"
              v-model="pinForm.confirmPin"
              placeholder="再次输入新PIN码"
              :password="true"
            />
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeChangePinModal">
            <text>取消</text>
          </button>
          <button
            class="modal-btn confirm"
            @click="handleChangePin"
            :disabled="!canChangePin || changingPin"
          >
            <text>{{ changingPin ? '修改中...' : '确认修改' }}</text>
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { llm } from '@/services/llm'
import { db } from '@/services/database'

export default {
  data() {
    return {
      userProfile: {
        avatar: '👤',
        nickname: '用户',
        bio: ''
      },
      showAvatarModal: false,
      theme: 'light',
      notificationSettings: {
        messageNotification: true,
        tradeNotification: true,
        socialNotification: true,
        notificationSound: true,
        notificationVibration: true,
        doNotDisturbEnabled: false,
        doNotDisturbStart: '22:00',
        doNotDisturbEnd: '08:00'
      },
      privacySettings: {
        publicProfile: true,
        showOnlineStatus: true,
        publicTradeHistory: false,
        encryptLocalData: true
      },
      showChangePinModal: false,
      pinForm: {
        currentPin: '',
        newPin: '',
        confirmPin: ''
      },
      changingPin: false,
      avatarOptions: [
        '😀', '😃', '😄', '😁', '😊', '😇', '🙂', '😉',
        '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '🤗',
        '🤩', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏',
        '😣', '😥', '😮', '🤐', '😯', '😪', '😫', '😴',
        '👨', '👩', '👦', '👧', '👶', '👴', '👵', '👨‍💻',
        '👩‍💻', '👨‍🎓', '👩‍🎓', '🧑‍💼', '👨‍🏫', '👩‍🏫', '🦸', '🦹',
        '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
        '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔'
      ],
      llmConfig: {
        provider: 'openai',
        apiKey: '',
        secretKey: '',
        baseURL: '',
        model: '',
        temperature: 0.7
      },
      showApiKey: false,
      showSecretKey: false,
      testingConnection: false,
      providers: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'volcengine', label: '火山引擎（豆包）' },
        { value: 'baidu_qianfan', label: '百度千帆（文心一言）' },
        { value: 'aliyun_dashscope', label: '阿里云通义千问' },
        { value: 'tencent_hunyuan', label: '腾讯混元' },
        { value: 'xfyun_xinghuo', label: '讯飞星火' },
        { value: 'zhipu_ai', label: '智谱AI (GLM)' },
        { value: 'ollama', label: 'Ollama (本地)' },
        { value: 'custom', label: '自定义' }
      ],
      deviceInfo: {},
      dataStats: {
        knowledgeCount: 0,
        conversationCount: 0,
        messageCount: 0
      },
      cacheSize: '计算中...',
      appStats: {
        firstUseDate: '未知',
        usageDays: 0,
        launchCount: 0
      }
    }
  },
  computed: {
    selectedProviderIndex() {
      return this.providers.findIndex(p => p.value === this.llmConfig.provider)
    },
    canChangePin() {
      return (
        this.pinForm.currentPin.length >= 4 &&
        this.pinForm.newPin.length >= 4 &&
        this.pinForm.newPin.length <= 6 &&
        this.pinForm.confirmPin === this.pinForm.newPin
      )
    }
  },
  onLoad() {
    this.loadUserProfile()
    this.loadTheme()
    this.loadNotificationSettings()
    this.loadPrivacySettings()
    this.loadLLMConfig()
    this.loadDeviceInfo()
    this.loadDataStats()
    this.loadAppStats()
  },
  methods: {
    /**
     * 加载用户资料
     */
    loadUserProfile() {
      try {
        const profile = uni.getStorageSync('user_profile')
        if (profile) {
          this.userProfile = JSON.parse(profile)
        } else {
          // 设置默认值
          this.userProfile = {
            avatar: '👤',
            nickname: '用户',
            bio: ''
          }
        }
      } catch (error) {
        console.error('加载用户资料失败:', error)
      }
    },

    /**
     * 保存用户资料
     */
    saveProfile() {
      try {
        if (!this.userProfile.nickname.trim()) {
          uni.showToast({
            title: '请输入昵称',
            icon: 'none'
          })
          return
        }

        uni.setStorageSync('user_profile', JSON.stringify(this.userProfile))

        uni.showToast({
          title: '保存成功',
          icon: 'success'
        })
      } catch (error) {
        console.error('保存用户资料失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      }
    },

    /**
     * 选择头像
     */
    selectAvatar(emoji) {
      this.userProfile.avatar = emoji
      this.showAvatarModal = false
    },

    /**
     * 加载主题设置
     */
    loadTheme() {
      try {
        const savedTheme = uni.getStorageSync('app_theme')
        this.theme = savedTheme || 'light'
        this.applyTheme(this.theme)
      } catch (error) {
        console.error('加载主题失败:', error)
      }
    },

    /**
     * 切换主题
     */
    switchTheme(theme) {
      this.theme = theme
      this.applyTheme(theme)

      try {
        uni.setStorageSync('app_theme', theme)
        uni.showToast({
          title: '主题已切换',
          icon: 'success',
          duration: 1500
        })
      } catch (error) {
        console.error('保存主题失败:', error)
      }
    },

    /**
     * 应用主题
     */
    applyTheme(theme) {
      // 获取系统主题（如果是自动模式）
      let effectiveTheme = theme
      if (theme === 'auto') {
        const systemInfo = uni.getSystemInfoSync()
        effectiveTheme = systemInfo.theme || 'light'
      }

      // 设置页面主题属性
      const pages = getCurrentPages()
      if (pages.length > 0) {
        const currentPage = pages[pages.length - 1]
        if (currentPage.$vm && currentPage.$vm.$el) {
          currentPage.$vm.$el.setAttribute('data-theme', effectiveTheme)
        }
      }

      // 设置状态栏样式
      if (effectiveTheme === 'dark') {
        uni.setNavigationBarColor({
          frontColor: '#ffffff',
          backgroundColor: '#1f1f1f'
        })
        uni.setTabBarStyle({
          backgroundColor: '#1f1f1f',
          color: '#999999',
          selectedColor: '#667eea',
          borderStyle: 'black'
        })
      } else {
        uni.setNavigationBarColor({
          frontColor: '#000000',
          backgroundColor: '#ffffff'
        })
        uni.setTabBarStyle({
          backgroundColor: '#ffffff',
          color: '#999999',
          selectedColor: '#667eea',
          borderStyle: 'white'
        })
      }

      // 触发全局主题变更事件
      uni.$emit('themeChange', effectiveTheme)
    },

    /**
     * 加载通知设置
     */
    loadNotificationSettings() {
      try {
        const settings = uni.getStorageSync('notification_settings')
        if (settings) {
          this.notificationSettings = JSON.parse(settings)
        }
      } catch (error) {
        console.error('加载通知设置失败:', error)
      }
    },

    /**
     * 切换通知设置
     */
    toggleNotification(key, event) {
      this.notificationSettings[key] = event.detail.value

      try {
        uni.setStorageSync('notification_settings', JSON.stringify(this.notificationSettings))
        uni.showToast({
          title: event.detail.value ? '已开启' : '已关闭',
          icon: 'success',
          duration: 1000
        })
      } catch (error) {
        console.error('保存通知设置失败:', error)
      }
    },

    /**
     * 加载隐私设置
     */
    loadPrivacySettings() {
      try {
        const settings = uni.getStorageSync('privacy_settings')
        if (settings) {
          this.privacySettings = JSON.parse(settings)
        }
      } catch (error) {
        console.error('加载隐私设置失败:', error)
      }
    },

    /**
     * 切换隐私设置
     */
    togglePrivacy(key, event) {
      this.privacySettings[key] = event.detail.value

      try {
        uni.setStorageSync('privacy_settings', JSON.stringify(this.privacySettings))
        uni.showToast({
          title: event.detail.value ? '已开启' : '已关闭',
          icon: 'success',
          duration: 1000
        })
      } catch (error) {
        console.error('保存隐私设置失败:', error)
      }
    },

    /**
     * 关闭修改PIN码弹窗
     */
    closeChangePinModal() {
      this.showChangePinModal = false
      this.pinForm = {
        currentPin: '',
        newPin: '',
        confirmPin: ''
      }
    },

    /**
     * 修改PIN码
     */
    async handleChangePin() {
      if (!this.canChangePin || this.changingPin) {
        return
      }

      // 验证两次输入是否一致
      if (this.pinForm.newPin !== this.pinForm.confirmPin) {
        uni.showToast({
          title: '两次输入的PIN码不一致',
          icon: 'none'
        })
        return
      }

      // 验证当前PIN码
      const storedPin = uni.getStorageSync('user_pin')
      if (this.pinForm.currentPin !== storedPin) {
        uni.showToast({
          title: '当前PIN码错误',
          icon: 'none'
        })
        return
      }

      this.changingPin = true

      try {
        // 保存新PIN码
        uni.setStorageSync('user_pin', this.pinForm.newPin)

        uni.showToast({
          title: 'PIN码修改成功',
          icon: 'success'
        })

        // 延迟关闭弹窗
        setTimeout(() => {
          this.closeChangePinModal()
        }, 1500)
      } catch (error) {
        console.error('修改PIN码失败:', error)
        uni.showToast({
          title: '修改失败',
          icon: 'none'
        })
      } finally {
        this.changingPin = false
      }
    },

    loadLLMConfig() {
      // 从 LLM 服务加载配置
      this.llmConfig.provider = llm.provider
      const config = llm.config[llm.provider]
      this.llmConfig.apiKey = config.apiKey || ''
      this.llmConfig.secretKey = config.secretKey || config.apiSecret || ''
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
    /**
     * 加载数据统计
     */
    async loadDataStats() {
      try {
        // 获取知识条目数量
        const knowledge = await db.getKnowledgeItems({ limit: 10000 })
        this.dataStats.knowledgeCount = knowledge.length

        // 获取对话数量
        const conversations = await db.getConversations(10000)
        this.dataStats.conversationCount = conversations.length

        // 获取消息数量（近似统计）
        let messageCount = 0
        for (const conv of conversations.slice(0, 100)) {
          const count = await db.getConversationMessageCount(conv.id)
          messageCount += count
        }
        this.dataStats.messageCount = messageCount

        // 计算缓存大小
        this.calculateCacheSize()
      } catch (error) {
        console.error('加载数据统计失败:', error)
        this.dataStats = {
          knowledgeCount: 0,
          conversationCount: 0,
          messageCount: 0
        }
        this.cacheSize = '未知'
      }
    },
    /**
     * 计算缓存大小
     */
    calculateCacheSize() {
      try {
        const storageData = uni.getStorageSync('chainlesschain_db')
        if (storageData) {
          const sizeInBytes = new Blob([storageData]).size
          const sizeInKB = sizeInBytes / 1024
          const sizeInMB = sizeInKB / 1024

          if (sizeInMB >= 1) {
            this.cacheSize = sizeInMB.toFixed(2) + ' MB'
          } else {
            this.cacheSize = sizeInKB.toFixed(2) + ' KB'
          }
        } else {
          this.cacheSize = '0 KB'
        }
      } catch (error) {
        console.error('计算缓存大小失败:', error)
        this.cacheSize = '未知'
      }
    },
    /**
     * 加载应用统计
     */
    loadAppStats() {
      try {
        // 获取首次使用时间
        let firstUseTime = uni.getStorageSync('app_first_use_time')
        if (!firstUseTime) {
          firstUseTime = Date.now()
          uni.setStorageSync('app_first_use_time', firstUseTime)
        }

        const firstDate = new Date(firstUseTime)
        this.appStats.firstUseDate = `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, '0')}-${String(firstDate.getDate()).padStart(2, '0')}`

        // 计算使用天数
        const daysDiff = Math.floor((Date.now() - firstUseTime) / (1000 * 60 * 60 * 24))
        this.appStats.usageDays = daysDiff

        // 获取启动次数
        let launchCount = uni.getStorageSync('app_launch_count') || 0
        launchCount++
        uni.setStorageSync('app_launch_count', launchCount)
        this.appStats.launchCount = launchCount
      } catch (error) {
        console.error('加载应用统计失败:', error)
        this.appStats = {
          firstUseDate: '未知',
          usageDays: 0,
          launchCount: 0
        }
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
        volcengine: 'deepseek-v4-1-flash-260910',
        baidu_qianfan: 'ERNIE-Speed-128K',
        aliyun_dashscope: 'qwen-turbo',
        tencent_hunyuan: 'hunyuan-lite',
        xfyun_xinghuo: 'generalv3.5',
        zhipu_ai: 'glm-4-flash',
        ollama: 'qwen2:7b',
        custom: ''
      }
      return defaults[provider] || ''
    },
    needsSecretKey(provider) {
      return ['baidu_qianfan', 'tencent_hunyuan', 'xfyun_xinghuo'].includes(provider)
    },
    getApiKeyLabel(provider) {
      const labels = {
        baidu_qianfan: 'API Key',
        tencent_hunyuan: 'SecretId',
        xfyun_xinghuo: 'APPID'
      }
      return labels[provider] || 'API Key'
    },
    getSecretKeyLabel(provider) {
      const labels = {
        baidu_qianfan: 'Secret Key',
        tencent_hunyuan: 'SecretKey',
        xfyun_xinghuo: 'APISecret'
      }
      return labels[provider] || 'Secret Key'
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
        llm.setProvider(this.llmConfig.provider)

        const configToSave = {
          apiKey: this.llmConfig.apiKey,
          baseURL: this.llmConfig.baseURL,
          model: this.llmConfig.model,
          temperature: parseFloat(this.llmConfig.temperature)
        }

        // 添加 secretKey（如果需要）
        if (this.needsSecretKey(this.llmConfig.provider)) {
          if (this.llmConfig.provider === 'xfyun_xinghuo') {
            configToSave.apiSecret = this.llmConfig.secretKey
          } else {
            configToSave.secretKey = this.llmConfig.secretKey
          }
        }

        llm.updateConfig(this.llmConfig.provider, configToSave)

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
    /**
     * 测试 LLM 连接
     */
    async testLLMConnection() {
      if (this.testingConnection) {
        return
      }

      // 验证必填字段
      if (this.llmConfig.provider !== 'ollama' && !this.llmConfig.apiKey) {
        uni.showToast({
          title: '请先输入 API Key',
          icon: 'none'
        })
        return
      }

      this.testingConnection = true

      try {
        // 临时设置配置用于测试
        const originalProvider = llm.provider
        const originalConfig = { ...llm.config[this.llmConfig.provider] }

        llm.setProvider(this.llmConfig.provider)

        const testConfig = {
          apiKey: this.llmConfig.apiKey,
          baseURL: this.llmConfig.baseURL,
          model: this.llmConfig.model,
          temperature: parseFloat(this.llmConfig.temperature)
        }

        if (this.needsSecretKey(this.llmConfig.provider)) {
          if (this.llmConfig.provider === 'xfyun_xinghuo') {
            testConfig.apiSecret = this.llmConfig.secretKey
          } else {
            testConfig.secretKey = this.llmConfig.secretKey
          }
        }

        llm.updateConfig(this.llmConfig.provider, testConfig)

        // 发送测试消息
        const response = await llm.query('你好，这是一个测试消息，请简短回复。', [])

        if (response && response.content) {
          uni.showModal({
            title: '连接成功',
            content: '配置有效，可以正常使用。\n\n测试回复：' + response.content.substring(0, 50) + (response.content.length > 50 ? '...' : ''),
            showCancel: false,
            confirmText: '确定'
          })
        } else {
          throw new Error('未获取到有效响应')
        }

        // 恢复原配置
        llm.setProvider(originalProvider)
        llm.updateConfig(this.llmConfig.provider, originalConfig)
      } catch (error) {
        console.error('测试连接失败:', error)
        uni.showModal({
          title: '连接失败',
          content: '配置无效或网络错误\n\n错误信息：' + (error.message || '未知错误'),
          showCancel: false,
          confirmText: '确定'
        })
      } finally {
        this.testingConnection = false
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
        confirmColor: 'var(--color-error)',
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
    handleBackup() {
      uni.navigateTo({
        url: '/pages/backup/backup'
      })
    },
    handleImportExport() {
      uni.navigateTo({
        url: '/pages/knowledge/import-export/import-export'
      })
    },
    goToNotificationCenter() {
      uni.navigateTo({
        url: '/pages/notifications/center'
      })
    },
    handleDndStartChange(e) {
      this.notificationSettings.doNotDisturbStart = e.detail.value
      try {
        uni.setStorageSync('notification_settings', JSON.stringify(this.notificationSettings))
      } catch (error) {
        console.error('保存勿扰时间失败:', error)
      }
    },
    handleDndEndChange(e) {
      this.notificationSettings.doNotDisturbEnd = e.detail.value
      try {
        uni.setStorageSync('notification_settings', JSON.stringify(this.notificationSettings))
      } catch (error) {
        console.error('保存勿扰时间失败:', error)
      }
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
  background-color: var(--bg-page);
}

.content {
  height: 100vh;
  padding: 24rpx 24rpx 120rpx 24rpx;
}

.section {
  background-color: var(--bg-card);
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;

  .section-title {
    display: block;
    font-size: 32rpx;
    font-weight: bold;
    color: var(--text-primary);
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
      color: var(--text-secondary);
      margin-bottom: 16rpx;
    }

    .label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16rpx;

      .label {
        margin-bottom: 0;
      }

      .char-count {
        font-size: 22rpx;
        color: var(--text-tertiary);
      }
    }

    .input {
      width: 100%;
      height: 72rpx;
      padding: 0 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 28rpx;
    }

    .picker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 72rpx;
      padding: 0 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 28rpx;

      .arrow {
        font-size: 20rpx;
        color: var(--text-tertiary);
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
        color: var(--text-tertiary);
      }
    }
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx 0;
    border-bottom: 1rpx solid var(--bg-hover);

    &:last-child {
      border-bottom: none;
    }

    .info-label {
      font-size: 28rpx;
      color: var(--text-secondary);
    }

    .info-value {
      font-size: 28rpx;
      color: var(--text-primary);

      &.status-ok {
        color: var(--color-success);
      }

      &.status-pending {
        color: var(--color-warning);
      }
    }
  }

  .button-group {
    display: flex;
    gap: 16rpx;
    margin-top: 32rpx;

    .action-btn,
    .save-btn {
      flex: 1;
      margin-top: 0;

      &.secondary {
        background-color: var(--bg-input);
        color: var(--text-primary);

        &:active {
          background-color: var(--bg-hover);
        }

        &[disabled] {
          opacity: 0.5;
        }
      }
    }

    .save-btn {
      background-color: var(--color-brand);
      color: var(--text-inverse);

      &:active {
        opacity: 0.9;
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
    background-color: var(--color-primary);
    color: var(--bg-card);
  }

  .action-btn {
    background-color: var(--color-info);
    color: var(--bg-card);
    margin-top: 16rpx;

    &.backup {
      background: var(--gradient-brand);
      color: var(--text-inverse);
      font-weight: 500;
    }

    &.import-export {
      background: var(--gradient-blue);
      color: var(--text-inverse);
      font-weight: 500;
    }

    &.danger {
      background-color: var(--color-error);
    }

    &:first-child {
      margin-top: 0;
    }
  }

  .logout-btn {
    background-color: var(--bg-input);
    color: var(--text-secondary);
    margin-top: 0;
  }

  button::after {
    border: none;
  }

  // 个人信息section特殊样式
  .profile-section {
    .avatar-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 32rpx;
      padding: 32rpx 0;

      .avatar-display {
        width: 160rpx;
        height: 160rpx;
        border-radius: 80rpx;
        background: var(--gradient-brand);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 16rpx;
        box-shadow: var(--shadow-lg);

        .avatar-emoji {
          font-size: 80rpx;
        }
      }

      .avatar-hint {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }

    .textarea {
      width: 100%;
      min-height: 120rpx;
      padding: 16rpx 24rpx;
      background-color: var(--bg-input);
      border-radius: 8rpx;
      font-size: 28rpx;
      line-height: 1.6;
    }
  }

  // 开关项样式
  .data-stats {
    background-color: var(--bg-input);
    border-radius: 12rpx;
    padding: 24rpx;
    margin-bottom: 32rpx;

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16rpx 0;
      border-bottom: 1rpx solid var(--border-light);

      &:last-child {
        border-bottom: none;
      }

      .stat-label {
        font-size: 28rpx;
        color: var(--text-secondary);
      }

      .stat-value {
        font-size: 28rpx;
        font-weight: 500;
        color: var(--color-primary);
      }
    }
  }

  .switch-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24rpx 0;
    border-bottom: 1rpx solid var(--bg-hover);

    &:last-child {
      border-bottom: none;
    }

    .switch-info {
      flex: 1;
      margin-right: 24rpx;

      .switch-label {
        display: block;
        font-size: 28rpx;
        color: var(--text-primary);
        margin-bottom: 8rpx;
      }

      .switch-desc {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
        line-height: 1.5;
      }
    }

    switch {
      transform: scale(0.9);
    }
  }

  // 关于section的logo样式
  .about-logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40rpx 0;
    margin-bottom: 32rpx;
    border-bottom: 1rpx solid var(--bg-hover);

    .logo-image {
      width: 160rpx;
      height: 160rpx;
      margin-bottom: 24rpx;
      border-radius: 32rpx;
      box-shadow: 0 4rpx 16rpx rgba(102, 126, 234, 0.15);
      background-color: var(--bg-input);
      padding: 8rpx;
    }

    .app-name {
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 12rpx;
    }

    .app-desc {
      font-size: 24rpx;
      color: var(--text-tertiary);
      text-align: center;
    }
  }

  // 主题切换样式
  .theme-options {
    display: flex;
    gap: 16rpx;
    margin-top: 16rpx;

    .theme-option {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32rpx 16rpx;
      background-color: var(--bg-input);
      border-radius: 12rpx;
      border: 2rpx solid transparent;
      transition: all 0.2s;

      &.active {
        background-color: var(--bg-success-light);
        border-color: var(--color-primary);
      }

      .theme-icon {
        font-size: 48rpx;
        margin-bottom: 12rpx;
      }

      .theme-name {
        font-size: 24rpx;
        color: var(--text-secondary);
      }

      &.active .theme-name {
        color: var(--color-primary);
        font-weight: 500;
      }
    }
  }

  // 勿扰模式时间设置
  .dnd-time-settings {
    margin-top: 24rpx;
    padding: 24rpx;
    background-color: var(--bg-input);
    border-radius: 12rpx;

    .time-picker-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16rpx 0;
      border-bottom: 1rpx solid var(--border-light);

      &:last-child {
        border-bottom: none;
      }

      .time-label {
        font-size: 28rpx;
        color: var(--text-secondary);
      }

      .time-picker {
        display: flex;
        align-items: center;
        gap: 12rpx;
        padding: 12rpx 24rpx;
        background-color: var(--bg-card);
        border-radius: 8rpx;
        font-size: 28rpx;
        color: var(--text-primary);

        .arrow {
          font-size: 20rpx;
          color: var(--text-tertiary);
        }
      }
    }
  }
}

// 弹窗样式
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 640rpx;
    max-height: 80vh;
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .modal-btn {
      width: 100%;
      height: 88rpx;
      border-radius: 44rpx;
      font-size: 30rpx;
      font-weight: 500;
      border: none;
      background-color: var(--bg-input);
      color: var(--text-secondary);
      margin-top: 32rpx;

      &::after {
        border: none;
      }
    }
  }

  .avatar-modal {
    .avatar-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 16rpx;
      margin-bottom: 16rpx;

      .avatar-option {
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--bg-input);
        border-radius: 12rpx;
        border: 2rpx solid transparent;
        transition: all 0.2s;

        &.active {
          background-color: var(--bg-success-light);
          border-color: var(--color-primary);
        }

        .avatar-emoji-large {
          font-size: 48rpx;
        }
      }
    }
  }

  .pin-modal {
    .pin-form {
      .form-item-full {
        margin-bottom: 32rpx;

        &:last-child {
          margin-bottom: 0;
        }

        .form-label {
          display: block;
          font-size: 28rpx;
          color: var(--text-secondary);
          margin-bottom: 16rpx;
        }

        .form-input {
          width: 100%;
          height: 80rpx;
          padding: 0 24rpx;
          background-color: var(--bg-input);
          border-radius: 8rpx;
          font-size: 28rpx;
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;
      margin-top: 40rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 30rpx;
        font-weight: 500;
        border: none;
        background-color: var(--bg-input);
        color: var(--text-secondary);

        &::after {
          border: none;
        }

        &.confirm {
          background-color: var(--color-primary);
          color: var(--bg-card);

          &[disabled] {
            opacity: 0.5;
          }
        }

        &.cancel {
          background-color: var(--bg-input);
          color: var(--text-secondary);
        }
      }
    }
  }
}
</style>
