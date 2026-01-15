<template>
  <view class="social-page">
    <!-- Header -->
    <view class="header">
      <text class="title">社交交易</text>
      <view class="header-actions">
        <view class="action-btn" @click="showCreateModal = true">
          <text class="action-icon">+</text>
          <text class="action-text">发布</text>
        </view>
      </view>
    </view>

    <!-- Statistics Card -->
    <view class="stats-card">
      <view class="stat-item">
        <text class="stat-value">{{ stats.totalShares }}</text>
        <text class="stat-label">动态</text>
      </view>
      <view class="stat-item">
        <text class="stat-value">{{ stats.totalLikes }}</text>
        <text class="stat-label">点赞</text>
      </view>
      <view class="stat-item">
        <text class="stat-value">{{ stats.following }}</text>
        <text class="stat-label">关注</text>
      </view>
    </view>

    <!-- Share Type Tabs -->
    <view class="tabs">
      <view
        v-for="tab in shareTabs"
        :key="tab.value"
        class="tab-item"
        :class="{ active: currentShareType === tab.value }"
        @click="switchShareType(tab.value)"
      >
        <text class="tab-text">{{ tab.label }}</text>
      </view>
    </view>

    <!-- Shares Feed -->
    <scroll-view
      class="shares-feed"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="loading-container">
        <text class="loading-text">加载中...</text>
      </view>

      <view v-else-if="filteredShares.length === 0" class="empty-container">
        <text class="empty-icon">💬</text>
        <text class="empty-text">暂无动态</text>
        <text class="empty-hint">发布你的交易见解吧</text>
      </view>

      <view v-else class="shares-container">
        <view
          v-for="share in filteredShares"
          :key="share.id"
          class="share-card"
          @click="showShareDetail(share)"
        >
          <!-- Share Header -->
          <view class="share-header">
            <view class="author-info">
              <view class="author-avatar">
                <text class="avatar-text">{{ getAvatarText(share.author_did) }}</text>
              </view>
              <view class="author-details">
                <text class="author-name">{{ formatDid(share.author_did) }}</text>
                <text class="share-time">{{ formatTime(share.created_at) }}</text>
              </view>
            </view>
            <view class="share-type-badge" :class="share.type">
              <text class="badge-text">{{ getShareTypeText(share.type) }}</text>
            </view>
          </view>

          <!-- Share Content -->
          <view class="share-content">
            <text class="share-title">{{ share.title }}</text>
            <text v-if="share.description" class="share-description">{{ share.description }}</text>

            <!-- Trade Info (if type is order/trade) -->
            <view v-if="share.type === 'order' || share.type === 'trade'" class="trade-info">
              <view class="trade-row">
                <text class="trade-label">入场:</text>
                <text class="trade-value price">{{ share.price }}</text>
              </view>
              <view v-if="share.target_price" class="trade-row">
                <text class="trade-label">目标:</text>
                <text class="trade-value target">{{ share.target_price }}</text>
              </view>
              <view v-if="share.stop_loss" class="trade-row">
                <text class="trade-label">止损:</text>
                <text class="trade-value stop">{{ share.stop_loss }}</text>
              </view>
            </view>

            <!-- Tags -->
            <view v-if="share.tags && share.tags.length > 0" class="tags-container">
              <view
                v-for="(tag, index) in getTags(share.tags)"
                :key="index"
                class="tag"
              >
                <text class="tag-text">#{{ tag }}</text>
              </view>
            </view>
          </view>

          <!-- Share Footer -->
          <view class="share-footer">
            <view class="footer-stats">
              <view class="stat-item" @click.stop="handleLike(share)">
                <text class="stat-icon" :class="{ liked: hasLiked(share) }">❤️</text>
                <text class="stat-text">{{ share.like_count || 0 }}</text>
              </view>
              <view class="stat-item" @click.stop="showComments(share)">
                <text class="stat-icon">💬</text>
                <text class="stat-text">{{ share.comment_count || 0 }}</text>
              </view>
            </view>
            <view
              v-if="share.author_did !== currentDid"
              class="follow-btn"
              :class="{ following: isFollowing(share.author_did) }"
              @click.stop="handleFollow(share.author_did)"
            >
              <text class="follow-text">{{ isFollowing(share.author_did) ? '已关注' : '关注' }}</text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- Create Share Modal -->
    <view v-if="showCreateModal" class="modal-overlay" @click="closeCreateModal">
      <view class="modal-content large" @click.stop>
        <view class="modal-header">
          <text class="modal-title">发布动态</text>
          <text class="modal-close" @click="closeCreateModal">×</text>
        </view>

        <view class="modal-body">
          <view class="form-group">
            <text class="form-label">类型</text>
            <view class="radio-group">
              <view
                v-for="type in shareTypes"
                :key="type.value"
                class="radio-item"
                :class="{ active: createForm.type === type.value }"
                @click="createForm.type = type.value"
              >
                <text class="radio-text">{{ type.label }}</text>
              </view>
            </view>
          </view>

          <view class="form-group">
            <text class="form-label">标题</text>
            <input
              v-model="createForm.title"
              class="form-input"
              placeholder="例如: 看涨BTC，突破关键阻力位"
            />
          </view>

          <view class="form-group">
            <text class="form-label">描述</text>
            <textarea
              v-model="createForm.description"
              class="form-textarea"
              placeholder="分享你的交易见解..."
              maxlength="500"
            />
          </view>

          <view v-if="createForm.type === 'order' || createForm.type === 'trade'" class="trade-fields">
            <view class="form-group">
              <text class="form-label">入场价格</text>
              <input
                v-model.number="createForm.price"
                class="form-input"
                type="number"
                placeholder="入场价格"
              />
            </view>

            <view class="form-group">
              <text class="form-label">目标价格</text>
              <input
                v-model.number="createForm.targetPrice"
                class="form-input"
                type="number"
                placeholder="目标价格"
              />
            </view>

            <view class="form-group">
              <text class="form-label">止损价格</text>
              <input
                v-model.number="createForm.stopLoss"
                class="form-input"
                type="number"
                placeholder="止损价格"
              />
            </view>
          </view>

          <view class="form-group">
            <text class="form-label">标签 (多个用逗号分隔)</text>
            <input
              v-model="createForm.tagsInput"
              class="form-input"
              placeholder="例如: BTC,做多,日内"
            />
          </view>
        </view>

        <view class="modal-footer">
          <view class="modal-btn cancel" @click="closeCreateModal">
            <text class="btn-text">取消</text>
          </view>
          <view class="modal-btn confirm" @click="handleCreateShare">
            <text class="btn-text">发布</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Share Detail Modal -->
    <view v-if="showDetailModal && selectedShare" class="modal-overlay" @click="closeDetailModal">
      <view class="modal-content large detail" @click.stop>
        <view class="modal-header">
          <text class="modal-title">动态详情</text>
          <text class="modal-close" @click="closeDetailModal">×</text>
        </view>

        <view class="modal-body">
          <!-- Share Header -->
          <view class="detail-header">
            <view class="author-info">
              <view class="author-avatar large">
                <text class="avatar-text">{{ getAvatarText(selectedShare.author_did) }}</text>
              </view>
              <view class="author-details">
                <text class="author-name">{{ formatDid(selectedShare.author_did) }}</text>
                <text class="share-time">{{ formatTime(selectedShare.created_at) }}</text>
              </view>
            </view>
            <view class="share-type-badge" :class="selectedShare.type">
              <text class="badge-text">{{ getShareTypeText(selectedShare.type) }}</text>
            </view>
          </view>

          <!-- Share Content -->
          <view class="detail-content">
            <text class="detail-title">{{ selectedShare.title }}</text>
            <text v-if="selectedShare.description" class="detail-description">
              {{ selectedShare.description }}
            </text>

            <!-- Trade Info -->
            <view v-if="selectedShare.type === 'order' || selectedShare.type === 'trade'" class="trade-info-detail">
              <view class="trade-row">
                <text class="trade-label">入场价格:</text>
                <text class="trade-value price">{{ selectedShare.price }}</text>
              </view>
              <view v-if="selectedShare.target_price" class="trade-row">
                <text class="trade-label">目标价格:</text>
                <text class="trade-value target">{{ selectedShare.target_price }}</text>
              </view>
              <view v-if="selectedShare.stop_loss" class="trade-row">
                <text class="trade-label">止损价格:</text>
                <text class="trade-value stop">{{ selectedShare.stop_loss }}</text>
              </view>
            </view>

            <!-- Tags -->
            <view v-if="selectedShare.tags && selectedShare.tags.length > 0" class="tags-container">
              <view
                v-for="(tag, index) in getTags(selectedShare.tags)"
                :key="index"
                class="tag"
              >
                <text class="tag-text">#{{ tag }}</text>
              </view>
            </view>
          </view>

          <!-- Stats -->
          <view class="detail-stats">
            <view class="stat-item" @click.stop="handleLike(selectedShare)">
              <text class="stat-icon" :class="{ liked: hasLiked(selectedShare) }">❤️</text>
              <text class="stat-text">{{ selectedShare.like_count || 0 }}</text>
            </view>
            <view class="stat-item">
              <text class="stat-icon">💬</text>
              <text class="stat-text">{{ selectedShare.comment_count || 0 }}</text>
            </view>
          </view>

          <!-- Comments -->
          <view class="comments-section">
            <text class="section-title">评论</text>

            <view v-if="comments.length === 0" class="no-comments">
              <text class="no-comments-text">暂无评论</text>
            </view>

            <view v-else class="comments-list">
              <view
                v-for="comment in comments"
                :key="comment.id"
                class="comment-item"
              >
                <view class="comment-avatar">
                  <text class="avatar-text">{{ getAvatarText(comment.author_did) }}</text>
                </view>
                <view class="comment-content">
                  <text class="comment-author">{{ formatDid(comment.author_did) }}</text>
                  <text class="comment-text">{{ comment.content }}</text>
                  <text class="comment-time">{{ formatTime(comment.created_at) }}</text>
                </view>
              </view>
            </view>

            <!-- Add Comment -->
            <view class="add-comment">
              <input
                v-model="commentInput"
                class="comment-input"
                placeholder="写评论..."
                @confirm="handleAddComment"
              />
              <view class="comment-btn" @click="handleAddComment">
                <text class="btn-text">发送</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { createSocialTradingManager } from '@/services/trade/social-trading-manager.js'
import { createMarketplaceManager } from '@/services/trade/marketplace-manager.js'
import { createCreditScoreManager } from '@/services/trade/credit-score-manager.js'
import { createAssetManager } from '@/services/trade/asset-manager.js'
import { getDatabase } from '@/services/database.js'
import { getDIDManager } from '@/services/did.js'

export default {
  data() {
    return {
      socialTrading: null,
      currentDid: '',
      loading: false,
      refreshing: false,

      // Shares data
      shares: [],
      comments: [],
      followingList: [],
      likedShares: new Set(),

      // Tabs
      currentShareType: 'all',
      shareTabs: [
        { label: '全部', value: 'all' },
        { label: '交易', value: 'order' },
        { label: '分析', value: 'analysis' },
        { label: '技巧', value: 'tip' }
      ],

      // Statistics
      stats: {
        totalShares: 0,
        totalLikes: 0,
        following: 0
      },

      // Modals
      showCreateModal: false,
      showDetailModal: false,

      // Forms
      createForm: {
        type: 'order',
        title: '',
        description: '',
        price: null,
        targetPrice: null,
        stopLoss: null,
        tagsInput: ''
      },
      commentInput: '',

      // Share types
      shareTypes: [
        { label: '订单', value: 'order' },
        { label: '交易', value: 'trade' },
        { label: '分析', value: 'analysis' },
        { label: '技巧', value: 'tip' }
      ],

      // Selected data
      selectedShare: null
    }
  },

  computed: {
    filteredShares() {
      if (this.currentShareType === 'all') {
        return this.shares
      }
      return this.shares.filter(share => share.type === this.currentShareType)
    }
  },

  async onLoad() {
    await this.initServices()
    await this.loadData()
  },

  onPullDownRefresh() {
    this.onRefresh()
  },

  methods: {
    async initServices() {
      try {
        const db = await getDatabase()
        const didManager = await getDIDManager()
        this.currentDid = await didManager.getCurrentDid()

        const assetManager = createAssetManager(db, didManager)
        const marketplace = createMarketplaceManager(db, didManager, assetManager)
        const creditScoreManager = createCreditScoreManager(db, didManager, assetManager, marketplace)

        this.socialTrading = createSocialTradingManager(db, didManager, marketplace, creditScoreManager)

        await assetManager.initialize()
        await marketplace.initialize()
        await creditScoreManager.initialize()
        await this.socialTrading.initialize()

        console.log('[SocialPage] 服务初始化成功')
      } catch (error) {
        console.error('[SocialPage] 服务初始化失败:', error)
        uni.showToast({
          title: '初始化失败',
          icon: 'none'
        })
      }
    },

    async loadData() {
      this.loading = true
      try {
        await Promise.all([
          this.loadShares(),
          this.loadFollowing(),
          this.loadStats()
        ])
      } catch (error) {
        console.error('[SocialPage] 加载数据失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async loadShares() {
      try {
        const allShares = await this.socialTrading.getShares({ limit: 100 })
        // Sort by created time, newest first
        this.shares = allShares.sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        )
        console.log('[SocialPage] 已加载动态:', this.shares.length)
      } catch (error) {
        console.error('[SocialPage] 加载动态失败:', error)
        throw error
      }
    },

    async loadFollowing() {
      try {
        this.followingList = await this.socialTrading.getFollowing()
        console.log('[SocialPage] 已加载关注列表:', this.followingList.length)
      } catch (error) {
        console.error('[SocialPage] 加载关注列表失败:', error)
        this.followingList = []
      }
    },

    async loadStats() {
      try {
        const allShares = await this.socialTrading.getShares({ limit: 1000 })

        let totalLikes = 0
        allShares.forEach(share => {
          totalLikes += (share.like_count || 0)
        })

        this.stats = {
          totalShares: allShares.length,
          totalLikes: totalLikes,
          following: this.followingList.length
        }
      } catch (error) {
        console.error('[SocialPage] 加载统计失败:', error)
        this.stats = { totalShares: 0, totalLikes: 0, following: 0 }
      }
    },

    async onRefresh() {
      this.refreshing = true
      try {
        await this.loadData()
        uni.showToast({
          title: '刷新成功',
          icon: 'success'
        })
      } catch (error) {
        uni.showToast({
          title: '刷新失败',
          icon: 'none'
        })
      } finally {
        this.refreshing = false
        uni.stopPullDownRefresh()
      }
    },

    switchShareType(type) {
      this.currentShareType = type
    },

    async showShareDetail(share) {
      this.selectedShare = share
      await this.loadComments(share.id)
      this.showDetailModal = true
    },

    async loadComments(shareId) {
      try {
        this.comments = await this.socialTrading.getComments(shareId)
      } catch (error) {
        console.error('[SocialPage] 加载评论失败:', error)
        this.comments = []
      }
    },

    closeDetailModal() {
      this.showDetailModal = false
      this.selectedShare = null
      this.comments = []
      this.commentInput = ''
    },

    closeCreateModal() {
      this.showCreateModal = false
      this.resetCreateForm()
    },

    resetCreateForm() {
      this.createForm = {
        type: 'order',
        title: '',
        description: '',
        price: null,
        targetPrice: null,
        stopLoss: null,
        tagsInput: ''
      }
    },

    async handleCreateShare() {
      // Validate
      if (!this.createForm.title.trim()) {
        uni.showToast({ title: '请输入标题', icon: 'none' })
        return
      }

      // Parse tags
      const tags = this.createForm.tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)

      try {
        uni.showLoading({ title: '发布中...' })

        const shareData = {
          type: this.createForm.type,
          title: this.createForm.title.trim(),
          description: this.createForm.description.trim(),
          tags: tags
        }

        // Add trade-specific fields
        if (this.createForm.type === 'order' || this.createForm.type === 'trade') {
          if (this.createForm.price) shareData.price = this.createForm.price
          if (this.createForm.targetPrice) shareData.targetPrice = this.createForm.targetPrice
          if (this.createForm.stopLoss) shareData.stopLoss = this.createForm.stopLoss
        }

        const share = await this.socialTrading.createShare(shareData)

        console.log('[SocialPage] 动态已发布:', share.id)

        uni.hideLoading()
        uni.showToast({
          title: '发布成功',
          icon: 'success'
        })

        this.closeCreateModal()
        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[SocialPage] 发布失败:', error)
        uni.showToast({
          title: error.message || '发布失败',
          icon: 'none'
        })
      }
    },

    async handleLike(share) {
      try {
        await this.socialTrading.addLike('share', share.id)

        // Update local state
        this.likedShares.add(share.id)
        share.like_count = (share.like_count || 0) + 1

        uni.showToast({
          title: '已点赞',
          icon: 'success',
          duration: 1000
        })
      } catch (error) {
        console.error('[SocialPage] 点赞失败:', error)
        uni.showToast({
          title: '点赞失败',
          icon: 'none'
        })
      }
    },

    async showComments(share) {
      await this.showShareDetail(share)
    },

    async handleAddComment() {
      if (!this.commentInput.trim()) {
        uni.showToast({ title: '请输入评论内容', icon: 'none' })
        return
      }

      try {
        const comment = await this.socialTrading.addComment(
          this.selectedShare.id,
          this.commentInput.trim()
        )

        // Update local state
        this.comments.unshift(comment)
        this.selectedShare.comment_count = (this.selectedShare.comment_count || 0) + 1
        this.commentInput = ''

        uni.showToast({
          title: '评论成功',
          icon: 'success',
          duration: 1000
        })
      } catch (error) {
        console.error('[SocialPage] 评论失败:', error)
        uni.showToast({
          title: '评论失败',
          icon: 'none'
        })
      }
    },

    async handleFollow(traderDid) {
      try {
        if (this.isFollowing(traderDid)) {
          await this.socialTrading.unfollowTrader(traderDid)

          // Update local state
          this.followingList = this.followingList.filter(f => f.target_did !== traderDid)

          uni.showToast({
            title: '已取消关注',
            icon: 'success',
            duration: 1000
          })
        } else {
          await this.socialTrading.followTrader(traderDid)

          // Update local state
          this.followingList.push({ target_did: traderDid })

          uni.showToast({
            title: '已关注',
            icon: 'success',
            duration: 1000
          })
        }

        this.stats.following = this.followingList.length
      } catch (error) {
        console.error('[SocialPage] 关注操作失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    hasLiked(share) {
      return this.likedShares.has(share.id)
    },

    isFollowing(did) {
      return this.followingList.some(f => f.target_did === did)
    },

    getTags(tags) {
      if (!tags) return []

      try {
        return typeof tags === 'string' ? JSON.parse(tags) : tags
      } catch (error) {
        return []
      }
    },

    getShareTypeText(type) {
      const typeMap = {
        order: '订单',
        trade: '交易',
        analysis: '分析',
        tip: '技巧'
      }
      return typeMap[type] || type
    },

    getAvatarText(did) {
      if (!did) return '?'
      // Get first letter of last part of DID
      const parts = did.split(':')
      const lastPart = parts[parts.length - 1]
      return lastPart.substring(0, 1).toUpperCase()
    },

    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
      if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'

      return date.toLocaleDateString('zh-CN')
    },

    formatDid(did) {
      if (!did) return ''
      if (did.length <= 20) return did
      return did.substring(0, 10) + '...' + did.substring(did.length - 10)
    }
  }
}
</script>

<style lang="scss" scoped>
.social-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 32rpx;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 48rpx 32rpx 32rpx;
  color: white;

  .title {
    font-size: 40rpx;
    font-weight: bold;
    display: block;
    margin-bottom: 24rpx;
  }

  .header-actions {
    display: flex;
    justify-content: flex-end;

    .action-btn {
      background: rgba(255, 255, 255, 0.2);
      padding: 16rpx 32rpx;
      border-radius: 40rpx;
      display: flex;
      align-items: center;
      gap: 8rpx;

      .action-icon {
        font-size: 32rpx;
        font-weight: bold;
      }

      .action-text {
        font-size: 28rpx;
      }
    }
  }
}

.stats-card {
  background: white;
  margin: -24rpx 32rpx 24rpx;
  padding: 32rpx;
  border-radius: 16rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: space-around;

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;

    .stat-value {
      font-size: 36rpx;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 8rpx;
    }

    .stat-label {
      font-size: 24rpx;
      color: #999;
    }
  }
}

.tabs {
  display: flex;
  background: white;
  margin: 0 32rpx 24rpx;
  border-radius: 16rpx;
  padding: 8rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

  .tab-item {
    flex: 1;
    text-align: center;
    padding: 16rpx;
    border-radius: 12rpx;
    transition: all 0.3s;

    .tab-text {
      font-size: 28rpx;
      color: #666;
    }

    &.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

      .tab-text {
        color: white;
        font-weight: bold;
      }
    }
  }
}

.shares-feed {
  height: calc(100vh - 500rpx);
  padding: 0 32rpx;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 32rpx;

  .loading-text,
  .empty-text {
    font-size: 28rpx;
    color: #999;
    margin-top: 16rpx;
  }

  .empty-icon {
    font-size: 80rpx;
  }

  .empty-hint {
    font-size: 24rpx;
    color: #ccc;
    margin-top: 16rpx;
  }
}

.shares-container {
  .share-card {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

    .share-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24rpx;

      .author-info {
        display: flex;
        gap: 16rpx;
        flex: 1;

        .author-avatar {
          width: 64rpx;
          height: 64rpx;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;

          &.large {
            width: 80rpx;
            height: 80rpx;

            .avatar-text {
              font-size: 32rpx;
            }
          }

          .avatar-text {
            color: white;
            font-size: 28rpx;
            font-weight: bold;
          }
        }

        .author-details {
          display: flex;
          flex-direction: column;
          gap: 8rpx;

          .author-name {
            font-size: 28rpx;
            font-weight: bold;
            color: #333;
          }

          .share-time {
            font-size: 24rpx;
            color: #999;
          }
        }
      }

      .share-type-badge {
        padding: 8rpx 16rpx;
        border-radius: 8rpx;

        &.order {
          background: #e6f7ff;
          color: #1890ff;
        }

        &.trade {
          background: #f0f5ff;
          color: #597ef7;
        }

        &.analysis {
          background: #fff7e6;
          color: #fa8c16;
        }

        &.tip {
          background: #f6ffed;
          color: #52c41a;
        }

        .badge-text {
          font-size: 24rpx;
        }
      }
    }

    .share-content {
      margin-bottom: 24rpx;

      .share-title {
        display: block;
        font-size: 32rpx;
        font-weight: bold;
        color: #333;
        margin-bottom: 16rpx;
        line-height: 1.5;
      }

      .share-description {
        display: block;
        font-size: 28rpx;
        color: #666;
        line-height: 1.6;
        margin-bottom: 16rpx;
      }

      .trade-info {
        padding: 24rpx;
        background: #f5f7fa;
        border-radius: 12rpx;
        margin-bottom: 16rpx;

        .trade-row {
          display: flex;
          justify-content: space-between;
          padding: 8rpx 0;

          .trade-label {
            font-size: 28rpx;
            color: #999;
          }

          .trade-value {
            font-size: 28rpx;
            font-weight: bold;

            &.price {
              color: #667eea;
            }

            &.target {
              color: #52c41a;
            }

            &.stop {
              color: #ff4d4f;
            }
          }
        }
      }

      .tags-container {
        display: flex;
        flex-wrap: wrap;
        gap: 16rpx;

        .tag {
          padding: 8rpx 16rpx;
          background: #f0f4ff;
          border-radius: 8rpx;

          .tag-text {
            font-size: 24rpx;
            color: #667eea;
          }
        }
      }
    }

    .share-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 24rpx;
      border-top: 1rpx solid #f0f0f0;

      .footer-stats {
        display: flex;
        gap: 32rpx;

        .stat-item {
          display: flex;
          align-items: center;
          gap: 8rpx;

          .stat-icon {
            font-size: 32rpx;

            &.liked {
              animation: like 0.3s ease;
            }
          }

          .stat-text {
            font-size: 24rpx;
            color: #666;
          }
        }
      }

      .follow-btn {
        padding: 12rpx 32rpx;
        border-radius: 40rpx;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;

        &.following {
          background: #f5f5f5;
          color: #666;
        }

        .follow-text {
          font-size: 24rpx;
        }
      }
    }
  }
}

@keyframes like {
  0% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.3);
  }

  100% {
    transform: scale(1);
  }
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  width: 640rpx;
  max-height: 80vh;
  border-radius: 16rpx;
  overflow: hidden;

  &.large {
    width: 680rpx;
  }

  &.detail {
    max-height: 85vh;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx;
  border-bottom: 1rpx solid #f0f0f0;

  .modal-title {
    font-size: 32rpx;
    font-weight: bold;
    color: #333;
  }

  .modal-close {
    font-size: 48rpx;
    color: #999;
    line-height: 1;
  }
}

.modal-body {
  padding: 32rpx;
  max-height: 60vh;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 32rpx;

  .form-label {
    display: block;
    font-size: 28rpx;
    color: #666;
    margin-bottom: 16rpx;
  }

  .form-input,
  .form-textarea {
    width: 100%;
    padding: 24rpx;
    border: 1rpx solid #e0e0e0;
    border-radius: 8rpx;
    font-size: 28rpx;
    box-sizing: border-box;
  }

  .form-textarea {
    height: 200rpx;
  }

  .radio-group {
    display: flex;
    gap: 16rpx;
    flex-wrap: wrap;

    .radio-item {
      padding: 16rpx 24rpx;
      border: 1rpx solid #e0e0e0;
      border-radius: 8rpx;
      transition: all 0.3s;

      &.active {
        border-color: #667eea;
        background: #f0f4ff;

        .radio-text {
          color: #667eea;
          font-weight: bold;
        }
      }

      .radio-text {
        font-size: 28rpx;
        color: #666;
      }
    }
  }
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32rpx;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.detail-content {
  margin-bottom: 32rpx;

  .detail-title {
    display: block;
    font-size: 36rpx;
    font-weight: bold;
    color: #333;
    margin-bottom: 24rpx;
    line-height: 1.5;
  }

  .detail-description {
    display: block;
    font-size: 28rpx;
    color: #666;
    line-height: 1.8;
    margin-bottom: 24rpx;
  }

  .trade-info-detail {
    padding: 24rpx;
    background: #f5f7fa;
    border-radius: 12rpx;
    margin-bottom: 24rpx;

    .trade-row {
      display: flex;
      justify-content: space-between;
      padding: 12rpx 0;

      .trade-label {
        font-size: 28rpx;
        color: #999;
      }

      .trade-value {
        font-size: 28rpx;
        font-weight: bold;

        &.price {
          color: #667eea;
        }

        &.target {
          color: #52c41a;
        }

        &.stop {
          color: #ff4d4f;
        }
      }
    }
  }
}

.detail-stats {
  display: flex;
  gap: 48rpx;
  padding: 24rpx;
  background: #f5f7fa;
  border-radius: 12rpx;
  margin-bottom: 32rpx;

  .stat-item {
    display: flex;
    align-items: center;
    gap: 12rpx;

    .stat-icon {
      font-size: 36rpx;

      &.liked {
        animation: like 0.3s ease;
      }
    }

    .stat-text {
      font-size: 28rpx;
      color: #666;
      font-weight: bold;
    }
  }
}

.comments-section {
  .section-title {
    display: block;
    font-size: 28rpx;
    font-weight: bold;
    color: #333;
    margin-bottom: 24rpx;
  }

  .no-comments {
    text-align: center;
    padding: 48rpx 0;

    .no-comments-text {
      font-size: 28rpx;
      color: #999;
    }
  }

  .comments-list {
    margin-bottom: 24rpx;

    .comment-item {
      display: flex;
      gap: 16rpx;
      padding: 24rpx 0;
      border-bottom: 1rpx solid #f0f0f0;

      .comment-avatar {
        width: 56rpx;
        height: 56rpx;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        .avatar-text {
          color: white;
          font-size: 24rpx;
          font-weight: bold;
        }
      }

      .comment-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8rpx;

        .comment-author {
          font-size: 28rpx;
          font-weight: bold;
          color: #333;
        }

        .comment-text {
          font-size: 28rpx;
          color: #666;
          line-height: 1.6;
        }

        .comment-time {
          font-size: 24rpx;
          color: #999;
        }
      }
    }
  }

  .add-comment {
    display: flex;
    gap: 16rpx;
    padding-top: 24rpx;
    border-top: 1rpx solid #f0f0f0;

    .comment-input {
      flex: 1;
      padding: 16rpx 24rpx;
      border: 1rpx solid #e0e0e0;
      border-radius: 40rpx;
      font-size: 28rpx;
    }

    .comment-btn {
      padding: 16rpx 32rpx;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 40rpx;

      .btn-text {
        font-size: 28rpx;
      }
    }
  }
}

.modal-footer {
  display: flex;
  gap: 16rpx;
  padding: 32rpx;
  border-top: 1rpx solid #f0f0f0;

  .modal-btn {
    flex: 1;
    padding: 24rpx;
    border-radius: 8rpx;
    text-align: center;
    font-size: 28rpx;

    &.cancel {
      background: #f5f5f5;
      color: #666;
    }

    &.confirm {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .btn-text {
      font-size: 28rpx;
    }
  }
}
</style>
