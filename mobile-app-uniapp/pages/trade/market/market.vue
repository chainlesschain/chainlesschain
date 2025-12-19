<template>
  <view class="market-page">
    <!-- 搜索栏 -->
    <view class="header">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          placeholder="搜索知识商品..."
          @input="handleSearch"
        />
      </view>
    </view>

    <!-- 商品列表 -->
    <scroll-view
      class="content"
      scroll-y
      @scrolltolower="loadMore"
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- 加载状态 -->
      <view class="loading" v-if="loading && listings.length === 0">
        <text>加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-else-if="listings.length === 0">
        <text class="empty-icon">📦</text>
        <text class="empty-text">暂无商品</text>
        <text class="empty-hint">去资产页面上架你的知识吧</text>
      </view>

      <!-- 商品列表 -->
      <view class="listing-item" v-for="listing in listings" :key="listing.id" @click="viewDetail(listing)">
        <view class="listing-header">
          <view class="listing-type">
            <text>{{ getTypeIcon(listing.knowledge_id) }}</text>
          </view>
          <view class="listing-info">
            <text class="listing-title">{{ listing.title }}</text>
            <text class="listing-seller">卖家: {{ getSellerName(listing.seller_did) }}</text>
          </view>
          <view class="listing-price">
            <text class="price-value">{{ listing.price }}</text>
            <text class="price-unit">CLC</text>
          </view>
        </view>

        <text class="listing-desc" v-if="listing.description">{{ listing.description }}</text>

        <view class="listing-footer">
          <text class="listing-time">{{ formatTime(listing.created_at) }}</text>
          <view class="buy-btn" @click.stop="buyListing(listing)">
            <text>购买</text>
          </view>
        </view>
      </view>

      <!-- 加载更多 -->
      <view class="load-more" v-if="hasMore && !loading">
        <text>加载更多...</text>
      </view>
    </scroll-view>

    <!-- 商品详情弹窗 -->
    <view class="modal" v-if="showDetail" @click="closeDetail">
      <view class="modal-content detail-modal" @click.stop>
        <view class="detail-header">
          <text class="modal-title">商品详情</text>
          <view class="close-btn" @click="closeDetail">
            <text>✕</text>
          </view>
        </view>

        <view class="detail-body" v-if="currentListing">
          <view class="detail-section">
            <text class="section-label">标题</text>
            <text class="section-value">{{ currentListing.title }}</text>
          </view>

          <view class="detail-section" v-if="currentListing.description">
            <text class="section-label">描述</text>
            <text class="section-value">{{ currentListing.description }}</text>
          </view>

          <view class="detail-section">
            <text class="section-label">卖家</text>
            <text class="section-value">{{ getSellerName(currentListing.seller_did) }}</text>
          </view>

          <view class="detail-section">
            <text class="section-label">价格</text>
            <view class="price-display">
              <text class="price-large">{{ currentListing.price }}</text>
              <text class="price-unit-large">CLC</text>
            </view>
          </view>

          <view class="detail-section">
            <text class="section-label">发布时间</text>
            <text class="section-value">{{ formatFullTime(currentListing.created_at) }}</text>
          </view>
        </view>

        <view class="detail-actions">
          <button class="modal-btn cancel" @click="closeDetail">取消</button>
          <button
            class="modal-btn confirm"
            @click="confirmBuy"
            :disabled="buying || currentListing.seller_did === myDid"
          >
            {{ buying ? '购买中...' : (currentListing.seller_did === myDid ? '自己的商品' : '确认购买') }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      searchQuery: '',
      listings: [],
      loading: false,
      refreshing: false,
      hasMore: true,
      showDetail: false,
      currentListing: null,
      buying: false,
      myDid: '',
      friendsMap: {},
      balance: 0
    }
  },
  onLoad() {
    this.initUserDid()
    this.loadFriends()
    this.loadListings()
    this.loadBalance()
  },
  onShow() {
    // 每次显示时刷新
    this.loadListings()
    this.loadBalance()
  },
  onPullDownRefresh() {
    this.onRefresh().then(() => {
      uni.stopPullDownRefresh()
    })
  },
  methods: {
    /**
     * 初始化用户DID
     */
    initUserDid() {
      this.myDid = uni.getStorageSync('device_id') || 'did:chainless:user123'
    },

    /**
     * 加载好友列表（用于显示昵称）
     */
    async loadFriends() {
      try {
        const friends = await db.getFriends('accepted')
        this.friendsMap = {}
        friends.forEach(f => {
          this.friendsMap[f.friend_did] = f.nickname || f.friend_did
        })
        this.friendsMap[this.myDid] = '我'
      } catch (error) {
        console.error('加载好友列表失败:', error)
      }
    },

    /**
     * 获取卖家昵称
     */
    getSellerName(sellerDid) {
      return this.friendsMap[sellerDid] || sellerDid.substring(0, 12) + '...'
    },

    /**
     * 加载商品列表
     */
    async loadListings() {
      this.loading = true
      try {
        const listings = await db.getListings({
          status: 'on_sale',
          limit: 50,
          searchQuery: this.searchQuery
        })

        this.listings = listings
        console.log('加载商品列表:', this.listings.length)
      } catch (error) {
        console.error('加载商品列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载余额
     */
    async loadBalance() {
      try {
        this.balance = await db.getBalance(this.myDid)
      } catch (error) {
        console.error('加载余额失败:', error)
      }
    },

    /**
     * 搜索处理
     */
    handleSearch() {
      // 防抖处理
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => {
        this.loadListings()
      }, 500)
    },

    /**
     * 下拉刷新
     */
    async onRefresh() {
      this.refreshing = true
      await this.loadListings()
      await this.loadBalance()
      this.refreshing = false
    },

    /**
     * 加载更多
     */
    loadMore() {
      // 预留分页功能
      console.log('加载更多')
    },

    /**
     * 获取类型图标
     */
    getTypeIcon(knowledgeId) {
      // 简化处理，实际应该查询知识类型
      return '📄'
    },

    /**
     * 查看详情
     */
    viewDetail(listing) {
      this.currentListing = listing
      this.showDetail = true
    },

    /**
     * 关闭详情
     */
    closeDetail() {
      this.showDetail = false
      this.currentListing = null
    },

    /**
     * 购买商品（快捷方式）
     */
    buyListing(listing) {
      this.viewDetail(listing)
    },

    /**
     * 确认购买
     */
    async confirmBuy() {
      if (!this.currentListing) return

      // 检查是否是自己的商品
      if (this.currentListing.seller_did === this.myDid) {
        uni.showToast({
          title: '不能购买自己的商品',
          icon: 'none'
        })
        return
      }

      // 检查余额
      if (this.balance < this.currentListing.price) {
        uni.showModal({
          title: '余额不足',
          content: `当前余额: ${this.balance} CLC\n需要: ${this.currentListing.price} CLC\n\n请先去资产页面充值`,
          showCancel: false
        })
        return
      }

      // 确认购买
      uni.showModal({
        title: '确认购买',
        content: `确定花费 ${this.currentListing.price} CLC 购买《${this.currentListing.title}》吗？`,
        success: async (res) => {
          if (res.confirm) {
            await this.executeBuy()
          }
        }
      })
    },

    /**
     * 执行购买
     */
    async executeBuy() {
      if (!this.currentListing) return

      this.buying = true

      try {
        await db.buyKnowledge(this.currentListing.id, this.myDid)

        uni.showToast({
          title: '购买成功',
          icon: 'success'
        })

        this.closeDetail()

        // 刷新列表和余额
        await this.loadListings()
        await this.loadBalance()

        // 提示查看知识库
        setTimeout(() => {
          uni.showModal({
            title: '购买成功',
            content: '知识已添加到你的知识库，是否立即查看？',
            success: (res) => {
              if (res.confirm) {
                uni.switchTab({
                  url: '/pages/knowledge/list/list'
                })
              }
            }
          })
        }, 1000)
      } catch (error) {
        console.error('购买失败:', error)
        uni.showToast({
          title: error.message || '购买失败',
          icon: 'none'
        })
      } finally {
        this.buying = false
      }
    },

    /**
     * 格式化时间（简短）
     */
    formatTime(timestamp) {
      const now = Date.now()
      const diff = now - timestamp
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour

      if (diff < minute) {
        return '刚刚'
      } else if (diff < hour) {
        return `${Math.floor(diff / minute)}分钟前`
      } else if (diff < day) {
        return `${Math.floor(diff / hour)}小时前`
      } else if (diff < 7 * day) {
        return `${Math.floor(diff / day)}天前`
      } else {
        const date = new Date(timestamp)
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
    },

    /**
     * 格式化时间（完整）
     */
    formatFullTime(timestamp) {
      const date = new Date(timestamp)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day} ${hour}:${minute}`
    }
  }
}
</script>

<style lang="scss" scoped>
.market-page {
  min-height: 100vh;
  background-color: #f8f8f8;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 24rpx;
  background-color: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.search-box {
  display: flex;
  align-items: center;
  height: 72rpx;
  background-color: #f5f5f5;
  border-radius: 36rpx;
  padding: 0 32rpx;
  gap: 16rpx;

  .search-icon {
    font-size: 28rpx;
    color: #999;
  }

  .search-input {
    flex: 1;
    font-size: 28rpx;
    color: #333;
  }
}

.content {
  flex: 1;
  padding: 24rpx;
}

.loading, .empty {
  padding: 200rpx 40rpx;
  text-align: center;
  color: #999;
}

.empty {
  .empty-icon {
    display: block;
    font-size: 120rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    display: block;
    font-size: 32rpx;
    color: #333;
    margin-bottom: 16rpx;
  }

  .empty-hint {
    display: block;
    font-size: 24rpx;
    color: #999;
  }
}

.listing-item {
  background-color: #fff;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;

  .listing-header {
    display: flex;
    gap: 20rpx;
    margin-bottom: 20rpx;
    align-items: flex-start;

    .listing-type {
      width: 72rpx;
      height: 72rpx;
      background-color: #e6f7ff;
      border-radius: 12rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40rpx;
      flex-shrink: 0;
    }

    .listing-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .listing-title {
        font-size: 30rpx;
        font-weight: 500;
        color: #333;
        line-height: 1.4;
      }

      .listing-seller {
        font-size: 24rpx;
        color: #999;
      }
    }

    .listing-price {
      flex-shrink: 0;
      text-align: right;

      .price-value {
        display: block;
        font-size: 36rpx;
        font-weight: bold;
        color: #ff6b00;
      }

      .price-unit {
        display: block;
        font-size: 20rpx;
        color: #999;
        margin-top: 4rpx;
      }
    }
  }

  .listing-desc {
    font-size: 26rpx;
    line-height: 1.6;
    color: #666;
    margin-bottom: 20rpx;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .listing-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .listing-time {
      font-size: 24rpx;
      color: #999;
    }

    .buy-btn {
      padding: 12rpx 32rpx;
      background-color: #3cc51f;
      color: #ffffff;
      border-radius: 20rpx;
      font-size: 26rpx;
    }
  }
}

.load-more {
  padding: 40rpx;
  text-align: center;
  color: #999;
  font-size: 24rpx;
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
    background-color: #ffffff;
    border-radius: 16rpx;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .detail-modal {
    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24rpx 32rpx;
      border-bottom: 1rpx solid #f0f0f0;

      .modal-title {
        font-size: 32rpx;
        font-weight: 500;
        color: #333;
      }

      .close-btn {
        width: 48rpx;
        height: 48rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32rpx;
        color: #999;
      }
    }

    .detail-body {
      flex: 1;
      padding: 32rpx;
      overflow-y: auto;

      .detail-section {
        margin-bottom: 32rpx;

        &:last-child {
          margin-bottom: 0;
        }

        .section-label {
          display: block;
          font-size: 24rpx;
          color: #999;
          margin-bottom: 12rpx;
        }

        .section-value {
          display: block;
          font-size: 28rpx;
          color: #333;
          line-height: 1.6;
        }

        .price-display {
          display: flex;
          align-items: baseline;
          gap: 8rpx;

          .price-large {
            font-size: 48rpx;
            font-weight: bold;
            color: #ff6b00;
          }

          .price-unit-large {
            font-size: 24rpx;
            color: #ff6b00;
          }
        }
      }
    }

    .detail-actions {
      display: flex;
      gap: 20rpx;
      padding: 24rpx 32rpx;
      border-top: 1rpx solid #f0f0f0;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 30rpx;
        font-weight: 500;
        border: none;
        line-height: 88rpx;
        padding: 0;

        &::after {
          border: none;
        }

        &.cancel {
          background-color: #f5f5f5;
          color: #666;
        }

        &.confirm {
          background-color: #3cc51f;
          color: #ffffff;

          &[disabled] {
            opacity: 0.5;
          }
        }
      }
    }
  }
}
</style>
