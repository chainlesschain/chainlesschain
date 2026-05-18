<template>
  <view class="assets-page">
    <!-- 顶部统计卡片 -->
    <view class="stats-card">
      <view class="stat-item">
        <text class="stat-label">总资产数</text>
        <text class="stat-value">{{ totalAssets }}</text>
      </view>
      <view class="stat-divider"></view>
      <view class="stat-item">
        <text class="stat-label">资产总值</text>
        <text class="stat-value">{{ totalValue }}</text>
      </view>
    </view>

    <!-- 标签页 -->
    <view class="tabs">
      <view
        class="tab-item"
        :class="{ active: currentTab === 'my-assets' }"
        @click="switchTab('my-assets')"
      >
        <text>我的资产</text>
      </view>
      <view
        class="tab-item"
        :class="{ active: currentTab === 'history' }"
        @click="switchTab('history')"
      >
        <text>转账记录</text>
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
      <!-- 我的资产列表 -->
      <view v-if="currentTab === 'my-assets'">
        <view class="loading" v-if="loading && assets.length === 0">
          <text>加载中...</text>
        </view>

        <view class="empty" v-else-if="assets.length === 0">
          <text class="empty-icon">💎</text>
          <text class="empty-text">还没有资产</text>
          <button class="create-btn" @click="showCreateAsset">
            创建资产
          </button>
        </view>

        <view class="asset-item" v-for="asset in assets" :key="asset.id" @click="showAssetDetail(asset)">
          <view class="asset-icon" :style="{ backgroundColor: getAssetColor(asset.type) }">
            <text>{{ getAssetIcon(asset.type) }}</text>
          </view>
          <view class="asset-info">
            <view class="asset-header">
              <text class="asset-name">{{ asset.name }}</text>
              <text class="asset-symbol">{{ asset.symbol }}</text>
            </view>
            <text class="asset-type">{{ getAssetTypeText(asset.type) }}</text>
          </view>
          <view class="asset-balance">
            <text class="balance-value">{{ formatBalance(asset.balance) }}</text>
            <text class="balance-label">余额</text>
          </view>
        </view>

        <!-- 创建资产按钮 -->
        <view class="fab" @click="showCreateAsset" v-if="assets.length > 0">
          <text>➕</text>
        </view>
      </view>

      <!-- 转账记录 -->
      <view v-if="currentTab === 'history'">
        <view class="loading" v-if="loading && transfers.length === 0">
          <text>加载中...</text>
        </view>

        <view class="empty" v-else-if="transfers.length === 0">
          <text class="empty-icon">📜</text>
          <text class="empty-text">还没有转账记录</text>
        </view>

        <view class="transfer-item" v-for="transfer in transfers" :key="transfer.id">
          <view class="transfer-icon" :class="transfer.from_did === currentDid ? 'transfer-out' : 'transfer-in'">
            <text>{{ transfer.from_did === currentDid ? '📤' : '📥' }}</text>
          </view>
          <view class="transfer-info">
            <text class="transfer-type">
              {{ transfer.from_did === currentDid ? '转出' : '转入' }}
            </text>
            <text class="transfer-time">{{ formatTime(transfer.created_at) }}</text>
            <text class="transfer-memo" v-if="transfer.memo">{{ transfer.memo }}</text>
          </view>
          <view class="transfer-amount">
            <text :class="transfer.from_did === currentDid ? 'amount-out' : 'amount-in'">
              {{ transfer.from_did === currentDid ? '-' : '+' }}{{ transfer.amount }}
            </text>
            <text class="amount-asset">{{ transfer.asset_symbol }}</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 创建资产弹窗 -->
    <view class="modal" v-if="showCreate" @click="closeCreate">
      <view class="modal-content" @click.stop>
        <text class="modal-title">创建数字资产</text>

        <view class="form-item">
          <text class="form-label">资产类型</text>
          <picker
            mode="selector"
            :range="assetTypes"
            range-key="label"
            :value="createForm.typeIndex"
            @change="onTypeChange"
          >
            <view class="picker-input">
              <text>{{ assetTypes[createForm.typeIndex].label }}</text>
            </view>
          </picker>
        </view>

        <view class="form-item">
          <text class="form-label">资产名称</text>
          <input
            class="form-input"
            v-model="createForm.name"
            placeholder="例如：比特币"
            maxlength="50"
          />
        </view>

        <view class="form-item">
          <text class="form-label">资产符号</text>
          <input
            class="form-input"
            v-model="createForm.symbol"
            placeholder="例如：BTC"
            maxlength="10"
          />
        </view>

        <view class="form-item">
          <text class="form-label">总供应量</text>
          <input
            class="form-input"
            type="number"
            v-model.number="createForm.totalSupply"
            placeholder="总发行量"
          />
        </view>

        <view class="form-item">
          <text class="form-label">初始余额</text>
          <input
            class="form-input"
            type="number"
            v-model.number="createForm.initialBalance"
            placeholder="初始分配给自己的数量"
          />
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeCreate">取消</button>
          <button
            class="modal-btn confirm"
            @click="handleCreateAsset"
            :disabled="!canCreate || creating"
          >
            {{ creating ? '创建中...' : '确认创建' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 资产详情弹窗 -->
    <view class="modal" v-if="showDetail && selectedAsset" @click="closeDetail">
      <view class="modal-content detail-modal" @click.stop>
        <text class="modal-title">资产详情</text>

        <view class="detail-section">
          <view class="detail-header">
            <view class="detail-icon" :style="{ backgroundColor: getAssetColor(selectedAsset.type) }">
              <text>{{ getAssetIcon(selectedAsset.type) }}</text>
            </view>
            <view class="detail-main">
              <text class="detail-name">{{ selectedAsset.name }}</text>
              <text class="detail-symbol">{{ selectedAsset.symbol }}</text>
            </view>
          </view>

          <view class="detail-item">
            <text class="detail-label">资产类型</text>
            <text class="detail-value">{{ getAssetTypeText(selectedAsset.type) }}</text>
          </view>

          <view class="detail-item">
            <text class="detail-label">我的余额</text>
            <text class="detail-value highlight">{{ formatBalance(selectedAsset.balance) }}</text>
          </view>

          <view class="detail-item">
            <text class="detail-label">总供应量</text>
            <text class="detail-value">{{ selectedAsset.total_supply }}</text>
          </view>

          <view class="detail-item">
            <text class="detail-label">精度</text>
            <text class="detail-value">{{ selectedAsset.decimals }} 位小数</text>
          </view>

          <view class="detail-item">
            <text class="detail-label">创建时间</text>
            <text class="detail-value">{{ formatDateTime(selectedAsset.created_at) }}</text>
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn secondary" @click="showTransferModal">转账</button>
          <button class="modal-btn confirm" @click="closeDetail">关闭</button>
        </view>
      </view>
    </view>

    <!-- 转账弹窗 -->
    <view class="modal" v-if="showTransfer" @click="closeTransfer">
      <view class="modal-content" @click.stop>
        <text class="modal-title">转账</text>

        <view class="form-item">
          <text class="form-label">接收方DID</text>
          <input
            class="form-input"
            v-model="transferForm.toDid"
            placeholder="输入接收方DID地址"
          />
        </view>

        <view class="form-item">
          <text class="form-label">转账数量</text>
          <input
            class="form-input"
            type="number"
            v-model.number="transferForm.amount"
            placeholder="输入转账数量"
          />
          <text class="form-hint">可用余额: {{ formatBalance(selectedAsset.balance) }}</text>
        </view>

        <view class="form-item">
          <text class="form-label">备注（可选）</text>
          <input
            class="form-input"
            v-model="transferForm.memo"
            placeholder="添加转账备注"
            maxlength="100"
          />
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="closeTransfer">取消</button>
          <button
            class="modal-btn confirm"
            @click="handleTransfer"
            :disabled="!canTransfer || transferring"
          >
            {{ transferring ? '转账中...' : '确认转账' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { createAssetManager, AssetType } from '@/services/trade/asset-manager.js'
import { getDatabase } from '@/services/database.js'
import { getDIDManager } from '@/services/did.js'

export default {
  data() {
    return {
      currentTab: 'my-assets',
      currentDid: '',
      assets: [],
      transfers: [],
      loading: false,
      refreshing: false,

      // 统计
      totalAssets: 0,
      totalValue: 0,

      // 创建资产
      showCreate: false,
      creating: false,
      createForm: {
        typeIndex: 0,
        name: '',
        symbol: '',
        totalSupply: 0,
        initialBalance: 0
      },
      assetTypes: [
        { label: '代币 (Token)', value: AssetType.TOKEN },
        { label: 'NFT', value: AssetType.NFT },
        { label: '积分 (Points)', value: AssetType.POINTS },
        { label: '债券 (Bond)', value: AssetType.BOND }
      ],

      // 资产详情
      showDetail: false,
      selectedAsset: null,

      // 转账
      showTransfer: false,
      transferring: false,
      transferForm: {
        toDid: '',
        amount: 0,
        memo: ''
      },

      // 服务实例
      assetManager: null
    }
  },

  computed: {
    canCreate() {
      return this.createForm.name.trim() &&
             this.createForm.symbol.trim() &&
             this.createForm.totalSupply > 0 &&
             this.createForm.initialBalance >= 0 &&
             this.createForm.initialBalance <= this.createForm.totalSupply
    },

    canTransfer() {
      return this.transferForm.toDid.trim() &&
             this.transferForm.amount > 0 &&
             this.selectedAsset &&
             this.transferForm.amount <= this.selectedAsset.balance
    }
  },

  async onLoad() {
    await this.initServices()
    await this.loadData()
  },

  methods: {
    /**
     * 初始化服务
     */
    async initServices() {
      try {
        const db = await getDatabase()
        const didManager = await getDIDManager()

        this.currentDid = await didManager.getCurrentDid()

        // 创建AssetManager实例
        this.assetManager = createAssetManager(db, didManager)
        await this.assetManager.initialize()

        console.log('[Assets] 服务初始化完成')
      } catch (error) {
        console.error('[Assets] 服务初始化失败:', error)
        uni.showToast({
          title: '初始化失败',
          icon: 'none'
        })
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
      if (!this.assetManager) return

      this.loading = true
      try {
        if (this.currentTab === 'my-assets') {
          await this.loadAssets()
        } else {
          await this.loadTransfers()
        }
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载资产列表
     */
    async loadAssets() {
      try {
        const allAssets = await this.assetManager.getAssetsByOwner(this.currentDid)

        // 获取每个资产的余额
        this.assets = await Promise.all(
          allAssets.map(async (asset) => {
            const balance = await this.assetManager.getBalance(this.currentDid, asset.id)
            return { ...asset, balance }
          })
        )

        this.totalAssets = this.assets.length
        console.log('[Assets] 加载资产列表:', this.assets.length)
      } catch (error) {
        console.error('[Assets] 加载资产失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      }
    },

    /**
     * 加载转账记录
     */
    async loadTransfers() {
      try {
        const history = await this.assetManager.getUserHistory(this.currentDid, 100)

        // 只显示转账记录
        this.transfers = history.filter(h => h.type === 'transfer')

        // 获取资产符号
        for (const transfer of this.transfers) {
          try {
            const asset = await this.assetManager.getAsset(transfer.asset_id)
            transfer.asset_symbol = asset.symbol
          } catch (e) {
            transfer.asset_symbol = 'Unknown'
          }
        }

        console.log('[Assets] 加载转账记录:', this.transfers.length)
      } catch (error) {
        console.error('[Assets] 加载转账记录失败:', error)
      }
    },

    /**
     * 下拉刷新
     */
    async onRefresh() {
      this.refreshing = true
      await this.loadData()
      this.refreshing = false
    },

    /**
     * 显示创建资产弹窗
     */
    showCreateAsset() {
      this.showCreate = true
      this.createForm = {
        typeIndex: 0,
        name: '',
        symbol: '',
        totalSupply: 0,
        initialBalance: 0
      }
    },

    /**
     * 关闭创建弹窗
     */
    closeCreate() {
      this.showCreate = false
    },

    /**
     * 资产类型改变
     */
    onTypeChange(e) {
      this.createForm.typeIndex = e.detail.value
    },

    /**
     * 创建资产
     */
    async handleCreateAsset() {
      if (!this.canCreate) return

      this.creating = true
      try {
        const assetType = this.assetTypes[this.createForm.typeIndex].value

        const asset = await this.assetManager.createAsset({
          type: assetType,
          name: this.createForm.name.trim(),
          symbol: this.createForm.symbol.trim().toUpperCase(),
          totalSupply: this.createForm.totalSupply,
          initialBalance: this.createForm.initialBalance,
          decimals: 8
        })

        uni.showToast({
          title: '创建成功',
          icon: 'success'
        })

        this.closeCreate()
        await this.loadAssets()
      } catch (error) {
        console.error('[Assets] 创建资产失败:', error)
        uni.showToast({
          title: error.message || '创建失败',
          icon: 'none'
        })
      } finally {
        this.creating = false
      }
    },

    /**
     * 显示资产详情
     */
    showAssetDetail(asset) {
      this.selectedAsset = asset
      this.showDetail = true
    },

    /**
     * 关闭详情
     */
    closeDetail() {
      this.showDetail = false
      this.selectedAsset = null
    },

    /**
     * 显示转账弹窗
     */
    showTransferModal() {
      this.showDetail = false
      this.showTransfer = true
      this.transferForm = {
        toDid: '',
        amount: 0,
        memo: ''
      }
    },

    /**
     * 关闭转账弹窗
     */
    closeTransfer() {
      this.showTransfer = false
    },

    /**
     * 执行转账
     */
    async handleTransfer() {
      if (!this.canTransfer) return

      this.transferring = true
      try {
        await this.assetManager.transferAsset(
          this.selectedAsset.id,
          this.transferForm.toDid,
          this.transferForm.amount,
          this.transferForm.memo
        )

        uni.showToast({
          title: '转账成功',
          icon: 'success'
        })

        this.closeTransfer()
        await this.loadAssets()
      } catch (error) {
        console.error('[Assets] 转账失败:', error)
        uni.showToast({
          title: error.message || '转账失败',
          icon: 'none'
        })
      } finally {
        this.transferring = false
      }
    },

    /**
     * 获取资产图标
     */
    getAssetIcon(type) {
      const icons = {
        [AssetType.TOKEN]: '🪙',
        [AssetType.NFT]: '🎨',
        [AssetType.POINTS]: '⭐',
        [AssetType.BOND]: '📜'
      }
      return icons[type] || '💎'
    },

    /**
     * 获取资产颜色
     */
    getAssetColor(type) {
      const colors = {
        [AssetType.TOKEN]: '#667eea',
        [AssetType.NFT]: '#f093fb',
        [AssetType.POINTS]: '#feca57',
        [AssetType.BOND]: '#5f27cd'
      }
      return colors[type] || '#888'
    },

    /**
     * 获取资产类型文本
     */
    getAssetTypeText(type) {
      const texts = {
        [AssetType.TOKEN]: '代币',
        [AssetType.NFT]: 'NFT',
        [AssetType.POINTS]: '积分',
        [AssetType.BOND]: '债券'
      }
      return texts[type] || type
    },

    /**
     * 格式化余额
     */
    formatBalance(balance) {
      if (!balance) return '0'
      return parseFloat(balance).toFixed(2)
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
    },

    /**
     * 格式化日期时间
     */
    formatDateTime(timestamp) {
      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
  }
}
</script>

<style lang="scss" scoped>
.assets-page {
  min-height: 100vh;
  background-color: #f5f5f5;
  display: flex;
  flex-direction: column;
}

.stats-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 48rpx 32rpx;
  margin: 24rpx;
  border-radius: 16rpx;
  display: flex;
  box-shadow: 0 8rpx 24rpx rgba(102, 126, 234, 0.3);

  .stat-item {
    flex: 1;
    text-align: center;

    .stat-label {
      display: block;
      font-size: 26rpx;
      color: rgba(255, 255, 255, 0.8);
      margin-bottom: 16rpx;
    }

    .stat-value {
      display: block;
      font-size: 48rpx;
      font-weight: bold;
      color: white;
    }
  }

  .stat-divider {
    width: 1rpx;
    background-color: rgba(255, 255, 255, 0.3);
    margin: 0 24rpx;
  }
}

.tabs {
  display: flex;
  background-color: white;
  border-bottom: 1rpx solid #eee;

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
      color: #667eea;
      font-weight: 500;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 60rpx;
        height: 4rpx;
        background-color: #667eea;
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
    margin-bottom: 40rpx;
  }

  .create-btn {
    width: 300rpx;
    height: 80rpx;
    background-color: #667eea;
    color: white;
    border-radius: 40rpx;
    font-size: 28rpx;
    border: none;

    &::after {
      border: none;
    }
  }
}

.asset-item {
  background-color: white;
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  display: flex;
  align-items: center;
  gap: 24rpx;

  .asset-icon {
    width: 96rpx;
    height: 96rpx;
    border-radius: 48rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48rpx;
    flex-shrink: 0;
  }

  .asset-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;

    .asset-header {
      display: flex;
      align-items: center;
      gap: 12rpx;

      .asset-name {
        font-size: 30rpx;
        font-weight: 500;
        color: #333;
      }

      .asset-symbol {
        padding: 4rpx 12rpx;
        background-color: #f0f0f0;
        border-radius: 8rpx;
        font-size: 22rpx;
        color: #666;
      }
    }

    .asset-type {
      font-size: 24rpx;
      color: #999;
    }
  }

  .asset-balance {
    text-align: right;
    flex-shrink: 0;

    .balance-value {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: #333;
      margin-bottom: 4rpx;
    }

    .balance-label {
      display: block;
      font-size: 22rpx;
      color: #999;
    }
  }
}

.transfer-item {
  background-color: white;
  border-radius: 12rpx;
  padding: 32rpx;
  margin-bottom: 16rpx;
  display: flex;
  gap: 20rpx;
  align-items: center;

  .transfer-icon {
    width: 72rpx;
    height: 72rpx;
    border-radius: 36rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 36rpx;
    flex-shrink: 0;

    &.transfer-out {
      background-color: #fff1f0;
    }

    &.transfer-in {
      background-color: #f6ffed;
    }
  }

  .transfer-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6rpx;

    .transfer-type {
      font-size: 28rpx;
      color: #333;
      font-weight: 500;
    }

    .transfer-time {
      font-size: 24rpx;
      color: #999;
    }

    .transfer-memo {
      font-size: 24rpx;
      color: #666;
      margin-top: 4rpx;
    }
  }

  .transfer-amount {
    text-align: right;
    flex-shrink: 0;

    .amount-out {
      display: block;
      font-size: 32rpx;
      font-weight: bold;
      color: #ff4d4f;
    }

    .amount-in {
      display: block;
      font-size: 32rpx;
      font-weight: bold;
      color: #52c41a;
    }

    .amount-asset {
      display: block;
      font-size: 22rpx;
      color: #999;
      margin-top: 4rpx;
    }
  }
}

.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 112rpx;
  height: 112rpx;
  background-color: #667eea;
  border-radius: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48rpx;
  color: white;
  box-shadow: 0 8rpx 24rpx rgba(102, 126, 234, 0.4);
  z-index: 10;
}

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
    background-color: white;
    border-radius: 16rpx;
    padding: 40rpx;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: #333;
      margin-bottom: 32rpx;
      text-align: center;
    }
  }

  .form-item {
    margin-bottom: 32rpx;

    .form-label {
      display: block;
      font-size: 28rpx;
      color: #666;
      margin-bottom: 16rpx;
    }

    .picker-input,
    .form-input {
      width: 100%;
      height: 80rpx;
      padding: 0 24rpx;
      background-color: #f5f5f5;
      border-radius: 8rpx;
      font-size: 28rpx;
      display: flex;
      align-items: center;
    }

    .form-hint {
      display: block;
      font-size: 24rpx;
      color: #999;
      margin-top: 8rpx;
    }
  }

  .detail-modal {
    .detail-section {
      .detail-header {
        display: flex;
        align-items: center;
        gap: 24rpx;
        margin-bottom: 32rpx;
        padding: 32rpx;
        background-color: #f5f5f5;
        border-radius: 12rpx;

        .detail-icon {
          width: 96rpx;
          height: 96rpx;
          border-radius: 48rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48rpx;
        }

        .detail-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8rpx;

          .detail-name {
            font-size: 32rpx;
            font-weight: bold;
            color: #333;
          }

          .detail-symbol {
            font-size: 28rpx;
            color: #666;
          }
        }
      }

      .detail-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24rpx 0;
        border-bottom: 1rpx solid #f0f0f0;

        &:last-child {
          border-bottom: none;
        }

        .detail-label {
          font-size: 28rpx;
          color: #666;
        }

        .detail-value {
          font-size: 28rpx;
          color: #333;

          &.highlight {
            font-size: 36rpx;
            font-weight: bold;
            color: #667eea;
          }
        }
      }
    }
  }

  .modal-actions {
    display: flex;
    gap: 20rpx;
    margin-top: 32rpx;

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

      &.secondary {
        background-color: #764ba2;
        color: white;
      }

      &.confirm {
        background-color: #667eea;
        color: white;

        &[disabled] {
          opacity: 0.5;
        }
      }
    }
  }
}
</style>
