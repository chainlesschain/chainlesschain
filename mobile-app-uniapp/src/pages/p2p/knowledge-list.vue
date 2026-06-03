<template>
  <view class="knowledge-list-container">
    <!-- 头部 -->
    <view class="header">
      <view class="header-info">
        <text class="header-title">PC端知识库</text>
        <text class="header-subtitle">{{ deviceName }}</text>
      </view>
      <button class="btn-back" @tap="goBack">返回</button>
    </view>

    <!-- 搜索栏 -->
    <view class="search-bar">
      <view class="search-box">
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          placeholder="搜索知识库..."
          @confirm="handleSearch"
        />
        <text class="search-icon" @tap="handleSearch">🔍</text>
      </view>
    </view>

    <!-- 标签筛选 -->
    <scroll-view class="tags-bar" scroll-x v-if="tags.length > 0">
      <view class="tag-list">
        <view
          class="tag-item"
          :class="{ active: !selectedTag }"
          @click="selectTag(null)"
        >
          <text class="tag-name">全部</text>
        </view>
        <view
          class="tag-item"
          :class="{ active: tag.name === selectedTag }"
          v-for="tag in tags"
          :key="tag.name"
          @click="selectTag(tag.name)"
        >
          <text class="tag-name">{{ tag.name }}</text>
          <text class="tag-count">{{ tag.count }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 笔记列表 -->
    <view class="content">
      <!-- 加载状态 -->
      <view class="loading-container" v-if="loading">
        <view class="loading-icon"></view>
        <text class="loading-text">加载中...</text>
      </view>

      <!-- 空状态 -->
      <view class="empty-container" v-else-if="notes.length === 0">
        <text class="empty-icon">📝</text>
        <text class="empty-text">{{ searchQuery ? '没有找到相关笔记' : 'PC端暂无笔记' }}</text>
      </view>

      <!-- 笔记卡片列表 -->
      <scroll-view class="notes-list" scroll-y v-else @scrolltolower="loadMore">
        <view
          class="note-card"
          v-for="note in notes"
          :key="note.id"
          @tap="viewNoteDetail(note)"
        >
          <view class="note-header">
            <text class="note-title">{{ note.title }}</text>
          </view>
          <text class="note-preview">{{ note.preview || note.snippet || '' }}</text>
          <view class="note-footer">
            <view class="note-tags" v-if="note.tags && note.tags.length > 0">
              <view class="note-tag" v-for="tag in note.tags.slice(0, 3)" :key="tag">
                <text class="note-tag-text">{{ tag }}</text>
              </view>
            </view>
            <view class="note-meta">
              <text class="meta-text">{{ formatTime(note.updated_at) }}</text>
            </view>
          </view>
        </view>

        <!-- 加载更多 -->
        <view class="load-more" v-if="hasMore">
          <text class="load-more-text">{{ loadingMore ? '加载中...' : '下拉加载更多' }}</text>
        </view>

        <!-- 没有更多 -->
        <view class="no-more" v-else-if="notes.length > 0">
          <text class="no-more-text">没有更多了</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import { getP2PKnowledgeService } from '@/services/p2p/knowledge-service'

export default {
  data() {
    return {
      peerId: '',
      deviceName: 'PC设备',

      // 知识库服务
      knowledgeService: null,

      // 笔记列表
      notes: [],
      total: 0,
      limit: 20,
      offset: 0,
      hasMore: true,

      // 搜索
      searchQuery: '',
      selectedTag: null,

      // 标签列表
      tags: [],

      // 状态
      loading: true,
      loadingMore: false
    }
  },

  async onLoad(options) {
    this.peerId = options.peerId || ''
    this.deviceName = decodeURIComponent(options.deviceName || 'PC设备')

    if (!this.peerId) {
      uni.showToast({
        title: '缺少设备ID',
        icon: 'none'
      })
      setTimeout(() => {
        uni.navigateBack()
      }, 1500)
      return
    }

    await this.initService()
    await this.loadData()
  },

  onUnload() {
    if (this.knowledgeService) {
      this.knowledgeService.cleanup()
    }
  },

  methods: {
    /**
     * 初始化服务
     */
    async initService() {
      try {
        this.knowledgeService = getP2PKnowledgeService()
        await this.knowledgeService.initialize()

        console.log('[KnowledgeList] 服务初始化成功')
      } catch (error) {
        console.error('[KnowledgeList] 服务初始化失败:', error)
        uni.showToast({
          title: '服务初始化失败',
          icon: 'none'
        })
      }
    },

    /**
     * 加载数据
     */
    async loadData() {
      try {
        this.loading = true
        this.offset = 0
        this.notes = []

        // 并行加载笔记和标签
        await Promise.all([
          this.loadNotes(),
          this.loadTags()
        ])
      } catch (error) {
        console.error('[KnowledgeList] 加载数据失败:', error)
        uni.showToast({
          title: error.message || '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载笔记列表
     */
    async loadNotes() {
      try {
        let data

        if (this.searchQuery) {
          // 搜索模式
          data = await this.knowledgeService.searchNotes(this.peerId, this.searchQuery, {
            limit: this.limit,
            offset: this.offset
          })
        } else {
          // 列表模式
          data = await this.knowledgeService.listNotes(this.peerId, {
            limit: this.limit,
            offset: this.offset,
            sortBy: 'updated_at',
            sortOrder: 'DESC'
          })
        }

        this.notes = this.offset === 0 ? data.notes : [...this.notes, ...data.notes]
        this.total = data.total
        this.hasMore = this.notes.length < this.total

        console.log('[KnowledgeList] 加载笔记成功:', data.notes.length)
      } catch (error) {
        console.error('[KnowledgeList] 加载笔记失败:', error)
        throw error
      }
    },

    /**
     * 加载标签列表
     */
    async loadTags() {
      try {
        const data = await this.knowledgeService.getTags(this.peerId)
        this.tags = data.tags || []

        console.log('[KnowledgeList] 加载标签成功:', this.tags.length)
      } catch (error) {
        console.error('[KnowledgeList] 加载标签失败:', error)
        // 标签加载失败不影响主流程
      }
    },

    /**
     * 处理搜索
     */
    async handleSearch() {
      this.offset = 0
      await this.loadNotes()
    },

    /**
     * 选择标签
     */
    async selectTag(tagName) {
      this.selectedTag = tagName
      // TODO: 实现按标签筛选
      // 当前PC端handler不支持按标签筛选，需要在搜索中使用标签名
      if (tagName) {
        this.searchQuery = tagName
        await this.handleSearch()
      } else {
        this.searchQuery = ''
        this.offset = 0
        await this.loadNotes()
      }
    },

    /**
     * 加载更多
     */
    async loadMore() {
      if (!this.hasMore || this.loadingMore) return

      try {
        this.loadingMore = true
        this.offset += this.limit
        await this.loadNotes()
      } catch (error) {
        console.error('[KnowledgeList] 加载更多失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loadingMore = false
      }
    },

    /**
     * 查看笔记详情
     */
    async viewNoteDetail(note) {
      // 导航到笔记详情页面（需要创建）
      uni.navigateTo({
        url: `/pages/p2p/note-detail?peerId=${this.peerId}&noteId=${note.id}&deviceName=${encodeURIComponent(this.deviceName)}`
      })
    },

    /**
     * 返回
     */
    goBack() {
      uni.navigateBack()
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      if (!timestamp) return ''

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
        return `${date.getMonth() + 1}月${date.getDate()}日`
      }
    }
  }
}
</script>

<style scoped>
.knowledge-list-container {
  min-height: 100vh;
  background-color: #f5f5f5;
  display: flex;
  flex-direction: column;
}

/* 头部 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 30rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #e8e8e8;
}

.header-info {
  flex: 1;
}

.header-title {
  display: block;
  font-size: 36rpx;
  font-weight: bold;
  color: #333;
  margin-bottom: 5rpx;
}

.header-subtitle {
  display: block;
  font-size: 24rpx;
  color: #999;
}

.btn-back {
  padding: 12rpx 30rpx;
  background-color: #1890ff;
  color: #fff;
  border-radius: 30rpx;
  border: none;
  font-size: 26rpx;
}

/* 搜索栏 */
.search-bar {
  padding: 20rpx 30rpx;
  background-color: #fff;
  border-bottom: 1rpx solid #e8e8e8;
}

.search-box {
  display: flex;
  align-items: center;
  padding: 0 30rpx;
  height: 70rpx;
  background-color: #f5f5f5;
  border-radius: 35rpx;
}

.search-input {
  flex: 1;
  font-size: 28rpx;
  color: #333;
}

.search-icon {
  font-size: 32rpx;
  margin-left: 20rpx;
}

/* 标签栏 */
.tags-bar {
  background-color: #fff;
  border-bottom: 1rpx solid #e8e8e8;
  white-space: nowrap;
}

.tag-list {
  display: inline-flex;
  padding: 20rpx 30rpx;
  gap: 15rpx;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 12rpx 24rpx;
  background-color: #f5f5f5;
  border-radius: 30rpx;
  font-size: 26rpx;
  color: #666;
}

.tag-item.active {
  background-color: #1890ff;
  color: #fff;
}

.tag-count {
  font-size: 22rpx;
  opacity: 0.8;
}

/* 内容区域 */
.content {
  flex: 1;
  position: relative;
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

/* 空状态 */
.empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 150rpx 40rpx;
}

.empty-icon {
  font-size: 120rpx;
  margin-bottom: 30rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #999;
}

/* 笔记列表 */
.notes-list {
  height: 100%;
  padding: 20rpx;
}

.note-card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.note-header {
  margin-bottom: 15rpx;
}

.note-title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
  line-height: 1.4;
}

.note-preview {
  font-size: 26rpx;
  color: #666;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  margin-bottom: 15rpx;
}

.note-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.note-tags {
  display: flex;
  gap: 10rpx;
  flex-wrap: wrap;
  flex: 1;
}

.note-tag {
  padding: 6rpx 16rpx;
  background-color: #f0f5ff;
  border-radius: 16rpx;
}

.note-tag-text {
  font-size: 22rpx;
  color: #1890ff;
}

.note-meta {
  margin-left: 20rpx;
}

.meta-text {
  font-size: 22rpx;
  color: #999;
}

/* 加载更多 */
.load-more,
.no-more {
  text-align: center;
  padding: 30rpx 0;
}

.load-more-text,
.no-more-text {
  font-size: 26rpx;
  color: #999;
}
</style>
