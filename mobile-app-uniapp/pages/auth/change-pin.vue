<template>
  <view class="change-pin-container">
    <view class="header">
      <text class="title">修改PIN码</text>
      <text class="subtitle">请输入旧PIN码和新PIN码</text>
    </view>

    <view class="form-section">
      <view class="input-group">
        <text class="label">旧PIN码</text>
        <input
          class="pin-input"
          type="number"
          maxlength="6"
          v-model="oldPin"
          placeholder="请输入旧PIN码"
          :password="!showOldPin"
        />
        <view class="toggle-visibility" @click="showOldPin = !showOldPin">
          <text class="toggle-text">{{ showOldPin ? '隐藏' : '显示' }}</text>
        </view>
      </view>

      <view class="divider"></view>

      <view class="input-group">
        <text class="label">新PIN码</text>
        <input
          class="pin-input"
          type="number"
          maxlength="6"
          v-model="newPin"
          placeholder="请输入6位数字PIN码"
          :password="!showNewPin"
          @input="validateNewPin"
        />
        <view class="toggle-visibility" @click="showNewPin = !showNewPin">
          <text class="toggle-text">{{ showNewPin ? '隐藏' : '显示' }}</text>
        </view>
      </view>

      <view class="input-group">
        <text class="label">确认新PIN码</text>
        <input
          class="pin-input"
          type="number"
          maxlength="6"
          v-model="confirmNewPin"
          placeholder="请再次输入新PIN码"
          :password="!showConfirmNewPin"
          @input="validateConfirmNewPin"
        />
        <view class="toggle-visibility" @click="showConfirmNewPin = !showConfirmNewPin">
          <text class="toggle-text">{{ showConfirmNewPin ? '隐藏' : '显示' }}</text>
        </view>
      </view>

      <view class="error-message" v-if="errorMessage">
        <text class="error-text">{{ errorMessage }}</text>
      </view>

      <view class="warning-card">
        <text class="warning-icon">⚠️</text>
        <text class="warning-text">修改PIN码后，需要使用新PIN码重新加密您的私钥和敏感数据</text>
      </view>

      <button
        class="submit-btn"
        :class="{ 'btn-disabled': !canSubmit }"
        :disabled="!canSubmit || loading"
        @click="handleChange"
      >
        <text v-if="!loading">确认修改</text>
        <text v-else>修改中...</text>
      </button>

      <button class="cancel-btn" @click="handleCancel">
        <text>取消</text>
      </button>
    </view>
  </view>
</template>

<script>
import authService from '@/services/auth'
import encryptionManager from '@/services/encryption-manager'

export default {
  data() {
    return {
      oldPin: '',
      newPin: '',
      confirmNewPin: '',
      showOldPin: false,
      showNewPin: false,
      showConfirmNewPin: false,
      errorMessage: '',
      loading: false,
      reencrypting: false
    }
  },
  computed: {
    canSubmit() {
      return (
        this.oldPin.length === 6 &&
        this.newPin.length === 6 &&
        this.confirmNewPin.length === 6 &&
        this.newPin === this.confirmNewPin
      )
    }
  },
  methods: {
    validateNewPin() {
      if (this.newPin && !/^\d{0,6}$/.test(this.newPin)) {
        this.errorMessage = 'PIN码必须是数字'
        return
      }
      if (this.newPin === this.oldPin && this.newPin.length === 6) {
        this.errorMessage = '新PIN码不能与旧PIN码相同'
        return
      }
      this.errorMessage = ''
    },
    validateConfirmNewPin() {
      if (this.confirmNewPin && this.confirmNewPin !== this.newPin.substring(0, this.confirmNewPin.length)) {
        this.errorMessage = '两次输入的新PIN码不一致'
        return
      }
      this.errorMessage = ''
    },
    async handleChange() {
      if (!this.canSubmit || this.loading) {
        return
      }

      // 最终验证
      if (this.newPin === this.oldPin) {
        this.errorMessage = '新PIN码不能与旧PIN码相同'
        return
      }

      this.loading = true

      try {
        // 调用AUTH服务修改PIN（这会返回旧密钥和新密钥）
        const result = await authService.changePIN(this.oldPin, this.newPin)

        if (result.success) {
          // PIN修改成功，扫描是否有加密数据
          const scanResult = await encryptionManager.scanEncryptedData()

          if (scanResult.totalEncrypted > 0) {
            // 有加密数据，询问是否重新加密
            uni.showModal({
              title: 'PIN码修改成功',
              content: `检测到${scanResult.totalEncrypted}项加密数据。是否使用新PIN重新加密？\n（建议重新加密以确保数据安全）`,
              confirmText: '重新加密',
              cancelText: '稍后处理',
              success: async (res) => {
                if (res.confirm) {
                  await this.reencryptData(result)
                } else {
                  this.showReencryptReminder()
                }
              }
            })
          } else {
            // 没有加密数据，直接返回
            uni.showToast({
              title: 'PIN码修改成功',
              icon: 'success'
            })
            setTimeout(() => {
              uni.navigateBack()
            }, 1500)
          }
        }
      } catch (error) {
        console.error('修改PIN失败:', error)

        let errorMsg = '修改失败'
        if (error.message.includes('旧PIN')) {
          errorMsg = '旧PIN码错误'
        } else if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })

        // 清空旧PIN输入
        if (errorMsg.includes('旧PIN')) {
          this.oldPin = ''
        }
      } finally {
        this.loading = false
      }
    },

    /**
     * 重新加密数据
     */
    async reencryptData(changePINResult) {
      this.reencrypting = true

      // 显示加载提示
      uni.showLoading({
        title: '正在重新加密...',
        mask: true
      })

      // 设置进度回调
      encryptionManager.setProgressCallback((message, current, total) => {
        uni.showLoading({
          title: `${message} ${current}/${total}`,
          mask: true
        })
      })

      try {
        // 从changePIN结果中获取旧密钥和新密钥
        const oldMasterKey = changePINResult.oldMasterKey
        const newMasterKey = changePINResult.masterKey

        const stats = await encryptionManager.reencryptAllData(oldMasterKey, newMasterKey)

        uni.hideLoading()

        uni.showModal({
          title: '重新加密完成',
          content: `成功：${stats.success}项\n失败：${stats.failed}项`,
          showCancel: false,
          success: () => {
            uni.navigateBack()
          }
        })
      } catch (error) {
        console.error('重新加密失败:', error)

        uni.hideLoading()

        uni.showModal({
          title: '重新加密失败',
          content: error.message || '部分数据可能未能重新加密，请稍后在设置中重试',
          showCancel: false
        })
      } finally {
        this.reencrypting = false
      }
    },

    /**
     * 显示重新加密提醒
     */
    showReencryptReminder() {
      uni.showModal({
        title: '重要提醒',
        content: '您选择稍后重新加密。为确保数据安全，建议尽快在"设置 > 安全 > 重新加密数据"中完成重新加密操作。',
        showCancel: false,
        success: () => {
          uni.navigateBack()
        }
      })
    },
    handleCancel() {
      uni.navigateBack()
    }
  }
}
</script>

<style lang="scss" scoped>
.change-pin-container {
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

  .divider {
    height: 2rpx;
    background: rgba(255, 255, 255, 0.2);
    margin: 40rpx 0;
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

  .warning-card {
    background-color: rgba(255, 193, 7, 0.2);
    border-radius: 16rpx;
    padding: 24rpx;
    margin-bottom: 48rpx;
    display: flex;
    align-items: flex-start;

    .warning-icon {
      font-size: 32rpx;
      margin-right: 12rpx;
    }

    .warning-text {
      flex: 1;
      font-size: 24rpx;
      color: rgba(255, 255, 255, 0.9);
      line-height: 36rpx;
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
    margin-bottom: 24rpx;

    &.btn-disabled {
      opacity: 0.5;
    }
  }

  .submit-btn::after {
    border: none;
  }

  .cancel-btn {
    width: 100%;
    height: 96rpx;
    background-color: transparent;
    color: var(--bg-card);
    border: 2rpx solid rgba(255, 255, 255, 0.5);
    border-radius: 48rpx;
    font-size: 32rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cancel-btn::after {
    border: none;
  }
}
</style>
