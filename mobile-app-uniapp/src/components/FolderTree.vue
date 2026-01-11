<template>
  <view class="folder-tree">
    <!-- 根目录 -->
    <view class="tree-node root-node" @click="selectFolder(null)">
      <view class="node-content" :class="{ active: selectedFolderId === null }">
        <text class="node-icon">📁</text>
        <text class="node-name">根目录</text>
        <text class="node-count">{{ rootCount }} 项</text>
      </view>
    </view>

    <!-- 文件夹树 -->
    <view class="tree-list">
      <folder-tree-node
        v-for="folder in rootFolders"
        :key="folder.id"
        :folder="folder"
        :level="0"
        :selected-id="selectedFolderId"
        :folder-counts="folderCounts"
        :all-folders="allFolders"
        @select="handleSelect"
        @edit="handleEdit"
        @delete="handleDelete"
        @move="handleMove"
      />
    </view>
  </view>
</template>

<script>
import FolderTreeNode from './FolderTreeNode.vue'

export default {
  name: 'FolderTree',
  components: {
    FolderTreeNode
  },
  props: {
    folders: {
      type: Array,
      default: () => []
    },
    folderCounts: {
      type: Object,
      default: () => ({})
    },
    selectedFolderId: {
      type: [Number, String],
      default: null
    },
    rootCount: {
      type: Number,
      default: 0
    }
  },
  computed: {
    // 所有文件夹的映射
    allFolders() {
      return this.folders
    },

    // 根级文件夹（没有父文件夹的）
    rootFolders() {
      return this.folders.filter(f => !f.parent_id)
    }
  },
  methods: {
    selectFolder(folderId) {
      this.$emit('select', folderId)
    },

    handleSelect(folderId) {
      this.$emit('select', folderId)
    },

    handleEdit(folder) {
      this.$emit('edit', folder)
    },

    handleDelete(folder) {
      this.$emit('delete', folder)
    },

    handleMove(data) {
      this.$emit('move', data)
    }
  }
}
</script>

<style lang="scss" scoped>
.folder-tree {
  .root-node {
    margin-bottom: 8rpx;

    .node-content {
      display: flex;
      align-items: center;
      gap: 16rpx;
      padding: 20rpx 24rpx;
      background-color: var(--bg-card);
      border-radius: 12rpx;
      transition: all 0.2s;

      &.active {
        background-color: var(--color-primary);

        .node-icon,
        .node-name,
        .node-count {
          color: #ffffff;
        }
      }

      &:active {
        transform: scale(0.98);
      }

      .node-icon {
        font-size: 20px;
      }

      .node-name {
        flex: 1;
        font-size: 15px;
        font-weight: 500;
        color: var(--text-primary);
      }

      .node-count {
        font-size: 12px;
        color: var(--text-tertiary);
      }
    }
  }

  .tree-list {
    display: flex;
    flex-direction: column;
    gap: 4rpx;
  }
}
</style>
