<template>
  <view class="biometric-container">
    <view class="header">
      <text class="title">生物识别设置</text>
      <text class="subtitle">使用指纹或面容ID快速解锁</text>
    </view>

    <view class="content-section">
      <!-- 设备支持状态 -->
      <view class="status-card" v-if="checkComplete">
        <view class="status-header">
          <text class="status-title">设备支持</text>
          <view class="status-badge" :class="support.supported ? 'badge-success' : 'badge-error'">
            <text class="badge-text">{{ support.supported ? '支持' : '不支持' }}</text>
          </view>
        </view>

        <view class="status-info" v-if="support.supported">
          <text class="info-label">支持的认证方式：</text>
          <view class="auth-types">
            <view class="auth-type" v-for="type in support.types" :key="type">
              <text class="type-icon">{{ getTypeIcon(type) }}</text>
              <text class="type-name">{{ getTypeName(type) }}</text>
            </view>
          </view>
        </view>

        <view class="status-info" v-else>
          <text class="info-text">您的设备不支持生物识别功能</text>
        </view>
      </view>

      <!-- 生物识别开关 -->
      <view class="setting-card" v-if="support.supported">
        <view class="setting-row">
          <view class="setting-info">
            <text class="setting-title">启用生物识别</text>
            <text class="setting-desc">使用生物识别代替PIN码解锁</text>
          </view>
          <switch
            :checked="biometricEnabled"
            :disabled="loading"
            @change="handleToggleBiometric"
            color="#667eea"
          />
        </view>
      </view>

      <!-- 安全提示 -->
      <view class="tips-card">
        <text class="tips-title">安全提示</text>
        <text class="tips-item">• 生物识别仅用于快速解锁，不会替代PIN码</text>
        <text class="tips-item">• 启用生物识别需要先验证PIN码</text>
        <text class="tips-item">• 您可以随时禁用生物识别并使用PIN码</text>
        <text class="tips-item" v-if="!support.supported">• H5模式暂不支持生物识别，请在App中使用</text>
      </view>

      <!-- 测试按钮 -->
      <view class="action-section" v-if="biometricEnabled">
        <button class="test-btn" @click="handleTest" :disabled="loading">
          <text>测试生物识别</text>
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import authService from '@/services/auth'

export default {
  data() {
    return {
      checkComplete: false,
      support: {
        supported: false,
        types: []
      },
      biometricEnabled: false,
      loading: false
    }
  },
  onLoad() {
    this.checkBiometricSupport()
    this.checkBiometricStatus()
  },
  methods: {
    async checkBiometricSupport() {
      try {
        this.support = await authService.checkBiometricSupport()
        console.log('生物识别支持:', this.support)
      } catch (error) {
        console.error('检查生物识别支持失败:', error)
        this.support = { supported: false, types: [] }
      } finally {
        this.checkComplete = true
      }
    },
    checkBiometricStatus() {
      this.biometricEnabled = authService.isBiometricEnabled()
    },
    async handleToggleBiometric(e) {
      const enabled = e.detail.value

      if (enabled) {
        // 启用生物识别
        await this.enableBiometric()
      } else {
        // 禁用生物识别
        await this.disableBiometric()
      }
    },
    async enableBiometric() {
      this.loading = true

      try {
        // 先请求输入PIN码
        const pin = await this.requestPIN()
        if (!pin) {
          this.biometricEnabled = false
          return
        }

        // 调用服务启用生物识别
        await authService.enableBiometric(pin)

        uni.showToast({
          title: '生物识别已启用',
          icon: 'success'
        })

        this.biometricEnabled = true
      } catch (error) {
        console.error('启用生物识别失败:', error)

        let errorMsg = '启用失败'
        if (error.message.includes('PIN')) {
          errorMsg = 'PIN码错误'
        } else if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })

        this.biometricEnabled = false
      } finally {
        this.loading = false
      }
    },
    async disableBiometric() {
      this.loading = true

      try {
        await authService.disableBiometric()

        uni.showToast({
          title: '生物识别已禁用',
          icon: 'success'
        })

        this.biometricEnabled = false
      } catch (error) {
        console.error('禁用生物识别失败:', error)

        uni.showToast({
          title: '禁用失败',
          icon: 'none'
        })

        this.biometricEnabled = true
      } finally {
        this.loading = false
      }
    },
    requestPIN() {
      return new Promise((resolve) => {
        uni.showModal({
          title: '验证PIN码',
          content: '请输入PIN码以启用生物识别',
          editable: true,
          placeholderText: '请输入6位PIN码',
          success: (res) => {
            if (res.confirm && res.content) {
              resolve(res.content)
            } else {
              resolve(null)
            }
          },
          fail: () => {
            resolve(null)
          }
        })
      })
    },
    async handleTest() {
      if (this.loading) {
        return
      }

      this.loading = true

      try {
        const result = await authService.verifyBiometric('测试生物识别')

        if (result.success) {
          uni.showToast({
            title: '验证成功',
            icon: 'success'
          })
        } else {
          throw new Error('验证失败')
        }
      } catch (error) {
        console.error('生物识别测试失败:', error)

        uni.showToast({
          title: error.message || '验证失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },
    getTypeIcon(type) {
      const icons = {
        fingerprint: '👆',
        facial: '👤',
        speech: '🗣️'
      }
      return icons[type] || '🔐'
    },
    getTypeName(type) {
      const names = {
        fingerprint: '指纹识别',
        facial: '面容识别',
        speech: '声音识别'
      }
      return names[type] || type
    }
  }
}
</script>

<style lang="scss" scoped>
.biometric-container {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding: 40rpx;
}

.header {
  text-align: center;
  margin-bottom: 60rpx;
  padding-top: 40rpx;

  .title {
    display: block;
    font-size: 48rpx;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 16rpx;
  }

  .subtitle {
    display: block;
    font-size: 26rpx;
    color: var(--text-secondary);
  }
}

.content-section {
  .status-card {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;
    margin-bottom: 32rpx;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);

    .status-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24rpx;

      .status-title {
        font-size: 32rpx;
        font-weight: bold;
        color: var(--text-primary);
      }

      .status-badge {
        padding: 8rpx 24rpx;
        border-radius: 24rpx;

        &.badge-success {
          background-color: rgba(82, 196, 26, 0.1);

          .badge-text {
            color: #52c41a;
          }
        }

        &.badge-error {
          background-color: rgba(255, 77, 79, 0.1);

          .badge-text {
            color: #ff4d4f;
          }
        }

        .badge-text {
          font-size: 24rpx;
          font-weight: 500;
        }
      }
    }

    .status-info {
      .info-label {
        display: block;
        font-size: 26rpx;
        color: var(--text-secondary);
        margin-bottom: 16rpx;
      }

      .auth-types {
        display: flex;
        gap: 24rpx;

        .auth-type {
          flex: 1;
          background-color: var(--bg-page);
          border-radius: 12rpx;
          padding: 24rpx;
          text-align: center;

          .type-icon {
            display: block;
            font-size: 48rpx;
            margin-bottom: 8rpx;
          }

          .type-name {
            display: block;
            font-size: 24rpx;
            color: var(--text-primary);
          }
        }
      }

      .info-text {
        font-size: 26rpx;
        color: var(--text-secondary);
        line-height: 40rpx;
      }
    }
  }

  .setting-card {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;
    margin-bottom: 32rpx;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);

    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .setting-info {
        flex: 1;
        margin-right: 32rpx;

        .setting-title {
          display: block;
          font-size: 30rpx;
          font-weight: 500;
          color: var(--text-primary);
          margin-bottom: 8rpx;
        }

        .setting-desc {
          display: block;
          font-size: 24rpx;
          color: var(--text-secondary);
          line-height: 36rpx;
        }
      }
    }
  }

  .tips-card {
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;
    margin-bottom: 32rpx;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);

    .tips-title {
      display: block;
      font-size: 28rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 16rpx;
    }

    .tips-item {
      display: block;
      font-size: 24rpx;
      color: var(--text-secondary);
      line-height: 40rpx;
      margin-bottom: 8rpx;

      &:last-child {
        margin-bottom: 0;
      }
    }
  }

  .action-section {
    .test-btn {
      width: 100%;
      height: 88rpx;
      background-color: var(--color-primary);
      color: #ffffff;
      border-radius: 44rpx;
      font-size: 30rpx;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;

      &[disabled] {
        opacity: 0.6;
      }
    }

    .test-btn::after {
      border: none;
    }
  }
}
</style>
