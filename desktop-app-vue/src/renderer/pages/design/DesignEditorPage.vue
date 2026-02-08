<template>
  <div class="design-editor-page">
    <!-- 顶部工具栏 -->
    <div class="editor-header">
      <div class="header-left">
        <a-button type="text" @click="goBack">
          <template #icon> ← 返回 </template>
        </a-button>
        <a-divider type="vertical" />
        <h2 class="project-name">
          {{ currentProject?.name || "设计项目" }}
        </h2>
      </div>

      <div class="header-center">
        <!-- 画板选择 -->
        <a-select
          v-if="artboards.length > 0"
          :value="currentArtboard?.id"
          style="width: 200px"
          @change="switchArtboard"
        >
          <a-select-option
            v-for="artboard in artboards"
            :key="artboard.id"
            :value="artboard.id"
          >
            {{ artboard.name }}
          </a-select-option>
        </a-select>
      </div>

      <div class="header-right">
        <a-space>
          <a-button :loading="saving" @click="saveProject"> 保存 </a-button>
          <a-button type="primary" @click="exportDesign"> 导出 </a-button>
        </a-space>
      </div>
    </div>

    <!-- 主编辑区域 -->
    <div class="editor-content">
      <!-- 左侧工具栏 -->
      <ToolPanel />

      <!-- 中央画布区域 -->
      <div class="canvas-area">
        <DesignCanvas
          v-if="currentArtboard"
          ref="canvasRef"
          :artboard-id="currentArtboard.id"
          :width="currentArtboard.width"
          :height="currentArtboard.height"
          @objects-modified="handleObjectsModified"
          @selection-changed="handleSelectionChanged"
        />
        <div v-else class="empty-state">
          <a-empty description="请先创建画板" />
          <a-button type="primary" @click="createNewArtboard">
            创建画板
          </a-button>
        </div>
      </div>

      <!-- 右侧属性面板（简化版） -->
      <div class="properties-panel">
        <div class="panel-header">
          <h3>属性</h3>
        </div>
        <div class="panel-content">
          <template v-if="selectedObjects.length === 1">
            <div class="property-group">
              <h4>基本信息</h4>
              <div class="property-item">
                <label>类型</label>
                <span>{{ selectedObjects[0].type }}</span>
              </div>
              <div class="property-item">
                <label>名称</label>
                <a-input
                  :value="selectedObjects[0].name"
                  size="small"
                  @change="updateObjectName"
                />
              </div>
            </div>

            <a-divider />

            <div class="property-group">
              <h4>位置和大小</h4>
              <div class="property-item">
                <label>X</label>
                <a-input-number
                  :value="Math.round(selectedObjects[0].left)"
                  size="small"
                  style="width: 100%"
                  @change="(value) => updateObjectPosition('left', value)"
                />
              </div>
              <div class="property-item">
                <label>Y</label>
                <a-input-number
                  :value="Math.round(selectedObjects[0].top)"
                  size="small"
                  style="width: 100%"
                  @change="(value) => updateObjectPosition('top', value)"
                />
              </div>
              <div class="property-item">
                <label>宽度</label>
                <a-input-number
                  :value="Math.round(selectedObjects[0].width)"
                  size="small"
                  style="width: 100%"
                  @change="(value) => updateObjectDimension('width', value)"
                />
              </div>
              <div class="property-item">
                <label>高度</label>
                <a-input-number
                  :value="Math.round(selectedObjects[0].height)"
                  size="small"
                  style="width: 100%"
                  @change="(value) => updateObjectDimension('height', value)"
                />
              </div>
            </div>
          </template>

          <template v-else-if="selectedObjects.length > 1">
            <a-empty description="已选中多个对象" />
          </template>

          <template v-else>
            <a-empty description="未选中对象" />
          </template>
        </div>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="editor-footer">
      <div class="footer-left">
        <span>{{ selectedObjects.length }} 个对象已选中</span>
      </div>
      <div class="footer-right">
        <span
          >{{ currentArtboard?.width }} × {{ currentArtboard?.height }}px</span
        >
      </div>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { useDesignStore } from "../../stores/design";
import { storeToRefs } from "pinia";
import DesignCanvas from "../../components/design/canvas/DesignCanvas.vue";
import ToolPanel from "../../components/design/panels/ToolPanel.vue";

const route = useRoute();
const router = useRouter();
const designStore = useDesignStore();

const { currentProject, currentArtboard, artboards, selectedObjects, saving } =
  storeToRefs(designStore);

const canvasRef = ref(null);

/**
 * 初始化编辑器
 */
async function initializeEditor() {
  const projectId = route.params.projectId;

  if (!projectId) {
    message.error("项目 ID 不存在");
    router.push("/projects");
    return;
  }

  try {
    await designStore.loadProject(projectId);
  } catch (error) {
    logger.error("[DesignEditorPage] Failed to load project:", error);
    message.error("加载项目失败: " + error.message);
  }
}

/**
 * 返回项目列表
 */
function goBack() {
  router.push("/projects");
}

/**
 * 切换画板
 */
async function switchArtboard(artboardId) {
  try {
    await designStore.switchArtboard(artboardId);
  } catch (error) {
    logger.error("[DesignEditorPage] Failed to switch artboard:", error);
    message.error("切换画板失败");
  }
}

/**
 * 创建新画板
 */
async function createNewArtboard() {
  try {
    await designStore.createArtboard(`Artboard ${artboards.value.length + 1}`);
    message.success("画板创建成功");
  } catch (error) {
    logger.error("[DesignEditorPage] Failed to create artboard:", error);
    message.error("创建画板失败");
  }
}

/**
 * 保存项目
 */
async function saveProject() {
  if (!canvasRef.value || !currentArtboard.value) {
    message.warning("没有可保存的内容");
    return;
  }

  try {
    const canvasJSON = canvasRef.value.getCanvasJSON();
    const objects = canvasJSON.objects.map((obj) => ({
      id: obj.id,
      fabric_json: obj,
    }));

    await designStore.saveArtboard(objects);
    message.success("保存成功");
  } catch (error) {
    logger.error("[DesignEditorPage] Failed to save:", error);
    message.error("保存失败: " + error.message);
  }
}

/**
 * 导出设计
 */
function exportDesign() {
  if (!canvasRef.value) {
    message.warning("没有可导出的内容");
    return;
  }

  // 导出为图片
  const dataURL = canvasRef.value.exportAsImage("png");

  // 创建下载链接
  const link = document.createElement("a");
  link.download = `${currentProject.value.name}-${currentArtboard.value.name}.png`;
  link.href = dataURL;
  link.click();

  message.success("导出成功");
}

/**
 * 处理对象修改
 */
function handleObjectsModified() {
  logger.info("[DesignEditorPage] Objects modified");
}

/**
 * 处理选区变化
 */
function handleSelectionChanged(objects) {
  logger.info("[DesignEditorPage] Selection changed:", objects);
}

/**
 * 更新对象名称
 */
async function updateObjectName(event) {
  const newName = event.target.value;

  if (!selectedObjects.value.length || !selectedObjects.value[0]?.id) {
    return;
  }

  const objectId = selectedObjects.value[0].id;

  try {
    // 更新数据库中的对象名称
    await designStore.updateObjectProperties(objectId, { name: newName });

    // 更新本地 selectedObjects 状态
    selectedObjects.value[0].name = newName;

    // 更新画布中对象的名称
    if (canvasRef.value?.fabricCanvas?.value) {
      const canvas = canvasRef.value.fabricCanvas.value;
      const objects = canvas.getObjects();
      const targetObj = objects.find((obj) => obj.id === objectId);
      if (targetObj) {
        targetObj.set("name", newName);
      }
    }

    logger.info("[DesignEditorPage] Object name updated:", newName);
  } catch (error) {
    logger.error("[DesignEditorPage] Failed to update object name:", error);
  }
}

/**
 * 更新对象位置
 */
async function updateObjectPosition(property, value) {
  if (!selectedObjects.value.length || !selectedObjects.value[0]?.id) {
    return;
  }

  const objectId = selectedObjects.value[0].id;

  try {
    // 更新画布中对象的位置
    if (canvasRef.value?.fabricCanvas?.value) {
      const canvas = canvasRef.value.fabricCanvas.value;
      const objects = canvas.getObjects();
      const targetObj = objects.find((obj) => obj.id === objectId);
      if (targetObj) {
        targetObj.set(property, value);
        targetObj.setCoords();
        canvas.renderAll();

        // 获取更新后的 fabric JSON 并保存
        const fabricJson = targetObj.toJSON(["id", "name"]);
        await designStore.updateObjectProperties(objectId, { fabricJson });

        // 更新本地状态
        selectedObjects.value[0][property] = value;
      }
    }

    logger.info(`[DesignEditorPage] Object ${property} updated:`, value);
  } catch (error) {
    logger.error("[DesignEditorPage] Failed to update object position:", error);
  }
}

/**
 * 更新对象尺寸
 */
async function updateObjectDimension(property, value) {
  if (!selectedObjects.value.length || !selectedObjects.value[0]?.id) {
    return;
  }

  const objectId = selectedObjects.value[0].id;

  try {
    // 更新画布中对象的尺寸
    if (canvasRef.value?.fabricCanvas?.value) {
      const canvas = canvasRef.value.fabricCanvas.value;
      const objects = canvas.getObjects();
      const targetObj = objects.find((obj) => obj.id === objectId);
      if (targetObj) {
        // 计算新的 scale 值
        const currentValue =
          property === "width" ? targetObj.width : targetObj.height;
        const currentScale =
          property === "width" ? targetObj.scaleX : targetObj.scaleY;
        const newScale = (value / currentValue) * (currentScale || 1);

        if (property === "width") {
          targetObj.set("scaleX", newScale);
        } else {
          targetObj.set("scaleY", newScale);
        }

        targetObj.setCoords();
        canvas.renderAll();

        // 获取更新后的 fabric JSON 并保存
        const fabricJson = targetObj.toJSON(["id", "name"]);
        await designStore.updateObjectProperties(objectId, { fabricJson });

        // 更新本地状态
        selectedObjects.value[0][property] = value;
      }
    }

    logger.info(`[DesignEditorPage] Object ${property} updated:`, value);
  } catch (error) {
    logger.error(
      "[DesignEditorPage] Failed to update object dimension:",
      error,
    );
  }
}

/**
 * 快捷键处理
 */
function handleKeyDown(event) {
  // Ctrl/Cmd + S: 保存
  if ((event.ctrlKey || event.metaKey) && event.key === "s") {
    event.preventDefault();
    saveProject();
  }

  // Delete: 删除选中对象
  if (event.key === "Delete" && canvasRef.value) {
    canvasRef.value.deleteSelected();
  }

  // V: 选择工具
  if (event.key === "v" && !event.ctrlKey && !event.metaKey) {
    designStore.setActiveTool("select");
  }

  // R: 矩形工具
  if (event.key === "r" && !event.ctrlKey && !event.metaKey) {
    designStore.setActiveTool("rect");
  }

  // C: 圆形工具
  if (event.key === "c" && !event.ctrlKey && !event.metaKey) {
    designStore.setActiveTool("circle");
  }

  // T: 文本工具
  if (event.key === "t" && !event.ctrlKey && !event.metaKey) {
    designStore.setActiveTool("text");
  }
}

// 生命周期
onMounted(async () => {
  await initializeEditor();

  // 绑定快捷键
  window.addEventListener("keydown", handleKeyDown);
});

onBeforeUnmount(() => {
  // 清理快捷键
  window.removeEventListener("keydown", handleKeyDown);

  // 重置 store
  designStore.reset();
});
</script>

<style scoped>
.design-editor-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.editor-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
}

.header-left,
.header-center,
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-name {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.editor-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.canvas-area {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #f5f5f5;
  overflow: auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.properties-panel {
  width: 280px;
  border-left: 1px solid #e0e0e0;
  background: #fafafa;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.property-group {
  margin-bottom: 16px;
}

.property-group h4 {
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: #666;
}

.property-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.property-item label {
  min-width: 60px;
  font-size: 12px;
  color: #666;
}

.editor-footer {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-top: 1px solid #e0e0e0;
  background: #fafafa;
  font-size: 12px;
  color: #666;
}
</style>
