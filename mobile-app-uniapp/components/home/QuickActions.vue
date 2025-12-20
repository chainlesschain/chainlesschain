<template>
  <view class="quick-actions">
    <view class="action-grid">
      <view class="action-item" @click="goToKnowledge">
        <view class="action-icon knowledge">
          <text class="icon-emoji">📚</text>
        </view>
        <text class="action-label">知识库</text>
      </view>

      <view class="action-item" @click="goToChat">
        <view class="action-icon chat">
          <text class="icon-emoji">🤖</text>
        </view>
        <text class="action-label">AI助手</text>
      </view>

      <view class="action-item" @click="goToFolders">
        <view class="action-icon folder">
          <text class="icon-emoji">📁</text>
        </view>
        <text class="action-label">文件夹</text>
      </view>

      <view class="action-item" @click="goToStatistics">
        <view class="action-icon stats">
          <text class="icon-emoji">📊</text>
        </view>
        <text class="action-label">统计</text>
      </view>

      <view class="action-item" @click="goToSocial">
        <view class="action-icon social">
          <text class="icon-emoji">👥</text>
        </view>
        <text class="action-label">社交</text>
      </view>

      <view class="action-item" @click="goToMarket">
        <view class="action-icon market">
          <text class="icon-emoji">💰</text>
        </view>
        <text class="action-label">交易</text>
      </view>

      <view class="action-item" @click="goToBackup">
        <view class="action-icon backup">
          <text class="icon-emoji">☁️</text>
        </view>
        <text class="action-label">备份</text>
      </view>

      <view class="action-item" @click="goToImportExport">
        <view class="action-icon import">
          <text class="icon-emoji">📦</text>
        </view>
        <text class="action-label">导入导出</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  methods: {
    goToKnowledge() {
      uni.switchTab({
        url: '/pages/knowledge/list/list'
      })
    },

    goToChat() {
      uni.navigateTo({
        url: '/pages/chat/chat'
      })
    },

    goToFolders() {
      uni.navigateTo({
        url: '/pages/knowledge/folders/folders'
      })
    },

    goToStatistics() {
      uni.navigateTo({
        url: '/pages/knowledge/statistics/statistics'
      })
    },

    goToSocial() {
      uni.navigateTo({
        url: '/pages/social/friends/friends'
      })
    },

    goToMarket() {
      uni.navigateTo({
        url: '/pages/trade/market/market'
      })
    },

    goToBackup() {
      uni.navigateTo({
        url: '/pages/backup/backup'
      })
    },

    goToImportExport() {
      uni.navigateTo({
        url: '/pages/knowledge/import-export/import-export'
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.quick-actions {
  .action-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 28rpx;
    row-gap: 36rpx;

    .action-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12rpx;
      cursor: pointer;
      transition: transform 0.2s ease;

      &:active {
        transform: scale(0.95);
      }

      .action-icon {
        width: 100rpx;
        height: 100rpx;
        border-radius: 24rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;

        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: inherit;
          filter: brightness(1.1);
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        &:active::before {
          opacity: 1;
        }

        .icon-emoji {
          font-size: 48rpx;
          position: relative;
          z-index: 1;
        }

        // 知识库 - 紫色渐变
        &.knowledge {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        // AI助手 - 粉红渐变
        &.chat {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }

        // 文件夹 - 蓝色渐变
        &.folder {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }

        // 统计 - 绿色渐变
        &.stats {
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        }

        // 社交 - 橙粉渐变
        &.social {
          background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
        }

        // 交易 - 深蓝渐变
        &.market {
          background: linear-gradient(135deg, #30cfd0 0%, #330867 100%);
        }

        // 备份 - 淡蓝粉渐变
        &.backup {
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
        }

        // 导入导出 - 紫粉渐变
        &.import {
          background: linear-gradient(135deg, #d299c2 0%, #fef9d7 100%);
        }
      }

      .action-label {
        font-size: 24rpx;
        color: var(--text-secondary);
        text-align: center;
        font-weight: 500;
        letter-spacing: 0.5rpx;
      }
    }
  }
}
</style>
