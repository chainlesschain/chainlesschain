<template>
  <view class="verify-pin-container">
    <view class="header">
      <text class="title">验证身份</text>
      <text class="subtitle">{{ message || '请输入PIN码以继续' }}</text>
    </view>

    <view class="form-section">
      <view class="pin-display">
        <view
          v-for="(dot, index) in 6"
          :key="index"
          class="pin-dot"
          :class="{ 'pin-dot-filled': index < pin.length }"
        >
          <text v-if="showPin && index < pin.length">{{ pin[index] }}</text>
        </view>
      </view>

      <view class="pin-keyboard">
        <view class="keyboard-row" v-for="(row, rowIndex) in keyboard" :key="rowIndex">
          <view
            v-for="key in row"
            :key="key.value"
            class="keyboard-key"
            :class="{ 'keyboard-key-disabled': key.disabled }"
            @click="handleKeyPress(key.value)"
          >
            <text class="key-text">{{ key.label }}</text>
          </view>
        </view>
      </view>

      <view class="actions">
        <view class="action-btn" @click="toggleShowPin">
          <text class="action-text">{{ showPin ? '隐藏' : '显示' }}PIN码</text>
        </view>
        <view class="action-btn" @click="handleCancel">
          <text class="action-text">取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import authService from '@/services/auth'

export default {
  data() {
    return {
      pin: '',
      showPin: false,
      message: '',
      loading: false,
      keyboard: [
        [
          { label: '1', value: '1' },
          { label: '2', value: '2' },
          { label: '3', value: '3' }
        ],
        [
          { label: '4', value: '4' },
          { label: '5', value: '5' },
          { label: '6', value: '6' }
        ],
        [
          { label: '7', value: '7' },
          { label: '8', value: '8' },
          { label: '9', value: '9' }
        ],
        [
          { label: '', value: '', disabled: true },
          { label: '0', value: '0' },
          { label: '⌫', value: 'backspace' }
        ]
      ]
    }
  },
  onLoad(options) {
    // 接收传递的提示信息
    if (options.message) {
      this.message = decodeURIComponent(options.message)
    }
  },
  methods: {
    handleKeyPress(value) {
      if (!value || this.loading) {
        return
      }

      if (value === 'backspace') {
        this.pin = this.pin.slice(0, -1)
        return
      }

      if (this.pin.length < 6) {
        this.pin += value

        // 自动验证
        if (this.pin.length === 6) {
          this.verifyPin()
        }
      }
    },
    toggleShowPin() {
      this.showPin = !this.showPin
    },
    async verifyPin() {
      if (this.loading) {
        return
      }

      this.loading = true

      try {
        const result = await authService.verifyPIN(this.pin)

        if (result.success) {
          uni.showToast({
            title: '验证成功',
            icon: 'success',
            duration: 1000
          })

          setTimeout(() => {
            // 返回上一页，并传递验证成功的信息
            const pages = getCurrentPages()
            const prevPage = pages[pages.length - 2]
            if (prevPage) {
              prevPage.$vm.onPinVerified && prevPage.$vm.onPinVerified(result.masterKey)
            }
            uni.navigateBack()
          }, 1000)
        } else {
          throw new Error('PIN码错误')
        }
      } catch (error) {
        console.error('验证失败:', error)

        uni.showToast({
          title: error.message || 'PIN码错误',
          icon: 'none',
          duration: 2000
        })

        // 清空输入
        this.pin = ''
      } finally {
        this.loading = false
      }
    },
    handleCancel() {
      uni.navigateBack()
    }
  }
}
</script>

<style lang="scss" scoped>
.verify-pin-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 100rpx 40rpx 60rpx;
  display: flex;
  flex-direction: column;
}

.header {
  text-align: center;
  margin-bottom: 100rpx;

  .title {
    display: block;
    font-size: 48rpx;
    font-weight: bold;
    color: var(--bg-card);
    margin-bottom: 16rpx;
  }

  .subtitle {
    display: block;
    font-size: 26rpx;
    color: rgba(255, 255, 255, 0.8);
    line-height: 40rpx;
  }
}

.form-section {
  flex: 1;
  display: flex;
  flex-direction: column;

  .pin-display {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 80rpx;
    gap: 20rpx;

    .pin-dot {
      width: 80rpx;
      height: 80rpx;
      border-radius: 50%;
      background-color: rgba(255, 255, 255, 0.2);
      border: 2rpx solid rgba(255, 255, 255, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s;

      &.pin-dot-filled {
        background-color: var(--bg-card);
        border-color: var(--bg-card);

        text {
          font-size: 40rpx;
          font-weight: bold;
          color: var(--text-link);
        }
      }
    }
  }

  .pin-keyboard {
    margin-bottom: 60rpx;

    .keyboard-row {
      display: flex;
      justify-content: center;
      gap: 24rpx;
      margin-bottom: 24rpx;

      .keyboard-key {
        width: 160rpx;
        height: 120rpx;
        background-color: rgba(255, 255, 255, 0.2);
        border-radius: 16rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(10rpx);
        transition: all 0.2s;

        &:active:not(.keyboard-key-disabled) {
          background-color: rgba(255, 255, 255, 0.3);
          transform: scale(0.95);
        }

        &.keyboard-key-disabled {
          opacity: 0;
          pointer-events: none;
        }

        .key-text {
          font-size: 48rpx;
          font-weight: 500;
          color: var(--bg-card);
        }
      }
    }
  }

  .actions {
    display: flex;
    justify-content: space-around;
    margin-top: auto;

    .action-btn {
      padding: 20rpx 40rpx;

      .action-text {
        font-size: 28rpx;
        color: rgba(255, 255, 255, 0.9);
      }
    }
  }
}
</style>
