<template>
  <view class="folders-page">
    <view class="loading" v-if="loading">
      <text>加载中...</text>
    </view>

    <view class="content" v-else>
      <!-- 文件夹列表 -->
      <view class="folder-list" v-if="folders.length > 0">
        <view
          class="folder-item"
          v-for="folder in folders"
          :key="folder.id"
          @click="viewFolder(folder)"
        >
          <view class="folder-icon" :style="{ backgroundColor: folder.color + '20' }">
            <text :style="{ color: folder.color }">{{ folder.icon || '📁' }}</text>
          </view>
          <view class="folder-info">
            <text class="folder-name">{{ folder.name }}</text>
            <text class="folder-count">{{ folderCounts[folder.id] || 0 }} 项</text>
          </view>
          <view class="folder-actions">
            <text class="action-btn" @click.stop="editFolder(folder)">✏️</text>
            <text class="action-btn" @click.stop="confirmDeleteFolder(folder)">🗑️</text>
          </view>
        </view>
      </view>

      <!-- 空状态 -->
      <view class="empty" v-else>
        <text class="empty-icon">📁</text>
        <text class="empty-text">还没有文件夹，点击下方按钮创建</text>
      </view>
    </view>

    <!-- 添加按钮 -->
    <view class="fab" @click="showCreateModal = true">
      <text class="fab-icon">+</text>
    </view>

    <!-- 创建/编辑文件夹弹窗 -->
    <view class="modal" v-if="showCreateModal" @click="showCreateModal = false">
      <view class="modal-content" @click.stop>
        <text class="modal-title">{{ editingFolder ? '编辑文件夹' : '创建文件夹' }}</text>

        <view class="form">
          <view class="form-item">
            <text class="label">文件夹名称</text>
            <input
              class="input"
              v-model="folderForm.name"
              placeholder="请输入文件夹名称"
              maxlength="20"
            />
          </view>

          <view class="form-item">
            <text class="label">图标</text>
            <view class="icon-selector">
              <view
                class="icon-option"
                v-for="icon in iconOptions"
                :key="icon"
                :class="{ active: folderForm.icon === icon }"
                @click="folderForm.icon = icon"
              >
                <text>{{ icon }}</text>
              </view>
            </view>
          </view>

          <view class="form-item">
            <text class="label">颜色</text>
            <view class="color-selector">
              <view
                class="color-option"
                v-for="color in colorOptions"
                :key="color"
                :class="{ active: folderForm.color === color }"
                :style="{ backgroundColor: color }"
                @click="folderForm.color = color"
              >
                <text v-if="folderForm.color === color" class="check">✓</text>
              </view>
            </view>
          </view>
        </view>

        <view class="modal-actions">
          <button class="modal-btn cancel" @click="cancelEdit">
            <text>取消</text>
          </button>
          <button
            class="modal-btn confirm"
            :disabled="!folderForm.name"
            @click="saveFolder"
          >
            <text>{{ editingFolder ? '保存' : '创建' }}</text>
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
      loading: false,
      folders: [],
      folderCounts: {},
      showCreateModal: false,
      editingFolder: null,
      folderForm: {
        name: '',
        icon: '📁',
        color: '#3cc51f'
      },
      iconOptions: ['📁', '📂', '📚', '📖', '📝', '💼', '🎯', '⭐', '🔖', '📌', '🏷️', '🎨'],
      colorOptions: [
        '#3cc51f', '#1890ff', '#722ed1', '#eb2f96',
        '#fa8c16', '#fadb14', '#52c41a', '#13c2c2',
        '#2f54eb', '#f5222d', '#fa541c', '#a0d911'
      ]
    }
  },
  onLoad() {
    this.loadFolders()
  },
  onShow() {
    // 页面显示时刷新数据
    this.loadFolders()
  },
  methods: {
    async loadFolders() {
      this.loading = true
      try {
        this.folders = await db.getFolders()

        // 加载每个文件夹的知识数量
        for (const folder of this.folders) {
          const count = await db.getFolderKnowledgeCount(folder.id)
          this.folderCounts[folder.id] = count
        }

        // 强制更新
        this.$forceUpdate()
      } catch (error) {
        console.error('加载文件夹失败:', error)
        uni.showToast({
          title: '加载失败',
          icon: 'none'
        })
      } finally {
        this.loading = false
      }
    },

    viewFolder(folder) {
      // 跳转到知识列表，并筛选该文件夹
      uni.navigateTo({
        url: `/pages/knowledge/list/list?folderId=${folder.id}`
      })
    },

    editFolder(folder) {
      this.editingFolder = folder
      this.folderForm = {
        name: folder.name,
        icon: folder.icon || '📁',
        color: folder.color || '#3cc51f'
      }
      this.showCreateModal = true
    },

    async saveFolder() {
      if (!this.folderForm.name.trim()) {
        uni.showToast({
          title: '请输入文件夹名称',
          icon: 'none'
        })
        return
      }

      try {
        if (this.editingFolder) {
          // 更新文件夹
          await db.updateFolder(this.editingFolder.id, {
            name: this.folderForm.name.trim(),
            icon: this.folderForm.icon,
            color: this.folderForm.color
          })

          uni.showToast({
            title: '更新成功',
            icon: 'success'
          })
        } else {
          // 创建文件夹
          await db.createFolder(
            this.folderForm.name.trim(),
            null,
            this.folderForm.color,
            this.folderForm.icon
          )

          uni.showToast({
            title: '创建成功',
            icon: 'success'
          })
        }

        this.showCreateModal = false
        this.cancelEdit()
        await this.loadFolders()
      } catch (error) {
        console.error('保存文件夹失败:', error)
        uni.showToast({
          title: '保存失败',
          icon: 'none'
        })
      }
    },

    confirmDeleteFolder(folder) {
      const count = this.folderCounts[folder.id] || 0

      uni.showModal({
        title: '确认删除',
        content: count > 0
          ? `删除后，文件夹中的 ${count} 项知识将移至根目录，确定删除吗？`
          : '确定要删除这个文件夹吗？',
        success: async (res) => {
          if (res.confirm) {
            await this.deleteFolder(folder.id)
          }
        }
      })
    },

    async deleteFolder(folderId) {
      try {
        await db.deleteFolder(folderId)

        uni.showToast({
          title: '删除成功',
          icon: 'success'
        })

        await this.loadFolders()
      } catch (error) {
        console.error('删除文件夹失败:', error)
        uni.showToast({
          title: '删除失败',
          icon: 'none'
        })
      }
    },

    cancelEdit() {
      this.editingFolder = null
      this.folderForm = {
        name: '',
        icon: '📁',
        color: '#3cc51f'
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.folders-page {
  min-height: 100vh;
  background-color: var(--bg-page);
  padding-bottom: 120rpx;
}

.loading {
  padding: 100rpx 40rpx;
  text-align: center;
  color: var(--text-tertiary);
}

.content {
  padding: 20rpx;
}

// 文件夹列表
.folder-list {
  .folder-item {
    display: flex;
    align-items: center;
    gap: 20rpx;
    padding: 24rpx;
    background-color: var(--bg-card);
    border-radius: 12rpx;
    margin-bottom: 16rpx;
    box-shadow: var(--shadow-sm);

    .folder-icon {
      width: 80rpx;
      height: 80rpx;
      border-radius: 16rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48rpx;
      flex-shrink: 0;
    }

    .folder-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8rpx;
      overflow: hidden;

      .folder-name {
        font-size: 30rpx;
        font-weight: 500;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .folder-count {
        font-size: 24rpx;
        color: var(--text-tertiary);
      }
    }

    .folder-actions {
      display: flex;
      gap: 16rpx;
      flex-shrink: 0;

      .action-btn {
        font-size: 36rpx;
        width: 64rpx;
        height: 64rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--bg-input);
        border-radius: 12rpx;

        &:active {
          background-color: var(--bg-hover);
        }
      }
    }
  }
}

// 空状态
.empty {
  text-align: center;
  padding: 120rpx 40rpx;

  .empty-icon {
    display: block;
    font-size: 120rpx;
    margin-bottom: 20rpx;
  }

  .empty-text {
    font-size: 28rpx;
    color: var(--text-secondary);
  }
}

// 浮动按钮
.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 112rpx;
  height: 112rpx;
  background: linear-gradient(135deg, #3cc51f 0%, #52c41a 100%);
  border-radius: 56rpx;
  box-shadow: 0 8rpx 24rpx rgba(60, 197, 31, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;

  .fab-icon {
    font-size: 72rpx;
    color: #ffffff;
    font-weight: 300;
  }

  &:active {
    transform: scale(0.95);
  }
}

// 弹窗
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  .modal-content {
    width: 680rpx;
    max-height: 80vh;
    background-color: var(--bg-card);
    border-radius: 16rpx;
    padding: 40rpx;
    overflow-y: auto;

    .modal-title {
      display: block;
      font-size: 36rpx;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .form {
      .form-item {
        margin-bottom: 32rpx;

        .label {
          display: block;
          font-size: 28rpx;
          font-weight: 500;
          color: var(--text-primary);
          margin-bottom: 16rpx;
        }

        .input {
          width: 100%;
          height: 72rpx;
          padding: 0 24rpx;
          background-color: var(--bg-input);
          border-radius: 8rpx;
          font-size: 28rpx;
          color: var(--text-primary);
        }

        .icon-selector,
        .color-selector {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 16rpx;
        }

        .icon-option {
          aspect-ratio: 1;
          background-color: var(--bg-input);
          border-radius: 12rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 40rpx;
          border: 3rpx solid transparent;
          transition: all 0.2s;

          &.active {
            border-color: var(--color-primary);
            background-color: var(--color-primary) + '20';
          }

          &:active {
            transform: scale(0.95);
          }
        }

        .color-option {
          aspect-ratio: 1;
          border-radius: 50%;
          border: 3rpx solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;

          &.active {
            border-color: var(--text-primary);
            box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.2);
          }

          &:active {
            transform: scale(0.95);
          }

          .check {
            font-size: 32rpx;
            color: #ffffff;
            font-weight: bold;
          }
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;
      margin-top: 32rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 30rpx;
        font-weight: 500;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;

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

          &:disabled {
            opacity: 0.5;
          }
        }
      }
    }
  }
}
</style>
