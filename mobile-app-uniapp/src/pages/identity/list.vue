<template>
  <view class="identity-list-page">
    <!-- 头部 -->
    <view class="header">
      <text class="title">我的身份</text>
      <text class="subtitle">去中心化身份管理</text>
    </view>

    <!-- 身份列表 -->
    <view v-if="identities.length > 0" class="identity-list">
      <view
        v-for="identity in identities"
        :key="identity.did"
        class="identity-card"
        @tap="viewIdentity(identity)"
      >
        <!-- 头像 -->
        <view class="avatar">
          <text class="avatar-icon">👤</text>
        </view>

        <!-- 身份信息 -->
        <view class="identity-info">
          <view class="nickname-row">
            <text class="nickname">{{ identity.nickname }}</text>
            <text v-if="identity.is_default" class="default-badge">默认</text>
          </view>
          <text class="did">{{ formatDID(identity.did) }}</text>
          <text class="timestamp">创建于 {{ formatDate(identity.created_at) }}</text>
        </view>

        <!-- 操作按钮 -->
        <view class="actions">
          <text class="action-icon">›</text>
        </view>
      </view>
    </view>

    <!-- 空状态 -->
    <view v-else class="empty-state">
      <text class="empty-icon">🆔</text>
      <text class="empty-text">暂无身份</text>
      <text class="empty-hint">创建您的第一个去中心化身份</text>
    </view>

    <!-- 底部操作按钮 -->
    <view class="footer-actions">
      <view class="action-button primary" @tap="createIdentity">
        <text class="button-icon">+</text>
        <text class="button-text">创建新身份</text>
      </view>
      <view class="action-button secondary" @tap="importIdentity">
        <text class="button-icon">📥</text>
        <text class="button-text">导入身份</text>
      </view>
    </view>

    <!-- 身份详情弹窗 -->
    <view v-if="showDetailModal" class="modal-overlay" @tap="closeDetail">
      <view class="modal-content" @tap.stop>
        <view class="modal-header">
          <text class="modal-title">身份详情</text>
          <text class="close-btn" @tap="closeDetail">✕</text>
        </view>

        <view v-if="selectedIdentity" class="detail-content">
          <!-- 完整DID -->
          <view class="detail-item">
            <text class="detail-label">DID标识符</text>
            <text class="detail-value did-full">{{ selectedIdentity.did }}</text>
            <text class="copy-btn" @tap="copyDID(selectedIdentity.did)">复制</text>
          </view>

          <!-- 昵称 -->
          <view class="detail-item">
            <text class="detail-label">昵称</text>
            <text class="detail-value">{{ selectedIdentity.nickname }}</text>
          </view>

          <!-- 个人简介 -->
          <view v-if="selectedIdentity.bio" class="detail-item">
            <text class="detail-label">个人简介</text>
            <text class="detail-value">{{ selectedIdentity.bio }}</text>
          </view>

          <!-- 公钥 -->
          <view class="detail-item">
            <text class="detail-label">签名公钥</text>
            <text class="detail-value monospace">{{ formatKey(selectedIdentity.public_key_sign) }}</text>
          </view>

          <view class="detail-item">
            <text class="detail-label">加密公钥</text>
            <text class="detail-value monospace">{{ formatKey(selectedIdentity.public_key_encrypt) }}</text>
          </view>

          <!-- 操作按钮 -->
          <view class="detail-actions">
            <view class="detail-btn" @tap="setAsDefault(selectedIdentity.did)">
              <text>{{ selectedIdentity.is_default ? '✅ 已是默认' : '设为默认' }}</text>
            </view>
            <view class="detail-btn" @tap="exportIdentityData(selectedIdentity.did)">
              <text>导出身份</text>
            </view>
            <view class="detail-btn danger" @tap="confirmDelete(selectedIdentity.did)">
              <text>删除身份</text>
            </view>
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
      identities: [],
      showDetailModal: false,
      selectedIdentity: null,
      pin: '123456' // 临时PIN码，实际应从用户输入获取
    }
  },

  onLoad() {
    this.loadIdentities()
  },

  onShow() {
    this.loadIdentities()
  },

  methods: {
    /**
     * 加载身份列表
     */
    async loadIdentities() {
      try {
        uni.showLoading({ title: '加载中...' })
        this.identities = await database.getAllIdentities()
        console.log('✅ 加载身份列表:', this.identities)
      } catch (error) {
        console.error('❌ 加载身份失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        uni.hideLoading()
      }
    },

    /**
     * 创建新身份
     */
    createIdentity() {
      uni.navigateTo({
        url: '/pages/identity/create'
      })
    },

    /**
     * 导入身份
     */
    importIdentity() {
      uni.showToast({
        title: '功能开发中',
        icon: 'none'
      })
    },

    /**
     * 查看身份详情
     */
    viewIdentity(identity) {
      this.selectedIdentity = identity
      this.showDetailModal = true
    },

    /**
     * 关闭详情弹窗
     */
    closeDetail() {
      this.showDetailModal = false
      this.selectedIdentity = null
    },

    /**
     * 设为默认身份
     */
    async setAsDefault(did) {
      try {
        await database.setDefaultIdentity(did)
        uni.showToast({
          title: '已设为默认',
          icon: 'success'
        })
        this.loadIdentities()
        this.closeDetail()
      } catch (error) {
        console.error('设置默认身份失败:', error)
        uni.showToast({
          title: '设置失败',
          icon: 'none'
        })
      }
    },

    /**
     * 导出身份
     */
    async exportIdentityData(did) {
      try {
        uni.showLoading({ title: '导出中...' })
        const exportData = await didService.exportDID(did, this.pin)

        // H5环境：下载为文件
        // #ifdef H5
        const blob = new Blob([exportData], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `identity_${did.slice(0, 20)}.json`
        a.click()
        URL.revokeObjectURL(url)
        // #endif

        // App环境：保存到文件
        // #ifndef H5
        uni.showToast({
          title: '已复制到剪贴板',
          icon: 'success'
        })
        uni.setClipboardData({
          data: exportData
        })
        // #endif

        console.log('✅ 身份导出成功')
      } catch (error) {
        console.error('❌ 导出失败:', error)
        uni.showToast({
          title: '导出失败',
          icon: 'none'
        })
      } finally {
        uni.hideLoading()
      }
    },

    /**
     * 确认删除
     */
    confirmDelete(did) {
      uni.showModal({
        title: '确认删除',
        content: '删除后无法恢复，确定要删除这个身份吗？',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteIdentity(did)
          }
        }
      })
    },

    /**
     * 删除身份
     */
    async deleteIdentity(did) {
      try {
        await database.deleteIdentity(did)
        uni.showToast({
          title: '已删除',
          icon: 'success'
        })
        this.loadIdentities()
        this.closeDetail()
      } catch (error) {
        console.error('删除失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    /**
     * 复制DID
     */
    copyDID(did) {
      uni.setClipboardData({
        data: did,
        success: () => {
          uni.showToast({
            title: '已复制',
            icon: 'success'
          })
        }
      })
    },

    /**
     * 格式化DID（缩短显示）
     */
    formatDID(did) {
      if (!did) return ''
      const parts = did.split(':')
      const hash = parts[parts.length - 1]
      return `${hash.slice(0, 8)}...${hash.slice(-8)}`
    },

    /**
     * 格式化密钥（缩短显示）
     */
    formatKey(key) {
      if (!key) return ''
      return `${key.slice(0, 12)}...${key.slice(-12)}`
    },

    /**
     * 格式化日期
     */
    formatDate(timestamp) {
      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
  }
}
</script>

<style scoped lang="scss">
.identity-list-page {
  min-height: 100vh;
  background: var(--bg-page, #f8f8f8);
  padding-bottom: 160rpx;
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

.identity-list {
  padding: 20rpx;
}

.identity-card {
  background: var(--bg-card, #fff);
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  display: flex;
  align-items: center;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.05);
  transition: all 0.3s;

  &:active {
    transform: scale(0.98);
    opacity: 0.8;
  }

  .avatar {
    width: 100rpx;
    height: 100rpx;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 24rpx;

    .avatar-icon {
      font-size: 50rpx;
    }
  }

  .identity-info {
    flex: 1;

    .nickname-row {
      display: flex;
      align-items: center;
      margin-bottom: 8rpx;

      .nickname {
        font-size: 32rpx;
        font-weight: bold;
        color: var(--text-primary, #333);
      }

      .default-badge {
        margin-left: 12rpx;
        background: #667eea;
        color: #fff;
        font-size: 20rpx;
        padding: 4rpx 12rpx;
        border-radius: 8rpx;
      }
    }

    .did {
      font-size: 24rpx;
      color: var(--text-secondary, #666);
      font-family: 'Courier New', monospace;
      display: block;
      margin-bottom: 6rpx;
    }

    .timestamp {
      font-size: 22rpx;
      color: var(--text-tertiary, #999);
      display: block;
    }
  }

  .actions {
    .action-icon {
      font-size: 40rpx;
      color: var(--text-tertiary, #999);
    }
  }
}

.empty-state {
  text-align: center;
  padding: 120rpx 40rpx;

  .empty-icon {
    font-size: 120rpx;
    display: block;
    margin-bottom: 30rpx;
  }

  .empty-text {
    font-size: 32rpx;
    color: var(--text-secondary, #666);
    display: block;
    margin-bottom: 16rpx;
  }

  .empty-hint {
    font-size: 26rpx;
    color: var(--text-tertiary, #999);
    display: block;
  }
}

.footer-actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg-card, #fff);
  padding: 20rpx;
  display: flex;
  gap: 20rpx;
  box-shadow: 0 -4rpx 12rpx rgba(0, 0, 0, 0.05);

  .action-button {
    flex: 1;
    padding: 24rpx;
    border-radius: 12rpx;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    &.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
    }

    &.secondary {
      background: var(--bg-input, #f5f5f5);
      color: var(--text-primary, #333);
    }

    .button-icon {
      font-size: 40rpx;
      display: block;
      margin-bottom: 8rpx;
    }

    .button-text {
      font-size: 26rpx;
    }

    &:active {
      opacity: 0.8;
    }
  }
}

/* 弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
}

.modal-content {
  background: var(--bg-card, #fff);
  border-radius: 24rpx 24rpx 0 0;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30rpx 40rpx;
  border-bottom: 1rpx solid var(--border-color, #eee);

  .modal-title {
    font-size: 34rpx;
    font-weight: bold;
    color: var(--text-primary, #333);
  }

  .close-btn {
    font-size: 40rpx;
    color: var(--text-secondary, #666);
    padding: 10rpx;
  }
}

.detail-content {
  padding: 30rpx 40rpx;
}

.detail-item {
  margin-bottom: 30rpx;

  .detail-label {
    font-size: 26rpx;
    color: var(--text-secondary, #666);
    display: block;
    margin-bottom: 12rpx;
  }

  .detail-value {
    font-size: 28rpx;
    color: var(--text-primary, #333);
    display: block;
    word-break: break-all;

    &.did-full {
      font-family: 'Courier New', monospace;
      background: var(--bg-input, #f5f5f5);
      padding: 20rpx;
      border-radius: 8rpx;
    }

    &.monospace {
      font-family: 'Courier New', monospace;
      font-size: 24rpx;
    }
  }

  .copy-btn {
    color: #667eea;
    font-size: 26rpx;
    margin-top: 12rpx;
    display: inline-block;
  }
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 40rpx;

  .detail-btn {
    padding: 24rpx;
    border-radius: 12rpx;
    text-align: center;
    background: var(--bg-input, #f5f5f5);
    color: var(--text-primary, #333);
    font-size: 28rpx;

    &.danger {
      background: #ff4444;
      color: #fff;
    }

    &:active {
      opacity: 0.8;
    }
  }
}
</style>

