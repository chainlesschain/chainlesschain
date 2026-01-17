<template>
  <view class="knowledge-list">
    <!-- 搜索栏 -->
    <view class="header">
      <view class="search-box" v-if="!selectionMode">
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          :placeholder="searchMode === 'smart' ? '智能搜索...' : '搜索知识库...'"
          @input="handleSearch"
        />
        <text class="search-icon">🔍</text>
        <view class="search-mode-btn" @click="toggleSearchMode" v-if="searchQuery">
          <text class="mode-icon">{{ searchMode === 'smart' ? '🧠' : '📝' }}</text>
        </view>
      </view>

      <!-- 批量选择模式标题 -->
      <view class="selection-header" v-else>
        <text class="selection-title">已选择 {{ selectedItems.length }} 项</text>
      </view>

      <!-- 操作按钮 -->
      <view class="action-buttons">
        <view class="action-btn" @click="toggleSelectionMode" v-if="!selectionMode">
          <text class="action-icon">☑️</text>
        </view>
        <view class="action-btn" @click="cancelSelection" v-else>
          <text class="action-text">取消</text>
        </view>

        <view class="folder-btn" @click="goToFolders" v-if="!selectionMode">
          <text class="folder-icon">📁</text>
        </view>
        <view class="stats-btn" @click="goToStatistics" v-if="!selectionMode">
          <text class="stats-icon">📊</text>
        </view>
        <view class="filter-btn" @click="showFilterModal = true" v-if="!selectionMode">
          <text class="filter-icon">{{ hasActiveFilter ? '🎯' : '☰' }}</text>
        </view>
      </view>
    </view>

    <!-- 标签筛选条 -->
    <scroll-view class="tags-bar" scroll-x v-if="tags.length > 0">
      <view class="tag-list">
        <view
          class="tag-item"
          :class="{ active: selectedTagId === null && !favoriteOnly }"
          @click="selectTag(null)"
        >
          <text class="tag-name">全部</text>
        </view>
        <view
          class="tag-item"
          :class="{ active: favoriteOnly }"
          @click="toggleFavorite"
        >
          <text class="tag-icon">⭐</text>
          <text class="tag-name">收藏</text>
        </view>
        <view
          class="tag-item"
          :class="{ active: tag.id === selectedTagId }"
          v-for="tag in tags"
          :key="tag.id"
          @click="selectTag(tag.id)"
        >
          <text class="tag-dot" :style="{ backgroundColor: tag.color }"></text>
          <text class="tag-name">{{ tag.name }}</text>
          <text class="tag-count">{{ tag.count }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 知识列表 -->
    <view class="list-container">
      <!-- 骨架屏加载状态 -->
      <Skeleton v-if="loading" type="list" :rows="5" :avatar="false" :animate="true" />


      <view class="empty" v-else-if="items.length === 0">
        <text class="empty-icon">📝</text>
        <text class="empty-text">{{ emptyText }}</text>
        <button class="add-btn" @click="goToAdd" v-if="!searchQuery && !selectedTagId">
          添加第一个条目
        </button>
      </view>

      <view
        class="item"
        :class="{ selected: isItemSelected(item.id) }"
        v-for="item in items"
        :key="item.id"
        @click="handleItemClick(item)"
      >
        <!-- 选择框 -->
        <view class="selection-checkbox" v-if="selectionMode" @click.stop="toggleItemSelection(item.id)">
          <text class="checkbox-icon">{{ isItemSelected(item.id) ? '☑️' : '⬜' }}</text>
        </view>

        <view class="item-content-wrapper">
          <view class="item-header">
            <text class="item-title">{{ item.title }}</text>
            <view class="item-badges">
              <!-- RAG相关性分数 -->
              <text class="relevance-score" v-if="item.score && searchMode === 'smart'">
                {{ (item.score * 100).toFixed(0) }}%
              </text>
              <!-- 检索来源标记 -->
              <text class="source-badge" v-if="item.source === 'backend_vector'">🧠</text>
              <text class="source-badge" v-if="item.source === 'local_keyword'">📝</text>
              <text class="favorite-icon" v-if="item.is_favorite" @click.stop="toggleItemFavorite(item)">⭐</text>
              <text class="favorite-icon-empty" v-else @click.stop="toggleItemFavorite(item)">☆</text>
            </view>
          </view>
          <text class="item-content">{{ item.content }}</text>
          <view class="item-footer">
            <view class="item-tags" v-if="itemTags[item.id] && itemTags[item.id].length > 0">
              <view
                class="item-tag"
                v-for="tag in itemTags[item.id]"
                :key="tag.id"
                :style="{ backgroundColor: tag.color + '20', borderColor: tag.color }"
              >
                <text class="item-tag-name" :style="{ color: tag.color }">{{ tag.name }}</text>
              </view>
            </view>
            <text class="item-time">{{ formatTime(item.updated_at) }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 添加按钮 -->
    <view class="fab" @click="goToAdd" v-if="!selectionMode">
      <text class="fab-icon">+</text>
    </view>

    <!-- 批量操作工具栏 -->
    <view class="batch-toolbar" v-if="selectionMode && selectedItems.length > 0">
      <view class="toolbar-actions">
        <view class="toolbar-btn" @click="selectAll">
          <text class="toolbar-icon">☑️</text>
          <text class="toolbar-label">全选</text>
        </view>
        <view class="toolbar-btn" @click="showFolderSelector">
          <text class="toolbar-icon">📁</text>
          <text class="toolbar-label">移动</text>
        </view>
        <view class="toolbar-btn" @click="batchDelete">
          <text class="toolbar-icon">🗑️</text>
          <text class="toolbar-label">删除</text>
        </view>
      </view>
    </view>

    <!-- 筛选弹窗 -->
    <view class="modal" v-if="showFilterModal" @click="showFilterModal = false">
      <view class="modal-content filter-modal" @click.stop>
        <text class="modal-title">筛选选项</text>

        <view class="filter-section">
          <text class="filter-label">排序方式</text>
          <view class="filter-options">
            <view
              class="filter-option"
              :class="{ active: sortBy === 'updated' }"
              @click="sortBy = 'updated'"
            >
              <text>最近更新</text>
            </view>
            <view
              class="filter-option"
              :class="{ active: sortBy === 'created' }"
              @click="sortBy = 'created'"
            >
              <text>最近创建</text>
            </view>
            <view
              class="filter-option"
              :class="{ active: sortBy === 'title' }"
              @click="sortBy = 'title'"
            >
              <text>标题</text>
            </view>
          </view>
        </view>

        <view class="filter-section">
          <text class="filter-label">知识类型</text>
          <view class="filter-options">
            <view
              class="filter-option"
              :class="{ active: filterType === null }"
              @click="filterType = null"
            >
              <text>全部</text>
            </view>
            <view
              class="filter-option"
              :class="{ active: filterType === 'note' }"
              @click="filterType = 'note'"
            >
              <text>笔记</text>
            </view>
            <view
              class="filter-option"
              :class="{ active: filterType === 'document' }"
              @click="filterType = 'document'"
            >
              <text>文档</text>
            </view>
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="resetFilter">
            <text>重置</text>
          </button>
          <button class="modal-btn confirm" @click="applyFilter">
            <text>应用</text>
          </button>
        </view>
      </view>
    </view>

    <!-- 文件夹选择器 -->
    <FolderSelector
      :visible="showFolderSelector"
      :current-folder-id="currentFolderId"
      @close="showFolderSelector = false"
      @confirm="handleBatchMove"
    />
  </view>
</template>

<script>
import { db } from '@/services/database'
import knowledgeRAG from '@/services/knowledge-rag'
import FolderSelector from '@/components/FolderSelector.vue'
import Skeleton from '@/components/Skeleton.vue'

export default {
  components: {
    FolderSelector,
    Skeleton
  },
  data() {
    return {
      searchQuery: '',
      searchMode: 'simple', // 'simple' 或 'smart'
      items: [],
      tags: [],
      itemTags: {}, // 每个知识项的标签
      loading: false,
      selectedTagId: null,
      favoriteOnly: false,
      showFilterModal: false,
      sortBy: 'updated',
      filterType: null,
      currentFolderId: null, // 当前文件夹ID筛选
      ragServiceStatus: null, // RAG服务状态
      // 批量选择相关
      selectionMode: false,
      selectedItems: [],
      showFolderSelector: false
    }
  },
  computed: {
    hasActiveFilter() {
      return this.selectedTagId !== null || this.favoriteOnly || this.filterType !== null
    },
    emptyText() {
      if (this.searchQuery) {
        return '没有找到匹配的知识'
      }
      if (this.selectedTagId) {
        return '该标签下暂无知识'
      }
      if (this.favoriteOnly) {
        return '还没有收藏的知识'
      }
      return '暂无知识条目'
    }
  },
  onLoad(options) {
    // 如果从文件夹页面跳转过来，设置当前文件夹
    if (options.folderId) {
      this.currentFolderId = parseInt(options.folderId)
      this.loadFolderName()
    }

    this.loadTags()
    this.loadItems()
  },
  onShow() {
    // 页面显示时重新加载，确保新添加的条目能显示
    this.loadTags()
    this.loadItems()
  },
  onPullDownRefresh() {
    Promise.all([
      this.loadTags(),
      this.loadItems()
    ]).then(() => {
      uni.stopPullDownRefresh()
    })
  },
  methods: {
    /**
     * 加载标签列表
     */
    async loadTags() {
      try {
        this.tags = await db.getTags()
      } catch (error) {
        console.error('加载标签失败:', error)
      }
    },

    /**
     * 加载知识列表
     */
    async loadItems() {
      this.loading = true
      try {
        const result = await db.getKnowledgeItems({
          searchQuery: this.searchQuery,
          tagId: this.selectedTagId,
          favoriteOnly: this.favoriteOnly,
          type: this.filterType,
          folderId: this.currentFolderId,
          limit: 50
        })
        this.items = result || []

        // 加载每个知识项的标签
        await this.loadItemTags()
      } catch (error) {
        console.error('加载知识库失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载知识项的标签
     */
    async loadItemTags() {
      const tagsMap = {}
      for (const item of this.items) {
        try {
          const tags = await db.getKnowledgeTags(item.id)
          tagsMap[item.id] = tags || []
        } catch (error) {
          console.error(`加载知识 ${item.id} 的标签失败:`, error)
          tagsMap[item.id] = []
        }
      }
      this.itemTags = tagsMap
    },

    /**
     * 搜索处理
     */
    handleSearch() {
      // 防抖搜索
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => {
        if (this.searchMode === 'smart' && this.searchQuery.trim()) {
          this.performSmartSearch()
        } else {
          this.loadItems()
        }
      }, 300)
    },

    /**
     * 智能搜索（RAG向量检索）
     */
    async performSmartSearch() {
      if (!this.searchQuery.trim()) {
        this.loadItems()
        return
      }

      this.loading = true
      try {
        // 使用RAG检索
        const results = await knowledgeRAG.retrieve(this.searchQuery, {
          limit: 20,
          includeContent: true,
          includeTags: true,
          useBackend: true, // 优先使用后端
          useReranker: true // 使用重排序
        })

        console.log('[智能搜索] 检索到结果:', results.length)

        // 转换格式以匹配现有UI
        this.items = results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content || '',
          type: r.type,
          score: r.score, // 相关性分数
          source: r.source, // 检索来源（backend_vector 或 local_keyword）
          is_favorite: r.is_favorite || 0,
          created_at: r.createdAt,
          updated_at: r.updatedAt || r.createdAt
        }))

        // 加载标签
        await this.loadItemTags()

        // 显示搜索模式提示
        if (results.length > 0 && results[0].source === 'backend_vector') {
          uni.showToast({
            title: `智能检索: ${results.length}个结果`,
            icon: 'none',
            duration: 1500
          })
        }
      } catch (error) {
        console.error('[智能搜索] 失败:', error)
        uni.showToast({
          title: '智能搜索失败，使用普通搜索',
          icon: 'none'
        })
        // 降级到普通搜索
        this.searchMode = 'simple'
        this.loadItems()
      } finally {
        this.loading = false
      }
    },

    /**
     * 切换搜索模式
     */
    async toggleSearchMode() {
      this.searchMode = this.searchMode === 'simple' ? 'smart' : 'simple'

      // 如果切换到智能模式，检查后端可用性
      if (this.searchMode === 'smart') {
        const status = await knowledgeRAG.getServiceStatus()
        this.ragServiceStatus = status

        if (!status.backend.available) {
          uni.showModal({
            title: '智能搜索提示',
            content: '后端AI服务不可用，将使用本地关键词检索。',
            showCancel: false
          })
        } else {
          uni.showToast({
            title: '智能搜索模式',
            icon: 'none',
            duration: 1000
          })
        }
      } else {
        uni.showToast({
          title: '普通搜索模式',
          icon: 'none',
          duration: 1000
        })
      }

      // 如果有搜索内容，重新搜索
      if (this.searchQuery.trim()) {
        this.handleSearch()
      }
    },

    /**
     * 选择标签
     */
    selectTag(tagId) {
      this.selectedTagId = tagId
      this.favoriteOnly = false
      this.loadItems()
    },

    /**
     * 切换收藏筛选
     */
    toggleFavorite() {
      this.favoriteOnly = !this.favoriteOnly
      this.selectedTagId = null
      this.loadItems()
    },

    /**
     * 切换知识项收藏状态
     */
    async toggleItemFavorite(item) {
      try {
        await db.toggleKnowledgeFavorite(item.id)

        // 更新本地状态
        const index = this.items.findIndex(i => i.id === item.id)
        if (index !== -1) {
          this.items[index].is_favorite = this.items[index].is_favorite ? 0 : 1
        }

        uni.showToast({
          title: item.is_favorite ? '已取消收藏' : '已收藏',
          icon: 'success',
          duration: 1000
        })

        // 如果当前在收藏筛选模式，重新加载列表
        if (this.favoriteOnly) {
          this.loadItems()
        }
      } catch (error) {
        console.error('切换收藏状态失败:', error)
        uni.showToast({
          title: '操作失败',
          icon: 'none'
        })
      }
    },

    /**
     * 应用筛选
     */
    applyFilter() {
      this.showFilterModal = false
      this.loadItems()
    },

    /**
     * 重置筛选
     */
    resetFilter() {
      this.sortBy = 'updated'
      this.filterType = null
      this.showFilterModal = false
      this.loadItems()
    },

    /**
     * 跳转到详情
     */
    goToDetail(id) {
      uni.navigateTo({
        url: `/pages/knowledge/detail/detail?id=${id}`
      })
    },

    /**
     * 跳转到统计页面
     */
    goToStatistics() {
      uni.navigateTo({
        url: '/pages/knowledge/statistics/statistics'
      })
    },

    /**
     * 切换批量选择模式
     */
    toggleSelectionMode() {
      this.selectionMode = !this.selectionMode
      if (!this.selectionMode) {
        this.selectedItems = []
      }
    },

    /**
     * 取消选择
     */
    cancelSelection() {
      this.selectionMode = false
      this.selectedItems = []
    },

    /**
     * 处理列表项点击
     */
    handleItemClick(item) {
      if (this.selectionMode) {
        this.toggleItemSelection(item.id)
      } else {
        this.goToDetail(item.id)
      }
    },

    /**
     * 切换项目选择状态
     */
    toggleItemSelection(itemId) {
      const index = this.selectedItems.indexOf(itemId)
      if (index > -1) {
        this.selectedItems.splice(index, 1)
      } else {
        this.selectedItems.push(itemId)
      }
    },

    /**
     * 检查项目是否被选中
     */
    isItemSelected(itemId) {
      return this.selectedItems.includes(itemId)
    },

    /**
     * 全选
     */
    selectAll() {
      if (this.selectedItems.length === this.items.length) {
        // 如果已全选，则取消全选
        this.selectedItems = []
      } else {
        // 否则全选
        this.selectedItems = this.items.map(item => item.id)
      }
    },

    /**
     * 显示文件夹选择器
     */
    showFolderSelector() {
      this.showFolderSelector = true
    },

    /**
     * 批量移动到文件夹
     */
    async handleBatchMove(targetFolderId) {
      if (this.selectedItems.length === 0) {
        uni.showToast({
          title: '请先选择知识条目',
          icon: 'none'
        })
        return
      }

      uni.showLoading({
        title: '移动中...',
        mask: true
      })

      try {
        // 批量更新文件夹
        for (const itemId of this.selectedItems) {
          await db.updateKnowledgeItem(itemId, {
            folder_id: targetFolderId
          })
        }

        uni.hideLoading()

        uni.showToast({
          title: `已移动 ${this.selectedItems.length} 项`,
          icon: 'success'
        })

        // 关闭文件夹选择器
        this.showFolderSelector = false

        // 退出选择模式
        this.cancelSelection()

        // 重新加载列表
        await this.loadItems()
      } catch (error) {
        uni.hideLoading()
        console.error('批量移动失败:', error)
        uni.showToast({
          title: '移动失败',
          icon: 'none'
        })
      }
    },

    /**
     * 批量删除
     */
    batchDelete() {
      if (this.selectedItems.length === 0) {
        uni.showToast({
          title: '请先选择知识条目',
          icon: 'none'
        })
        return
      }

      uni.showModal({
        title: '确认删除',
        content: `确定要删除选中的 ${this.selectedItems.length} 项知识吗？删除后无法恢复。`,
        success: async (res) => {
          if (res.confirm) {
            uni.showLoading({
              title: '删除中...',
              mask: true
            })

            try {
              // 批量删除
              for (const itemId of this.selectedItems) {
                await db.deleteKnowledgeItem(itemId)
              }

              uni.hideLoading()

              uni.showToast({
                title: `已删除 ${this.selectedItems.length} 项`,
                icon: 'success'
              })

              // 退出选择模式
              this.cancelSelection()

              // 重新加载列表
              await this.loadItems()
            } catch (error) {
              uni.hideLoading()
              console.error('批量删除失败:', error)
              uni.showToast({
                title: '删除失败',
                icon: 'none'
              })
            }
          }
        }
      })
    },

    /**
     * 跳转到文件夹管理
     */
    goToFolders() {
      uni.navigateTo({
        url: '/pages/knowledge/folders/folders'
      })
    },

    /**
     * 加载文件夹名称并更新导航栏标题
     */
    async loadFolderName() {
      if (!this.currentFolderId) return

      try {
        const folders = await db.getFolders()
        const folder = folders.find(f => f.id === this.currentFolderId)
        if (folder) {
          uni.setNavigationBarTitle({
            title: `${folder.icon || '📁'} ${folder.name}`
          })
        }
      } catch (error) {
        console.error('加载文件夹名称失败:', error)
      }
    },

    /**
     * 跳转到添加
     */
    goToAdd() {
      let url = '/pages/knowledge/edit/edit'
      // 如果当前在文件夹视图中，传递文件夹ID
      if (this.currentFolderId) {
        url += `?folderId=${this.currentFolderId}`
      }
      uni.navigateTo({
        url: url
      })
    },

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
      const date = new Date(timestamp)
      const now = new Date()
      const diff = now - date

      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`

      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
}
</script>

<style lang="scss" scoped>
.knowledge-list {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 100rpx;
}

.header {
  padding: 24rpx;
  background-color: var(--bg-card);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  gap: 16rpx;

  .search-box {
    flex: 1;
    position: relative;

    .search-input {
      width: 100%;
      height: 72rpx;
      background-color: var(--bg-input);
      color: var(--text-primary);
      border-radius: 36rpx;
      padding: 0 50rpx 0 32rpx;
      font-size: 14px;
    }

    .search-icon {
      position: absolute;
      right: 24rpx;
      top: 50%;
      transform: translateY(-50%);
      font-size: 16px;
    }

    .search-mode-btn {
      position: absolute;
      right: 60rpx;
      top: 50%;
      transform: translateY(-50%);
      padding: 8rpx 16rpx;
      background-color: var(--bg-success-light);
      border-radius: 20rpx;
      display: flex;
      align-items: center;
      justify-content: center;

      .mode-icon {
        font-size: 14px;
      }
    }
  }

  .folder-btn {
    width: 72rpx;
    height: 72rpx;
    background-color: var(--bg-input);
    border-radius: 36rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 16rpx;

    .folder-icon {
      font-size: 16px;
    }
  }

  .stats-btn {
    width: 72rpx;
    height: 72rpx;
    background-color: var(--bg-input);
    border-radius: 36rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 16rpx;

    .stats-icon {
      font-size: 16px;
    }
  }

  .filter-btn {
    width: 72rpx;
    height: 72rpx;
    background-color: var(--bg-input);
    border-radius: 36rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 16rpx;

    .filter-icon {
      font-size: 16px;
    }
  }
}

.tags-bar {
  background-color: var(--bg-card);
  padding: 16rpx 24rpx;
  white-space: nowrap;
  border-bottom: 1rpx solid var(--border-light);

  .tag-list {
    display: inline-flex;
    gap: 16rpx;

    .tag-item {
      display: inline-flex;
      align-items: center;
      gap: 8rpx;
      padding: 12rpx 24rpx;
      background-color: var(--bg-input);
      border-radius: 32rpx;
      font-size: 12px;
      color: var(--text-secondary);
      border: 2rpx solid transparent;
      transition: all 0.2s;

      &.active {
        background-color: var(--color-primary);
        color: var(--text-inverse);
        border-color: var(--color-primary);
      }

      .tag-dot {
        width: 12rpx;
        height: 12rpx;
        border-radius: 50%;
      }

      .tag-icon {
        font-size: 14px;
      }

      .tag-name {
        font-size: 12px;
      }

      .tag-count {
        font-size: 10px;
        opacity: 0.7;
      }
    }
  }
}

.list-container {
  padding: 24rpx;
}

.loading, .empty {
  text-align: center;
  padding: 100rpx 40rpx;
  color: var(--text-tertiary);
}

.empty-icon {
  display: block;
  font-size: 60px;
  margin-bottom: 20rpx;
}

.empty-text {
  display: block;
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 40rpx;
}

.add-btn {
  background-color: var(--color-primary);
  color: var(--text-inverse);
  border-radius: 48rpx;
  padding: 20rpx 60rpx;
  font-size: 14px;
  border: none;

  &::after {
    border: none;
  }
}

.item {
  background-color: var(--bg-card);
  border-radius: 16rpx;
  padding: 32rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--shadow-sm);

  .item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16rpx;

    .item-title {
      flex: 1;
      font-size: 16px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .item-badges {
      display: flex;
      align-items: center;
      gap: 8rpx;

      .relevance-score {
        font-size: 11px;
        padding: 4rpx 12rpx;
        background-color: var(--color-primary);
        color: var(--text-inverse);
        border-radius: 12rpx;
        font-weight: 500;
      }

      .source-badge {
        font-size: 12px;
        padding: 2rpx 6rpx;
      }

      .favorite-icon,
      .favorite-icon-empty {
        font-size: 18px;
        padding: 8rpx;
      }

      .favorite-icon {
        color: var(--color-favorite);
      }

      .favorite-icon-empty {
        color: var(--text-tertiary);
        opacity: 0.5;
      }
    }
  }

  .item-content {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 16rpx;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .item-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12rpx;

    .item-tags {
      flex: 1;
      display: flex;
      flex-wrap: wrap;
      gap: 12rpx;

      .item-tag {
        display: inline-flex;
        align-items: center;
        padding: 6rpx 16rpx;
        border-radius: 16rpx;
        border: 1rpx solid;

        .item-tag-name {
          font-size: 11px;
          font-weight: 500;
        }
      }
    }

    .item-time {
      font-size: 12px;
      color: var(--text-tertiary);
    }
  }
}

.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 112rpx;
  height: 112rpx;
  background-color: var(--color-primary);
  border-radius: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.4);

  .fab-icon {
    font-size: 30px;
    color: var(--text-inverse);
    line-height: 1;
  }
}

// 筛选弹窗
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
    max-height: 80vh;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 18px;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .filter-section {
      margin-bottom: 32rpx;

      .filter-label {
        display: block;
        font-size: 14px;
        color: var(--text-secondary);
        margin-bottom: 16rpx;
      }

      .filter-options {
        display: flex;
        flex-wrap: wrap;
        gap: 16rpx;

        .filter-option {
          padding: 16rpx 32rpx;
          background-color: var(--bg-input);
          border-radius: 32rpx;
          font-size: 13px;
          color: var(--text-secondary);
          border: 2rpx solid transparent;
          transition: all 0.2s;

          &.active {
            background-color: var(--bg-success-light);
            color: var(--color-primary);
            border-color: var(--color-primary);
          }
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;
      margin-top: 40rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 15px;
        font-weight: 500;
        border: none;

        &::after {
          border: none;
        }

        &.cancel {
          background-color: var(--bg-input);
          color: var(--text-secondary);
        }

        &.confirm {
          background-color: var(--color-primary);
          color: var(--text-inverse);
        }
      }
    }
  }
}
</style>
