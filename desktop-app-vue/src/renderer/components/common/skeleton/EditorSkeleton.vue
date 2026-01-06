<template>
  <div class="editor-skeleton">
    <!-- 编辑器工具栏 -->
    <div class="editor-toolbar">
      <div class="toolbar-left">
        <div class="skeleton-box button" v-for="i in 5" :key="i"></div>
      </div>
      <div class="toolbar-right">
        <div class="skeleton-box button small" v-for="i in 3" :key="'r' + i"></div>
      </div>
    </div>

    <!-- 编辑器内容区 -->
    <div class="editor-content">
      <!-- 行号 -->
      <div class="line-numbers">
        <div v-for="i in 25" :key="i" class="line-number skeleton-text">{{ i }}</div>
      </div>

      <!-- 代码行 -->
      <div class="code-lines">
        <div v-for="i in 25" :key="i" class="code-line" :style="getLineStyle(i)">
          <div class="skeleton-box code-segment" :style="getSegmentStyle(i, 0)"></div>
          <div class="skeleton-box code-segment" :style="getSegmentStyle(i, 1)"></div>
          <div class="skeleton-box code-segment" :style="getSegmentStyle(i, 2)"></div>
        </div>
      </div>
    </div>

    <!-- 编辑器状态栏 -->
    <div class="editor-statusbar">
      <div class="skeleton-box status-item"></div>
      <div class="skeleton-box status-item"></div>
      <div class="skeleton-box status-item"></div>
    </div>
  </div>
</template>

<script setup>
const getLineStyle = (index) => {
  return {
    animationDelay: `${index * 0.02}s`
  }
}

const getSegmentStyle = (lineIndex, segmentIndex) => {
  // 模拟代码片段的不同长度
  const widths = [
    [40, 60, 80],
    [30, 50, 0],
    [50, 70, 90],
    [60, 0, 0],
    [35, 55, 75],
    [45, 65, 0],
    [0, 0, 0], // 空行
    [40, 60, 80],
  ]

  const pattern = widths[lineIndex % widths.length]
  const width = pattern[segmentIndex]

  return {
    width: width ? `${width}px` : '0',
    marginRight: width ? '8px' : '0'
  }
}
</script>

<style scoped>
.editor-skeleton {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #1e1e1e;
  border-radius: 4px;
  overflow: hidden;
}

/* 工具栏 */
.editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  background-color: #2d2d2d;
  border-bottom: 1px solid #3e3e3e;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  gap: 8px;
}

.skeleton-box.button {
  width: 32px;
  height: 24px;
}

.skeleton-box.button.small {
  width: 24px;
  height: 20px;
}

/* 编辑器内容 */
.editor-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  padding: 12px 0;
}

.line-numbers {
  width: 50px;
  padding-left: 12px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #858585;
  text-align: right;
  user-select: none;
}

.line-number {
  height: 20px;
  line-height: 20px;
  opacity: 0.5;
}

.code-lines {
  flex: 1;
  padding: 0 12px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
}

.code-line {
  display: flex;
  align-items: center;
  height: 20px;
  opacity: 0;
  animation: fadeIn 0.3s ease-out forwards;
}

@keyframes fadeIn {
  to {
    opacity: 1;
  }
}

.code-segment {
  height: 14px;
}

/* 状态栏 */
.editor-statusbar {
  display: flex;
  gap: 16px;
  height: 28px;
  padding: 0 12px;
  background-color: #2d2d2d;
  border-top: 1px solid #3e3e3e;
  align-items: center;
}

.status-item {
  width: 60px;
  height: 14px;
}

/* 骨架屏动画 */
.skeleton-box {
  background: linear-gradient(90deg, #2a2a2a 25%, #1f1f1f 50%, #2a2a2a 75%);
  background-size: 200% 100%;
  border-radius: 3px;
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

.skeleton-text {
  background: none;
}
</style>
