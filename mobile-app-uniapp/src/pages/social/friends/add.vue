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

    <!-- 我的二维码区域 -->
    <view class="my-qrcode-section">
      <button class="show-qrcode-btn" @click="showMyQRCode">
        <text class="icon">📱</text>
        <text>我的二维码</text>
      </button>
    </view>

    <!-- 二维码弹窗 -->
    <view class="qrcode-modal" v-if="showQRModal" @click="hideQRCode">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">我的DID二维码</text>
          <text class="close-btn" @click="hideQRCode">✕</text>
        </view>

        <view class="qrcode-container">
          <!-- 使用canvas绘制二维码 -->
          <canvas
            canvas-id="qrcodeCanvas"
            class="qrcode-canvas"
            :style="{ width: qrcodeSize + 'px', height: qrcodeSize + 'px' }"
          />
        </view>

        <view class="my-did-info">
          <text class="did-label">我的DID</text>
          <text class="did-text">{{ myDid }}</text>
          <button class="copy-btn" @click="copyMyDid">复制DID</button>
        </view>

        <view class="qrcode-tips">
          <text class="tip-text">• 让好友扫描此二维码添加我为好友</text>
          <text class="tip-text">• 或分享我的DID给好友手动添加</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import friendService from '@/services/friends'
import didService from '@/services/did'

export default {
  data() {
    return {
      didInput: '',
      searchResult: null,
      searching: false,
      sending: false,
      requestMessage: '',
      showQRModal: false,
      myDid: '',
      qrcodeSize: 500 // 二维码大小（rpx）
    }
  },

  async onLoad() {
    try {
      // 获取当前用户的DID
      const currentIdentity = await didService.getCurrentIdentity()
      if (currentIdentity) {
        this.myDid = currentIdentity.did
      } else {
        // 如果没有DID，提示用户创建
        uni.showToast({
          title: '请先创建DID身份',
          icon: 'none',
          duration: 3000
        })
      }
    } catch (error) {
      console.error('获取当前DID失败:', error)
      uni.showToast({
        title: '获取DID身份失败，请稍后重试',
        icon: 'none',
        duration: 2000
      })
    }
  },

  methods: {
    async searchUser() {
      if (!this.didInput) {
        uni.showToast({
          title: '请输入DID',
          icon: 'none'
        })
        return
      }

      // 去除首尾空格
      const trimmedDid = this.didInput.trim()

      // 验证DID格式
      if (!trimmedDid.startsWith('did:chainlesschain:')) {
        uni.showToast({
          title: 'DID格式错误\n正确格式：did:chainlesschain:xxxxx',
          icon: 'none',
          duration: 2500
        })
        return
      }

      // 验证DID长度（基本检查）
      if (trimmedDid.length < 25) {
        uni.showToast({
          title: 'DID长度不正确',
          icon: 'none'
        })
        return
      }

      // 防止重复搜索
      if (this.searching) {
        return
      }

      this.searching = true
      this.searchResult = null

      try {
        const result = await friendService.searchUserByDid(trimmedDid)

        if (!result) {
          uni.showToast({
            title: '未找到该DID用户',
            icon: 'none',
            duration: 2000
          })
          return
        }

        this.searchResult = result

        // 提供友好的状态提示
        if (result.isFriend) {
          uni.showToast({
            title: '✓ 该用户已是您的好友',
            icon: 'none',
            duration: 1500
          })
        } else if (result.isBlocked) {
          uni.showToast({
            title: '该用户在黑名单中',
            icon: 'none',
            duration: 1500
          })
        } else {
          uni.showToast({
            title: '找到用户，可以发送好友请求',
            icon: 'success',
            duration: 1500
          })
        }
      } catch (error) {
        console.error('搜索用户失败:', error)

        let errorMsg = '搜索失败，请稍后重试'

        // 根据错误类型提供友好提示
        if (error.message) {
          if (error.message.includes('不存在') || error.message.includes('未找到')) {
            errorMsg = '该DID不存在或尚未注册'
          } else if (error.message.includes('格式') || error.message.includes('invalid')) {
            errorMsg = 'DID格式错误'
          } else if (error.message.includes('网络') || error.message.includes('timeout')) {
            errorMsg = '网络连接失败，请检查网络'
          } else if (error.message.includes('超时')) {
            errorMsg = '请求超时，请稍后重试'
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.searching = false
      }
    },

    async sendRequest() {
      if (!this.searchResult) {
        uni.showToast({
          title: '请先搜索用户',
          icon: 'none'
        })
        return
      }

      // 防止重复提交
      if (this.sending) {
        return
      }

      this.sending = true

      try {
        await friendService.sendFriendRequest(
          this.searchResult.did,
          this.requestMessage.trim()
        )

        uni.showToast({
          title: '✓ 好友请求已发送',
          icon: 'success',
          duration: 1500
        })

        // 清空验证消息
        this.requestMessage = ''

        // 延迟返回上一页
        setTimeout(() => {
          uni.navigateBack()
        }, 1500)
      } catch (error) {
        console.error('发送好友请求失败:', error)

        let errorMsg = '发送失败，请稍后重试'

        // 根据错误类型提供友好提示
        if (error.message) {
          if (error.message.includes('已是好友')) {
            errorMsg = '该用户已是您的好友'
          } else if (error.message.includes('已发送') || error.message.includes('pending')) {
            errorMsg = '您已发送过好友请求，请等待对方回应'
          } else if (error.message.includes('黑名单') || error.message.includes('blocked')) {
            errorMsg = '无法向该用户发送请求'
          } else if (error.message.includes('网络') || error.message.includes('timeout')) {
            errorMsg = '网络连接失败，请检查网络后重试'
          } else if (error.message.includes('超时')) {
            errorMsg = '请求超时，请稍后重试'
          } else {
            errorMsg = error.message
          }
        }

        uni.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2500
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

          if (!res.result) {
            uni.showToast({
              title: '扫码失败，未识别到内容',
              icon: 'none'
            })
            return
          }

          // 检查是否是有效的DID
          if (res.result.startsWith('did:chainlesschain:')) {
            this.didInput = res.result
            // 自动搜索
            this.searchUser()
          } else {
            // 尝试解析JSON格式的二维码
            try {
              const qrData = JSON.parse(res.result)
              if (qrData.type === 'did' && qrData.did) {
                this.didInput = qrData.did
                this.searchUser()
                return
              }
            } catch (e) {
              // 不是JSON格式
            }

            // 无法识别的二维码格式
            uni.showModal({
              title: '无效的二维码',
              content: '这不是有效的DID二维码，请确保扫描的是ChainlessChain的DID二维码',
              showCancel: false
            })
          }
        },
        fail: (err) => {
          console.error('扫码失败:', err)

          let errorMsg = '扫码失败'
          if (err.errMsg) {
            if (err.errMsg.includes('cancel')) {
              errorMsg = '已取消扫码'
            } else if (err.errMsg.includes('permission')) {
              errorMsg = '没有相机权限，请在设置中开启'
            } else {
              errorMsg = '扫码失败：' + err.errMsg
            }
          }

          uni.showToast({
            title: errorMsg,
            icon: 'none',
            duration: 2000
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
    },

    /**
     * 显示我的二维码
     */
    async showMyQRCode() {
      if (!this.myDid) {
        uni.showModal({
          title: '提示',
          content: '您还没有DID身份，请先前往设置页面创建DID身份',
          showCancel: true,
          confirmText: '前往创建',
          success: (res) => {
            if (res.confirm) {
              // TODO: 跳转到创建DID页面
              uni.navigateTo({
                url: '/pages/settings/did/create'
              })
            }
          }
        })
        return
      }

      this.showQRModal = true

      // 延迟生成二维码，确保canvas已渲染
      setTimeout(() => {
        this.generateQRCode()
      }, 100)
    },

    /**
     * 隐藏二维码
     */
    hideQRCode() {
      this.showQRModal = false
    },

    /**
     * 生成二维码
     */
    generateQRCode() {
      try {
        // 使用 uni.createCanvasContext 创建画布上下文
        const ctx = uni.createCanvasContext('qrcodeCanvas', this)

        // 使用简单的二维码生成方法
        // 实际项目中应该使用专业的二维码库，如 uQRCode
        this.drawSimpleQRCode(ctx, this.myDid)

        // 提示用户这是占位符
        uni.showModal({
          title: '功能说明',
          content: '当前显示的是二维码占位符。\n\n要使用真实的二维码功能，需要安装 uQRCode 插件：\n1. 在 HBuilderX 中搜索 uQRCode\n2. 安装插件后重新运行',
          showCancel: false,
          confirmText: '我知道了'
        })
      } catch (error) {
        console.error('生成二维码失败:', error)
        uni.showModal({
          title: '二维码生成失败',
          content: error.message || '生成二维码时发生错误，请稍后重试',
          showCancel: false
        })
      }
    },

    /**
     * 绘制简单的二维码占位符
     * TODO: 实际项目中应使用 uQRCode 等专业库
     */
    drawSimpleQRCode(ctx, text) {
      const size = this.qrcodeSize
      const pixelRatio = uni.getSystemInfoSync().pixelRatio || 1
      const canvasSize = size * pixelRatio

      // 绘制白色背景
      ctx.setFillStyle('#FFFFFF')
      ctx.fillRect(0, 0, canvasSize, canvasSize)

      // 绘制简单的占位图案（实际应使用QR算法）
      ctx.setFillStyle('#000000')
      const moduleSize = canvasSize / 25

      // 绘制定位点（三个角）
      this.drawFinderPattern(ctx, moduleSize, moduleSize, moduleSize * 7)
      this.drawFinderPattern(ctx, canvasSize - moduleSize * 8, moduleSize, moduleSize * 7)
      this.drawFinderPattern(ctx, moduleSize, canvasSize - moduleSize * 8, moduleSize * 7)

      // 绘制中心文字提示
      ctx.setFillStyle('#666666')
      ctx.setFontSize(12 * pixelRatio)
      ctx.setTextAlign('center')
      ctx.fillText('DID二维码', canvasSize / 2, canvasSize / 2)
      ctx.fillText('(需安装二维码库)', canvasSize / 2, canvasSize / 2 + 20 * pixelRatio)

      ctx.draw()

      // 提示用户安装二维码库
      console.warn('请安装 uQRCode 库以生成真实的二维码')
    },

    /**
     * 绘制定位图案
     */
    drawFinderPattern(ctx, x, y, size) {
      // 外框
      ctx.fillRect(x, y, size, size)
      // 内白框
      ctx.setFillStyle('#FFFFFF')
      ctx.fillRect(x + size * 0.15, y + size * 0.15, size * 0.7, size * 0.7)
      // 中心点
      ctx.setFillStyle('#000000')
      ctx.fillRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4)
    },

    /**
     * 复制我的DID
     */
    copyMyDid() {
      if (!this.myDid) {
        return
      }

      uni.setClipboardData({
        data: this.myDid,
        success: () => {
          uni.showToast({
            title: '已复制DID',
            icon: 'success'
          })
        },
        fail: () => {
          uni.showToast({
            title: '复制失败',
            icon: 'none'
          })
        }
      })
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

.my-qrcode-section {
  padding: 32rpx;
  position: fixed;
  bottom: 32rpx;
  left: 32rpx;
  right: 32rpx;

  .show-qrcode-btn {
    width: 100%;
    height: 88rpx;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 2rpx solid var(--border-color);
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

.qrcode-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;

  .modal-content {
    width: 640rpx;
    background: var(--bg-card);
    border-radius: 24rpx;
    padding: 32rpx;
    max-height: 80vh;
    overflow-y: auto;

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32rpx;

      .modal-title {
        font-size: 36rpx;
        font-weight: bold;
        color: var(--text-primary);
      }

      .close-btn {
        font-size: 48rpx;
        color: var(--text-tertiary);
        width: 64rpx;
        height: 64rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;

        &:active {
          opacity: 0.6;
        }
      }
    }

    .qrcode-container {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32rpx;
      background: white;
      border-radius: 16rpx;
      margin-bottom: 32rpx;

      .qrcode-canvas {
        width: 500rpx;
        height: 500rpx;
        border: 2rpx solid #f0f0f0;
        border-radius: 8rpx;
      }
    }

    .my-did-info {
      background: var(--bg-secondary);
      border-radius: 16rpx;
      padding: 24rpx;
      margin-bottom: 24rpx;

      .did-label {
        display: block;
        font-size: 24rpx;
        color: var(--text-tertiary);
        margin-bottom: 12rpx;
      }

      .did-text {
        display: block;
        font-size: 22rpx;
        color: var(--text-primary);
        font-family: monospace;
        word-break: break-all;
        line-height: 1.6;
        margin-bottom: 16rpx;
      }

      .copy-btn {
        width: 100%;
        height: 72rpx;
        background: var(--bg-accent);
        color: var(--text-on-accent);
        border: none;
        border-radius: 12rpx;
        font-size: 28rpx;

        &::after {
          border: none;
        }

        &:active {
          opacity: 0.8;
        }
      }
    }

    .qrcode-tips {
      padding: 24rpx;
      background: rgba(102, 126, 234, 0.05);
      border-radius: 12rpx;

      .tip-text {
        display: block;
        font-size: 24rpx;
        color: var(--text-secondary);
        line-height: 2;
      }
    }
  }
}
</style>
