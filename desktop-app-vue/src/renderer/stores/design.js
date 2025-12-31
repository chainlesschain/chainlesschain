import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { electronAPI } from '../utils/ipc';

/**
 * 设计编辑器状态管理 Store
 */
export const useDesignStore = defineStore('design', () => {
  // ========== State ==========
  const currentProject = ref(null);
  const currentArtboard = ref(null);
  const artboards = ref([]);
  const selectedObjects = ref([]);
  const activeTool = ref('select'); // 'select', 'rect', 'circle', 'text', 'pen', 'comment'
  const clipboard = ref([]);

  // 历史记录（撤销/重做）
  const history = ref({
    undoStack: [],
    redoStack: []
  });

  // 协作相关
  const collaborators = ref([]);
  const collaborationEnabled = ref(false);

  // 设计系统
  const currentFillColor = ref('#000000');
  const currentStrokeColor = ref('#000000');
  const currentStrokeWidth = ref(1);
  const designTokens = ref({
    colors: [],
    typography: [],
    spacing: [],
    shadows: [],
    borderRadius: []
  });

  // UI 状态
  const loading = ref(false);
  const saving = ref(false);
  const showGrid = ref(true);
  const gridSpacing = ref(20);
  const zoom = ref(100);

  // ========== Getters ==========
  const hasSelection = computed(() => selectedObjects.value.length > 0);
  const canUndo = computed(() => history.value.undoStack.length > 0);
  const canRedo = computed(() => history.value.redoStack.length > 0);
  const singleSelection = computed(() =>
    selectedObjects.value.length === 1 ? selectedObjects.value[0] : null
  );

  // ========== Actions ==========

  /**
   * 加载设计项目
   */
  async function loadProject(projectId) {
    loading.value = true;
    try {
      const project = await electronAPI.invoke('project:get-by-id', projectId);

      if (project.project_type !== 'design') {
        throw new Error('不是设计项目');
      }

      currentProject.value = project;

      // 加载项目的所有画板
      const artboardsList = await electronAPI.invoke('design:get-artboards', projectId);
      artboards.value = artboardsList;

      // 加载第一个画板
      if (artboardsList.length > 0) {
        await loadArtboard(artboardsList[0].id);
      }

      // 加载 Design Tokens
      const tokens = await electronAPI.invoke('design:get-tokens', projectId);
      designTokens.value = groupTokensByType(tokens);

      return project;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载画板
   */
  async function loadArtboard(artboardId) {
    loading.value = true;
    try {
      const data = await electronAPI.invoke('design:get-artboard', artboardId);
      currentArtboard.value = data.artboard;

      // 返回对象列表供 Canvas 组件使用
      return data.objects;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建新画板
   */
  async function createArtboard(name, width = 1920, height = 1080) {
    const artboard = await electronAPI.invoke('design:create-artboard', {
      project_id: currentProject.value.id,
      name,
      width,
      height
    });

    artboards.value.push(artboard);
    return artboard;
  }

  /**
   * 切换画板
   */
  async function switchArtboard(artboardId) {
    // 如果当前有画板，先保存
    if (currentArtboard.value) {
      // 由 Canvas 组件负责调用 saveArtboard
    }

    await loadArtboard(artboardId);
  }

  /**
   * 保存画板
   */
  async function saveArtboard(objects) {
    if (!currentArtboard.value) return;

    saving.value = true;
    try {
      await electronAPI.invoke('design:save-artboard', {
        artboard_id: currentArtboard.value.id,
        objects
      });

      return { success: true };
    } finally {
      saving.value = false;
    }
  }

  /**
   * 设置激活工具
   */
  function setActiveTool(tool) {
    activeTool.value = tool;
  }

  /**
   * 设置选中对象
   */
  function setSelectedObjects(objects) {
    selectedObjects.value = objects;
  }

  /**
   * 更新对象属性
   */
  async function updateObjectProperties(objectId, properties) {
    await electronAPI.invoke('design:update-object', {
      id: objectId,
      ...properties
    });
  }

  /**
   * 设置填充颜色
   */
  function setFillColor(color) {
    currentFillColor.value = color;
  }

  /**
   * 设置描边颜色
   */
  function setStrokeColor(color) {
    currentStrokeColor.value = color;
  }

  /**
   * 设置描边宽度
   */
  function setStrokeWidth(width) {
    currentStrokeWidth.value = width;
  }

  /**
   * AI 生成设计
   */
  async function aiGenerateDesign(prompt) {
    loading.value = true;
    try {
      const context = {
        artboardSize: {
          width: currentArtboard.value.width,
          height: currentArtboard.value.height
        },
        tokens: designTokens.value,
        components: await electronAPI.invoke('design:get-components', {
          projectId: currentProject.value.id
        })
      };

      const objects = await electronAPI.invoke('design:ai-generate', {
        prompt,
        context
      });

      return objects;
    } finally {
      loading.value = false;
    }
  }

  /**
   * AI 优化设计
   */
  async function aiOptimizeDesign(objects) {
    loading.value = true;
    try {
      const suggestions = await electronAPI.invoke('design:ai-optimize', {
        objects,
        artboardSize: {
          width: currentArtboard.value.width,
          height: currentArtboard.value.height
        }
      });

      return suggestions;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 添加到历史记录
   */
  function addToHistory(action) {
    history.value.undoStack.push(action);
    history.value.redoStack = []; // 清空重做栈

    // 限制历史记录数量
    if (history.value.undoStack.length > 50) {
      history.value.undoStack.shift();
    }
  }

  /**
   * 撤销
   */
  function undo() {
    if (canUndo.value) {
      const action = history.value.undoStack.pop();
      history.value.redoStack.push(action);
      return action;
    }
    return null;
  }

  /**
   * 重做
   */
  function redo() {
    if (canRedo.value) {
      const action = history.value.redoStack.pop();
      history.value.undoStack.push(action);
      return action;
    }
    return null;
  }

  /**
   * 清空历史记录
   */
  function clearHistory() {
    history.value.undoStack = [];
    history.value.redoStack = [];
  }

  /**
   * 导出代码
   */
  async function exportCode(framework) {
    loading.value = true;
    try {
      const code = await electronAPI.invoke('design:export-code', {
        artboardId: currentArtboard.value.id,
        framework // 'react' | 'vue'
      });

      return code;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 广播变更（协作同步）
   */
  function broadcastChange(change) {
    if (collaborationEnabled.value) {
      electronAPI.send('design:broadcast-change', {
        artboardId: currentArtboard.value.id,
        change
      });
    }
  }

  /**
   * 创建评论
   */
  async function createComment(commentData) {
    const comment = await electronAPI.invoke('design:add-comment', {
      ...commentData,
      artboard_id: currentArtboard.value.id,
      user_id: currentProject.value.user_id
    });

    return comment;
  }

  /**
   * 设置缩放
   */
  function setZoom(value) {
    zoom.value = Math.max(10, Math.min(400, value));
  }

  /**
   * 切换网格显示
   */
  function toggleGrid() {
    showGrid.value = !showGrid.value;
  }

  /**
   * 复制选中对象
   */
  function copySelection() {
    clipboard.value = [...selectedObjects.value];
  }

  /**
   * 粘贴对象
   */
  function pasteFromClipboard() {
    return clipboard.value.map(obj => ({
      ...obj,
      left: (obj.left || 0) + 20,
      top: (obj.top || 0) + 20
    }));
  }

  /**
   * 重置状态
   */
  function reset() {
    currentProject.value = null;
    currentArtboard.value = null;
    artboards.value = [];
    selectedObjects.value = [];
    activeTool.value = 'select';
    clipboard.value = [];
    clearHistory();
    collaborators.value = [];
    collaborationEnabled.value = false;
    designTokens.value = {
      colors: [],
      typography: [],
      spacing: [],
      shadows: [],
      borderRadius: []
    };
  }

  // ========== 工具函数 ==========

  /**
   * 按类型分组 Design Tokens
   */
  function groupTokensByType(tokens) {
    return tokens.reduce((acc, token) => {
      if (!acc[token.token_type]) {
        acc[token.token_type] = [];
      }
      acc[token.token_type].push(token);
      return acc;
    }, {
      colors: [],
      typography: [],
      spacing: [],
      shadows: [],
      borderRadius: []
    });
  }

  return {
    // State
    currentProject,
    currentArtboard,
    artboards,
    selectedObjects,
    activeTool,
    clipboard,
    history,
    collaborators,
    collaborationEnabled,
    currentFillColor,
    currentStrokeColor,
    currentStrokeWidth,
    designTokens,
    loading,
    saving,
    showGrid,
    gridSpacing,
    zoom,

    // Getters
    hasSelection,
    canUndo,
    canRedo,
    singleSelection,

    // Actions
    loadProject,
    loadArtboard,
    createArtboard,
    switchArtboard,
    saveArtboard,
    setActiveTool,
    setSelectedObjects,
    updateObjectProperties,
    setFillColor,
    setStrokeColor,
    setStrokeWidth,
    aiGenerateDesign,
    aiOptimizeDesign,
    addToHistory,
    undo,
    redo,
    clearHistory,
    exportCode,
    broadcastChange,
    createComment,
    setZoom,
    toggleGrid,
    copySelection,
    pasteFromClipboard,
    reset
  };
});
