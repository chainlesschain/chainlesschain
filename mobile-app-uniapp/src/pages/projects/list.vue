<template>
  <view class="projects-page">
    <!-- 搜索栏 -->
    <view class="search-bar">
      <view class="search-input">
        <text class="search-icon">🔍</text>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索项目..."
          @input="onSearchInput"
        />
        <text v-if="searchQuery" class="clear-icon" @click="clearSearch">✕</text>
      </view>
    </view>

    <!-- 项目分类Tab -->
    <view class="project-tabs">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        :class="['tab-item', { active: currentTab === tab.value }]"
        @click="switchTab(tab.value)"
      >
        <text>{{ tab.label }}</text>
      </view>
    </view>

    <!-- 项目列表 -->
    <view class="projects-container">
      <scroll-view
        scroll-y
        class="projects-list"
        @scrolltolower="loadMore"
        :refresher-enabled="true"
        :refresher-triggered="isRefreshing"
        @refresherrefresh="onRefresh"
      >
        <!-- 加载中 -->
        <view v-if="isLoading && projects.length === 0" class="loading-container">
          <view class="loading-spinner"></view>
          <text class="loading-text">加载中...</text>
        </view>

        <!-- 项目列表 -->
        <view v-else-if="projects.length > 0" class="project-items">
          <view
            v-for="project in filteredProjects"
            :key="project.id"
            class="project-card"
            @click="goToDetail(project.id)"
          >
            <!-- 项目封面 -->
            <view class="project-cover">
              <image
                v-if="project.cover_image"
                :src="project.cover_image"
                mode="aspectFill"
                class="cover-image"
              />
              <view v-else class="cover-placeholder">
                <text class="cover-icon">{{ getProjectIcon(project.type) }}</text>
              </view>
            </view>

            <!-- 项目信息 -->
            <view class="project-info">
              <view class="project-header">
                <text class="project-name">{{ project.name }}</text>
                <view :class="['project-type', `type-${project.type}`]">
                  {{ getProjectTypeLabel(project.type) }}
                </view>
              </view>

              <text class="project-desc" v-if="project.description">
                {{ project.description }}
              </text>

              <view class="project-stats">
                <view class="stat-item">
                  <text class="stat-icon">📄</text>
                  <text class="stat-text">{{ project.fileCount || 0 }} 文件</text>
                </view>
                <view class="stat-item">
                  <text class="stat-icon">✓</text>
                  <text class="stat-text">{{ project.taskCount || 0 }} 任务</text>
                </view>
                <view class="stat-item">
                  <text class="stat-icon">👥</text>
                  <text class="stat-text">{{ project.collaboratorCount || 0 }} 协作</text>
                </view>
              </view>

              <view class="project-footer">
                <text class="update-time">{{ formatTime(project.updated_at) }}</text>
                <view v-if="project.completionRate" class="progress-bar">
                  <view
                    class="progress-fill"
                    :style="{ width: project.completionRate + '%' }"
                  ></view>
                </view>
              </view>
            </view>
          </view>

          <!-- 加载更多 -->
          <view v-if="hasMore" class="load-more">
            <text class="load-more-text">加载更多...</text>
          </view>
          <view v-else-if="projects.length > 0" class="no-more">
            <text class="no-more-text">没有更多了</text>
          </view>
        </view>

        <!-- 空状态 -->
        <view v-else class="empty-state">
          <view class="empty-icon">📁</view>
          <text class="empty-title">暂无项目</text>
          <text class="empty-subtitle">
            {{ currentTab === 'all' ? '点击右下角按钮创建第一个项目' : '该分类下暂无项目' }}
          </text>
        </view>
      </scroll-view>
    </view>

    <!-- 快速创建按钮 -->
    <view class="fab-button" @click="goToCreate">
      <text class="fab-icon">➕</text>
    </view>
  </view>
</template>

<script>
import projectManager from '@/services/project-manager'
import database from '@/services/database'

export default {
  data() {
    return {
      searchQuery: '',
      currentTab: 'all',
      tabs: [
        { label: '全部', value: 'all' },
        { label: '进行中', value: 'active' },
        { label: '已归档', value: 'archived' },
        { label: '协作', value: 'collaborating' }
      ],
      projects: [],
      isLoading: false,
      isRefreshing: false,
      hasMore: false,
      offset: 0,
      limit: 20
    }
  },

  computed: {
    filteredProjects() {
      if (!this.searchQuery) {
        return this.projects
      }

      const query = this.searchQuery.toLowerCase()
      return this.projects.filter(p => {
        return p.name.toLowerCase().includes(query) ||
               (p.description && p.description.toLowerCase().includes(query))
      })
    }
  },

  onLoad(options = {}) {
    if (options.tab) {
      const targetTab = this.tabs.find(tab => tab.value === options.tab)
      if (targetTab) {
        this.currentTab = targetTab.value
      }
    }
    this.initDatabase()
  },

  onShow() {
    // 每次显示页面时刷新列表
    this.loadProjects()
  },

  methods: {
    async initDatabase() {
      try {
        if (!database.isOpen) {
          await database.initWithoutPin()
        }
        this.loadProjects()
      } catch (error) {
        console.error('[ProjectList] 数据库初始化失败:', error)
        uni.showToast({
          title: '初始化失败',
          icon: 'none'
        })
      }
    },

    async loadProjects(refresh = false) {
      if (this.isLoading) return

      this.isLoading = true

      if (refresh) {
        this.offset = 0
        this.projects = []
      }

      try {
        const filters = {
          status: this.getStatusByTab(),
          includeCollaborating: this.currentTab === 'collaborating',
          limit: this.limit,
          offset: this.offset
        }

        let projectList = []

        if (this.currentTab === 'collaborating') {
          // 只获取协作项目
          projectList = await projectManager.getCollaboratingProjects()
        } else {
          projectList = await projectManager.getProjects(filters)
        }

        // 获取每个项目的统计信息
        for (const project of projectList) {
          const stats = await projectManager.getProjectStatistics(project.id)
          project.fileCount = stats.fileCount
          project.taskCount = stats.taskCount
          project.collaboratorCount = stats.collaboratorCount
          project.completionRate = stats.completionRate
        }

        if (refresh) {
          this.projects = projectList
        } else {
          this.projects.push(...projectList)
        }

        this.hasMore = projectList.length >= this.limit
        this.offset += projectList.length

      } catch (error) {
        console.error('[ProjectList] 加载项目失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.isLoading = false
        this.isRefreshing = false
      }
    },

    switchTab(tab) {
      if (this.currentTab === tab) return

      this.currentTab = tab
      this.offset = 0
      this.loadProjects(true)
    },

    getStatusByTab() {
      switch (this.currentTab) {
        case 'active':
          return 'active'
        case 'archived':
          return 'archived'
        default:
          return null
      }
    },

    onSearchInput() {
      // 搜索是客户端过滤，不需要重新加载
    },

    clearSearch() {
      this.searchQuery = ''
    },

    onRefresh() {
      this.isRefreshing = true
      this.loadProjects(true)
    },

    loadMore() {
      if (!this.hasMore || this.isLoading) return
      this.loadProjects()
    },

    goToDetail(projectId) {
      uni.navigateTo({
        url: `/pages/projects/detail?id=${projectId}`
      })
    },

    goToCreate() {
      uni.navigateTo({
        url: '/pages/projects/create'
      })
    },

    getProjectIcon(type) {
      const icons = {
        general: '📋',
        code: '💻',
        research: '🔬',
        writing: '✍️',
        learning: '📚',
        other: '📁'
      }
      return icons[type] || icons.other
    },

    getProjectTypeLabel(type) {
      const labels = {
        general: '通用',
        code: '代码',
        research: '研究',
        writing: '写作',
        learning: '学习',
        other: '其他'
      }
      return labels[type] || labels.other
    },

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
        return Math.floor(diff / minute) + '分钟前'
      } else if (diff < day) {
        return Math.floor(diff / hour) + '小时前'
      } else if (diff < 7 * day) {
        return Math.floor(diff / day) + '天前'
      } else {
        const date = new Date(timestamp)
        return `${date.getMonth() + 1}月${date.getDate()}日`
      }
    }
  }
}
</script>

<style scoped>
.projects-page {
  min-height: 100vh;
  background: #f5f5f5;
  padding-bottom: calc(env(safe-area-inset-bottom) + 50px);
}

/* 搜索栏 */
.search-bar {
  background: white;
  padding: 12px 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.search-input {
  display: flex;
  align-items: center;
  background: #f5f5f5;
  border-radius: 20px;
  padding: 8px 16px;
}

.search-icon {
  font-size: 16px;
  margin-right: 8px;
}

.search-input input {
  flex: 1;
  font-size: 14px;
  border: none;
  background: transparent;
}

.clear-icon {
  font-size: 14px;
  color: #999;
  padding: 0 4px;
}

/* 分类Tab */
.project-tabs {
  display: flex;
  background: white;
  padding: 12px 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 8px 12px;
  font-size: 14px;
  color: #666;
  border-radius: 8px;
  transition: all 0.3s;
}

.tab-item.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
}

/* 项目容器 */
.projects-container {
  flex: 1;
}

.projects-list {
  height: calc(100vh - 160px);
}

/* 加载状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f0f0f0;
  border-top-color: #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  margin-top: 16px;
  font-size: 14px;
  color: #999;
}

/* 项目卡片 */
.project-items {
  padding: 0 16px;
}

.project-card {
  background: white;
  border-radius: 12px;
  margin-bottom: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: transform 0.2s, box-shadow 0.2s;
}

.project-card:active {
  transform: scale(0.98);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}

.project-cover {
  width: 100%;
  height: 120px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  position: relative;
}

.cover-image {
  width: 100%;
  height: 100%;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-icon {
  font-size: 48px;
}

.project-info {
  padding: 16px;
}

.project-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.project-name {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  flex: 1;
  margin-right: 8px;
}

.project-type {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  color: white;
  background: #999;
}

.type-code {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.type-research {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

.type-writing {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
}

.type-learning {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
}

.project-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.project-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-icon {
  font-size: 14px;
}

.stat-text {
  font-size: 12px;
  color: #999;
}

.project-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.update-time {
  font-size: 12px;
  color: #999;
}

.progress-bar {
  width: 80px;
  height: 4px;
  background: #f0f0f0;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transition: width 0.3s;
}

/* 加载更多 */
.load-more,
.no-more {
  padding: 20px;
  text-align: center;
}

.load-more-text,
.no-more-text {
  font-size: 14px;
  color: #999;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 80px;
  margin-bottom: 20px;
  opacity: 0.5;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.empty-subtitle {
  font-size: 14px;
  color: #999;
}

/* 悬浮按钮 */
.fab-button {
  position: fixed;
  right: 20px;
  bottom: calc(env(safe-area-inset-bottom) + 70px);
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  transition: transform 0.2s;
}

.fab-button:active {
  transform: scale(0.9);
}

.fab-icon {
  font-size: 24px;
  color: white;
}
</style>
