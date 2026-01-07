<template>
  <view class="note-detail-container">
    <!-- 头部 -->
    <view class="header">
      <button class="btn-back" @tap="goBack">
        <text class="icon-back">←</text>
      </button>
      <view class="header-info">
        <text class="header-device">{{ deviceName }}</text>
      </view>
      <button class="btn-action" @tap="showActionSheet">
        <text class="icon-more">⋯</text>
      </button>
    </view>

    <!-- 加载状态 -->
    <view class="loading-container" v-if="loading">
      <view class="loading-icon"></view>
      <text class="loading-text">加载中...</text>
    </view>

    <!-- 错误状态 -->
    <view class="error-container" v-else-if="error">
      <text class="error-icon">❌</text>
      <text class="error-text">{{ errorMessage }}</text>
      <button class="btn-retry" @tap="loadNote">重试</button>
    </view>

    <!-- 笔记内容 -->
    <scroll-view class="content" scroll-y v-else-if="note">
      <!-- 笔记头部信息 -->
      <view class="note-header">
        <text class="note-title">{{ note.title }}</text>
        <view class="note-meta">
          <text class="meta-item">
            <text class="meta-icon">📅</text>
            <text class="meta-text">创建于 {{ formatDateTime(note.created_at) }}</text>
          </text>
          <text class="meta-item">
            <text class="meta-icon">🔄</text>
            <text class="meta-text">更新于 {{ formatDateTime(note.updated_at) }}</text>
          </text>
        </view>
        <view class="note-tags" v-if="note.tags && note.tags.length > 0">
          <view class="tag-item" v-for="tag in note.tags" :key="tag">
            <text class="tag-text">{{ tag }}</text>
          </view>
        </view>
      </view>

      <!-- 分割线 -->
      <view class="divider"></view>

      <!-- Markdown内容渲染 -->
      <view class="note-content">
        <!-- 使用mp-html渲染Markdown -->
        <mp-html
          :content="renderedContent"
          :selectable="true"
          :lazy-load="true"
          @linktap="handleLinkTap"
        />
      </view>

      <!-- 底部信息 -->
      <view class="note-footer">
        <view class="footer-item">
          <text class="footer-label">字数统计</text>
          <text class="footer-value">{{ contentLength }} 字</text>
        </view>
        <view class="footer-item" v-if="note.folder_id">
          <text class="footer-label">所属文件夹</text>
          <text class="footer-value">{{ note.folder_name || '未知' }}</text>
        </view>
      </view>
    </scroll-view>

  </view>
</template>

<script>
import { getP2PKnowledgeService } from '@/services/p2p/knowledge-service'
import mpHtml from 'mp-html/dist/uni-app/components/mp-html/mp-html'

export default {
  components: {
    mpHtml
  },

  data() {
    return {
      peerId: '',
      noteId: '',
      deviceName: 'PC设备',

      // 笔记数据
      note: null,

      // 知识库服务
      knowledgeService: null,

      // 状态
      loading: true,
      error: false,
      errorMessage: ''
    }
  },

  computed: {
    /**
     * 渲染后的Markdown内容
     */
    renderedContent() {
      if (!this.note || !this.note.content) {
        return '<p>暂无内容</p>'
      }

      // 将Markdown转换为HTML
      return this.markdownToHtml(this.note.content)
    },

    /**
     * 内容字数
     */
    contentLength() {
      if (!this.note || !this.note.content) {
        return 0
      }
      return this.note.content.length
    }
  },

  async onLoad(options) {
    this.peerId = options.peerId || ''
    this.noteId = options.noteId || ''
    this.deviceName = decodeURIComponent(options.deviceName || 'PC设备')

    if (!this.peerId || !this.noteId) {
      this.error = true
      this.errorMessage = '缺少必要参数'
      this.loading = false
      return
    }

    await this.initService()
    await this.loadNote()
  },

  onUnload() {
    if (this.knowledgeService) {
      // 清理不需要，服务是单例
    }
  },

  methods: {
    /**
     * 初始化服务
     */
    async initService() {
      try {
        this.knowledgeService = getP2PKnowledgeService()
        // 服务已经在knowledge-list页面初始化过了
        console.log('[NoteDetail] 服务初始化成功')
      } catch (error) {
        console.error('[NoteDetail] 服务初始化失败:', error)
        this.error = true
        this.errorMessage = '服务初始化失败'
      }
    },

    /**
     * 加载笔记
     */
    async loadNote() {
      try {
        this.loading = true
        this.error = false

        const data = await this.knowledgeService.getNote(this.peerId, this.noteId)
        this.note = data.note

        console.log('[NoteDetail] 笔记加载成功:', this.note.title)
      } catch (error) {
        console.error('[NoteDetail] 加载笔记失败:', error)
        this.error = true
        this.errorMessage = error.message || '加载失败'

        uni.showToast({
          title: this.errorMessage,
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 简单的Markdown转HTML
     * 注意：这是一个简化版本，生产环境建议使用marked或markdown-it库
     */
    markdownToHtml(markdown) {
      if (!markdown) return ''

      let html = markdown

      // 处理代码块
      html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang || 'text'}">${this.escapeHtml(code)}</code></pre>`
      })

      // 处理行内代码
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

      // 处理标题
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

      // 处理粗体
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')

      // 处理斜体
      html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
      html = html.replace(/_(.+?)_/g, '<em>$1</em>')

      // 处理删除线
      html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

      // 处理链接
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

      // 处理图片
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

      // 处理无序列表
      html = html.replace(/^\* (.+)$/gm, '<li>$1</li>')
      html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
      html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')

      // 处理有序列表
      html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

      // 处理引用
      html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

      // 处理分割线
      html = html.replace(/^---$/gm, '<hr />')
      html = html.replace(/^\*\*\*$/gm, '<hr />')

      // 处理换行
      html = html.replace(/\n\n/g, '</p><p>')
      html = html.replace(/\n/g, '<br />')

      // 包装在段落中
      if (!html.startsWith('<')) {
        html = '<p>' + html + '</p>'
      }

      // 添加样式
      html = `
        <div class="markdown-body">
          ${html}
        </div>
        <style>
          .markdown-body {
            font-size: 30rpx;
            line-height: 1.8;
            color: #333;
          }
          .markdown-body h1 {
            font-size: 44rpx;
            font-weight: bold;
            margin: 40rpx 0 20rpx;
            padding-bottom: 15rpx;
            border-bottom: 2rpx solid #eee;
          }
          .markdown-body h2 {
            font-size: 38rpx;
            font-weight: bold;
            margin: 35rpx 0 18rpx;
            padding-bottom: 12rpx;
            border-bottom: 1rpx solid #eee;
          }
          .markdown-body h3 {
            font-size: 34rpx;
            font-weight: bold;
            margin: 30rpx 0 15rpx;
          }
          .markdown-body p {
            margin: 20rpx 0;
          }
          .markdown-body strong {
            font-weight: bold;
            color: #000;
          }
          .markdown-body em {
            font-style: italic;
          }
          .markdown-body del {
            text-decoration: line-through;
            color: #999;
          }
          .markdown-body a {
            color: #1890ff;
            text-decoration: underline;
          }
          .markdown-body code {
            padding: 4rpx 8rpx;
            background-color: #f5f5f5;
            border-radius: 6rpx;
            font-family: monospace;
            font-size: 26rpx;
            color: #e96900;
          }
          .markdown-body pre {
            padding: 20rpx;
            background-color: #f5f5f5;
            border-radius: 8rpx;
            overflow-x: auto;
            margin: 20rpx 0;
          }
          .markdown-body pre code {
            padding: 0;
            background-color: transparent;
            color: #333;
          }
          .markdown-body ul, .markdown-body ol {
            padding-left: 40rpx;
            margin: 20rpx 0;
          }
          .markdown-body li {
            margin: 10rpx 0;
          }
          .markdown-body blockquote {
            padding: 20rpx;
            margin: 20rpx 0;
            border-left: 6rpx solid #1890ff;
            background-color: #f0f5ff;
            color: #666;
          }
          .markdown-body hr {
            border: none;
            border-top: 2rpx solid #eee;
            margin: 30rpx 0;
          }
          .markdown-body img {
            max-width: 100%;
            height: auto;
            border-radius: 8rpx;
            margin: 20rpx 0;
          }
        </style>
      `

      return html
    },

    /**
     * HTML转义
     */
    escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }
      return text.replace(/[&<>"']/g, m => map[m])
    },

    /**
     * 处理链接点击
     */
    handleLinkTap(e) {
      const href = e.detail.href
      console.log('[NoteDetail] 链接点击:', href)

      // 复制链接到剪贴板
      uni.setClipboardData({
        data: href,
        success: () => {
          uni.showToast({
            title: '链接已复制',
            icon: 'success'
          })
        }
      })
    },

    /**
     * 显示操作菜单
     */
    showActionSheet() {
      uni.showActionSheet({
        itemList: ['📋 复制内容', '📤 分享笔记', '🔄 刷新'],
        success: (res) => {
          switch (res.tapIndex) {
            case 0:
              this.copyContent()
              break
            case 1:
              this.shareNote()
              break
            case 2:
              this.refreshNote()
              break
          }
        }
      })
    },

    /**
     * 复制内容
     */
    copyContent() {
      if (!this.note || !this.note.content) {
        uni.showToast({
          title: '暂无内容',
          icon: 'none'
        })
        return
      }

      uni.setClipboardData({
        data: this.note.content,
        success: () => {
          uni.showToast({
            title: '内容已复制',
            icon: 'success'
          })
        }
      })
    },

    /**
     * 分享笔记
     */
    shareNote() {
      if (!this.note) return

      // 简单分享：复制标题和内容
      const shareText = `${this.note.title}\n\n${this.note.content}`

      uni.setClipboardData({
        data: shareText,
        success: () => {
          uni.showToast({
            title: '已复制到剪贴板',
            icon: 'success'
          })
        }
      })
    },

    /**
     * 刷新笔记
     */
    async refreshNote() {
      await this.loadNote()
      uni.showToast({
        title: '刷新成功',
        icon: 'success'
      })
    },

    /**
     * 返回
     */
    goBack() {
      uni.navigateBack()
    },

    /**
     * 格式化日期时间
     */
    formatDateTime(timestamp) {
      if (!timestamp) return ''

      const date = new Date(timestamp)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')

      return `${year}-${month}-${day} ${hours}:${minutes}`
    }
  }
}
</script>

<style scoped>
.note-detail-container {
  min-height: 100vh;
  background-color: #f5f5f5;
  display: flex;
  flex-direction: column;
}

/* 头部 */
.header {
  display: flex;
  align-items: center;
  padding: 20rpx 30rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #e8e8e8;
}

.btn-back,
.btn-action {
  width: 70rpx;
  height: 70rpx;
  border-radius: 35rpx;
  background-color: #f5f5f5;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.icon-back,
.icon-more {
  font-size: 36rpx;
  color: #333;
}

.header-info {
  flex: 1;
  text-align: center;
  padding: 0 20rpx;
}

.header-device {
  font-size: 26rpx;
  color: #999;
}

/* 加载状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 150rpx 0;
}

.loading-icon {
  width: 60rpx;
  height: 60rpx;
  border: 4rpx solid #f3f3f3;
  border-top: 4rpx solid #1890ff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20rpx;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  font-size: 28rpx;
  color: #999;
}

/* 错误状态 */
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 150rpx 40rpx;
}

.error-icon {
  font-size: 120rpx;
  margin-bottom: 30rpx;
}

.error-text {
  font-size: 28rpx;
  color: #ff4d4f;
  margin-bottom: 40rpx;
}

.btn-retry {
  padding: 16rpx 50rpx;
  background-color: #1890ff;
  color: #fff;
  border-radius: 40rpx;
  border: none;
  font-size: 28rpx;
}

/* 内容区域 */
.content {
  flex: 1;
  background-color: #fff;
}

/* 笔记头部 */
.note-header {
  padding: 40rpx 30rpx 30rpx;
}

.note-title {
  display: block;
  font-size: 44rpx;
  font-weight: bold;
  color: #333;
  line-height: 1.4;
  margin-bottom: 20rpx;
}

.note-meta {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-bottom: 20rpx;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 24rpx;
  color: #999;
}

.meta-icon {
  font-size: 26rpx;
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.tag-item {
  padding: 8rpx 20rpx;
  background-color: #f0f5ff;
  border-radius: 20rpx;
}

.tag-text {
  font-size: 24rpx;
  color: #1890ff;
}

/* 分割线 */
.divider {
  height: 1rpx;
  background-color: #e8e8e8;
  margin: 0 30rpx 30rpx;
}

/* 笔记内容 */
.note-content {
  padding: 0 30rpx 30rpx;
  min-height: 200rpx;
}

/* 底部信息 */
.note-footer {
  padding: 30rpx;
  background-color: #fafafa;
  border-top: 1rpx solid #e8e8e8;
}

.footer-item {
  display: flex;
  justify-content: space-between;
  padding: 15rpx 0;
}

.footer-label {
  font-size: 26rpx;
  color: #999;
}

.footer-value {
  font-size: 26rpx;
  color: #666;
  font-weight: 500;
}
</style>
