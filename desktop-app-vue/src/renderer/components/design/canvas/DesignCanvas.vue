<template>
  <div class="design-canvas-container" ref="containerRef">
    <canvas ref="canvasRef" :id="canvasId"></canvas>

    <!-- 加载提示 -->
    <div v-if="loading" class="loading-overlay">
      <a-spin size="large" tip="加载中..." />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as fabric from 'fabric';
import { useDesignStore } from '../../../stores/design';
import { storeToRefs } from 'pinia';

const props = defineProps({
  artboardId: {
    type: String,
    required: true
  },
  width: {
    type: Number,
    default: 1920
  },
  height: {
    type: Number,
    default: 1080
  }
});

const emit = defineEmits(['objectsModified', 'selectionChanged']);

const designStore = useDesignStore();
const { activeTool, currentFillColor, currentStrokeColor, currentStrokeWidth } = storeToRefs(designStore);

const canvasRef = ref(null);
const containerRef = ref(null);
const fabricCanvas = ref(null);
const loading = ref(false);
const canvasId = ref(`canvas-${Date.now()}`);

// 当前绘图状态
let isDrawing = false;
let currentShape = null;
let startX = 0;
let startY = 0;

/**
 * 初始化 Fabric.js Canvas
 */
async function initializeCanvas() {
  if (!canvasRef.value) return;

  try {
    // 创建 Fabric Canvas
    fabricCanvas.value = new fabric.Canvas(canvasRef.value, {
      width: props.width,
      height: props.height,
      backgroundColor: '#FFFFFF',
      selection: true,
      preserveObjectStacking: true
    });

    // 绑定事件
    bindCanvasEvents();

    // 加载画板数据
    await loadArtboardObjects();

    console.log('[DesignCanvas] Canvas initialized successfully');
  } catch (error) {
    console.error('[DesignCanvas] Failed to initialize canvas:', error);
  }
}

/**
 * 加载画板对象
 */
async function loadArtboardObjects() {
  loading.value = true;
  try {
    const objects = await designStore.loadArtboard(props.artboardId);

    if (objects && objects.length > 0) {
      // 清空画布
      fabricCanvas.value.clear();

      // 加载每个对象
      for (const obj of objects) {
        try {
          const fabricJson = JSON.parse(obj.fabric_json);
          fabric.util.enlivenObjects([fabricJson], (objects) => {
            const fabricObj = objects[0];
            fabricObj.set({
              id: obj.id,
              name: obj.name,
              selectable: !obj.is_locked,
              visible: obj.is_visible
            });
            fabricCanvas.value.add(fabricObj);
          });
        } catch (error) {
          console.error('[DesignCanvas] Failed to load object:', error);
        }
      }

      fabricCanvas.value.renderAll();
    }
  } finally {
    loading.value = false;
  }
}

/**
 * 绑定 Canvas 事件
 */
function bindCanvasEvents() {
  if (!fabricCanvas.value) return;

  // 对象修改事件
  fabricCanvas.value.on('object:modified', handleObjectModified);

  // 选区创建事件
  fabricCanvas.value.on('selection:created', handleSelectionCreated);
  fabricCanvas.value.on('selection:updated', handleSelectionUpdated);
  fabricCanvas.value.on('selection:cleared', handleSelectionCleared);

  // 鼠标事件（用于绘图）
  fabricCanvas.value.on('mouse:down', handleMouseDown);
  fabricCanvas.value.on('mouse:move', handleMouseMove);
  fabricCanvas.value.on('mouse:up', handleMouseUp);
}

/**
 * 处理对象修改
 */
async function handleObjectModified(event) {
  const obj = event.target;

  if (obj && obj.id) {
    const fabricJson = obj.toJSON(['id', 'name']);

    // 保存到数据库
    try {
      await designStore.updateObjectProperties(obj.id, {
        fabricJson: fabricJson
      });

      emit('objectsModified');
    } catch (error) {
      console.error('[DesignCanvas] Failed to save object:', error);
    }
  }
}

/**
 * 处理选区创建
 */
function handleSelectionCreated(event) {
  updateSelection(event);
}

/**
 * 处理选区更新
 */
function handleSelectionUpdated(event) {
  updateSelection(event);
}

/**
 * 处理选区清除
 */
function handleSelectionCleared() {
  designStore.setSelectedObjects([]);
  emit('selectionChanged', []);
}

/**
 * 更新选区
 */
function updateSelection(event) {
  const selected = event.selected || [event.target];
  const selectedObjects = selected.map(obj => ({
    id: obj.id,
    type: obj.type,
    name: obj.name,
    left: obj.left,
    top: obj.top,
    width: obj.width * (obj.scaleX || 1),
    height: obj.height * (obj.scaleY || 1),
    fill: obj.fill,
    stroke: obj.stroke,
    strokeWidth: obj.strokeWidth,
    angle: obj.angle
  }));

  designStore.setSelectedObjects(selectedObjects);
  emit('selectionChanged', selectedObjects);
}

/**
 * 处理鼠标按下
 */
function handleMouseDown(options) {
  if (activeTool.value === 'select') return;

  const pointer = fabricCanvas.value.getPointer(options.e);
  startX = pointer.x;
  startY = pointer.y;
  isDrawing = true;

  // 根据当前工具创建形状
  if (activeTool.value === 'rect') {
    currentShape = new fabric.Rect({
      left: startX,
      top: startY,
      width: 0,
      height: 0,
      fill: currentFillColor.value,
      stroke: currentStrokeColor.value,
      strokeWidth: currentStrokeWidth.value
    });
    fabricCanvas.value.add(currentShape);
  } else if (activeTool.value === 'circle') {
    currentShape = new fabric.Circle({
      left: startX,
      top: startY,
      radius: 0,
      fill: currentFillColor.value,
      stroke: currentStrokeColor.value,
      strokeWidth: currentStrokeWidth.value
    });
    fabricCanvas.value.add(currentShape);
  } else if (activeTool.value === 'text') {
    const text = new fabric.IText('双击编辑文本', {
      left: startX,
      top: startY,
      fill: currentFillColor.value,
      fontSize: 24,
      fontFamily: 'Arial'
    });
    fabricCanvas.value.add(text);
    fabricCanvas.value.setActiveObject(text);
    text.enterEditing();

    isDrawing = false;
  }
}

/**
 * 处理鼠标移动
 */
function handleMouseMove(options) {
  if (!isDrawing || !currentShape) return;

  const pointer = fabricCanvas.value.getPointer(options.e);

  if (activeTool.value === 'rect') {
    const width = Math.abs(pointer.x - startX);
    const height = Math.abs(pointer.y - startY);

    currentShape.set({
      left: Math.min(startX, pointer.x),
      top: Math.min(startY, pointer.y),
      width: width,
      height: height
    });
  } else if (activeTool.value === 'circle') {
    const radius = Math.sqrt(
      Math.pow(pointer.x - startX, 2) + Math.pow(pointer.y - startY, 2)
    ) / 2;

    currentShape.set({
      radius: Math.max(radius, 1)
    });
  }

  fabricCanvas.value.renderAll();
}

/**
 * 处理鼠标释放
 */
async function handleMouseUp() {
  if (!isDrawing) return;

  isDrawing = false;

  if (currentShape) {
    // 保存到数据库
    try {
      const fabricJson = currentShape.toJSON();
      const objectType = currentShape.type;

      const result = await window.electronAPI.invoke('design:add-object', {
        artboardId: props.artboardId,
        objectType: objectType,
        name: `${objectType} ${Date.now()}`,
        fabricJson: fabricJson
      });

      // 设置对象 ID
      currentShape.set({ id: result.id });

      emit('objectsModified');
    } catch (error) {
      console.error('[DesignCanvas] Failed to save new object:', error);
    }

    currentShape = null;
  }
}

/**
 * 删除选中对象
 */
async function deleteSelected() {
  const activeObjects = fabricCanvas.value.getActiveObjects();

  if (activeObjects.length === 0) return;

  for (const obj of activeObjects) {
    if (obj.id) {
      try {
        await window.electronAPI.invoke('design:delete-object', obj.id);
        fabricCanvas.value.remove(obj);
      } catch (error) {
        console.error('[DesignCanvas] Failed to delete object:', error);
      }
    }
  }

  fabricCanvas.value.discardActiveObject();
  fabricCanvas.value.renderAll();
  emit('objectsModified');
}

/**
 * 清空画布
 */
function clearCanvas() {
  fabricCanvas.value.clear();
  fabricCanvas.value.backgroundColor = '#FFFFFF';
  fabricCanvas.value.renderAll();
}

/**
 * 获取 Canvas JSON
 */
function getCanvasJSON() {
  return fabricCanvas.value.toJSON(['id', 'name']);
}

/**
 * 导出为图片
 */
function exportAsImage(format = 'png') {
  return fabricCanvas.value.toDataURL({
    format: format,
    quality: 1
  });
}

// 监听工具切换
watch(activeTool, (newTool) => {
  if (!fabricCanvas.value) return;

  // 切换到选择工具
  if (newTool === 'select') {
    fabricCanvas.value.isDrawingMode = false;
    fabricCanvas.value.selection = true;
    fabricCanvas.value.defaultCursor = 'default';
  } else {
    fabricCanvas.value.selection = false;
    fabricCanvas.value.defaultCursor = 'crosshair';
  }
});

// 生命周期
onMounted(async () => {
  await nextTick();
  await initializeCanvas();
});

onBeforeUnmount(() => {
  if (fabricCanvas.value) {
    fabricCanvas.value.dispose();
  }
});

// 暴露方法给父组件
defineExpose({
  deleteSelected,
  clearCanvas,
  getCanvasJSON,
  exportAsImage,
  fabricCanvas
});
</script>

<style scoped>
.design-canvas-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #f0f0f0;
  overflow: auto;
}

canvas {
  border: 1px solid #ddd;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(255, 255, 255, 0.8);
  z-index: 1000;
}
</style>
