<template>
  <view class="assets-page">
    <!-- 余额卡片 -->
    <view class="balance-card">
      <view class="balance-header">
        <text class="balance-label">总资产 (CLC)</text>
        <view class="recharge-btn" @click="showRechargeModal">
          <text>💰 充值</text>
        </view>
      </view>
      <view class="balance-value">
        <text>{{ balance.toFixed(2) }}</text>
      </view>
    </view>

    <!-- 标签页 -->
    <view class="tabs">
      <view
        class="tab-item"
        :class="{ active: currentTab === 'transactions' }"
        @click="switchTab('transactions')"
      >
        <text>交易记录</text>
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'listings' }"
        @click="switchTab('listings')"
      >
        <text>我的上架 ({{ myListingsCount }})</text>
      </view>
    </view>

    <!-- 内容区域 -->
    <scroll-view
      class="content"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- 交易记录 -->
      <view v-if="currentTab === 'transactions'">
        <view class="loading" v-if="loading && transactions.length === 0">
          <text>加载中...</text>
        </view>

        <view class="empty" v-else-if="transactions.length === 0">
          <text class="empty-icon">📊</text>
          <text class="empty-text">还没有交易记录</text>
        </view>

        <view class="transaction-item" v-for="tx in transactions" :key="tx.id">
          <view class="tx-icon" :class="'tx-' + tx.type">
            <text>{{ getTypeIcon(tx.type) }}</text>
          </view>
          <view class="tx-info">
            <text class="tx-type">{{ getTypeText(tx.type) }}</text>
            <text class="tx-time">{{ formatTime(tx.created_at) }}</text>
          </view>
          <view class="tx-amount" :class="tx.amount > 0 ? 'positive' : 'negative'">
            <text>{{ tx.amount > 0 ? '+' : '' }}{{ tx.amount.toFixed(2) }} CLC</text>
          </view>
        </view>
      </view>

      <!-- 我的上架 -->
      <view v-if="currentTab === 'listings'">
        <view class="loading" v-if="loading && myListings.length === 0">
          <text>加载中...</text>
        </view>

        <view class="empty" v-else-if="myListings.length === 0">
          <text class="empty-icon">📦</text>
          <text class="empty-text">还没有上架商品</text>
          <button class="add-listing-btn" @click="showCreateListing">
            上架知识
          </button>
        </view>

        <view class="listing-item" v-for="listing in myListings" :key="listing.id">
          <view class="listing-header">
            <view class="listing-info">
              <text class="listing-title">{{ listing.title }}</text>
              <text class="listing-status" :class="'status-' + listing.status">
                {{ getListingStatusText(listing.status) }}
              </text>
            </view>
            <view class="listing-price">
              <text class="price-value">{{ listing.price }}</text>
              <text class="price-unit">CLC</text>
            </view>
          </view>

          <text class="listing-desc" v-if="listing.description">{{ listing.description }}</text>

          <view class="listing-footer">
            <text class="listing-time">{{ formatTime(listing.created_at) }}</text>
            <view class="listing-actions">
              <view class="action-btn remove" @click="removeListingConfirm(listing)" v-if="listing.status === 'on_sale'">
                <text>下架</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 上架按钮 -->
        <view class="fab" @click="showCreateListing" v-if="myListings.length > 0">
          <text>➕</text>
        </view>
      </view>
    </scroll-view>

    <!-- 充值弹窗 -->
    <view class="modal" v-if="showRecharge" @click="closeRecharge">
      <view class="modal-content recharge-modal" @click.stop>
        <text class="modal-title">充值</text>

        <view class="recharge-options">
          <view
            class="recharge-option"
            v-for="amount in rechargeOptions"
            :key="amount"
            @click="selectRechargeAmount(amount)"
            :class="{ active: rechargeAmount === amount }"
          >
            <text class="amount-value">{{ amount }}</text>
            <text class="amount-unit">CLC</text>
          </view>
        </view>

        <view class="custom-amount">
          <text class="label">自定义金额</text>
          <input
            class="amount-input"
            type="number"
            v-model.number="rechargeAmount"
            placeholder="输入金额"
          />
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeRecharge">取消</button>
          <button
            class="modal-btn confirm"
            @click="handleRecharge"
            :disabled="!rechargeAmount || rechargeAmount <= 0 || recharging"
          >
            {{ recharging ? '充值中...' : '确认充值' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 上架弹窗 -->
    <view class="modal" v-if="showCreate" @click="closeCreate">
      <view class="modal-content create-modal" @click.stop>
        <text class="modal-title">上架知识</text>

        <view class="form-section">
          <text class="form-label">选择知识</text>
          <picker
            mode="selector"
            :range="knowledgeItems"
            range-key="title"
            @change="onKnowledgeSelect"
          >
            <view class="picker-input">
              <text v-if="newListing.knowledge">{{ newListing.knowledge.title }}</text>
              <text v-else class="placeholder">请选择要上架的知识</text>
            </view>
          </picker>
        </view>

        <view class="form-section">
          <text class="form-label">商品标题</text>
          <input
            class="form-input"
            type="text"
            v-model="newListing.title"
            placeholder="给商品起个标题"
            maxlength="50"
          />
        </view>

        <view class="form-section">
          <text class="form-label">商品描述（可选）</text>
          <textarea
            class="form-textarea"
            v-model="newListing.description"
            placeholder="描述一下这个知识的价值..."
            maxlength="200"
          />
        </view>

        <view class="form-section">
          <text class="form-label">价格 (CLC)</text>
          <input
            class="form-input"
            type="number"
            v-model.number="newListing.price"
            placeholder="设定价格"
          />
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeCreate">取消</button>
          <button
            class="modal-btn confirm"
            @click="handleCreateListing"
            :disabled="!canCreate || creating"
          >
            {{ creating ? '上架中...' : '确认上架' }}
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
      currentTab: 'transactions',
      balance: 0,
      transactions: [],
      myListings: [],
      knowledgeItems: [],
      loading: false,
      refreshing: false,
      myDid: '',
      showRecharge: false,
      rechargeAmount: 0,
      rechargeOptions: [10, 50, 100, 500],
      recharging: false,
      showCreate: false,
      newListing: {
        knowledge: null,
        title: '',
        description: '',
        price: 0
      },
      creating: false
    }
  },
  computed: {
    myListingsCount() {
      return this.myListings.filter(l => l.status === 'on_sale').length
    },
    canCreate() {
      return this.newListing.knowledge &&
             this.newListing.title.trim() &&
             this.newListing.price > 0
    }
  },
  onLoad() {
    this.initUserDid()
    this.loadBalance()
    this.loadData()
  },
  onShow() {
    // 每次显示时刷新
    this.loadBalance()
    this.loadData()
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
     * 切换标签
     */
    switchTab(tab) {
      this.currentTab = tab
      this.loadData()
    },

    /**
     * 加载数据
     */
    async loadData() {
      this.loading = true
      try {
        if (this.currentTab === 'transactions') {
          await this.loadTransactions()
        } else {
          await this.loadMyListings()
        }
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载交易记录
     */
    async loadTransactions() {
      try {
        this.transactions = await db.getTransactions(this.myDid, 50)
        console.log('加载交易记录:', this.transactions.length)
      } catch (error) {
        console.error('加载交易记录失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 加载我的上架
     */
    async loadMyListings() {
      try {
        this.myListings = await db.getMyListings(this.myDid)
        console.log('加载我的上架:', this.myListings.length)
      } catch (error) {
        console.error('加载上架失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 下拉刷新
     */
    async onRefresh() {
      this.refreshing = true
      await this.loadBalance()
      await this.loadData()
      this.refreshing = false
    },

    /**
     * 获取类型图标
     */
    getTypeIcon(type) {
      const icons = {
        buy: '🛒',
        sell: '💰',
        deposit: '💳',
        withdraw: '🏦'
      }
      return icons[type] || '💵'
    },

    /**
     * 获取类型文本
     */
    getTypeText(type) {
      const texts = {
        buy: '购买知识',
        sell: '出售知识',
        deposit: '充值',
        withdraw: '提现'
      }
      return texts[type] || type
    },

    /**
     * 获取商品状态文本
     */
    getListingStatusText(status) {
      const texts = {
        on_sale: '在售',
        sold: '已售出',
        removed: '已下架'
      }
      return texts[status] || status
    },

    /**
     * 显示充值弹窗
     */
    showRechargeModal() {
      this.showRecharge = true
      this.rechargeAmount = 0
    },

    /**
     * 关闭充值弹窗
     */
    closeRecharge() {
      this.showRecharge = false
      this.rechargeAmount = 0
    },

    /**
     * 选择充值金额
     */
    selectRechargeAmount(amount) {
      this.rechargeAmount = amount
    },

    /**
     * 执行充值
     */
    async handleRecharge() {
      if (!this.rechargeAmount || this.rechargeAmount <= 0) {
        return
      }

      this.recharging = true

      try {
        // 模拟充值
        await db.updateBalance(this.myDid, this.rechargeAmount)
        await db.addTransaction(this.myDid, 'deposit', this.rechargeAmount)

        uni.showToast({
          title: '充值成功',
          icon: 'success'
        })

        this.closeRecharge()

        // 刷新余额和交易记录
        await this.loadBalance()
        if (this.currentTab === 'transactions') {
          await this.loadTransactions()
        }
      } catch (error) {
        console.error('充值失败:', error)
        uni.showToast({
          title: error.message || '充值失败',
          icon: 'none'
        })
      } finally {
        this.recharging = false
      }
    },

    /**
     * 显示上架弹窗
     */
    async showCreateListing() {
      // 加载知识列表
      try {
        this.knowledgeItems = await db.getKnowledgeItems({ limit: 100 })

        if (this.knowledgeItems.length === 0) {
          uni.showModal({
            title: '提示',
            content: '还没有知识可以上架，请先去知识库添加知识',
            showCancel: false
          })
          return
        }

        this.showCreate = true
        this.newListing = {
          knowledge: null,
          title: '',
          description: '',
          price: 0
        }
      } catch (error) {
        console.error('加载知识列表失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 关闭上架弹窗
     */
    closeCreate() {
      this.showCreate = false
    },

    /**
     * 选择知识
     */
    onKnowledgeSelect(e) {
      const index = e.detail.value
      this.newListing.knowledge = this.knowledgeItems[index]
      // 自动填充标题
      if (!this.newListing.title) {
        this.newListing.title = this.newListing.knowledge.title
      }
    },

    /**
     * 创建上架
     */
    async handleCreateListing() {
      if (!this.canCreate) {
        return
      }

      this.creating = true

      try {
        await db.createListing(
          this.newListing.knowledge.id,
          this.myDid,
          this.newListing.title,
          this.newListing.description,
          this.newListing.price
        )

        uni.showToast({
          title: '上架成功',
          icon: 'success'
        })

        this.closeCreate()

        // 刷新列表
        await this.loadMyListings()
      } catch (error) {
        console.error('上架失败:', error)
        uni.showToast({
          title: error.message || '上架失败',
          icon: 'none'
        })
      } finally {
        this.creating = false
      }
    },

    /**
     * 下架确认
     */
    removeListingConfirm(listing) {
      uni.showModal({
        title: '下架商品',
        content: `确定要下架《${listing.title}》吗？`,
        success: async (res) => {
          if (res.confirm) {
            await this.removeListing(listing)
          }
        }
      })
    },

    /**
     * 下架商品
     */
    async removeListing(listing) {
      try {
        await db.removeListing(listing.id)

        uni.showToast({
          title: '已下架',
          icon: 'success'
        })

        // 刷新列表
        await this.loadMyListings()
      } catch (error) {
        console.error('下架失败:', error)
        uni.showToast({
          title: '下架失败',
          icon: 'none'
        })
      }
    },

    /**
     * 格式化时间
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
    }
  }
}
</script>

<style lang="scss" scoped>
.assets-page {
  min-height: 100vh;
  background-color: #f8f8f8;
  display: flex;
  flex-direction: column;
}

.balance-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 48rpx 32rpx;
  margin: 24rpx;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 24rpx rgba(102, 126, 234, 0.3);

  .balance-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24rpx;

    .balance-label {
      font-size: 28rpx;
      color: rgba(255, 255, 255, 0.8);
    }

    .recharge-btn {
      padding: 12rpx 24rpx;
      background-color: rgba(255, 255, 255, 0.2);
      border-radius: 20rpx;
      font-size: 24rpx;
      color: #ffffff;
      backdrop-filter: blur(10rpx);
    }
  }

  .balance-value {
    font-size: 72rpx;
    font-weight: bold;
    color: #ffffff;
    text-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.1);
  }
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
    margin-bottom: 32rpx;
  }

  .add-listing-btn {
    width: 300rpx;
    height: 80rpx;
    background-color: #3cc51f;
    color: #ffffff;
    border-radius: 40rpx;
    font-size: 28rpx;
    border: none;
    margin: 0 auto;

    &::after {
      border: none;
    }
  }
}

// 交易记录
.transaction-item {
  background-color: #fff;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 16rpx;
  display: flex;
  gap: 20rpx;
  align-items: center;

  .tx-icon {
    width: 72rpx;
    height: 72rpx;
    border-radius: 36rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40rpx;
    flex-shrink: 0;

    &.tx-buy {
      background-color: #fff7e6;
    }

    &.tx-sell {
      background-color: #f6ffed;
    }

    &.tx-deposit {
      background-color: #e6f7ff;
    }

    &.tx-withdraw {
      background-color: #fff1f0;
    }
  }

  .tx-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .tx-type {
      font-size: 28rpx;
      color: #333;
      font-weight: 500;
    }

    .tx-time {
      font-size: 24rpx;
      color: #999;
    }
  }

  .tx-amount {
    font-size: 32rpx;
    font-weight: bold;
    flex-shrink: 0;

    &.positive {
      color: #52c41a;
    }

    &.negative {
      color: #ff4d4f;
    }
  }
}

// 我的上架
.listing-item {
  background-color: #fff;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;

  .listing-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16rpx;

    .listing-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12rpx;

      .listing-title {
        font-size: 30rpx;
        font-weight: 500;
        color: #333;
        line-height: 1.4;
      }

      .listing-status {
        display: inline-block;
        width: fit-content;
        padding: 4rpx 12rpx;
        border-radius: 8rpx;
        font-size: 22rpx;

        &.status-on_sale {
          background-color: #f6ffed;
          color: #52c41a;
        }

        &.status-sold {
          background-color: #f0f0f0;
          color: #999;
        }

        &.status-removed {
          background-color: #fff1f0;
          color: #ff4d4f;
        }
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
    margin-bottom: 16rpx;
  }

  .listing-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .listing-time {
      font-size: 24rpx;
      color: #999;
    }

    .listing-actions {
      display: flex;
      gap: 16rpx;

      .action-btn {
        padding: 8rpx 24rpx;
        border-radius: 16rpx;
        font-size: 24rpx;

        &.remove {
          background-color: #fff1f0;
          color: #ff4d4f;
        }
      }
    }
  }
}

.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 112rpx;
  height: 112rpx;
  background-color: #3cc51f;
  border-radius: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  color: #ffffff;
  box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.4);
  z-index: 10;
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
    background-color: #ffffff;
    border-radius: 16rpx;
    padding: 40rpx;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: #333;
      margin-bottom: 32rpx;
      text-align: center;
    }
  }

  // 充值弹窗
  .recharge-modal {
    .recharge-options {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20rpx;
      margin-bottom: 32rpx;

      .recharge-option {
        padding: 32rpx 24rpx;
        background-color: #f5f5f5;
        border-radius: 12rpx;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 8rpx;

        &.active {
          background-color: #e6f7e6;
          border: 2rpx solid #3cc51f;
        }

        .amount-value {
          font-size: 40rpx;
          font-weight: bold;
          color: #333;
        }

        .amount-unit {
          font-size: 24rpx;
          color: #999;
        }
      }
    }

    .custom-amount {
      margin-bottom: 32rpx;

      .label {
        display: block;
        font-size: 28rpx;
        color: #666;
        margin-bottom: 16rpx;
      }

      .amount-input {
        width: 100%;
        height: 80rpx;
        padding: 0 24rpx;
        background-color: #f5f5f5;
        border-radius: 8rpx;
        font-size: 28rpx;
      }
    }
  }

  // 上架弹窗
  .create-modal {
    max-height: 80vh;
    overflow-y: auto;

    .form-section {
      margin-bottom: 32rpx;

      .form-label {
        display: block;
        font-size: 28rpx;
        color: #666;
        margin-bottom: 16rpx;
      }

      .picker-input {
        width: 100%;
        height: 80rpx;
        padding: 0 24rpx;
        background-color: #f5f5f5;
        border-radius: 8rpx;
        display: flex;
        align-items: center;
        font-size: 28rpx;
        color: #333;

        .placeholder {
          color: #999;
        }
      }

      .form-input {
        width: 100%;
        height: 80rpx;
        padding: 0 24rpx;
        background-color: #f5f5f5;
        border-radius: 8rpx;
        font-size: 28rpx;
      }

      .form-textarea {
        width: 100%;
        min-height: 160rpx;
        padding: 16rpx 24rpx;
        background-color: #f5f5f5;
        border-radius: 8rpx;
        font-size: 28rpx;
        line-height: 1.6;
      }
    }
  }

  .modal-actions {
    display: flex;
    gap: 20rpx;

    .modal-btn {
      flex: 1;
      height: 88rpx;
      border-radius: 44rpx;
      font-size: 30rpx;
      font-weight: 500;
      border: none;

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
</style>
