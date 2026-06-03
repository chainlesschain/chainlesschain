<template>
  <view class="folder-selector-modal" v-if="visible" @click="handleClose">
    <view class="modal-content" @click.stop>
      <text class="modal-title">选择目标文件夹</text>

      <!-- 根目录选项 -->
      <view
        class="folder-option root-option"
        :class="{ selected: selectedFolderId === null }"
        @click="selectFolder(null)"
      >
        <text class="folder-icon">📁</text>
        <text class="folder-name">根目录</text>
        <text class="check-icon" v-if="selectedFolderId === null">✓</text>
      </view>

      <!-- 文件夹列表 -->
      <scroll-view class="folder-list" scroll-y>
        <view
          class="folder-option"
          :class="{ selected: selectedFolderId === folder.id }"
          v-for="folder in folders"
          :key="folder.id"
          @click="selectFolder(folder.id)"
        >
          <view class="folder-icon-wrapper" :style="{ backgroundColor: folder.color + '20' }">
            <text class="folder-icon" :style="{ color: folder.color }">
              {{ folder.icon || '📁' }}
            </text>
          </view>
          <text class="folder-name">{{ folder.name }}</text>
          <text class="folder-count">{{ folderCounts[folder.id] || 0 }} 项</text>
          <text class="check-icon" v-if="selectedFolderId === folder.id">✓</text>
        </view>

        <view class="empty" v-if="folders.length === 0">
          <text class="empty-text">暂无文件夹</text>
        </view>
      </scroll-view>

      <!-- 操作按钮 -->
      <view class="modal-actions">
        <button class="modal-btn cancel" @click="handleClose">
          <text>取消</text>
        </button>
        <button class="modal-btn confirm" @click="handleConfirm">
          <text>确定</text>
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { db } from '@/services/database'

export default {
  name: 'FolderSelector',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    currentFolderId: {
      type: [Number, String],
      default: null
    }
  },
  data() {
    return {
      folders: [],
      folderCounts: {},
      selectedFolderId: null
    }
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        this.selectedFolderId = this.currentFolderId
        this.loadFolders()
      }
    }
  },
  methods: {
    async loadFolders() {
      try {
        this.folders = await db.getFolders()

        // 加载每个文件夹的知识数量
        for (const folder of this.folders) {
          const count = await db.getFolderKnowledgeCount(folder.id)
          this.folderCounts[folder.id] = count
        }

        this.$forceUpdate()
      } catch (error) {
        console.error('加载文件夹失败:', error)
      }
    },

    selectFolder(folderId) {
      this.selectedFolderId = folderId
    },

    handleClose() {
      this.$emit('close')
    },

    handleConfirm() {
      this.$emit('confirm', this.selectedFolderId)
    }
  }
}
</script>

<style lang="scss" scoped>
.folder-selector-modal {
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
    max-height: 80vh;
    background-color: var(--bg-card);
    border-radius: 32rpx 32rpx 0 0;
    padding: 40rpx;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s ease-out;

    .modal-title {
      display: block;
      font-size: 18px;
      font-weight: bold;
      color: var(--text-primary);
      margin-bottom: 32rpx;
      text-align: center;
    }

    .root-option {
      margin-bottom: 16rpx;
      padding-bottom: 16rpx;
      border-bottom: 1rpx solid var(--border-color);
    }

    .folder-list {
      flex: 1;
      max-height: 500rpx;
      margin-bottom: 24rpx;

      .folder-option {
        display: flex;
        align-items: center;
        gap: 16rpx;
        padding: 20rpx;
        background-color: var(--bg-input);
        border-radius: 12rpx;
        margin-bottom: 12rpx;
        transition: all 0.2s;

        &.selected {
          background-color: var(--color-primary) + '20';
          border: 2rpx solid var(--color-primary);
        }

        &:active {
          transform: scale(0.98);
        }

        .folder-icon-wrapper {
          width: 64rpx;
          height: 64rpx;
          border-radius: 12rpx;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          .folder-icon {
            font-size: 20px;
          }
        }

        .folder-icon {
          font-size: 20px;
          flex-shrink: 0;
        }

        .folder-name {
          flex: 1;
          font-size: 15px;
          font-weight: 500;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .folder-count {
          font-size: 12px;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .check-icon {
          font-size: 18px;
          color: var(--color-primary);
          font-weight: bold;
          flex-shrink: 0;
        }
      }

      .empty {
        text-align: center;
        padding: 60rpx 20rpx;

        .empty-text {
          font-size: 14px;
          color: var(--text-tertiary);
        }
      }
    }

    .modal-actions {
      display: flex;
      gap: 20rpx;

      .modal-btn {
        flex: 1;
        height: 88rpx;
        border-radius: 44rpx;
        font-size: 15px;
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
        }
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
