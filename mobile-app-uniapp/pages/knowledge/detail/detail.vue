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
        <button class="action-btn share-btn" @click="showShareModal = true">
          <text>📤 分享</text>
        </button>
        <button class="action-btn edit-btn" @click="goToEdit">
          <text>✏️ 编辑</text>
        </button>
        <button class="action-btn delete-btn" @click="handleDelete">
          <text>🗑️ 删除</text>
        </button>
      </view>
    </view>

    <!-- 分享弹窗 -->
    <view class="modal" v-if="showShareModal" @click="showShareModal = false">
      <view class="modal-content share-modal" @click.stop>
        <text class="modal-title">分享知识</text>

        <view class="share-options">
          <view class="share-option" @click="copyAsText">
            <view class="option-icon">📋</view>
            <text class="option-label">复制文本</text>
          </view>

          <view class="share-option" @click="copyAsMarkdown">
            <view class="option-icon">📝</view>
            <text class="option-label">复制Markdown</text>
          </view>

          <view class="share-option" @click="exportAsFile">
            <view class="option-icon">💾</view>
            <text class="option-label">导出文件</text>
          </view>

          <view class="share-option" @click="shareToSocial">
            <view class="option-icon">🔗</view>
            <text class="option-label">分享到...</text>
          </view>
        </view>

        <button class="modal-close" @click="showShareModal = false">
          <text>取消</text>
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
      error: null,
      showShareModal: false
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
    },

    /**
     * 复制为纯文本
     */
    copyAsText() {
      if (!this.item) return

      const text = `${this.item.title}\n\n${this.item.content}`

      uni.setClipboardData({
        data: text,
        success: () => {
          uni.showToast({
            title: '已复制到剪贴板',
            icon: 'success'
          })
          this.showShareModal = false
        },
        fail: (err) => {
          console.error('复制失败:', err)
          uni.showToast({
            title: '复制失败',
            icon: 'none'
          })
        }
      })
    },

    /**
     * 复制为Markdown格式
     */
    async copyAsMarkdown() {
      if (!this.item) return

      try {
        // 获取标签
        const tags = await db.getKnowledgeTags(this.id)
        const tagText = tags && tags.length > 0
          ? tags.map(tag => `#${tag.name}`).join(' ')
          : ''

        // 生成Markdown格式
        let markdown = `# ${this.item.title}\n\n`

        // 添加元数据
        markdown += `**类型**: ${this.getTypeLabel(this.item.type)}\n`
        markdown += `**更新时间**: ${this.formatTime(this.item.updated_at)}\n`

        if (tagText) {
          markdown += `**标签**: ${tagText}\n`
        }

        markdown += `\n---\n\n`
        markdown += `${this.item.content}\n`

        // 添加底部标识
        markdown += `\n---\n`
        markdown += `*导出自 ChainlessChain 知识库*\n`

        uni.setClipboardData({
          data: markdown,
          success: () => {
            uni.showToast({
              title: 'Markdown已复制',
              icon: 'success'
            })
            this.showShareModal = false
          },
          fail: (err) => {
            console.error('复制失败:', err)
            uni.showToast({
              title: '复制失败',
              icon: 'none'
            })
          }
        })
      } catch (error) {
        console.error('生成Markdown失败:', error)
        uni.showToast({
          title: '生成失败',
          icon: 'none'
        })
      }
    },

    /**
     * 导出为文件
     */
    async exportAsFile() {
      if (!this.item) return

      try {
        // 获取标签
        const tags = await db.getKnowledgeTags(this.id)
        const tagText = tags && tags.length > 0
          ? tags.map(tag => `#${tag.name}`).join(' ')
          : ''

        // 生成Markdown内容
        let content = `# ${this.item.title}\n\n`
        content += `**类型**: ${this.getTypeLabel(this.item.type)}\n`
        content += `**更新时间**: ${this.formatTime(this.item.updated_at)}\n`
        if (tagText) {
          content += `**标签**: ${tagText}\n`
        }
        content += `\n---\n\n`
        content += `${this.item.content}\n`
        content += `\n---\n`
        content += `*导出自 ChainlessChain 知识库*\n`

        // 生成文件名（移除特殊字符）
        const safeTitle = this.item.title.replace(/[^\w\u4e00-\u9fa5]/g, '_').substring(0, 50)
        const fileName = `${safeTitle}.md`

        // #ifdef H5
        // H5环境：创建下载链接
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)

        uni.showToast({
          title: '文件已下载',
          icon: 'success'
        })
        this.showShareModal = false
        // #endif

        // #ifndef H5
        // App环境：保存到本地文件系统
        // 注意：需要在 manifest.json 中配置文件权限
        const fs = uni.getFileSystemManager()
        const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`

        fs.writeFile({
          filePath: filePath,
          data: content,
          encoding: 'utf8',
          success: () => {
            uni.showModal({
              title: '导出成功',
              content: `文件已保存到：${filePath}`,
              showCancel: false,
              success: () => {
                this.showShareModal = false
              }
            })
          },
          fail: (err) => {
            console.error('保存文件失败:', err)
            // 降级：复制到剪贴板
            uni.setClipboardData({
              data: content,
              success: () => {
                uni.showToast({
                  title: '内容已复制到剪贴板',
                  icon: 'success'
                })
                this.showShareModal = false
              }
            })
          }
        })
        // #endif
      } catch (error) {
        console.error('导出文件失败:', error)
        uni.showToast({
          title: '导出失败',
          icon: 'none'
        })
      }
    },

    /**
     * 分享到社交平台
     */
    shareToSocial() {
      if (!this.item) return

      const shareContent = {
        title: this.item.title,
        summary: this.item.content.substring(0, 100) + (this.item.content.length > 100 ? '...' : ''),
        href: '' // 可以是应用的分享链接
      }

      // #ifdef APP-PLUS
      // App环境：使用原生分享
      uni.share({
        provider: 'weixin',
        scene: 'WXSceneSession',
        type: 1,
        title: shareContent.title,
        summary: shareContent.summary,
        success: () => {
          uni.showToast({
            title: '分享成功',
            icon: 'success'
          })
          this.showShareModal = false
        },
        fail: (err) => {
          console.error('分享失败:', err)
          // 降级：复制到剪贴板
          this.copyAsText()
        }
      })
      // #endif

      // #ifdef H5
      // H5环境：使用Web Share API（如果支持）
      if (navigator.share) {
        navigator.share({
          title: shareContent.title,
          text: shareContent.summary
        })
          .then(() => {
            uni.showToast({
              title: '分享成功',
              icon: 'success'
            })
            this.showShareModal = false
          })
          .catch((err) => {
            console.error('分享失败:', err)
            // 降级：复制到剪贴板
            this.copyAsText()
          })
      } else {
        // 不支持Web Share API，降级为复制
        uni.showModal({
          title: '提示',
          content: '当前环境不支持直接分享，是否复制内容到剪贴板？',
          success: (res) => {
            if (res.confirm) {
              this.copyAsText()
            }
          }
        })
      }
      // #endif

      // #ifdef MP-WEIXIN
      // 微信小程序环境：引导用户使用转发功能
      uni.showModal({
        title: '提示',
        content: '请点击右上角的"..."按钮，选择"转发"分享给好友',
        showCancel: false
      })
      // #endif
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

      &.share-btn {
        background-color: var(--color-success);
        color: var(--text-inverse);
      }

      &.edit-btn {
        background-color: var(--color-info);
        color: var(--text-inverse);
      }

      &.delete-btn {
        background-color: var(--color-error);
        color: var(--text-inverse);
      }
    }
  }
}

// 分享弹窗
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 100%;
    background-color: var(--bg-card);
    border-radius: 32rpx 32rpx 0 0;
    padding: 40rpx;
    animation: slideUp 0.3s ease-out;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .share-options {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 32rpx;
      margin-bottom: 32rpx;

      .share-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16rpx;
        cursor: pointer;
        transition: transform 0.2s;

        &:active {
          transform: scale(0.95);
        }

        .option-icon {
          width: 120rpx;
          height: 120rpx;
          background-color: var(--bg-input);
          border-radius: 24rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 56rpx;
          transition: background-color 0.2s;

          &:active {
            background-color: var(--bg-hover);
          }
        }

        .option-label {
          font-size: 24rpx;
          color: var(--text-secondary);
          text-align: center;
        }
      }
    }

    .modal-close {
      width: 100%;
      height: 88rpx;
      background-color: var(--bg-input);
      color: var(--text-primary);
      border-radius: 44rpx;
      font-size: 30rpx;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;

      &::after {
        border: none;
      }
    }
  }
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
