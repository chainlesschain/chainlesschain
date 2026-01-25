<template>
  <div
    :class="['resize-handle', direction]"
    @mousedown="handleMouseDown"
  >
    <div class="resize-handle-line" />
  </div>
</template>

<script setup>
import { onBeforeUnmount } from 'vue';

const props = defineProps({
  direction: {
    type: String,
    default: 'vertical', // 'vertical' | 'horizontal'
    validator: (value) => ['vertical', 'horizontal'].includes(value),
  },
  minSize: {
    type: Number,
    default: 200,
  },
  maxSize: {
    type: Number,
    default: 800,
  },
});

const emit = defineEmits(['resize']);

let isResizing = false;
let lastX = 0;
let lastY = 0;

const handleMouseDown = (e) => {
  e.preventDefault();
  isResizing = true;
  lastX = e.clientX;
  lastY = e.clientY;

  // 添加全局事件监听
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  // 添加拖拽样式
  document.body.style.cursor = props.direction === 'vertical' ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';
};

const handleMouseMove = (e) => {
  if (!isResizing) {return;}

  // 计算增量（从上一个位置到当前位置）
  const currentX = e.clientX;
  const currentY = e.clientY;

  const delta = props.direction === 'vertical'
    ? currentX - lastX
    : currentY - lastY;

  // 更新last位置为当前位置
  lastX = currentX;
  lastY = currentY;

  emit('resize', delta);
};

const handleMouseUp = () => {
  if (!isResizing) {return;}

  isResizing = false;

  // 移除全局事件监听
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);

  // 移除拖拽样式
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

// 组件卸载时清理
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});
</script>

<style scoped>
.resize-handle {
  position: relative;
  flex-shrink: 0;
  z-index: 10;
}

.resize-handle.vertical {
  width: 4px;
  cursor: col-resize;
}

.resize-handle.horizontal {
  height: 4px;
  cursor: row-resize;
}

.resize-handle-line {
  position: absolute;
  background: transparent;
  transition: background-color 0.2s;
}

.resize-handle.vertical .resize-handle-line {
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  height: 100%;
}

.resize-handle.horizontal .resize-handle-line {
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 100%;
  height: 1px;
}

.resize-handle:hover .resize-handle-line {
  background: #3b82f6;
}

.resize-handle:active .resize-handle-line {
  background: #2563eb;
}
</style>
