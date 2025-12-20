<template>
  <view class="knowledge-list">
    <!-- 搜索栏 -->
    <view class="header">
      <view class="search-box">
        <input
          class="search-input"
          type="text"
          v-model="searchQuery"
          placeholder="搜索知识库..."
          @input="handleSearch"
        />
        <text class="search-icon">🔍</text>
      </view>
      <view class="filter-btn" @click="showFilterModal = true">
        <text class="filter-icon">{{ hasActiveFilter ? '🎯' : '☰' }}</text>
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
      <view class="loading" v-if="loading">
        <text>加载中...</text>
      </view>

      <view class="empty" v-else-if="items.length === 0">
        <text class="empty-icon">📝</text>
        <text class="empty-text">{{ emptyText }}</text>
        <button class="add-btn" @click="goToAdd" v-if="!searchQuery && !selectedTagId">
          添加第一个条目
        </button>
      </view>

      <view class="item" v-for="item in items" :key="item.id" @click="goToDetail(item.id)">
        <view class="item-header">
          <text class="item-title">{{ item.title }}</text>
          <text class="favorite-icon" v-if="item.is_favorite" @click.stop="toggleItemFavorite(item)">⭐</text>
          <text class="favorite-icon-empty" v-else @click.stop="toggleItemFavorite(item)">☆</text>
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

    <!-- 添加按钮 -->
    <view class="fab" @click="goToAdd">
      <text class="fab-icon">+</text>
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
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  data() {
    return {
      searchQuery: '',
      items: [],
      tags: [],
      itemTags: {}, // 每个知识项的标签
      loading: false,
      selectedTagId: null,
      favoriteOnly: false,
      showFilterModal: false,
      sortBy: 'updated',
      filterType: null
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
  onLoad() {
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
        this.loadItems()
      }, 300)
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
     * 跳转到添加
     */
    goToAdd() {
      uni.navigateTo({
        url: '/pages/knowledge/edit/edit'
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
      font-size: 28rpx;
    }

    .search-icon {
      position: absolute;
      right: 24rpx;
      top: 50%;
      transform: translateY(-50%);
      font-size: 32rpx;
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

    .filter-icon {
      font-size: 32rpx;
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
      font-size: 24rpx;
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
        font-size: 28rpx;
      }

      .tag-name {
        font-size: 24rpx;
      }

      .tag-count {
        font-size: 20rpx;
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
  font-size: 120rpx;
  margin-bottom: 20rpx;
}

.empty-text {
  display: block;
  font-size: 28rpx;
  color: var(--text-secondary);
  margin-bottom: 40rpx;
}

.add-btn {
  background-color: var(--color-primary);
  color: var(--text-inverse);
  border-radius: 48rpx;
  padding: 20rpx 60rpx;
  font-size: 28rpx;
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
      font-size: 32rpx;
      font-weight: 500;
      color: var(--text-primary);
    }

    .favorite-icon,
    .favorite-icon-empty {
      font-size: 36rpx;
      margin-left: 16rpx;
      padding: 8rpx;
    }

    .favorite-icon {
      color: #fadb14;
    }

    .favorite-icon-empty {
      color: var(--text-tertiary);
      opacity: 0.5;
    }
  }

  .item-content {
    display: block;
    font-size: 26rpx;
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
          font-size: 22rpx;
          font-weight: 500;
        }
      }
    }

    .item-time {
      font-size: 24rpx;
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
    font-size: 60rpx;
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
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .filter-section {
      margin-bottom: 32rpx;

      .filter-label {
        display: block;
        font-size: 28rpx;
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
          font-size: 26rpx;
          color: var(--text-secondary);
          border: 2rpx solid transparent;
          transition: all 0.2s;

          &.active {
            background-color: #e6f7e6;
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
        font-size: 30rpx;
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
