<template>
  <view class="tree-node">
    <!-- 节点内容 -->
    <view
      class="node-content"
      :style="{ paddingLeft: level * 32 + 'rpx' }"
      @tap="handleClick"
    >
      <!-- 展开/折叠图标（仅文件夹） -->
      <view v-if="node.type === 'directory'" class="expand-icon">
        <text>{{ expanded ? '▼' : '▶' }}</text>
      </view>
      <view v-else class="expand-icon placeholder"></view>

      <!-- 文件/文件夹图标 -->
      <view class="node-icon">
        <text>{{ getIcon() }}</text>
      </view>

      <!-- 文件/文件夹名称 -->
      <text class="node-name">{{ node.name }}</text>

      <!-- 文件大小（仅文件） -->
      <text v-if="node.type === 'file' && node.size" class="node-size">
        {{ formatSize(node.size) }}
      </text>
    </view>

    <!-- 子节点（文件夹展开时显示） -->
    <view v-if="node.type === 'directory' && expanded && node.children" class="children">
      <file-tree-node
        v-for="(child, index) in node.children"
        :key="index"
        :node="child"
        :level="level + 1"
        @file-click="$emit('file-click', $event)"
      />
    </view>
  </view>
</template>

<script>
export default {
  name: 'FileTreeNode',

  props: {
    node: {
      type: Object,
      required: true
    },
    level: {
      type: Number,
      default: 0
    }
  },

  data() {
    return {
      expanded: false
    }
  },

  methods: {
    /**
     * 点击节点
     */
    handleClick() {
      if (this.node.type === 'directory') {
        // 文件夹：切换展开/折叠
        this.expanded = !this.expanded
      } else {
        // 文件：触发点击事件
        this.$emit('file-click', this.node)
      }
    },

    /**
     * 获取图标
     */
    getIcon() {
      if (this.node.type === 'directory') {
        return this.expanded ? '📂' : '📁'
      }

      // 根据文件扩展名返回不同图标
      const fileName = this.node.name || ''
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
      if (!bytes) return ''

      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))

      return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
    }
  }
}
</script>

<style scoped>
.tree-node {
  font-size: 28rpx;
}

.node-content {
  display: flex;
  align-items: center;
  padding: 16rpx 32rpx;
  background-color: #fff;
  border-bottom: 1px solid #f5f5f5;
  min-height: 96rpx;
}

.node-content:active {
  background-color: #f8f9fa;
}

.expand-icon {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12rpx;
  font-size: 20rpx;
  color: #999;
}

.expand-icon.placeholder {
  visibility: hidden;
}

.node-icon {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 16rpx;
  font-size: 36rpx;
}

.node-name {
  flex: 1;
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-size {
  font-size: 24rpx;
  color: #999;
  margin-left: 16rpx;
}

.children {
  background-color: #fafafa;
}
</style>
