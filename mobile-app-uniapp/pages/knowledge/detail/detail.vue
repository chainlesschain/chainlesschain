<template>
  <view class="detail-container">
    <view class="loading" v-if="loading">
      <text>加载中...</text>
    </view>

    <view class="error" v-else-if="error">
      <text class="error-icon">⚠️</text>
      <text class="error-text">{{ error }}</text>
      <button class="back-btn" @click="goBack">返回</button>
    </view>

    <view class="content" v-else-if="item">
      <view class="header">
        <text class="title">{{ item.title }}</text>
        <view class="meta">
          <text class="type-tag" :class="'type-' + item.type">
            {{ getTypeLabel(item.type) }}
          </text>
          <text class="time">{{ formatTime(item.updated_at) }}</text>
        </view>
      </view>

      <view class="body">
        <text class="text-content">{{ item.content }}</text>
      </view>

      <view class="actions">
        <button class="action-btn edit-btn" @click="goToEdit">
          <text>✏️ 编辑</text>
        </button>
        <button class="action-btn delete-btn" @click="handleDelete">
          <text>🗑️ 删除</text>
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      id: '',
      item: null,
      loading: false,
      error: null
    }
  },
  onLoad(options) {
    if (options.id) {
      this.id = options.id
      this.loadItem()
    } else {
      this.error = '缺少知识条目 ID'
    }
  },
  methods: {
    async loadItem() {
      this.loading = true
      this.error = null

      try {
        const item = await db.getKnowledgeItem(this.id)
        if (item) {
          this.item = item
        } else {
          this.error = '未找到该知识条目'
        }
      } catch (error) {
        console.error('加载知识详情失败:', error)
        this.error = '加载失败，请重试'
      } finally {
        this.loading = false
      }
    },
    getTypeLabel(type) {
      const labels = {
        note: '笔记',
        document: '文档',
        conversation: '对话',
        web_clip: '网页摘录',
        image: '图片'
      }
      return labels[type] || type
    },
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      const minute = String(date.getMinutes()).padStart(2, '0')
      return `${year}-${month}-${day} ${hour}:${minute}`
    },
    goToEdit() {
      uni.navigateTo({
        url: `/pages/knowledge/edit/edit?id=${this.id}`
      })
    },
    handleDelete() {
      uni.showModal({
        title: '确认删除',
        content: '删除后无法恢复，确定要删除这条知识吗？',
        success: async (res) => {
          if (res.confirm) {
            try {
              await db.deleteKnowledgeItem(this.id)
              uni.showToast({
                title: '删除成功',
                icon: 'success'
              })
              setTimeout(() => {
                uni.navigateBack()
              }, 1000)
            } catch (error) {
              console.error('删除失败:', error)
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },
    goBack() {
      uni.navigateBack()
    }
  }
}
</script>

<style lang="scss" scoped>
.detail-container {
  min-height: 100vh;
  background-color: var(--bg-page);
}

.loading, .error {
  padding: 100rpx 40rpx;
  text-align: center;
  color: var(--text-tertiary);
}

.error {
  .error-icon {
    display: block;
    font-size: 100rpx;
    margin-bottom: 20rpx;
  }

  .error-text {
    display: block;
    font-size: 28rpx;
    color: var(--text-secondary);
    margin-bottom: 40rpx;
  }

  .back-btn {
    width: 300rpx;
    height: 80rpx;
    line-height: 80rpx;
    background-color: var(--color-primary);
    color: var(--bg-card);
    border-radius: 40rpx;
    font-size: 28rpx;
    border: none;
  }
}

.content {
  .header {
    background-color: var(--bg-card);
    padding: 40rpx;
    margin-bottom: 20rpx;

    .title {
      display: block;
      font-size: 40rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 20rpx;
      line-height: 1.4;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 20rpx;

      .type-tag {
        padding: 8rpx 20rpx;
        background-color: var(--bg-hover);
        color: var(--text-secondary);
        font-size: 24rpx;
        border-radius: 8rpx;

        &.type-note {
          background-color: #e6f7ff;
          color: var(--color-info);
        }

        &.type-document {
          background-color: #f6ffed;
          color: var(--color-success);
        }

        &.type-conversation {
          background-color: #fff7e6;
          color: var(--color-warning);
        }
      }

      .time {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }
  }

  .body {
    background-color: var(--bg-card);
    padding: 40rpx;
    margin-bottom: 20rpx;
    min-height: 400rpx;

    .text-content {
      font-size: 30rpx;
      color: var(--text-primary);
      line-height: 1.8;
      white-space: pre-wrap;
    }
  }

  .actions {
    padding: 40rpx;
    display: flex;
    gap: 20rpx;

    .action-btn {
      flex: 1;
      height: 88rpx;
      border-radius: 44rpx;
      font-size: 30rpx;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;

      &.edit-btn {
        background-color: var(--color-info);
        color: var(--bg-card);
      }

      &.delete-btn {
        background-color: var(--color-error);
        color: var(--bg-card);
      }
    }
  }
}
</style>
