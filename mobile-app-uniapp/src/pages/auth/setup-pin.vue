<template>
  <view class="setup-pin-container">
    <view class="header">
      <text class="title">设置PIN码</text>
      <text class="subtitle">PIN码用于保护您的私钥和敏感数据</text>
    </view>

    <view class="form-section">
      <view class="input-group">
        <text class="label">设置PIN码</text>
        <input
          class="pin-input"
          type="number"
          maxlength="6"
          v-model="pin"
          placeholder="请输入6位数字PIN码"
          :password="!showPin"
          @input="validatePin"
        />
        <view class="toggle-visibility" @click="showPin = !showPin">
          <text class="toggle-text">{{ showPin ? '隐藏' : '显示' }}</text>
        </view>
      </view>

      <view class="input-group">
        <text class="label">确认PIN码</text>
        <input
          class="pin-input"
          type="number"
          maxlength="6"
          v-model="confirmPin"
          placeholder="请再次输入PIN码"
          :password="!showConfirmPin"
          @input="validateConfirmPin"
        />
        <view class="toggle-visibility" @click="showConfirmPin = !showConfirmPin">
          <text class="toggle-text">{{ showConfirmPin ? '隐藏' : '显示' }}</text>
        </view>
      </view>

      <view class="error-message" v-if="errorMessage">
        <text class="error-text">{{ errorMessage }}</text>
      </view>

      <view class="tips-card">
        <text class="tips-title">安全提示</text>
        <text class="tips-item">• PIN码必须是6位数字</text>
        <text class="tips-item">• 请勿使用简单的数字组合（如123456）</text>
        <text class="tips-item">• PIN码用于加密您的私钥，请妥善保管</text>
        <text class="tips-item">• 忘记PIN码将无法恢复，请务必记住</text>
      </view>

      <button
        class="submit-btn"
        :class="{ 'btn-disabled': !canSubmit }"
        :disabled="!canSubmit || loading"
        @click="handleSetup"
      >
        <text v-if="!loading">设置PIN码</text>
        <text v-else>设置中...</text>
      </button>
    </view>
  </view>
</template>

<script>
import authService from '@/services/auth'

export default {
  data() {
    return {
      pin: '',
      confirmPin: '',
      showPin: false,
      showConfirmPin: false,
      errorMessage: '',
      loading: false
    }
  },
  computed: {
    canSubmit() {
      return this.pin.length === 6 && this.confirmPin.length === 6 && this.pin === this.confirmPin
    }
  },
  methods: {
    validatePin() {
      if (this.pin && !/^\d{0,6}$/.test(this.pin)) {
        this.errorMessage = 'PIN码必须是数字'
        return
      }
      this.errorMessage = ''
    },
    validateConfirmPin() {
      if (this.confirmPin && this.confirmPin !== this.pin.substring(0, this.confirmPin.length)) {
        this.errorMessage = '两次输入的PIN码不一致'
        return
      }
      this.errorMessage = ''
    },
    async handleSetup() {
      if (!this.canSubmit || this.loading) {
        return
      }

      // 验证PIN码强度
      if (this.isWeakPin(this.pin)) {
        uni.showModal({
          title: '弱PIN码警告',
          content: '您输入的PIN码过于简单，建议使用更复杂的组合。是否继续？',
          success: (res) => {
            if (res.confirm) {
              this.setupPIN()
            }
          }
        })
        return
      }

      await this.setupPIN()
    },
    async setupPIN() {
      this.loading = true

      try {
        // 调用AUTH服务设置PIN
        const result = await authService.setupPIN(this.pin)

        if (result.success) {
          uni.showToast({
            title: 'PIN码设置成功',
            icon: 'success'
          })

          // 延迟跳转
          setTimeout(() => {
            // 如果是从设置页面进入，返回上一页
            const pages = getCurrentPages()
            if (pages.length > 1) {
              uni.navigateBack()
            } else {
              // 否则跳转到首页
              uni.reLaunch({
                url: '/pages/index/index'
              })
            }
          }, 1500)
        }
      } catch (error) {
        console.error('设置PIN失败:', error)
        uni.showToast({
          title: error.message || '设置失败',
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.loading = false
      }
    },
    // 检查是否是弱PIN码
    isWeakPin(pin) {
      const weakPatterns = [
        '123456',
        '654321',
        '111111',
        '222222',
        '333333',
        '444444',
        '555555',
        '666666',
        '777777',
        '888888',
        '999999',
        '000000',
        '112233',
        '998877'
      ]
      return weakPatterns.includes(pin)
    }
  }
}
</script>

<style lang="scss" scoped>
.setup-pin-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 60rpx 40rpx;
}

.header {
  text-align: center;
  margin-bottom: 80rpx;

  .title {
    display: block;
    font-size: 48rpx;
    font-weight: bold;
    color: var(--bg-card);
    margin-bottom: 16rpx;
  }

  .subtitle {
    display: block;
    font-size: 24rpx;
    color: rgba(255, 255, 255, 0.8);
  }
}

.form-section {
  .input-group {
    margin-bottom: 40rpx;
    position: relative;

    .label {
      display: block;
      font-size: 28rpx;
      color: var(--bg-card);
      margin-bottom: 16rpx;
    }

    .pin-input {
      width: 100%;
      height: 96rpx;
      background-color: rgba(255, 255, 255, 0.2);
      border: 2rpx solid rgba(255, 255, 255, 0.3);
      border-radius: 16rpx;
      padding: 0 32rpx;
      font-size: 36rpx;
      color: var(--bg-card);
      letter-spacing: 8rpx;
    }

    .pin-input::placeholder {
      color: rgba(255, 255, 255, 0.5);
      font-size: 28rpx;
      letter-spacing: 0;
    }

    .toggle-visibility {
      position: absolute;
      right: 32rpx;
      bottom: 32rpx;
      padding: 8rpx 16rpx;

      .toggle-text {
        font-size: 24rpx;
        color: rgba(255, 255, 255, 0.8);
      }
    }
  }

  .error-message {
    margin-top: -24rpx;
    margin-bottom: 24rpx;
    padding: 16rpx 24rpx;
    background-color: rgba(255, 77, 79, 0.2);
    border-radius: 8rpx;

    .error-text {
      font-size: 24rpx;
      color: #ff4d4f;
    }
  }

  .tips-card {
    background-color: rgba(255, 255, 255, 0.15);
    border-radius: 16rpx;
    padding: 32rpx;
    margin-bottom: 48rpx;
    backdrop-filter: blur(10rpx);

    .tips-title {
      display: block;
      font-size: 28rpx;
      font-weight: bold;
      color: var(--bg-card);
      margin-bottom: 16rpx;
    }

    .tips-item {
      display: block;
      font-size: 24rpx;
      color: rgba(255, 255, 255, 0.8);
      line-height: 40rpx;
      margin-bottom: 8rpx;

      &:last-child {
        margin-bottom: 0;
      }
    }
  }

  .submit-btn {
    width: 100%;
    height: 96rpx;
    background-color: var(--bg-card);
    color: var(--text-link);
    border-radius: 48rpx;
    font-size: 32rpx;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;

    &.btn-disabled {
      opacity: 0.5;
    }
  }

  .submit-btn::after {
    border: none;
  }
}
</style>
