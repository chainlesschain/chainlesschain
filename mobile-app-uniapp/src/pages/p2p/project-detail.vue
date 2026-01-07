<template>
  <view class="container">
    <!-- 页面标题 -->
    <view class="page-header">
      <text class="page-title">{{ projectName || '项目详情' }}</text>
    </view>

    <!-- Tab切换 -->
    <view class="tabs">
      <view
        v-for="(tab, index) in tabs"
        :key="index"
        class="tab-item"
        :class="{ active: activeTab === index }"
        @tap="switchTab(index)"
      >
        <text class="tab-text">{{ tab }}</text>
      </view>
    </view>

    <!-- Tab内容 -->
    <scroll-view class="content" scroll-y>
      <!-- Tab 0: 项目信息 -->
      <view v-if="activeTab === 0" class="tab-content">
        <view v-if="loading" class="loading-container">
          <text class="loading-text">正在加载...</text>
        </view>

        <view v-else-if="project" class="info-container">
          <!-- 基本信息 -->
          <view class="info-card">
            <view class="card-title">基本信息</view>
            <view class="info-row">
              <text class="info-label">项目名称</text>
              <text class="info-value">{{ project.name }}</text>
            </view>
            <view v-if="project.description" class="info-row">
              <text class="info-label">项目描述</text>
              <text class="info-value">{{ project.description }}</text>
            </view>
            <view v-if="project.local_path" class="info-row">
              <text class="info-label">本地路径</text>
              <text class="info-value path">{{ project.local_path }}</text>
            </view>
            <view v-if="project.git_url" class="info-row">
              <text class="info-label">Git仓库</text>
              <text class="info-value path">{{ project.git_url }}</text>
            </view>
          </view>

          <!-- Git信息 -->
          <view v-if="project.last_commit_hash" class="info-card">
            <view class="card-title">Git 提交</view>
            <view class="info-row">
              <text class="info-label">提交哈希</text>
              <text class="info-value code">{{ project.last_commit_hash.substring(0, 8) }}</text>
            </view>
            <view v-if="project.last_commit_message" class="info-row">
              <text class="info-label">提交信息</text>
              <text class="info-value">{{ project.last_commit_message }}</text>
            </view>
          </view>

          <!-- 项目统计 -->
          <view v-if="project.stats" class="info-card">
            <view class="card-title">项目统计</view>
            <view class="stats-grid">
              <view class="stat-item">
                <text class="stat-value">{{ project.stats.totalFiles }}</text>
                <text class="stat-label">文件数</text>
              </view>
              <view class="stat-item">
                <text class="stat-value">{{ formatSize(project.stats.totalSize) }}</text>
                <text class="stat-label">总大小</text>
              </view>
            </view>

            <!-- 文件类型分布 -->
            <view v-if="project.stats.fileTypes" class="file-types">
              <text class="file-types-title">文件类型分布</text>
              <view class="type-list">
                <view
                  v-for="(count, ext) in project.stats.fileTypes"
                  :key="ext"
                  class="type-item"
                >
                  <text class="type-ext">{{ ext || '无扩展名' }}</text>
                  <text class="type-count">{{ count }}</text>
                </view>
              </view>
            </view>
          </view>

          <!-- 时间信息 -->
          <view class="info-card">
            <view class="card-title">时间信息</view>
            <view class="info-row">
              <text class="info-label">创建时间</text>
              <text class="info-value">{{ formatFullTime(project.created_at) }}</text>
            </view>
            <view class="info-row">
              <text class="info-label">更新时间</text>
              <text class="info-value">{{ formatFullTime(project.updated_at) }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- Tab 1: 文件树 -->
      <view v-else-if="activeTab === 1" class="tab-content">
        <view v-if="loadingTree" class="loading-container">
          <text class="loading-text">正在加载文件树...</text>
        </view>

        <view v-else-if="fileTree && fileTree.length" class="file-tree">
          <file-tree-node
            v-for="(node, index) in fileTree"
            :key="index"
            :node="node"
            :level="0"
            @file-click="handleFileClick"
          />
        </view>

        <view v-else class="empty-container">
          <text class="empty-icon">📂</text>
          <text class="empty-text">暂无文件</text>
        </view>
      </view>

      <!-- Tab 2: 文件搜索 -->
      <view v-else-if="activeTab === 2" class="tab-content">
        <!-- 搜索框 -->
        <view class="search-box">
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="输入文件名搜索"
            @confirm="handleSearch"
          />
          <view class="search-button" @tap="handleSearch">
            <text class="search-button-text">搜索</text>
          </view>
        </view>

        <!-- 搜索结果 -->
        <view v-if="searching" class="loading-container">
          <text class="loading-text">搜索中...</text>
        </view>

        <view v-else-if="searchResults.length" class="search-results">
          <view
            v-for="(file, index) in searchResults"
            :key="index"
            class="file-item"
            @tap="handleFileClick({ path: file.path, type: 'file', name: file.name })"
          >
            <view class="file-icon">
              <text>{{ getFileIcon(file.name) }}</text>
            </view>
            <view class="file-info">
              <text class="file-name">{{ file.name }}</text>
              <text class="file-path">{{ file.path }}</text>
              <view class="file-meta">
                <text class="file-size">{{ formatSize(file.size) }}</text>
                <text class="file-time">{{ formatFullTime(file.modifiedAt) }}</text>
              </view>
            </view>
          </view>
        </view>

        <view v-else-if="searchQuery" class="empty-container">
          <text class="empty-icon">🔍</text>
          <text class="empty-text">没有找到匹配的文件</text>
        </view>

        <view v-else class="empty-container">
          <text class="empty-icon">🔍</text>
          <text class="empty-text">输入关键词搜索文件</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import projectService from '@/services/p2p/project-service.js'
import FileTreeNode from '@/components/file-tree-node.vue'

export default {
  components: {
    FileTreeNode
  },

  data() {
    return {
      // URL参数
      projectId: '',
      peerId: '',
      projectName: '',

      // Tab
      tabs: ['项目信息', '文件树', '文件搜索'],
      activeTab: 0,

      // 项目数据
      project: null,
      fileTree: null,

      // 搜索
      searchQuery: '',
      searchResults: [],

      // 状态
      loading: false,
      loadingTree: false,
      searching: false
    }
  },

  onLoad(options) {
    this.projectId = options.projectId
    this.peerId = options.peerId
    this.projectName = decodeURIComponent(options.projectName || '')

    // 加载项目信息
    this.loadProject()
  },

  methods: {
    /**
     * 切换Tab
     */
    switchTab(index) {
      this.activeTab = index

      // 懒加载文件树
      if (index === 1 && !this.fileTree && !this.loadingTree) {
        this.loadFileTree()
      }
    },

    /**
     * 加载项目详情
     */
    async loadProject() {
      this.loading = true

      try {
        this.project = await projectService.getProject(this.peerId, this.projectId)
      } catch (error) {
        console.error('加载项目详情失败:', error)
        uni.showToast({
          title: error.message || '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载文件树
     */
    async loadFileTree() {
      this.loadingTree = true

      try {
        this.fileTree = await projectService.getFileTree(this.peerId, this.projectId, 3)
      } catch (error) {
        console.error('加载文件树失败:', error)
        uni.showToast({
          title: error.message || '加载失败',
          icon: 'none'
        })
      } finally {
        this.loadingTree = false
      }
    },

    /**
     * 搜索文件
     */
    async handleSearch() {
      if (!this.searchQuery.trim()) {
        return
      }

      this.searching = true

      try {
        const data = await projectService.searchFiles(
          this.peerId,
          this.projectId,
          this.searchQuery
        )

        this.searchResults = data.files
      } catch (error) {
        console.error('搜索文件失败:', error)
        uni.showToast({
          title: error.message || '搜索失败',
          icon: 'none'
        })
      } finally {
        this.searching = false
      }
    },

    /**
     * 点击文件
     */
    handleFileClick(node) {
      if (node.type !== 'file') {
        return
      }

      // 跳转到文件内容页面
      uni.navigateTo({
        url: `/pages/p2p/file-detail?projectId=${this.projectId}&peerId=${this.peerId}&filePath=${encodeURIComponent(node.path || node.name)}&fileName=${encodeURIComponent(node.name)}`
      })
    },

    /**
     * 获取文件图标
     */
    getFileIcon(fileName) {
      const ext = fileName.split('.').pop().toLowerCase()

      const iconMap = {
        js: '📜',
        ts: '📘',
        vue: '🟢',
        jsx: '⚛️',
        tsx: '⚛️',
        html: '🌐',
        css: '🎨',
        scss: '🎨',
        sass: '🎨',
        less: '🎨',
        json: '📋',
        md: '📝',
        txt: '📄',
        py: '🐍',
        java: '☕',
        cpp: '⚙️',
        c: '⚙️',
        go: '🔵',
        rs: '🦀',
        sh: '💻',
        yml: '⚙️',
        yaml: '⚙️',
        xml: '📰',
        sql: '🗄️',
        db: '🗄️',
        png: '🖼️',
        jpg: '🖼️',
        jpeg: '🖼️',
        gif: '🖼️',
        svg: '🎨',
        mp4: '🎬',
        mp3: '🎵',
        pdf: '📕',
        zip: '📦',
        tar: '📦',
        gz: '📦'
      }

      return iconMap[ext] || '📄'
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
     * 格式化完整时间
     */
    formatFullTime(timestamp) {
      if (!timestamp) return '未知'

      const date = new Date(timestamp)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
}

/* Tab切换 */
.tabs {
  display: flex;
  background-color: #fff;
  border-bottom: 1px solid #eee;
}

.tab-item {
  flex: 1;
  padding: 24rpx 0;
  text-align: center;
  position: relative;
}

.tab-item.active .tab-text {
  color: #667eea;
  font-weight: 600;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 25%;
  width: 50%;
  height: 4rpx;
  background-color: #667eea;
  border-radius: 2rpx;
}

.tab-text {
  font-size: 28rpx;
  color: #666;
}

/* 内容区域 */
.content {
  flex: 1;
}

.tab-content {
  padding: 24rpx 0;
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

/* 项目信息 */
.info-container {
  padding: 0 32rpx;
}

.info-card {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
}

.card-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 24rpx;
  padding-bottom: 16rpx;
  border-bottom: 1px solid #f0f0f0;
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

.info-value.code {
  font-family: monospace;
  color: #e83e8c;
  background-color: #f8f9fa;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
}

/* 统计信息 */
.stats-grid {
  display: flex;
  gap: 24rpx;
  margin-bottom: 32rpx;
}

.stat-item {
  flex: 1;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-value {
  font-size: 48rpx;
  font-weight: 600;
  color: #fff;
  margin-bottom: 8rpx;
}

.stat-label {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
}

/* 文件类型 */
.file-types {
  margin-top: 24rpx;
}

.file-types-title {
  font-size: 26rpx;
  color: #666;
  margin-bottom: 16rpx;
  display: block;
}

.type-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.type-item {
  display: flex;
  align-items: center;
  background-color: #f8f9fa;
  padding: 12rpx 20rpx;
  border-radius: 8rpx;
}

.type-ext {
  font-size: 24rpx;
  color: #666;
  margin-right: 12rpx;
}

.type-count {
  font-size: 24rpx;
  color: #999;
}

/* 文件树 */
.file-tree {
  padding: 0 16rpx;
}

/* 搜索框 */
.search-box {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
  background-color: #fff;
  margin-bottom: 24rpx;
}

.search-input {
  flex: 1;
  height: 72rpx;
  padding: 0 24rpx;
  background-color: #f8f9fa;
  border-radius: 12rpx;
  font-size: 28rpx;
  margin-right: 16rpx;
}

.search-button {
  height: 72rpx;
  padding: 0 32rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-button-text {
  font-size: 28rpx;
  color: #fff;
  font-weight: 500;
}

/* 搜索结果 */
.search-results {
  padding: 0 32rpx;
}

.file-item {
  display: flex;
  align-items: center;
  background-color: #fff;
  padding: 24rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.05);
}

.file-icon {
  width: 72rpx;
  height: 72rpx;
  font-size: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
  display: block;
  margin-bottom: 8rpx;
}

.file-path {
  font-size: 24rpx;
  color: #999;
  display: block;
  margin-bottom: 8rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  display: flex;
  gap: 24rpx;
}

.file-size,
.file-time {
  font-size: 22rpx;
  color: #ccc;
}
</style>
