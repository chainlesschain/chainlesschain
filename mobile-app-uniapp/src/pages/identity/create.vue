<template>
  <view class="create-identity-page">
    <!-- 头部 -->
    <view class="header">
      <text class="title">创建新身份</text>
      <text class="subtitle">生成您的去中心化身份标识符</text>
    </view>

    <!-- 表单 -->
    <view class="form-container">
      <!-- 昵称 -->
      <view class="form-item">
        <text class="label">昵称 *</text>
        <input
          v-model="formData.nickname"
          class="input"
          placeholder="请输入昵称"
          maxlength="20"
        />
        <text class="hint">{{ formData.nickname.length }}/20</text>
      </view>

      <!-- 个人简介 -->
      <view class="form-item">
        <text class="label">个人简介</text>
        <textarea
          v-model="formData.bio"
          class="textarea"
          placeholder="简单介绍一下自己（可选）"
          maxlength="200"
          :auto-height="true"
        />
        <text class="hint">{{ formData.bio.length }}/200</text>
      </view>

      <!-- PIN码 -->
      <view class="form-item">
        <text class="label">PIN码 *</text>
        <input
          v-model="formData.pin"
          class="input"
          type="number"
          password
          placeholder="请输入6位PIN码"
          maxlength="6"
        />
        <text class="hint">用于保护您的私钥</text>
      </view>

      <!-- 确认PIN码 -->
      <view class="form-item">
        <text class="label">确认PIN码 *</text>
        <input
          v-model="formData.pinConfirm"
          class="input"
          type="number"
          password
          placeholder="请再次输入PIN码"
          maxlength="6"
        />
      </view>

      <!-- 安全提示 -->
      <view class="security-notice">
        <text class="notice-icon">🔒</text>
        <view class="notice-content">
          <text class="notice-title">安全提示</text>
          <text class="notice-text">• DID和私钥将生成在您的设备上</text>
          <text class="notice-text">• 私钥使用PIN码加密存储</text>
          <text class="notice-text">• 请务必记住PIN码，遗失无法找回</text>
          <text class="notice-text">• 建议定期导出备份身份数据</text>
        </view>
      </view>

      <!-- 生成按钮 -->
      <view class="actions">
        <view class="btn cancel" @tap="cancel">取消</view>
        <view class="btn primary" @tap="generate" :class="{ disabled: !canGenerate }">
          {{ generating ? '生成中...' : '生成DID' }}
        </view>
      </view>
    </view>

    <!-- 成功提示弹窗 -->
    <view v-if="showSuccessModal" class="modal-overlay" @tap="closeSuccess">
      <view class="modal-content success" @tap.stop>
        <text class="success-icon">✅</text>
        <text class="success-title">DID创建成功！</text>

        <view class="did-display">
          <text class="did-label">您的DID标识符：</text>
          <text class="did-value">{{ createdDID }}</text>
        </view>

        <view class="success-actions">
          <view class="success-btn" @tap="copyDID">
            📋 复制DID
          </view>
          <view class="success-btn primary" @tap="goToList">
            查看我的身份
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import didService from '@/services/did.js'
import { db as database } from '@/services/database.js'

export default {
  data() {
    return {
      formData: {
        nickname: '',
        bio: '',
        pin: '',
        pinConfirm: ''
      },
      generating: false,
      showSuccessModal: false,
      createdDID: ''
    }
  },

  computed: {
    /**
     * 是否可以生成DID
     */
    canGenerate() {
      return (
        this.formData.nickname.trim().length > 0 &&
        this.formData.pin.length === 6 &&
        this.formData.pin === this.formData.pinConfirm &&
        !this.generating
      )
    }
  },

  methods: {
    /**
     * 生成DID
     */
    async generate() {
      if (!this.canGenerate) return

      // 验证PIN码
      if (this.formData.pin !== this.formData.pinConfirm) {
        uni.showToast({
          title: 'PIN码不一致',
          icon: 'none'
        })
        return
      }

      try {
        this.generating = true
        uni.showLoading({ title: '生成中...' })

        // 确保数据库已初始化
        if (!database.isOpen) {
          await database.init(this.formData.pin)
        }

        // 生成DID
        const result = await didService.generateDID(
          this.formData.nickname,
          this.formData.pin,
          this.formData.bio
        )

        console.log('✅ DID生成成功:', result)

        // 如果是第一个身份，设为默认
        const allIdentities = await database.getAllIdentities()
        if (allIdentities.length === 1) {
          await database.setDefaultIdentity(result.did)
        }

        this.createdDID = result.did
        this.showSuccessModal = true

        // 清空表单
        this.formData = {
          nickname: '',
          bio: '',
          pin: '',
          pinConfirm: ''
        }
      } catch (error) {
        console.error('❌ DID生成失败:', error)
        uni.showModal({
          title: '生成失败',
          content: error.message || '请稍后重试',
          showCancel: false
        })
      } finally {
        this.generating = false
        uni.hideLoading()
      }
    },

    /**
     * 取消
     */
    cancel() {
      uni.navigateBack()
    },

    /**
     * 复制DID
     */
    copyDID() {
      uni.setClipboardData({
        data: this.createdDID,
        success: () => {
          uni.showToast({
            title: '已复制',
            icon: 'success'
          })
        }
      })
    },

    /**
     * 关闭成功弹窗
     */
    closeSuccess() {
      this.showSuccessModal = false
      this.goToList()
    },

    /**
     * 跳转到身份列表
     */
    goToList() {
      uni.navigateBack()
    }
  }
}
</script>

<style scoped lang="scss">
.create-identity-page {
  min-height: 100vh;
  background: var(--bg-page, #f8f8f8);
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 60rpx 40rpx 40rpx;
  color: #fff;

  .title {
    font-size: 48rpx;
    font-weight: bold;
    display: block;
  }

  .subtitle {
    font-size: 28rpx;
    opacity: 0.9;
    margin-top: 10rpx;
    display: block;
  }
}

.form-container {
  padding: 40rpx;
}

.form-item {
  margin-bottom: 40rpx;

  .label {
    font-size: 28rpx;
    color: var(--text-primary, #333);
    font-weight: 500;
    display: block;
    margin-bottom: 16rpx;
  }

  .input,
  .textarea {
    width: 100%;
    background: var(--bg-card, #fff);
    border-radius: 12rpx;
    padding: 24rpx;
    font-size: 28rpx;
    color: var(--text-primary, #333);
    border: 2rpx solid var(--border-color, #e0e0e0);
    box-sizing: border-box;

    &:focus {
      border-color: #667eea;
    }
  }

  .textarea {
    min-height: 160rpx;
  }

  .hint {
    font-size: 24rpx;
    color: var(--text-tertiary, #999);
    margin-top: 12rpx;
    display: block;
  }
}

.security-notice {
  background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 40rpx;
  display: flex;

  .notice-icon {
    font-size: 48rpx;
    margin-right: 20rpx;
  }

  .notice-content {
    flex: 1;

    .notice-title {
      font-size: 28rpx;
      font-weight: bold;
      color: var(--text-primary, #333);
      display: block;
      margin-bottom: 16rpx;
    }

    .notice-text {
      font-size: 24rpx;
      color: var(--text-secondary, #666);
      display: block;
      margin-bottom: 8rpx;
      line-height: 1.6;
    }
  }
}

.actions {
  display: flex;
  gap: 20rpx;
  margin-top: 60rpx;

  .btn {
    flex: 1;
    padding: 28rpx;
    border-radius: 12rpx;
    text-align: center;
    font-size: 30rpx;
    font-weight: 500;

    &.cancel {
      background: var(--bg-input, #f5f5f5);
      color: var(--text-secondary, #666);
    }

    &.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;

      &.disabled {
        opacity: 0.5;
        pointer-events: none;
      }
    }

    &:active:not(.disabled) {
      opacity: 0.8;
    }
  }
}

/* 成功弹窗 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
}

.modal-content.success {
  background: var(--bg-card, #fff);
  border-radius: 24rpx;
  padding: 60rpx 40rpx;
  text-align: center;
  max-width: 600rpx;
  width: 100%;

  .success-icon {
    font-size: 120rpx;
    display: block;
    margin-bottom: 30rpx;
  }

  .success-title {
    font-size: 36rpx;
    font-weight: bold;
    color: var(--text-primary, #333);
    display: block;
    margin-bottom: 40rpx;
  }

  .did-display {
    background: var(--bg-input, #f5f5f5);
    border-radius: 12rpx;
    padding: 30rpx;
    margin-bottom: 40rpx;

    .did-label {
      font-size: 24rpx;
      color: var(--text-secondary, #666);
      display: block;
      margin-bottom: 12rpx;
    }

    .did-value {
      font-size: 24rpx;
      font-family: 'Courier New', monospace;
      color: var(--text-primary, #333);
      word-break: break-all;
      display: block;
      line-height: 1.6;
    }
  }

  .success-actions {
    display: flex;
    flex-direction: column;
    gap: 16rpx;

    .success-btn {
      padding: 28rpx;
      border-radius: 12rpx;
      font-size: 28rpx;
      background: var(--bg-input, #f5f5f5);
      color: var(--text-primary, #333);

      &.primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff;
      }

      &:active {
        opacity: 0.8;
      }
    }
  }
}
</style>

