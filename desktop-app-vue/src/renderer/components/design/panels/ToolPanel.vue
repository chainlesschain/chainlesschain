<template>
  <div class="tool-panel">
    <div class="tool-section">
      <h4>工具</h4>
      <div class="tool-buttons">
        <a-tooltip
          title="选择 (V)"
          placement="right"
        >
          <a-button
            :type="activeTool === 'select' ? 'primary' : 'default'"
            class="tool-btn"
            @click="selectTool('select')"
          >
            <template #icon>
              <span class="icon">⬆️</span>
            </template>
          </a-button>
        </a-tooltip>

        <a-tooltip
          title="矩形 (R)"
          placement="right"
        >
          <a-button
            :type="activeTool === 'rect' ? 'primary' : 'default'"
            class="tool-btn"
            @click="selectTool('rect')"
          >
            <template #icon>
              <span class="icon">⬜</span>
            </template>
          </a-button>
        </a-tooltip>

        <a-tooltip
          title="圆形 (C)"
          placement="right"
        >
          <a-button
            :type="activeTool === 'circle' ? 'primary' : 'default'"
            class="tool-btn"
            @click="selectTool('circle')"
          >
            <template #icon>
              <span class="icon">⭕</span>
            </template>
          </a-button>
        </a-tooltip>

        <a-tooltip
          title="文本 (T)"
          placement="right"
        >
          <a-button
            :type="activeTool === 'text' ? 'primary' : 'default'"
            class="tool-btn"
            @click="selectTool('text')"
          >
            <template #icon>
              <span class="icon">T</span>
            </template>
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <a-divider />

    <div class="tool-section">
      <h4>颜色</h4>
      <div class="color-inputs">
        <div class="color-item">
          <label>填充</label>
          <input
            type="color"
            :value="currentFillColor"
            class="color-picker"
            @input="updateFillColor($event.target.value)"
          >
          <span class="color-value">{{ currentFillColor }}</span>
        </div>

        <div class="color-item">
          <label>描边</label>
          <input
            type="color"
            :value="currentStrokeColor"
            class="color-picker"
            @input="updateStrokeColor($event.target.value)"
          >
          <span class="color-value">{{ currentStrokeColor }}</span>
        </div>

        <div class="stroke-width">
          <label>描边宽度</label>
          <a-slider
            :min="0"
            :max="20"
            :value="currentStrokeWidth"
            @change="updateStrokeWidth"
          />
          <span>{{ currentStrokeWidth }}px</span>
        </div>
      </div>
    </div>

    <a-divider />

    <div class="tool-section">
      <h4>视图</h4>
      <div class="view-controls">
        <a-button
          block
          @click="toggleGrid"
        >
          {{ showGrid ? '隐藏网格' : '显示网格' }}
        </a-button>

        <div class="zoom-control">
          <label>缩放</label>
          <a-slider
            :min="10"
            :max="400"
            :value="zoom"
            @change="updateZoom"
          />
          <span>{{ zoom }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useDesignStore } from '../../../stores/design';
import { storeToRefs } from 'pinia';

const designStore = useDesignStore();
const {
  activeTool,
  currentFillColor,
  currentStrokeColor,
  currentStrokeWidth,
  showGrid,
  zoom
} = storeToRefs(designStore);

/**
 * 选择工具
 */
function selectTool(tool) {
  designStore.setActiveTool(tool);
}

/**
 * 更新填充颜色
 */
function updateFillColor(color) {
  designStore.setFillColor(color);
}

/**
 * 更新描边颜色
 */
function updateStrokeColor(color) {
  designStore.setStrokeColor(color);
}

/**
 * 更新描边宽度
 */
function updateStrokeWidth(width) {
  designStore.setStrokeWidth(width);
}

/**
 * 切换网格显示
 */
function toggleGrid() {
  designStore.toggleGrid();
}

/**
 * 更新缩放
 */
function updateZoom(value) {
  designStore.setZoom(value);
}

// 快捷键支持（可选）
// 可以在主编辑器页面中实现
</script>

<style scoped>
.tool-panel {
  width: 240px;
  height: 100%;
  background: #fafafa;
  border-right: 1px solid #e0e0e0;
  padding: 16px;
  overflow-y: auto;
}

.tool-section {
  margin-bottom: 16px;
}

.tool-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.tool-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.tool-btn {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-btn .icon {
  font-size: 20px;
}

.color-inputs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.color-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-item label {
  min-width: 50px;
  font-size: 13px;
  color: #666;
}

.color-picker {
  width: 40px;
  height: 32px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  cursor: pointer;
}

.color-value {
  font-size: 12px;
  color: #999;
  font-family: monospace;
}

.stroke-width {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stroke-width label {
  font-size: 13px;
  color: #666;
}

.stroke-width span {
  font-size: 12px;
  color: #999;
  text-align: right;
}

.view-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.zoom-control {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zoom-control label {
  font-size: 13px;
  color: #666;
}

.zoom-control span {
  font-size: 12px;
  color: #999;
  text-align: right;
}
</style>
