<template>
  <view class="market-page">
    <!-- Header -->
    <view class="header">
      <text class="title">市场交易</text>
      <view class="header-actions">
        <view class="action-btn" @click="showCreateOrderModal = true">
          <text class="action-icon">+</text>
          <text class="action-text">创建订单</text>
        </view>
      </view>
    </view>

    <!-- Statistics Card -->
    <view class="stats-card">
      <view class="stat-item">
        <text class="stat-value">{{ stats.totalOrders }}</text>
        <text class="stat-label">总订单</text>
      </view>
      <view class="stat-item">
        <text class="stat-value">{{ stats.activeOrders }}</text>
        <text class="stat-label">活跃订单</text>
      </view>
      <view class="stat-item">
        <text class="stat-value">{{ stats.completedTrades }}</text>
        <text class="stat-label">完成交易</text>
      </view>
    </view>

    <!-- Order Type Tabs -->
    <view class="tabs">
      <view
        v-for="tab in orderTypeTabs"
        :key="tab.value"
        class="tab-item"
        :class="{ active: currentOrderType === tab.value }"
        @click="switchOrderType(tab.value)"
      >
        <text class="tab-text">{{ tab.label }}</text>
      </view>
    </view>

    <!-- Order List -->
    <scroll-view
      class="order-list"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <view v-if="loading" class="loading-container">
        <text class="loading-text">加载中...</text>
      </view>

      <view v-else-if="filteredOrders.length === 0" class="empty-container">
        <text class="empty-icon">📊</text>
        <text class="empty-text">暂无订单</text>
        <text class="empty-hint">点击右上角创建订单</text>
      </view>

      <view v-else class="orders-container">
        <view
          v-for="order in filteredOrders"
          :key="order.id"
          class="order-card"
          @click="showOrderDetail(order)"
        >
          <!-- Order Header -->
          <view class="order-header">
            <view class="order-title-row">
              <text class="order-title">{{ order.title }}</text>
              <view class="order-type-badge" :class="order.type">
                <text class="badge-text">{{ order.type === 'buy' ? '买单' : '卖单' }}</text>
              </view>
            </view>
            <view class="order-status-badge" :class="order.status">
              <text class="status-text">{{ getStatusText(order.status) }}</text>
            </view>
          </view>

          <!-- Order Info -->
          <view class="order-info">
            <view class="info-row">
              <text class="info-label">资产:</text>
              <text class="info-value">{{ getAssetName(order.asset_id) }}</text>
            </view>
            <view class="info-row">
              <text class="info-label">单价:</text>
              <text class="info-value price">{{ order.price_amount }}</text>
            </view>
            <view class="info-row">
              <text class="info-label">数量:</text>
              <text class="info-value">{{ order.quantity }} / {{ order.total_quantity }}</text>
            </view>
            <view class="info-row">
              <text class="info-label">总额:</text>
              <text class="info-value total">{{ order.price_amount * order.total_quantity }}</text>
            </view>
          </view>

          <!-- Order Footer -->
          <view class="order-footer">
            <text class="order-time">{{ formatTime(order.created_at) }}</text>
            <view class="order-actions">
              <view
                v-if="order.status === 'open' && order.creator_did !== currentDid"
                class="action-btn-small primary"
                @click.stop="handleMatchOrder(order)"
              >
                <text class="btn-text">{{ order.type === 'buy' ? '出售' : '购买' }}</text>
              </view>
              <view
                v-if="order.status === 'open' && order.creator_did === currentDid"
                class="action-btn-small danger"
                @click.stop="handleCancelOrder(order)"
              >
                <text class="btn-text">取消</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- Create Order Modal -->
    <view v-if="showCreateOrderModal" class="modal-overlay" @click="closeCreateModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">创建订单</text>
          <text class="modal-close" @click="closeCreateModal">×</text>
        </view>

        <view class="modal-body">
          <view class="form-group">
            <text class="form-label">订单类型</text>
            <view class="radio-group">
              <view
                v-for="type in orderTypes"
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
            <text class="form-label">订单标题</text>
            <input
              v-model="createForm.title"
              class="form-input"
              placeholder="例如: BTC限价买单"
            />
          </view>

          <view class="form-group">
            <text class="form-label">选择资产</text>
            <picker
              :range="availableAssets"
              range-key="name"
              @change="onAssetChange"
            >
              <view class="form-input picker">
                <text>{{ selectedAssetName || '请选择资产' }}</text>
              </view>
            </picker>
          </view>

          <view class="form-group">
            <text class="form-label">单价</text>
            <input
              v-model.number="createForm.priceAmount"
              class="form-input"
              type="number"
              placeholder="输入单价"
            />
          </view>

          <view class="form-group">
            <text class="form-label">数量</text>
            <input
              v-model.number="createForm.quantity"
              class="form-input"
              type="number"
              placeholder="输入数量"
            />
          </view>

          <view class="form-group">
            <text class="form-label">描述 (可选)</text>
            <textarea
              v-model="createForm.description"
              class="form-textarea"
              placeholder="订单描述"
              maxlength="500"
            />
          </view>
        </view>

        <view class="modal-footer">
          <view class="modal-btn cancel" @click="closeCreateModal">
            <text class="btn-text">取消</text>
          </view>
          <view class="modal-btn confirm" @click="handleCreateOrder">
            <text class="btn-text">创建</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Order Detail Modal -->
    <view v-if="showDetailModal && selectedOrder" class="modal-overlay" @click="closeDetailModal">
      <view class="modal-content detail" @click.stop>
        <view class="modal-header">
          <text class="modal-title">订单详情</text>
          <text class="modal-close" @click="closeDetailModal">×</text>
        </view>

        <view class="modal-body">
          <view class="detail-section">
            <view class="detail-title-row">
              <text class="detail-title">{{ selectedOrder.title }}</text>
              <view class="detail-type-badge" :class="selectedOrder.type">
                <text class="badge-text">{{ selectedOrder.type === 'buy' ? '买单' : '卖单' }}</text>
              </view>
            </view>
            <view class="detail-status-badge" :class="selectedOrder.status">
              <text class="status-text">{{ getStatusText(selectedOrder.status) }}</text>
            </view>
          </view>

          <view class="detail-section">
            <view class="detail-row">
              <text class="detail-label">订单ID:</text>
              <text class="detail-value">{{ selectedOrder.id }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">资产:</text>
              <text class="detail-value">{{ getAssetName(selectedOrder.asset_id) }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">单价:</text>
              <text class="detail-value price">{{ selectedOrder.price_amount }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">总数量:</text>
              <text class="detail-value">{{ selectedOrder.total_quantity }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">剩余数量:</text>
              <text class="detail-value">{{ selectedOrder.quantity }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">总金额:</text>
              <text class="detail-value total">{{ selectedOrder.price_amount * selectedOrder.total_quantity }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">创建者:</text>
              <text class="detail-value did">{{ formatDid(selectedOrder.creator_did) }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">创建时间:</text>
              <text class="detail-value">{{ formatTime(selectedOrder.created_at) }}</text>
            </view>
          </view>

          <view v-if="selectedOrder.description" class="detail-section">
            <text class="detail-label">描述:</text>
            <text class="detail-description">{{ selectedOrder.description }}</text>
          </view>
        </view>

        <view class="modal-footer">
          <view
            v-if="selectedOrder.status === 'open' && selectedOrder.creator_did !== currentDid"
            class="modal-btn confirm full"
            @click="handleMatchOrder(selectedOrder)"
          >
            <text class="btn-text">{{ selectedOrder.type === 'buy' ? '立即出售' : '立即购买' }}</text>
          </view>
          <view
            v-if="selectedOrder.status === 'open' && selectedOrder.creator_did === currentDid"
            class="modal-btn danger full"
            @click="handleCancelOrder(selectedOrder)"
          >
            <text class="btn-text">取消订单</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Match Order Modal -->
    <view v-if="showMatchModal" class="modal-overlay" @click="closeMatchModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">{{ matchingOrder?.type === 'buy' ? '出售资产' : '购买资产' }}</text>
          <text class="modal-close" @click="closeMatchModal">×</text>
        </view>

        <view class="modal-body">
          <view class="match-info">
            <text class="match-label">订单标题:</text>
            <text class="match-value">{{ matchingOrder?.title }}</text>
          </view>
          <view class="match-info">
            <text class="match-label">单价:</text>
            <text class="match-value price">{{ matchingOrder?.price_amount }}</text>
          </view>
          <view class="match-info">
            <text class="match-label">可用数量:</text>
            <text class="match-value">{{ matchingOrder?.quantity }}</text>
          </view>

          <view class="form-group">
            <text class="form-label">交易数量</text>
            <input
              v-model.number="matchForm.quantity"
              class="form-input"
              type="number"
              :placeholder="`最大: ${matchingOrder?.quantity}`"
            />
          </view>

          <view class="match-summary">
            <text class="summary-label">总金额:</text>
            <text class="summary-value">{{ (matchForm.quantity || 0) * (matchingOrder?.price_amount || 0) }}</text>
          </view>
        </view>

        <view class="modal-footer">
          <view class="modal-btn cancel" @click="closeMatchModal">
            <text class="btn-text">取消</text>
          </view>
          <view class="modal-btn confirm" @click="confirmMatchOrder">
            <text class="btn-text">确认交易</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { createMarketplaceManager } from '@/services/trade/marketplace-manager.js'
import { createAssetManager } from '@/services/trade/asset-manager.js'
import { getDatabase } from '@/services/database.js'
import { getDIDManager } from '@/services/did.js'

export default {
  data() {
    return {
      marketplaceManager: null,
      assetManager: null,
      currentDid: '',
      loading: false,
      refreshing: false,

      // Orders data
      orders: [],
      assets: [],
      availableAssets: [],

      // Tabs
      currentOrderType: 'all',
      orderTypeTabs: [
        { label: '全部', value: 'all' },
        { label: '买单', value: 'buy' },
        { label: '卖单', value: 'sell' }
      ],

      // Statistics
      stats: {
        totalOrders: 0,
        activeOrders: 0,
        completedTrades: 0
      },

      // Modals
      showCreateOrderModal: false,
      showDetailModal: false,
      showMatchModal: false,

      // Forms
      createForm: {
        type: 'buy',
        title: '',
        assetId: '',
        priceAmount: null,
        quantity: null,
        description: ''
      },
      matchForm: {
        quantity: null
      },

      // Order types
      orderTypes: [
        { label: '买单', value: 'buy' },
        { label: '卖单', value: 'sell' }
      ],

      // Selected data
      selectedOrder: null,
      matchingOrder: null,
      selectedAssetIndex: -1
    }
  },

  computed: {
    filteredOrders() {
      if (this.currentOrderType === 'all') {
        return this.orders
      }
      return this.orders.filter(order => order.type === this.currentOrderType)
    },

    selectedAssetName() {
      if (this.selectedAssetIndex >= 0) {
        return this.availableAssets[this.selectedAssetIndex]?.name || ''
      }
      return ''
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

        this.assetManager = createAssetManager(db, didManager)
        this.marketplaceManager = createMarketplaceManager(db, didManager, this.assetManager)

        await this.assetManager.initialize()
        await this.marketplaceManager.initialize()

        console.log('[MarketPage] 服务初始化成功')
      } catch (error) {
        console.error('[MarketPage] 服务初始化失败:', error)
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
          this.loadOrders(),
          this.loadAssets(),
          this.loadStats()
        ])
      } catch (error) {
        console.error('[MarketPage] 加载数据失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async loadOrders() {
      try {
        const allOrders = await this.marketplaceManager.getOrders()
        // Sort by created time, newest first
        this.orders = allOrders.sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        )
        console.log('[MarketPage] 已加载订单:', this.orders.length)
      } catch (error) {
        console.error('[MarketPage] 加载订单失败:', error)
        throw error
      }
    },

    async loadAssets() {
      try {
        this.assets = await this.assetManager.getAllAssets()
        // Only show assets owned by current user for selling
        this.availableAssets = this.assets
        console.log('[MarketPage] 已加载资产:', this.assets.length)
      } catch (error) {
        console.error('[MarketPage] 加载资产失败:', error)
        throw error
      }
    },

    async loadStats() {
      try {
        const allOrders = await this.marketplaceManager.getOrders()
        const transactions = await this.marketplaceManager.getTransactions()

        this.stats = {
          totalOrders: allOrders.length,
          activeOrders: allOrders.filter(o => o.status === 'open').length,
          completedTrades: transactions.filter(t => t.status === 'completed').length
        }
      } catch (error) {
        console.error('[MarketPage] 加载统计失败:', error)
        this.stats = { totalOrders: 0, activeOrders: 0, completedTrades: 0 }
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

    switchOrderType(type) {
      this.currentOrderType = type
    },

    showOrderDetail(order) {
      this.selectedOrder = order
      this.showDetailModal = true
    },

    closeDetailModal() {
      this.showDetailModal = false
      this.selectedOrder = null
    },

    closeCreateModal() {
      this.showCreateOrderModal = false
      this.resetCreateForm()
    },

    closeMatchModal() {
      this.showMatchModal = false
      this.matchingOrder = null
      this.matchForm.quantity = null
    },

    resetCreateForm() {
      this.createForm = {
        type: 'buy',
        title: '',
        assetId: '',
        priceAmount: null,
        quantity: null,
        description: ''
      }
      this.selectedAssetIndex = -1
    },

    onAssetChange(e) {
      this.selectedAssetIndex = e.detail.value
      this.createForm.assetId = this.availableAssets[this.selectedAssetIndex].id
    },

    async handleCreateOrder() {
      // Validate
      if (!this.createForm.title.trim()) {
        uni.showToast({ title: '请输入订单标题', icon: 'none' })
        return
      }
      if (!this.createForm.assetId) {
        uni.showToast({ title: '请选择资产', icon: 'none' })
        return
      }
      if (!this.createForm.priceAmount || this.createForm.priceAmount <= 0) {
        uni.showToast({ title: '请输入有效单价', icon: 'none' })
        return
      }
      if (!this.createForm.quantity || this.createForm.quantity <= 0) {
        uni.showToast({ title: '请输入有效数量', icon: 'none' })
        return
      }

      try {
        uni.showLoading({ title: '创建中...' })

        const order = await this.marketplaceManager.createOrder({
          type: this.createForm.type,
          title: this.createForm.title.trim(),
          assetId: this.createForm.assetId,
          priceAmount: this.createForm.priceAmount,
          quantity: this.createForm.quantity,
          description: this.createForm.description.trim()
        })

        console.log('[MarketPage] 订单已创建:', order.id)

        uni.hideLoading()
        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })

        this.closeCreateModal()
        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[MarketPage] 创建订单失败:', error)
        uni.showToast({
          title: error.message || '创建失败',
          icon: 'none'
        })
      }
    },

    handleMatchOrder(order) {
      this.matchingOrder = order
      this.matchForm.quantity = order.quantity
      this.showMatchModal = true
      this.closeDetailModal()
    },

    async confirmMatchOrder() {
      // Validate
      if (!this.matchForm.quantity || this.matchForm.quantity <= 0) {
        uni.showToast({ title: '请输入有效数量', icon: 'none' })
        return
      }
      if (this.matchForm.quantity > this.matchingOrder.quantity) {
        uni.showToast({ title: '数量超出可用范围', icon: 'none' })
        return
      }

      try {
        uni.showLoading({ title: '交易中...' })

        const transaction = await this.marketplaceManager.matchOrder(
          this.matchingOrder.id,
          this.matchForm.quantity
        )

        console.log('[MarketPage] 交易完成:', transaction.id)

        uni.hideLoading()
        uni.showToast({
          title: '交易成功',
          icon: 'success'
        })

        this.closeMatchModal()
        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[MarketPage] 交易失败:', error)
        uni.showToast({
          title: error.message || '交易失败',
          icon: 'none'
        })
      }
    },

    async handleCancelOrder(order) {
      uni.showModal({
        title: '确认取消',
        content: '确定要取消这个订单吗？',
        success: async (res) => {
          if (res.confirm) {
            try {
              uni.showLoading({ title: '取消中...' })

              await this.marketplaceManager.cancelOrder(order.id)

              uni.hideLoading()
              uni.showToast({
                title: '已取消',
                icon: 'success'
              })

              this.closeDetailModal()
              await this.loadData()
            } catch (error) {
              uni.hideLoading()
              console.error('[MarketPage] 取消订单失败:', error)
              uni.showToast({
                title: error.message || '取消失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    getAssetName(assetId) {
      const asset = this.assets.find(a => a.id === assetId)
      return asset ? `${asset.name} (${asset.symbol})` : assetId
    },

    getStatusText(status) {
      const statusMap = {
        open: '开放',
        partial: '部分成交',
        completed: '已完成',
        cancelled: '已取消'
      }
      return statusMap[status] || status
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
.market-page {
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

.order-list {
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

.orders-container {
  .order-card {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24rpx;

      .order-title-row {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 16rpx;

        .order-title {
          font-size: 32rpx;
          font-weight: bold;
          color: #333;
        }

        .order-type-badge {
          padding: 4rpx 16rpx;
          border-radius: 8rpx;
          font-size: 24rpx;

          &.buy {
            background: #e6f7ff;
            color: #1890ff;
          }

          &.sell {
            background: #fff7e6;
            color: #fa8c16;
          }

          .badge-text {
            font-size: 24rpx;
          }
        }
      }

      .order-status-badge {
        padding: 8rpx 16rpx;
        border-radius: 8rpx;
        font-size: 24rpx;

        &.open {
          background: #f0f9ff;
          color: #0284c7;
        }

        &.partial {
          background: #fef3c7;
          color: #d97706;
        }

        &.completed {
          background: #dcfce7;
          color: #16a34a;
        }

        &.cancelled {
          background: #fee2e2;
          color: #dc2626;
        }

        .status-text {
          font-size: 24rpx;
        }
      }
    }

    .order-info {
      margin-bottom: 24rpx;

      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 12rpx 0;

        .info-label {
          font-size: 28rpx;
          color: #999;
        }

        .info-value {
          font-size: 28rpx;
          color: #333;

          &.price {
            color: #667eea;
            font-weight: bold;
          }

          &.total {
            color: #52c41a;
            font-weight: bold;
          }
        }
      }
    }

    .order-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 24rpx;
      border-top: 1rpx solid #f0f0f0;

      .order-time {
        font-size: 24rpx;
        color: #999;
      }

      .order-actions {
        display: flex;
        gap: 16rpx;

        .action-btn-small {
          padding: 12rpx 32rpx;
          border-radius: 40rpx;
          font-size: 24rpx;

          &.primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }

          &.danger {
            background: #ff4d4f;
            color: white;
          }

          .btn-text {
            font-size: 24rpx;
          }
        }
      }
    }
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

  &.detail {
    width: 680rpx;
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

    &.picker {
      display: flex;
      align-items: center;
      color: #333;
    }
  }

  .form-textarea {
    height: 200rpx;
  }

  .radio-group {
    display: flex;
    gap: 16rpx;

    .radio-item {
      flex: 1;
      padding: 24rpx;
      border: 1rpx solid #e0e0e0;
      border-radius: 8rpx;
      text-align: center;
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

.detail-section {
  margin-bottom: 32rpx;

  .detail-title-row {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-bottom: 16rpx;

    .detail-title {
      font-size: 32rpx;
      font-weight: bold;
      color: #333;
    }

    .detail-type-badge {
      padding: 4rpx 16rpx;
      border-radius: 8rpx;

      &.buy {
        background: #e6f7ff;
        color: #1890ff;
      }

      &.sell {
        background: #fff7e6;
        color: #fa8c16;
      }

      .badge-text {
        font-size: 24rpx;
      }
    }
  }

  .detail-status-badge {
    display: inline-block;
    padding: 8rpx 16rpx;
    border-radius: 8rpx;

    &.open {
      background: #f0f9ff;
      color: #0284c7;
    }

    &.partial {
      background: #fef3c7;
      color: #d97706;
    }

    &.completed {
      background: #dcfce7;
      color: #16a34a;
    }

    &.cancelled {
      background: #fee2e2;
      color: #dc2626;
    }

    .status-text {
      font-size: 24rpx;
    }
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 16rpx 0;
    border-bottom: 1rpx solid #f5f5f5;

    .detail-label {
      font-size: 28rpx;
      color: #999;
    }

    .detail-value {
      font-size: 28rpx;
      color: #333;
      max-width: 60%;
      text-align: right;
      word-break: break-all;

      &.price {
        color: #667eea;
        font-weight: bold;
      }

      &.total {
        color: #52c41a;
        font-weight: bold;
      }

      &.did {
        font-size: 24rpx;
        font-family: monospace;
      }
    }
  }

  .detail-description {
    display: block;
    margin-top: 16rpx;
    padding: 24rpx;
    background: #f5f5f5;
    border-radius: 8rpx;
    font-size: 28rpx;
    color: #666;
    line-height: 1.6;
  }
}

.match-info {
  display: flex;
  justify-content: space-between;
  padding: 16rpx 0;
  margin-bottom: 16rpx;

  .match-label {
    font-size: 28rpx;
    color: #999;
  }

  .match-value {
    font-size: 28rpx;
    color: #333;

    &.price {
      color: #667eea;
      font-weight: bold;
    }
  }
}

.match-summary {
  margin-top: 32rpx;
  padding: 24rpx;
  background: #f0f4ff;
  border-radius: 8rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;

  .summary-label {
    font-size: 28rpx;
    color: #666;
  }

  .summary-value {
    font-size: 36rpx;
    font-weight: bold;
    color: #667eea;
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

    &.full {
      flex: none;
      width: 100%;
    }

    &.cancel {
      background: #f5f5f5;
      color: #666;
    }

    &.confirm {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    &.danger {
      background: #ff4d4f;
      color: white;
    }

    .btn-text {
      font-size: 28rpx;
    }
  }
}
</style>
