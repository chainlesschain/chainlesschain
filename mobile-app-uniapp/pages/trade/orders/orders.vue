<template>
  <view class="orders-page">
    <!-- 标签页 -->
    <view class="tabs">
      <view
        class="tab-item"
        :class="{ active: currentTab === 'buy' }"
        @click="switchTab('buy')"
      >
        <text>买入订单 ({{ buyCount }})</text>
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'sell' }"
        @click="switchTab('sell')"
      >
        <text>卖出订单 ({{ sellCount }})</text>
      </view>
    </view>

    <!-- 订单列表 -->
    <scroll-view
      class="content"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- 加载状态 -->
      <view class="loading" v-if="loading && orders.length === 0">
        <text>加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-else-if="orders.length === 0">
        <text class="empty-icon">📋</text>
        <text class="empty-text">还没有订单</text>
        <text class="empty-hint">去市场购买知识或上架你的知识吧</text>
      </view>

      <!-- 订单列表 -->
      <view class="order-item" v-for="order in displayOrders" :key="order.id" @click="viewOrderDetail(order)">
        <view class="order-header">
          <view class="order-type">
            <text>{{ currentTab === 'buy' ? '📥' : '📤' }}</text>
          </view>
          <view class="order-info">
            <text class="order-title">订单 #{{ order.id.substring(0, 8) }}</text>
            <text class="order-party">
              {{ currentTab === 'buy' ? '卖家' : '买家' }}: {{ getPartyName(order) }}
            </text>
          </view>
          <view class="order-status">
            <text class="status-badge" :class="'status-' + order.status">
              {{ getStatusText(order.status) }}
            </text>
          </view>
        </view>

        <view class="order-body">
          <view class="order-row">
            <text class="label">知识ID:</text>
            <text class="value">{{ order.knowledge_id.substring(0, 12) }}...</text>
          </view>
          <view class="order-row">
            <text class="label">金额:</text>
            <text class="value price">{{ order.price }} CLC</text>
          </view>
          <view class="order-row">
            <text class="label">时间:</text>
            <text class="value">{{ formatTime(order.created_at) }}</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 订单详情弹窗 -->
    <view class="modal" v-if="showDetail" @click="closeDetail">
      <view class="modal-content detail-modal" @click.stop>
        <view class="detail-header">
          <text class="modal-title">订单详情</text>
          <view class="close-btn" @click="closeDetail">
            <text>✕</text>
          </view>
        </view>

        <view class="detail-body" v-if="currentOrder">
          <view class="detail-section">
            <text class="section-label">订单编号</text>
            <text class="section-value">{{ currentOrder.id }}</text>
          </view>

          <view class="detail-section">
            <text class="section-label">订单状态</text>
            <text class="section-value">
              <text class="status-badge" :class="'status-' + currentOrder.status">
                {{ getStatusText(currentOrder.status) }}
              </text>
            </text>
          </view>

          <view class="detail-section">
            <text class="section-label">知识ID</text>
            <text class="section-value">{{ currentOrder.knowledge_id }}</text>
          </view>

          <view class="detail-section">
            <text class="section-label">{{ currentTab === 'buy' ? '卖家' : '买家' }}</text>
            <text class="section-value">{{ getPartyName(currentOrder) }}</text>
          </view>

          <view class="detail-section">
            <text class="section-label">交易金额</text>
            <view class="price-display">
              <text class="price-large">{{ currentOrder.price }}</text>
              <text class="price-unit-large">CLC</text>
            </view>
          </view>

          <view class="detail-section">
            <text class="section-label">创建时间</text>
            <text class="section-value">{{ formatFullTime(currentOrder.created_at) }}</text>
          </view>

          <view class="detail-section" v-if="currentOrder.completed_at">
            <text class="section-label">完成时间</text>
            <text class="section-value">{{ formatFullTime(currentOrder.completed_at) }}</text>
          </view>
        </view>

        <view class="detail-actions">
          <button class="modal-btn confirm" @click="closeDetail">关闭</button>
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
      currentTab: 'buy',
      orders: [],
      loading: false,
      refreshing: false,
      showDetail: false,
      currentOrder: null,
      myDid: '',
      friendsMap: {}
    }
  },
  computed: {
    displayOrders() {
      return this.orders
    },
    buyCount() {
      return this.orders.filter(o => o.buyer_did === this.myDid).length
    },
    sellCount() {
      return this.orders.filter(o => o.seller_did === this.myDid).length
    }
  },
  onLoad() {
    this.initUserDid()
    this.loadFriends()
    this.loadOrders()
  },
  onShow() {
    // 每次显示时刷新
    this.loadOrders()
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
     * 切换标签
     */
    switchTab(tab) {
      this.currentTab = tab
      this.loadOrders()
    },

    /**
     * 加载订单列表
     */
    async loadOrders() {
      this.loading = true
      try {
        const orders = await db.getOrders(this.myDid, this.currentTab)
        this.orders = orders
        console.log('加载订单列表:', this.orders.length)
      } catch (error) {
        console.error('加载订单失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 下拉刷新
     */
    async onRefresh() {
      this.refreshing = true
      await this.loadOrders()
      this.refreshing = false
    },

    /**
     * 获取对方昵称
     */
    getPartyName(order) {
      const did = this.currentTab === 'buy' ? order.seller_did : order.buyer_did
      return this.friendsMap[did] || did.substring(0, 12) + '...'
    },

    /**
     * 获取状态文本
     */
    getStatusText(status) {
      const map = {
        pending: '待处理',
        completed: '已完成',
        cancelled: '已取消'
      }
      return map[status] || status
    },

    /**
     * 查看订单详情
     */
    viewOrderDetail(order) {
      this.currentOrder = order
      this.showDetail = true
    },

    /**
     * 关闭详情
     */
    closeDetail() {
      this.showDetail = false
      this.currentOrder = null
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
.orders-page {
  min-height: 100vh;
  background-color: #f8f8f8;
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  background-color: #ffffff;
  border-bottom: 1rpx solid #f0f0f0;

  .tab-item {
    flex: 1;
    height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28rpx;
    color: #666;
    position: relative;

    &.active {
      color: #3cc51f;
      font-weight: 500;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 60rpx;
        height: 4rpx;
        background-color: #3cc51f;
        border-radius: 2rpx;
      }
    }
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

.order-item {
  background-color: #fff;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;

  .order-header {
    display: flex;
    gap: 20rpx;
    margin-bottom: 24rpx;
    align-items: flex-start;

    .order-type {
      width: 72rpx;
      height: 72rpx;
      background-color: #f0f0f0;
      border-radius: 36rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40rpx;
      flex-shrink: 0;
    }

    .order-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;

      .order-title {
        font-size: 30rpx;
        font-weight: 500;
        color: #333;
      }

      .order-party {
        font-size: 24rpx;
        color: #999;
      }
    }

    .order-status {
      flex-shrink: 0;
    }
  }

  .order-body {
    .order-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12rpx;

      &:last-child {
        margin-bottom: 0;
      }

      .label {
        font-size: 26rpx;
        color: #999;
      }

      .value {
        font-size: 26rpx;
        color: #333;

        &.price {
          color: #ff6b00;
          font-weight: 500;
        }
      }
    }
  }
}

.status-badge {
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  font-size: 22rpx;

  &.status-pending {
    background-color: #fff7e6;
    color: #fa8c16;
  }

  &.status-completed {
    background-color: #f6ffed;
    color: #52c41a;
  }

  &.status-cancelled {
    background-color: #fff1f0;
    color: #ff4d4f;
  }
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
          word-break: break-all;
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

        &.confirm {
          background-color: #3cc51f;
          color: #ffffff;
        }
      }
    }
  }
}
</style>
