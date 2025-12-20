<template>
  <view class="add-friend-container">
    <view class="header">
      <text class="title">添加好友</text>
    </view>

    <!-- 搜索区域 -->
    <view class="search-section">
      <view class="input-group">
        <text class="label">输入好友DID</text>
        <input
          class="did-input"
          type="text"
          v-model="didInput"
          placeholder="did:chainlesschain:..."
          :disabled="searching"
        />
      </view>

      <button
        class="search-btn"
        :class="{ 'btn-disabled': !didInput || searching }"
        :disabled="!didInput || searching"
        @click="searchUser"
      >
        <text v-if="!searching">搜索</text>
        <text v-else>搜索中...</text>
      </button>

      <!-- 扫码添加（预留） -->
      <!-- #ifdef APP-PLUS -->
      <button class="scan-btn" @click="scanQRCode">
        <text class="icon">📷</text>
        <text>扫码添加</text>
      </button>
      <!-- #endif -->
    </view>

    <!-- 搜索结果 -->
    <view class="result-section" v-if="searchResult">
      <view class="result-card">
        <view class="user-avatar">
          <text class="avatar-text">{{ getAvatarText() }}</text>
        </view>

        <view class="user-info">
          <text class="user-did">{{ formatDid(searchResult.did) }}</text>

          <view class="status-badge" v-if="searchResult.isFriend">
            <text class="badge-text">✓ 已是好友</text>
          </view>
          <view class="status-badge blocked" v-else-if="searchResult.isBlocked">
            <text class="badge-text">🚫 已拉黑</text>
          </view>

          <!-- DID文档信息 -->
          <view class="did-doc-info" v-if="searchResult.didDocument">
            <text class="info-label">公钥类型：</text>
            <text class="info-value">
              {{ searchResult.didDocument.verificationMethod?.[0]?.type || 'Unknown' }}
            </text>
          </view>
        </view>
      </view>

      <!-- 好友请求表单 -->
      <view class="request-form" v-if="!searchResult.isFriend && !searchResult.isBlocked">
        <view class="form-group">
          <text class="form-label">验证消息（选填）</text>
          <textarea
            class="message-input"
            v-model="requestMessage"
            placeholder="请输入验证消息..."
            maxlength="200"
            :disabled="sending"
          />
          <text class="char-count">{{ requestMessage.length }}/200</text>
        </view>

        <button
          class="send-btn"
          :class="{ 'btn-disabled': sending }"
          :disabled="sending"
          @click="sendRequest"
        >
          <text v-if="!sending">发送好友请求</text>
          <text v-else>发送中...</text>
        </button>
      </view>

      <!-- 已是好友的操作 -->
      <view class="friend-actions" v-if="searchResult.isFriend">
        <button class="view-profile-btn" @click="viewProfile">
          查看好友资料
        </button>
      </view>

      <!-- 已拉黑的操作 -->
      <view class="blocked-actions" v-if="searchResult.isBlocked">
        <button class="unblock-btn" @click="unblockUser">
          解除拉黑
        </button>
      </view>
    </view>

    <!-- 空状态 -->
    <view class="empty-state" v-if="!searchResult && !searching">
      <text class="empty-icon">🔍</text>
      <text class="empty-text">输入DID搜索用户</text>
      <view class="tips">
        <text class="tip-title">提示：</text>
        <text class="tip-item">• DID格式：did:chainlesschain:xxxxx</text>
        <text class="tip-item">• 可以从对方的个人名片获取DID</text>
        <!-- #ifdef APP-PLUS -->
        <text class="tip-item">• 或使用扫码功能添加</text>
        <!-- #endif -->
      </view>
    </view>
  </view>
</template>

<script>
import friendService from '@/services/friends'

export default {
  data() {
    return {
      didInput: '',
      searchResult: null,
      searching: false,
      sending: false,
      requestMessage: ''
    }
  },

  methods: {
    async searchUser() {
      if (!this.didInput) {
        return
      }

      // 验证DID格式
      if (!this.didInput.startsWith('did:chainlesschain:')) {
        uni.showToast({
          title: '无效的DID格式',
          icon: 'none'
        })
        return
      }

      this.searching = true
      this.searchResult = null

      try {
        const result = await friendService.searchUserByDid(this.didInput.trim())
        this.searchResult = result

        if (result.isFriend) {
          uni.showToast({
            title: '该用户已是您的好友',
            icon: 'none'
          })
        } else if (result.isBlocked) {
          uni.showToast({
            title: '该用户在黑名单中',
            icon: 'none'
          })
        }
      } catch (error) {
        console.error('搜索用户失败:', error)

        let errorMsg = '搜索失败'
        if (error.message.includes('不存在')) {
          errorMsg = 'DID不存在'
        } else if (error.message.includes('格式')) {
          errorMsg = 'DID格式错误'
        } else if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.searching = false
      }
    },

    async sendRequest() {
      if (!this.searchResult || this.sending) {
        return
      }

      this.sending = true

      try {
        await friendService.sendFriendRequest(
          this.searchResult.did,
          this.requestMessage.trim()
        )

        uni.showToast({
          title: '好友请求已发送',
          icon: 'success'
        })

        // 延迟返回
        setTimeout(() => {
          uni.navigateBack()
        }, 1500)
      } catch (error) {
        console.error('发送好友请求失败:', error)

        let errorMsg = '发送失败'
        if (error.message.includes('已是好友')) {
          errorMsg = '该用户已是您的好友'
        } else if (error.message.includes('已发送')) {
          errorMsg = '您已发送过好友请求'
        } else if (error.message.includes('黑名单')) {
          errorMsg = '无法向该用户发送请求'
        } else if (error.message) {
          errorMsg = error.message
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        })
      } finally {
        this.sending = false
      }
    },

    async unblockUser() {
      if (!this.searchResult) {
        return
      }

      try {
        await friendService.unblockUser(this.searchResult.did)

        uni.showToast({
          title: '已解除拉黑',
          icon: 'success'
        })

        // 重新搜索以更新状态
        await this.searchUser()
      } catch (error) {
        console.error('解除拉黑失败:', error)
        uni.showToast({
          title: error.message || '操作失败',
          icon: 'none'
        })
      }
    },

    viewProfile() {
      if (!this.searchResult) {
        return
      }

      uni.navigateTo({
        url: `/pages/social/friends/profile?did=${this.searchResult.did}`
      })
    },

    scanQRCode() {
      // #ifdef APP-PLUS
      uni.scanCode({
        success: (res) => {
          console.log('扫码结果:', res)
          // 假设二维码内容是DID
          if (res.result && res.result.startsWith('did:chainlesschain:')) {
            this.didInput = res.result
            this.searchUser()
          } else {
            uni.showToast({
              title: '无效的二维码',
              icon: 'none'
            })
          }
        },
        fail: (err) => {
          console.error('扫码失败:', err)
          uni.showToast({
            title: '扫码失败',
            icon: 'none'
          })
        }
      })
      // #endif
    },

    getAvatarText() {
      if (!this.searchResult) {
        return '?'
      }
      return this.searchResult.did.slice(-2).toUpperCase()
    },

    formatDid(did) {
      if (!did || did.length <= 32) {
        return did
      }
      return `${did.substring(0, 24)}...${did.slice(-8)}`
    }
  }
}
</script>

<style lang="scss" scoped>
.add-friend-container {
  min-height: 100vh;
  background: var(--bg-primary);
}

.header {
  background: var(--bg-card);
  padding: 32rpx;
  border-bottom: 2rpx solid var(--border-color);

  .title {
    font-size: 44rpx;
    font-weight: bold;
    color: var(--text-primary);
  }
}

.search-section {
  padding: 32rpx;
  background: var(--bg-card);
  border-bottom: 2rpx solid var(--border-color);

  .input-group {
    margin-bottom: 24rpx;

    .label {
      display: block;
      font-size: 28rpx;
      color: var(--text-secondary);
      margin-bottom: 16rpx;
    }

    .did-input {
      width: 100%;
      height: 88rpx;
      background: var(--bg-secondary);
      border-radius: 16rpx;
      padding: 0 24rpx;
      font-size: 26rpx;
      color: var(--text-primary);
      font-family: monospace;
    }
  }

  .search-btn {
    width: 100%;
    height: 88rpx;
    background: var(--bg-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 16rpx;
    font-size: 32rpx;
    font-weight: bold;
    margin-bottom: 16rpx;

    &.btn-disabled {
      opacity: 0.5;
    }

    &::after {
      border: none;
    }
  }

  .scan-btn {
    width: 100%;
    height: 88rpx;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: none;
    border-radius: 16rpx;
    font-size: 28rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16rpx;

    &::after {
      border: none;
    }

    .icon {
      font-size: 32rpx;
    }
  }
}

.result-section {
  padding: 32rpx;

  .result-card {
    background: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;
    margin-bottom: 24rpx;
    display: flex;
    gap: 24rpx;

    .user-avatar {
      width: 120rpx;
      height: 120rpx;
      border-radius: 60rpx;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .avatar-text {
        font-size: 48rpx;
        font-weight: bold;
        color: white;
      }
    }

    .user-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12rpx;

      .user-did {
        font-size: 26rpx;
        color: var(--text-primary);
        font-family: monospace;
        word-break: break-all;
      }

      .status-badge {
        padding: 8rpx 16rpx;
        background: rgba(102, 126, 234, 0.1);
        border-radius: 24rpx;
        align-self: flex-start;

        &.blocked {
          background: rgba(255, 77, 79, 0.1);
        }

        .badge-text {
          font-size: 24rpx;
          color: var(--text-link);
        }
      }

      .blocked .badge-text {
        color: var(--color-error);
      }

      .did-doc-info {
        margin-top: 8rpx;

        .info-label {
          font-size: 22rpx;
          color: var(--text-tertiary);
        }

        .info-value {
          font-size: 22rpx;
          color: var(--text-secondary);
          margin-left: 8rpx;
        }
      }
    }
  }

  .request-form {
    background: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;

    .form-group {
      margin-bottom: 24rpx;
      position: relative;

      .form-label {
        display: block;
        font-size: 28rpx;
        color: var(--text-secondary);
        margin-bottom: 16rpx;
      }

      .message-input {
        width: 100%;
        min-height: 200rpx;
        background: var(--bg-secondary);
        border-radius: 16rpx;
        padding: 24rpx;
        font-size: 28rpx;
        color: var(--text-primary);
        line-height: 1.5;
      }

      .char-count {
        display: block;
        text-align: right;
        font-size: 22rpx;
        color: var(--text-tertiary);
        margin-top: 8rpx;
      }
    }

    .send-btn {
      width: 100%;
      height: 88rpx;
      background: var(--bg-accent);
      color: var(--text-on-accent);
      border: none;
      border-radius: 16rpx;
      font-size: 32rpx;
      font-weight: bold;

      &.btn-disabled {
        opacity: 0.5;
      }

      &::after {
        border: none;
      }
    }
  }

  .friend-actions,
  .blocked-actions {
    background: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;

    button {
      width: 100%;
      height: 88rpx;
      border: none;
      border-radius: 16rpx;
      font-size: 32rpx;
      font-weight: bold;

      &::after {
        border: none;
      }
    }

    .view-profile-btn {
      background: var(--bg-accent);
      color: var(--text-on-accent);
    }

    .unblock-btn {
      background: var(--bg-secondary);
      color: var(--text-secondary);
    }
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 48rpx;

  .empty-icon {
    font-size: 128rpx;
    margin-bottom: 32rpx;
    opacity: 0.5;
  }

  .empty-text {
    font-size: 32rpx;
    color: var(--text-secondary);
    margin-bottom: 48rpx;
  }

  .tips {
    width: 100%;
    background: var(--bg-card);
    border-radius: 16rpx;
    padding: 32rpx;

    .tip-title {
      display: block;
      font-size: 28rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 16rpx;
    }

    .tip-item {
      display: block;
      font-size: 24rpx;
      color: var(--text-secondary);
      line-height: 2;
    }
  }
}
</style>
