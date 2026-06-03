<template>
  <view class="container">
    <!-- 页面标题 -->
    <view class="page-header">
      <text class="page-title">{{ fileName }}</text>
    </view>

    <!-- 加载状态 -->
    <view v-if="loading" class="loading-container">
      <text class="loading-text">正在加载文件...</text>
    </view>

    <!-- 文件内容 -->
    <view v-else-if="fileData" class="content-wrapper">
      <!-- 文件信息卡片 -->
      <view class="info-card">
        <view class="info-row">
          <text class="info-label">文件路径</text>
          <text class="info-value path">{{ fileData.filePath }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">文件大小</text>
          <text class="info-value">{{ formatSize(fileData.size) }}</text>
        </view>
        <view class="info-row">
          <text class="info-label">修改时间</text>
          <text class="info-value">{{ formatTime(fileData.modifiedAt) }}</text>
        </view>
      </view>

      <!-- 操作按钮 -->
      <view class="actions">
        <view class="action-button" @tap="copyContent">
          <text class="action-icon">📋</text>
          <text class="action-text">复制</text>
        </view>
        <view class="action-button" @tap="downloadFile">
          <text class="action-icon">💾</text>
          <text class="action-text">下载</text>
        </view>
        <view class="action-button secondary" @tap="toggleHighlight">
          <text class="action-icon">{{ enableHighlight ? '🎨' : '📝' }}</text>
          <text class="action-text">{{ enableHighlight ? '高亮' : '纯文本' }}</text>
        </view>
      </view>

      <!-- 文件内容 -->
      <view class="file-content-wrapper">
        <view class="content-header">
          <text class="content-title">文件内容</text>
          <text class="line-count">{{ lineCount }} 行</text>
        </view>

        <scroll-view class="file-content" scroll-y>
          <view class="code-container">
            <view
              v-for="(line, index) in contentLines"
              :key="index"
              class="code-line"
            >
              <text class="line-number">{{ index + 1 }}</text>
              <view class="line-content">
                <text
                  v-for="(token, tokenIndex) in line"
                  :key="tokenIndex"
                  :style="{ color: token.color }"
                  class="token"
                >{{ token.value }}</text>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 错误状态 -->
    <view v-else class="empty-container">
      <text class="empty-icon">⚠️</text>
      <text class="empty-text">加载失败</text>
    </view>
  </view>
</template>

<script>
import projectService from '@/services/p2p/project-service.js'
import syntaxHighlighter from '@/utils/syntax-highlighter.js'

export default {
  data() {
    return {
      // URL参数
      projectId: '',
      peerId: '',
      filePath: '',
      fileName: '',

      // 文件数据
      fileData: null,

      // 状态
      loading: false,

      // 语法高亮开关
      enableHighlight: true
    }
  },

  computed: {
    /**
     * 文件内容按行分割（带语法高亮）
     */
    contentLines() {
      if (!this.fileData || !this.fileData.content) {
        return []
      }

      if (this.enableHighlight) {
        // 使用语法高亮
        return syntaxHighlighter.highlight(this.fileData.content, this.fileName)
      } else {
        // 纯文本显示
        return this.fileData.content.split('\n').map(line => [{
          type: 'text',
          value: line,
          color: '#abb2bf'
        }])
      }
    },

    /**
     * 行数
     */
    lineCount() {
      return this.contentLines.length
    }
  },

  onLoad(options) {
    this.projectId = options.projectId
    this.peerId = options.peerId
    this.filePath = decodeURIComponent(options.filePath || '')
    this.fileName = decodeURIComponent(options.fileName || '')

    // 加载文件内容
    this.loadFile()
  },

  methods: {
    /**
     * 加载文件内容
     */
    async loadFile() {
      this.loading = true

      try {
        this.fileData = await projectService.getFile(
          this.peerId,
          this.projectId,
          this.filePath
        )
      } catch (error) {
        console.error('加载文件内容失败:', error)
        uni.showToast({
          title: error.message || '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 复制文件内容
     */
    copyContent() {
      if (!this.fileData || !this.fileData.content) {
        return
      }

      uni.setClipboardData({
        data: this.fileData.content,
        success: () => {
          uni.showToast({
            title: '已复制到剪贴板',
            icon: 'success'
          })
        },
        fail: () => {
          uni.showToast({
            title: '复制失败',
            icon: 'none'
          })
        }
      })
    },

    /**
     * 下载文件到本地
     */
    downloadFile() {
      if (!this.fileData || !this.fileData.content) {
        return
      }

      uni.showLoading({
        title: '正在保存...'
      })

      // 在小程序中使用文件系统API保存文件
      const fs = uni.getFileSystemManager()
      const fileName = this.fileName || 'file.txt'
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`

      try {
        fs.writeFile({
          filePath,
          data: this.fileData.content,
          encoding: 'utf8',
          success: () => {
            uni.hideLoading()
            uni.showToast({
              title: '文件已保存',
              icon: 'success'
            })

            // 提示用户文件位置
            setTimeout(() => {
              uni.showModal({
                title: '文件已保存',
                content: `文件已保存到本地：\n${fileName}\n\n您可以在"文件管理"中查看`,
                showCancel: false
              })
            }, 1500)
          },
          fail: (error) => {
            uni.hideLoading()
            console.error('保存文件失败:', error)
            uni.showToast({
              title: '保存失败',
              icon: 'none'
            })
          }
        })
      } catch (error) {
        uni.hideLoading()
        console.error('保存文件失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      }
    },

    /**
     * 切换语法高亮
     */
    toggleHighlight() {
      this.enableHighlight = !this.enableHighlight
      uni.showToast({
        title: this.enableHighlight ? '已开启语法高亮' : '已关闭语法高亮',
        icon: 'none'
      })
    },

    /**
     * 格式化文件大小
     */
    formatSize(bytes) {
      if (!bytes) return '0 B'

      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))

      return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return '未知'

      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }
  }
}
</script>

<style scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  display: flex;
  flex-direction: column;
}

/* 页面标题 */
.page-header {
  background-color: #fff;
  padding: 24rpx 32rpx;
  border-bottom: 1px solid #eee;
}

.page-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 加载状态 */
.loading-container {
  padding: 120rpx 0;
  text-align: center;
}

.loading-text {
  font-size: 28rpx;
  color: #999;
}

/* 空状态 */
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 0;
}

.empty-icon {
  font-size: 120rpx;
  margin-bottom: 24rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

/* 内容区域 */
.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24rpx 32rpx;
}

/* 文件信息 */
.info-card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20rpx;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  font-size: 26rpx;
  color: #999;
  flex-shrink: 0;
  width: 150rpx;
}

.info-value {
  font-size: 26rpx;
  color: #333;
  flex: 1;
  text-align: right;
  word-break: break-all;
}

.info-value.path {
  color: #667eea;
  font-size: 24rpx;
}

/* 操作按钮 */
.actions {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.action-button {
  flex: 1;
  height: 80rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}

.action-button.secondary {
  background: linear-gradient(135deg, #56b6c2 0%, #61afef 100%);
}

.action-button:active {
  opacity: 0.8;
}

.action-icon {
  font-size: 32rpx;
}

.action-text {
  font-size: 28rpx;
  color: #fff;
  font-weight: 500;
}

/* 文件内容 */
.file-content-wrapper {
  flex: 1;
  background-color: #fff;
  border-radius: 16rpx;
  overflow: hidden;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 32rpx;
  border-bottom: 1px solid #f0f0f0;
  background-color: #fafafa;
}

.content-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #333;
}

.line-count {
  font-size: 24rpx;
  color: #999;
}

.file-content {
  flex: 1;
  background-color: #282c34;
}

.code-container {
  padding: 24rpx 0;
}

.code-line {
  display: flex;
  min-height: 44rpx;
  line-height: 44rpx;
}

.line-number {
  width: 96rpx;
  text-align: right;
  padding-right: 24rpx;
  font-size: 24rpx;
  color: #5c6370;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  user-select: none;
  flex-shrink: 0;
}

.line-content {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  font-size: 26rpx;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  padding-right: 32rpx;
  line-height: 44rpx;
}

.token {
  font-size: 26rpx;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  white-space: pre;
}
</style>
