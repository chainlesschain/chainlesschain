<template>
  <view class="tree-node" :style="{ paddingLeft: (level * 32) + 'rpx' }">
    <!-- 节点内容 -->
    <view class="node-content" :class="{ active: selectedId === folder.id }">
      <!-- 展开/折叠按钮 -->
      <view
        v-if="hasChildren"
        class="expand-btn"
        @click.stop="toggleExpand"
      >
        <text class="expand-icon" :class="{ expanded: isExpanded }">▶</text>
      </view>
      <view v-else class="expand-placeholder"></view>

      <!-- 文件夹信息 -->
      <view class="node-info" @click="selectFolder">
        <view class="folder-icon" :style="{ backgroundColor: folder.color + '20' }">
          <text :style="{ color: folder.color }">{{ folder.icon || '📁' }}</text>
        </view>
        <text class="node-name">{{ folder.name }}</text>
        <text class="node-count">{{ folderCounts[folder.id] || 0 }} 项</text>
      </view>

      <!-- 操作按钮 -->
      <view class="node-actions">
        <text class="action-btn" @click.stop="editFolder">✏️</text>
        <text class="action-btn" @click.stop="deleteFolder">🗑️</text>
      </view>
    </view>

    <!-- 子文件夹 -->
    <view v-if="isExpanded && hasChildren" class="children">
      <folder-tree-node
        v-for="child in children"
        :key="child.id"
        :folder="child"
        :level="level + 1"
        :selected-id="selectedId"
        :folder-counts="folderCounts"
        :all-folders="allFolders"
        @select="$emit('select', $event)"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
        @move="$emit('move', $event)"
      />
    </view>
  </view>
</template>

<script>
export default {
  name: 'FolderTreeNode',
  props: {
    folder: {
      type: Object,
      required: true
    },
    level: {
      type: Number,
      default: 0
    },
    selectedId: {
      type: [Number, String],
      default: null
    },
    folderCounts: {
      type: Object,
      default: () => ({})
    },
    allFolders: {
      type: Array,
      default: () => []
    }
  },
  data() {
    return {
      isExpanded: false
    }
  },
  computed: {
    // 子文件夹
    children() {
      return this.allFolders.filter(f => f.parent_id === this.folder.id)
    },

    // 是否有子文件夹
    hasChildren() {
      return this.children.length > 0
    }
  },
  methods: {
    toggleExpand() {
      this.isExpanded = !this.isExpanded
    },

    selectFolder() {
      this.$emit('select', this.folder.id)
    },

    editFolder() {
      this.$emit('edit', this.folder)
    },

    deleteFolder() {
      this.$emit('delete', this.folder)
    }
  }
}
</script>

<style lang="scss" scoped>
.tree-node {
  .node-content {
    display: flex;
    align-items: center;
    gap: 12rpx;
    padding: 16rpx 20rpx;
    background-color: var(--bg-card);
    border-radius: 12rpx;
    margin-bottom: 4rpx;
    transition: all 0.2s;

    &.active {
      background-color: var(--color-primary);

      .node-name,
      .node-count {
        color: #ffffff;
      }

      .expand-icon {
        color: #ffffff;
      }
    }

    &:active {
      transform: scale(0.98);
    }

    .expand-btn {
      width: 48rpx;
      height: 48rpx;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .expand-icon {
        font-size: 12px;
        color: var(--text-tertiary);
        transition: transform 0.2s;

        &.expanded {
          transform: rotate(90deg);
        }
      }
    }

    .expand-placeholder {
      width: 48rpx;
      flex-shrink: 0;
    }

    .node-info {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 16rpx;
      overflow: hidden;

      .folder-icon {
        width: 56rpx;
        height: 56rpx;
        border-radius: 12rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
      }

      .node-name {
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .node-count {
        font-size: 11px;
        color: var(--text-tertiary);
        flex-shrink: 0;
      }
    }

    .node-actions {
      display: flex;
      gap: 8rpx;
      flex-shrink: 0;

      .action-btn {
        font-size: 16px;
        width: 56rpx;
        height: 56rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--bg-input);
        border-radius: 10rpx;

        &:active {
          background-color: var(--bg-hover);
        }
      }
    }
  }

  .children {
    margin-top: 4rpx;
  }
}
</style>
