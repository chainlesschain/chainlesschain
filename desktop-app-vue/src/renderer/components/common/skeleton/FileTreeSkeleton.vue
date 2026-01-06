<template>
  <div class="file-tree-skeleton">
    <div v-for="i in rows" :key="i" class="tree-item-skeleton" :style="getItemStyle(i)">
      <div class="item-indent" :style="{ width: getIndent(i) + 'px' }"></div>
      <div class="item-icon skeleton-box"></div>
      <div class="item-name skeleton-box" :style="{ width: getNameWidth(i) + '%' }"></div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  rows: {
    type: Number,
    default: 10
  }
})

const getIndent = (index) => {
  // 模拟树形结构的缩进
  const levels = [0, 20, 20, 40, 40, 40, 20, 0, 20, 40]
  return levels[index % levels.length]
}

const getNameWidth = (index) => {
  // 不同长度的文件名
  const widths = [60, 45, 55, 70, 50, 65, 40, 75, 55, 60]
  return widths[index % widths.length]
}

const getItemStyle = (index) => {
  return {
    animationDelay: `${index * 0.05}s`
  }
}
</script>

<style scoped>
.file-tree-skeleton {
  padding: 8px 0;
}

.tree-item-skeleton {
  display: flex;
  align-items: center;
  height: 32px;
  margin-bottom: 4px;
  opacity: 0;
  animation: fadeIn 0.3s ease-out forwards;
}

@keyframes fadeIn {
  to {
    opacity: 1;
  }
}

.item-indent {
  flex-shrink: 0;
}

.item-icon {
  width: 16px;
  height: 16px;
  margin-right: 8px;
  flex-shrink: 0;
}

.item-name {
  height: 14px;
  max-width: 200px;
}

.skeleton-box {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  border-radius: 4px;
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

/* 暗色主题 */
.dark .skeleton-box {
  background: linear-gradient(90deg, #2a2a2a 25%, #1f1f1f 50%, #2a2a2a 75%);
  background-size: 200% 100%;
}
</style>
