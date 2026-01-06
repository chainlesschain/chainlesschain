<template>
  <div class="skeleton-loader" :class="{ 'skeleton-animated': animated }">
    <template v-if="type === 'file-tree'">
      <FileTreeSkeleton :rows="rows" />
    </template>

    <template v-else-if="type === 'editor'">
      <EditorSkeleton />
    </template>

    <template v-else-if="type === 'chat'">
      <ChatSkeleton :messages="rows" />
    </template>

    <template v-else-if="type === 'card'">
      <CardSkeleton />
    </template>

    <template v-else-if="type === 'list'">
      <ListSkeleton :rows="rows" />
    </template>

    <template v-else>
      <!-- 通用骨架屏 -->
      <div class="skeleton-generic">
        <div v-for="i in rows" :key="i" class="skeleton-line" :style="getLineStyle(i)"></div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import FileTreeSkeleton from './skeleton/FileTreeSkeleton.vue'
import EditorSkeleton from './skeleton/EditorSkeleton.vue'
import ChatSkeleton from './skeleton/ChatSkeleton.vue'
import CardSkeleton from './skeleton/CardSkeleton.vue'
import ListSkeleton from './skeleton/ListSkeleton.vue'

const props = defineProps({
  type: {
    type: String,
    default: 'generic',
    validator: (value) => ['file-tree', 'editor', 'chat', 'card', 'list', 'generic'].includes(value)
  },
  rows: {
    type: Number,
    default: 5
  },
  animated: {
    type: Boolean,
    default: true
  }
})

const getLineStyle = (index) => {
  // 为不同行添加不同宽度，使其看起来更自然
  const widths = [100, 95, 85, 90, 75, 100, 80]
  const width = widths[index % widths.length]
  return {
    width: `${width}%`
  }
}
</script>

<style scoped>
.skeleton-loader {
  padding: 12px;
}

/* 骨架屏基础样式 */
.skeleton-line {
  height: 16px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 4px;
  margin-bottom: 12px;
}

/* 动画效果 */
.skeleton-animated .skeleton-line {
  animation: skeleton-loading 1.5s ease-in-out infinite;
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* 暗色主题支持 */
.dark .skeleton-line {
  background: linear-gradient(90deg, #2a2a2a 25%, #1f1f1f 50%, #2a2a2a 75%);
  background-size: 200% 100%;
}

.skeleton-generic {
  padding: 8px 0;
}
</style>
