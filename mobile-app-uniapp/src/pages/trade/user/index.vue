<template>
  <view class="user-center-page">
    <!-- Header with User Info -->
    <view class="header">
      <view class="user-profile">
        <view class="user-avatar">
          <text class="avatar-text">{{ getAvatarText(currentDid) }}</text>
        </view>
        <view class="user-details">
          <text class="user-name">{{ formatDid(currentDid) }}</text>
          <view class="user-level">
            <text class="level-text">Lv.{{ userLevel.level }}</text>
            <text class="level-name">{{ getLevelName(userLevel.level) }}</text>
          </view>
        </view>
      </view>
      <view class="check-in-btn" @click="handleCheckIn">
        <text class="check-in-icon">📅</text>
        <text class="check-in-text">签到</text>
      </view>
    </view>

    <!-- Level Progress Card -->
    <view class="level-card">
      <view class="level-header">
        <text class="level-title">等级进度</text>
        <text class="level-subtitle">Lv.{{ userLevel.level }} → Lv.{{ userLevel.level + 1 }}</text>
      </view>
      <view class="progress-bar-container">
        <view class="progress-bar">
          <view class="progress-fill" :style="{ width: getLevelProgress() + '%' }"></view>
        </view>
        <text class="progress-text">
          {{ userLevel.exp }} / {{ userLevel.next_level_exp }} EXP
        </text>
      </view>
      <view class="level-benefits">
        <text class="benefits-text">当前权益: {{ getCurrentBenefits() }}</text>
      </view>
    </view>

    <!-- Stats Cards -->
    <view class="stats-grid">
      <view class="stat-card">
        <text class="stat-value">{{ stats.points }}</text>
        <text class="stat-label">积分</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ stats.checkInDays }}</text>
        <text class="stat-label">连续签到</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ stats.completedTasks }}</text>
        <text class="stat-label">完成任务</text>
      </view>
      <view class="stat-card">
        <text class="stat-value">{{ stats.achievements }}</text>
        <text class="stat-label">成就</text>
      </view>
    </view>

    <!-- Tabs -->
    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        class="tab-item"
        :class="{ active: currentTab === tab.value }"
        @click="switchTab(tab.value)"
      >
        <text class="tab-text">{{ tab.label }}</text>
      </view>
    </view>

    <!-- Content -->
    <scroll-view
      class="content-area"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- Tasks Tab -->
      <view v-if="currentTab === 'tasks'" class="tasks-container">
        <view v-if="tasks.length === 0" class="empty-container">
          <text class="empty-icon">✅</text>
          <text class="empty-text">暂无任务</text>
        </view>

        <view v-else>
          <view
            v-for="task in tasks"
            :key="task.id"
            class="task-card"
            :class="{ completed: task.is_completed }"
          >
            <view class="task-header">
              <view class="task-info">
                <text class="task-title">{{ task.title }}</text>
                <text class="task-description">{{ task.description }}</text>
              </view>
              <view class="task-status">
                <text v-if="task.is_completed" class="status-completed">✓ 已完成</text>
                <text v-else class="status-pending">进行中</text>
              </view>
            </view>

            <view class="task-footer">
              <view class="task-progress">
                <text class="progress-label">进度:</text>
                <view class="mini-progress-bar">
                  <view
                    class="mini-progress-fill"
                    :style="{ width: getTaskProgress(task) + '%' }"
                  ></view>
                </view>
                <text class="progress-value">
                  {{ task.current_progress }} / {{ task.required_progress }}
                </text>
              </view>
              <view class="task-rewards">
                <text class="reward-icon">🎁</text>
                <text class="reward-text">{{ task.reward_exp }} EXP</text>
              </view>
            </view>

            <view
              v-if="!task.is_completed && task.current_progress >= task.required_progress"
              class="complete-btn"
              @click="handleCompleteTask(task)"
            >
              <text class="btn-text">领取奖励</text>
            </view>
          </view>
        </view>
      </view>

      <!-- Milestones Tab -->
      <view v-if="currentTab === 'milestones'" class="milestones-container">
        <view v-if="milestones.length === 0" class="empty-container">
          <text class="empty-icon">🏆</text>
          <text class="empty-text">暂无里程碑</text>
        </view>

        <view v-else>
          <view
            v-for="milestone in milestones"
            :key="milestone.id"
            class="milestone-card"
            :class="{ unlocked: milestone.is_unlocked }"
          >
            <view class="milestone-header">
              <view class="milestone-icon">
                <text class="icon-text">{{ getMilestoneIcon(milestone) }}</text>
              </view>
              <view class="milestone-info">
                <text class="milestone-title">{{ milestone.title }}</text>
                <text class="milestone-description">{{ milestone.description }}</text>
              </view>
            </view>

            <view class="milestone-footer">
              <view class="milestone-progress">
                <view class="mini-progress-bar">
                  <view
                    class="mini-progress-fill"
                    :style="{ width: getMilestoneProgress(milestone) + '%' }"
                  ></view>
                </view>
                <text class="progress-text">
                  {{ milestone.current_value }} / {{ milestone.target_value }}
                </text>
              </view>
              <view class="milestone-rewards">
                <text class="reward-text">{{ milestone.reward_points }} 积分</text>
              </view>
            </view>

            <view v-if="milestone.is_unlocked" class="unlocked-badge">
              <text class="badge-text">✓ 已达成</text>
            </view>
          </view>
        </view>
      </view>

      <!-- Rewards Tab -->
      <view v-if="currentTab === 'rewards'" class="rewards-container">
        <view class="rewards-balance">
          <text class="balance-label">可用积分</text>
          <text class="balance-value">{{ stats.points }}</text>
        </view>

        <view class="rewards-list">
          <view
            v-for="reward in availableRewards"
            :key="reward.id"
            class="reward-card"
          >
            <view class="reward-info">
              <text class="reward-icon">{{ reward.icon }}</text>
              <view class="reward-details">
                <text class="reward-name">{{ reward.name }}</text>
                <text class="reward-description">{{ reward.description }}</text>
              </view>
            </view>
            <view class="reward-footer">
              <text class="reward-cost">{{ reward.cost }} 积分</text>
              <view
                class="redeem-btn"
                :class="{ disabled: stats.points < reward.cost }"
                @click="handleRedeemReward(reward)"
              >
                <text class="btn-text">兑换</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- History Tab -->
      <view v-if="currentTab === 'history'" class="history-container">
        <view v-if="history.length === 0" class="empty-container">
          <text class="empty-icon">📝</text>
          <text class="empty-text">暂无记录</text>
        </view>

        <view v-else>
          <view
            v-for="record in history"
            :key="record.id"
            class="history-card"
          >
            <view class="history-header">
              <text class="history-type">{{ getHistoryTypeText(record.type) }}</text>
              <text class="history-time">{{ formatTime(record.created_at) }}</text>
            </view>
            <view class="history-content">
              <text class="history-description">{{ record.description }}</text>
              <text class="history-reward" :class="{ positive: record.exp > 0 }">
                {{ record.exp > 0 ? '+' : '' }}{{ record.exp }} EXP
              </text>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { createIncentiveManager } from '@/services/trade/incentive-manager.js'
import { createMarketplaceManager } from '@/services/trade/marketplace-manager.js'
import { createCreditScoreManager } from '@/services/trade/credit-score-manager.js'
import { createAssetManager } from '@/services/trade/asset-manager.js'
import { getDatabase } from '@/services/database/index.js'
import { getDIDManager } from '@/services/did/index.js'

export default {
  data() {
    return {
      incentiveManager: null,
      currentDid: '',
      loading: false,
      refreshing: false,

      // User data
      userLevel: {
        level: 1,
        exp: 0,
        next_level_exp: 100
      },
      tasks: [],
      milestones: [],
      history: [],

      // Stats
      stats: {
        points: 0,
        checkInDays: 0,
        completedTasks: 0,
        achievements: 0
      },

      // Tabs
      currentTab: 'tasks',
      tabs: [
        { label: '任务', value: 'tasks' },
        { label: '里程碑', value: 'milestones' },
        { label: '奖励', value: 'rewards' },
        { label: '历史', value: 'history' }
      ],

      // Available rewards
      availableRewards: [
        {
          id: 1,
          name: '经验加速卡',
          description: '1小时内经验获取翻倍',
          icon: '⚡',
          cost: 100
        },
        {
          id: 2,
          name: '幸运宝箱',
          description: '随机获得奖励',
          icon: '🎁',
          cost: 200
        },
        {
          id: 3,
          name: '专属头像框',
          description: '彰显身份的头像框',
          icon: '🖼️',
          cost: 500
        },
        {
          id: 4,
          name: '交易手续费减免',
          description: '减免10%交易手续费',
          icon: '💰',
          cost: 300
        }
      ]
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

        this.incentiveManager = createIncentiveManager(db, didManager, marketplace, creditScoreManager)

        await assetManager.initialize()
        await marketplace.initialize()
        await creditScoreManager.initialize()
        await this.incentiveManager.initialize()

        console.log('[UserCenterPage] 服务初始化成功')
      } catch (error) {
        console.error('[UserCenterPage] 服务初始化失败:', error)
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
          this.loadUserLevel(),
          this.loadTasks(),
          this.loadMilestones(),
          this.loadHistory(),
          this.loadStats()
        ])
      } catch (error) {
        console.error('[UserCenterPage] 加载数据失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    async loadUserLevel() {
      try {
        const level = await this.incentiveManager.getUserLevel(this.currentDid)
        this.userLevel = level
        console.log('[UserCenterPage] 用户等级:', level.level)
      } catch (error) {
        console.error('[UserCenterPage] 加载用户等级失败:', error)
        this.userLevel = { level: 1, exp: 0, next_level_exp: 100 }
      }
    },

    async loadTasks() {
      try {
        this.tasks = await this.incentiveManager.getTasks(this.currentDid)
        console.log('[UserCenterPage] 已加载任务:', this.tasks.length)
      } catch (error) {
        console.error('[UserCenterPage] 加载任务失败:', error)
        this.tasks = []
      }
    },

    async loadMilestones() {
      try {
        this.milestones = await this.incentiveManager.getMilestones(this.currentDid)
        console.log('[UserCenterPage] 已加载里程碑:', this.milestones.length)
      } catch (error) {
        console.error('[UserCenterPage] 加载里程碑失败:', error)
        this.milestones = []
      }
    },

    async loadHistory() {
      try {
        // Get level history (approximation)
        this.history = []
        console.log('[UserCenterPage] 已加载历史')
      } catch (error) {
        console.error('[UserCenterPage] 加载历史失败:', error)
        this.history = []
      }
    },

    async loadStats() {
      try {
        const checkInData = await this.incentiveManager.getCheckInStatus(this.currentDid)

        this.stats = {
          points: this.userLevel.points || 0,
          checkInDays: checkInData?.consecutive_days || 0,
          completedTasks: this.tasks.filter(t => t.is_completed).length,
          achievements: this.milestones.filter(m => m.is_unlocked).length
        }
      } catch (error) {
        console.error('[UserCenterPage] 加载统计失败:', error)
        this.stats = {
          points: 0,
          checkInDays: 0,
          completedTasks: 0,
          achievements: 0
        }
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

    switchTab(tab) {
      this.currentTab = tab
    },

    async handleCheckIn() {
      try {
        uni.showLoading({ title: '签到中...' })

        const result = await this.incentiveManager.checkIn(this.currentDid)

        uni.hideLoading()

        const message = `签到成功!\n连续签到 ${result.consecutiveDays} 天\n获得 ${result.rewardPoints} 积分`

        uni.showModal({
          title: '签到成功',
          content: message,
          showCancel: false
        })

        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[UserCenterPage] 签到失败:', error)
        uni.showToast({
          title: error.message || '签到失败',
          icon: 'none'
        })
      }
    },

    async handleCompleteTask(task) {
      try {
        uni.showLoading({ title: '领取中...' })

        await this.incentiveManager.completeTask(this.currentDid, task.id)

        uni.hideLoading()
        uni.showToast({
          title: `获得 ${task.reward_exp} EXP`,
          icon: 'success'
        })

        await this.loadData()
      } catch (error) {
        uni.hideLoading()
        console.error('[UserCenterPage] 完成任务失败:', error)
        uni.showToast({
          title: error.message || '领取失败',
          icon: 'none'
        })
      }
    },

    async handleRedeemReward(reward) {
      if (this.stats.points < reward.cost) {
        uni.showToast({
          title: '积分不足',
          icon: 'none'
        })
        return
      }

      uni.showModal({
        title: '确认兑换',
        content: `确定要花费 ${reward.cost} 积分兑换 ${reward.name} 吗？`,
        success: async (res) => {
          if (res.confirm) {
            try {
              uni.showLoading({ title: '兑换中...' })

              // TODO: Implement reward redemption logic
              // For now, just simulate
              await new Promise(resolve => setTimeout(resolve, 500))

              uni.hideLoading()
              uni.showToast({
                title: '兑换成功',
                icon: 'success'
              })

              await this.loadData()
            } catch (error) {
              uni.hideLoading()
              console.error('[UserCenterPage] 兑换失败:', error)
              uni.showToast({
                title: '兑换失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    getLevelProgress() {
      if (!this.userLevel.next_level_exp) return 0
      return Math.min((this.userLevel.exp / this.userLevel.next_level_exp) * 100, 100)
    },

    getTaskProgress(task) {
      if (!task.required_progress) return 0
      return Math.min((task.current_progress / task.required_progress) * 100, 100)
    },

    getMilestoneProgress(milestone) {
      if (!milestone.target_value) return 0
      return Math.min((milestone.current_value / milestone.target_value) * 100, 100)
    },

    getLevelName(level) {
      const levelNames = {
        1: '新手',
        2: '学徒',
        3: '熟练',
        4: '专家',
        5: '大师',
        6: '宗师',
        7: '传奇'
      }
      return levelNames[level] || '交易者'
    },

    getCurrentBenefits() {
      const benefits = {
        1: '基础交易',
        2: '手续费-5%',
        3: '手续费-10%',
        4: '优先客服',
        5: '专属徽章',
        6: 'VIP通道',
        7: '全部特权'
      }
      return benefits[this.userLevel.level] || '无'
    },

    getMilestoneIcon(milestone) {
      const icons = {
        trade_count: '🔄',
        trade_volume: '💰',
        continuous_days: '📅',
        profit_rate: '📈',
        follower_count: '👥',
        share_count: '📢'
      }
      return icons[milestone.category] || '🏆'
    },

    getHistoryTypeText(type) {
      const typeMap = {
        check_in: '每日签到',
        task_complete: '任务完成',
        trade: '交易奖励',
        level_up: '等级提升',
        milestone: '里程碑达成'
      }
      return typeMap[type] || type
    },

    getAvatarText(did) {
      if (!did) return '?'
      const parts = did.split(':')
      const lastPart = parts[parts.length - 1]
      return lastPart.substring(0, 1).toUpperCase()
    },

    formatTime(timestamp) {
      const date = new Date(timestamp)
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
.user-center-page {
  min-height: 100vh;
  background: #f5f7fa;
  padding-bottom: 32rpx;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 48rpx 32rpx 32rpx;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;

  .user-profile {
    display: flex;
    align-items: center;
    gap: 24rpx;

    .user-avatar {
      width: 96rpx;
      height: 96rpx;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 4rpx solid rgba(255, 255, 255, 0.5);

      .avatar-text {
        color: white;
        font-size: 40rpx;
        font-weight: bold;
      }
    }

    .user-details {
      .user-name {
        display: block;
        font-size: 32rpx;
        font-weight: bold;
        margin-bottom: 12rpx;
      }

      .user-level {
        display: flex;
        align-items: center;
        gap: 12rpx;

        .level-text {
          font-size: 28rpx;
          padding: 4rpx 16rpx;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 20rpx;
        }

        .level-name {
          font-size: 24rpx;
          opacity: 0.9;
        }
      }
    }
  }

  .check-in-btn {
    background: rgba(255, 255, 255, 0.2);
    padding: 16rpx 32rpx;
    border-radius: 40rpx;
    display: flex;
    align-items: center;
    gap: 8rpx;

    .check-in-icon {
      font-size: 28rpx;
    }

    .check-in-text {
      font-size: 28rpx;
    }
  }
}

.level-card {
  background: white;
  margin: -24rpx 32rpx 24rpx;
  padding: 32rpx;
  border-radius: 16rpx;
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.05);

  .level-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24rpx;

    .level-title {
      font-size: 32rpx;
      font-weight: bold;
      color: #333;
    }

    .level-subtitle {
      font-size: 24rpx;
      color: #667eea;
    }
  }

  .progress-bar-container {
    margin-bottom: 16rpx;

    .progress-bar {
      height: 16rpx;
      background: #f0f0f0;
      border-radius: 8rpx;
      overflow: hidden;
      margin-bottom: 12rpx;

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        border-radius: 8rpx;
        transition: width 0.3s;
      }
    }

    .progress-text {
      font-size: 24rpx;
      color: #999;
      display: block;
      text-align: right;
    }
  }

  .level-benefits {
    padding: 16rpx;
    background: #f0f4ff;
    border-radius: 8rpx;

    .benefits-text {
      font-size: 24rpx;
      color: #667eea;
    }
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;
  padding: 0 32rpx;
  margin-bottom: 24rpx;

  .stat-card {
    background: white;
    padding: 24rpx;
    border-radius: 12rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8rpx;

    .stat-value {
      font-size: 32rpx;
      font-weight: bold;
      color: #667eea;
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

.content-area {
  height: calc(100vh - 700rpx);
  padding: 0 32rpx;
}

.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 32rpx;

  .empty-icon {
    font-size: 80rpx;
    margin-bottom: 16rpx;
  }

  .empty-text {
    font-size: 28rpx;
    color: #999;
  }
}

/* Tasks */
.tasks-container {
  .task-card {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

    &.completed {
      opacity: 0.6;
    }

    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24rpx;

      .task-info {
        flex: 1;

        .task-title {
          display: block;
          font-size: 32rpx;
          font-weight: bold;
          color: #333;
          margin-bottom: 12rpx;
        }

        .task-description {
          display: block;
          font-size: 24rpx;
          color: #999;
          line-height: 1.5;
        }
      }

      .task-status {
        .status-completed {
          color: #52c41a;
          font-size: 24rpx;
        }

        .status-pending {
          color: #fa8c16;
          font-size: 24rpx;
        }
      }
    }

    .task-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .task-progress {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 12rpx;

        .progress-label {
          font-size: 24rpx;
          color: #999;
        }

        .mini-progress-bar {
          flex: 1;
          height: 8rpx;
          background: #f0f0f0;
          border-radius: 4rpx;
          overflow: hidden;

          .mini-progress-fill {
            height: 100%;
            background: #667eea;
            border-radius: 4rpx;
            transition: width 0.3s;
          }
        }

        .progress-value {
          font-size: 24rpx;
          color: #666;
        }
      }

      .task-rewards {
        display: flex;
        align-items: center;
        gap: 8rpx;

        .reward-icon {
          font-size: 28rpx;
        }

        .reward-text {
          font-size: 24rpx;
          color: #667eea;
          font-weight: bold;
        }
      }
    }

    .complete-btn {
      margin-top: 24rpx;
      padding: 16rpx;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 8rpx;
      text-align: center;

      .btn-text {
        font-size: 28rpx;
      }
    }
  }
}

/* Milestones */
.milestones-container {
  .milestone-card {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
    position: relative;

    &.unlocked {
      border: 2rpx solid #52c41a;
    }

    .milestone-header {
      display: flex;
      gap: 16rpx;
      margin-bottom: 24rpx;

      .milestone-icon {
        width: 64rpx;
        height: 64rpx;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;

        .icon-text {
          font-size: 32rpx;
        }
      }

      .milestone-info {
        flex: 1;

        .milestone-title {
          display: block;
          font-size: 32rpx;
          font-weight: bold;
          color: #333;
          margin-bottom: 8rpx;
        }

        .milestone-description {
          display: block;
          font-size: 24rpx;
          color: #999;
          line-height: 1.5;
        }
      }
    }

    .milestone-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .milestone-progress {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 16rpx;

        .mini-progress-bar {
          flex: 1;
          height: 8rpx;
          background: #f0f0f0;
          border-radius: 4rpx;
          overflow: hidden;

          .mini-progress-fill {
            height: 100%;
            background: #667eea;
            border-radius: 4rpx;
            transition: width 0.3s;
          }
        }

        .progress-text {
          font-size: 24rpx;
          color: #666;
        }
      }

      .milestone-rewards {
        .reward-text {
          font-size: 24rpx;
          color: #667eea;
          font-weight: bold;
        }
      }
    }

    .unlocked-badge {
      position: absolute;
      top: 16rpx;
      right: 16rpx;
      padding: 8rpx 16rpx;
      background: #52c41a;
      color: white;
      border-radius: 8rpx;

      .badge-text {
        font-size: 24rpx;
      }
    }
  }
}

/* Rewards */
.rewards-container {
  .rewards-balance {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
    text-align: center;

    .balance-label {
      display: block;
      font-size: 24rpx;
      color: #999;
      margin-bottom: 12rpx;
    }

    .balance-value {
      display: block;
      font-size: 48rpx;
      font-weight: bold;
      color: #667eea;
    }
  }

  .rewards-list {
    .reward-card {
      background: white;
      padding: 32rpx;
      border-radius: 16rpx;
      margin-bottom: 24rpx;
      box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

      .reward-info {
        display: flex;
        gap: 16rpx;
        margin-bottom: 24rpx;

        .reward-icon {
          font-size: 48rpx;
        }

        .reward-details {
          flex: 1;

          .reward-name {
            display: block;
            font-size: 32rpx;
            font-weight: bold;
            color: #333;
            margin-bottom: 8rpx;
          }

          .reward-description {
            display: block;
            font-size: 24rpx;
            color: #999;
            line-height: 1.5;
          }
        }
      }

      .reward-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .reward-cost {
          font-size: 28rpx;
          color: #667eea;
          font-weight: bold;
        }

        .redeem-btn {
          padding: 12rpx 32rpx;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: 40rpx;

          &.disabled {
            background: #f0f0f0;
            color: #999;
          }

          .btn-text {
            font-size: 24rpx;
          }
        }
      }
    }
  }
}

/* History */
.history-container {
  .history-card {
    background: white;
    padding: 32rpx;
    border-radius: 16rpx;
    margin-bottom: 24rpx;
    box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16rpx;

      .history-type {
        font-size: 28rpx;
        font-weight: bold;
        color: #333;
      }

      .history-time {
        font-size: 24rpx;
        color: #999;
      }
    }

    .history-content {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .history-description {
        font-size: 24rpx;
        color: #666;
      }

      .history-reward {
        font-size: 28rpx;
        font-weight: bold;
        color: #999;

        &.positive {
          color: #52c41a;
        }
      }
    }
  }
}
</style>
