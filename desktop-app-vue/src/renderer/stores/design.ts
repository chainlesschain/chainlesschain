/**
 * Design Store - 设计编辑器状态管理
 */

import { defineStore } from 'pinia';
import { ref, computed, Ref, ComputedRef } from 'vue';
import { electronAPI } from '../utils/ipc';

// ==================== 类型定义 ====================

/**
 * 设计项目
 */
export interface DesignProject {
  id: string;
  title: string;
  project_type: string;
  user_id: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 画板信息
 */
export interface Artboard {
  id: string;
  project_id: string;
  name: string;
  width: number;
  height: number;
  background_color?: string;
  sort_order?: number;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 设计对象
 */
export interface DesignObject {
  id: string;
  type: 'rect' | 'circle' | 'text' | 'path' | 'image' | 'group' | string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;
  opacity?: number;
  [key: string]: any;
}

/**
 * 历史记录操作
 */
export interface HistoryAction {
  type: string;
  timestamp: number;
  data: any;
  [key: string]: any;
}

/**
 * 历史记录状态
 */
export interface HistoryState {
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];
}

/**
 * 协作者信息
 */
export interface Collaborator {
  id: string;
  name: string;
  avatar?: string;
  cursor?: { x: number; y: number };
  color?: string;
  [key: string]: any;
}

/**
 * Design Token
 */
export interface DesignToken {
  id: string;
  name: string;
  token_type: string;
  value: any;
  [key: string]: any;
}

/**
 * Design Tokens（按类型分组）
 */
export interface DesignTokens {
  colors: DesignToken[];
  typography: DesignToken[];
  spacing: DesignToken[];
  shadows: DesignToken[];
  borderRadius: DesignToken[];
  [key: string]: DesignToken[];
}

/**
 * 评论数据
 */
export interface CommentData {
  x: number;
  y: number;
  content: string;
  [key: string]: any;
}

/**
 * 评论
 */
export interface Comment extends CommentData {
  id: string;
  artboard_id: string;
  user_id: string;
  created_at?: number;
  [key: string]: any;
}

/**
 * AI 生成上下文
 */
export interface AIGenerateContext {
  artboardSize: {
    width: number;
    height: number;
  };
  tokens: DesignTokens;
  components: any[];
}

/**
 * AI 优化建议
 */
export interface AIOptimizeSuggestion {
  type: string;
  description: string;
  changes?: any[];
  [key: string]: any;
}

/**
 * 变更广播数据
 */
export interface ChangeData {
  type: string;
  objectId?: string;
  data?: any;
  [key: string]: any;
}

/**
 * 导出代码结果
 */
export interface ExportCodeResult {
  code: string;
  framework: 'react' | 'vue';
  [key: string]: any;
}

/**
 * 工具类型
 */
export type ToolType = 'select' | 'rect' | 'circle' | 'text' | 'pen' | 'comment';

// ==================== Store ====================

export const useDesignStore = defineStore('design', () => {
  // ========== State ==========
  const currentProject: Ref<DesignProject | null> = ref(null);
  const currentArtboard: Ref<Artboard | null> = ref(null);
  const artboards: Ref<Artboard[]> = ref([]);
  const selectedObjects: Ref<DesignObject[]> = ref([]);
  const activeTool: Ref<ToolType> = ref('select');
  const clipboard: Ref<DesignObject[]> = ref([]);

  // 历史记录（撤销/重做）
  const history: Ref<HistoryState> = ref({
    undoStack: [],
    redoStack: [],
  });

  // 协作相关
  const collaborators: Ref<Collaborator[]> = ref([]);
  const collaborationEnabled: Ref<boolean> = ref(false);

  // 设计系统
  const currentFillColor: Ref<string> = ref('#000000');
  const currentStrokeColor: Ref<string> = ref('#000000');
  const currentStrokeWidth: Ref<number> = ref(1);
  const designTokens: Ref<DesignTokens> = ref({
    colors: [],
    typography: [],
    spacing: [],
    shadows: [],
    borderRadius: [],
  });

  // UI 状态
  const loading: Ref<boolean> = ref(false);
  const saving: Ref<boolean> = ref(false);
  const showGrid: Ref<boolean> = ref(true);
  const gridSpacing: Ref<number> = ref(20);
  const zoom: Ref<number> = ref(100);

  // ========== Getters ==========
  const hasSelection: ComputedRef<boolean> = computed(() => selectedObjects.value.length > 0);
  const canUndo: ComputedRef<boolean> = computed(() => history.value.undoStack.length > 0);
  const canRedo: ComputedRef<boolean> = computed(() => history.value.redoStack.length > 0);
  const singleSelection: ComputedRef<DesignObject | null> = computed(() =>
    selectedObjects.value.length === 1 ? selectedObjects.value[0] : null
  );

  // ========== Actions ==========

  /**
   * 加载设计项目
   */
  async function loadProject(projectId: string): Promise<DesignProject> {
    loading.value = true;
    try {
      const project = await electronAPI.invoke('project:get', projectId);

      if (project.project_type !== 'design') {
        throw new Error('不是设计项目');
      }

      currentProject.value = project;

      // 加载项目的所有画板
      const artboardsList: Artboard[] = await electronAPI.invoke(
        'design:get-artboards',
        projectId
      );
      artboards.value = artboardsList;

      // 加载第一个画板
      if (artboardsList.length > 0) {
        await loadArtboard(artboardsList[0].id);
      }

      // 加载 Design Tokens
      const tokens: DesignToken[] = await electronAPI.invoke('design:get-tokens', projectId);
      designTokens.value = groupTokensByType(tokens);

      return project;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载画板
   */
  async function loadArtboard(artboardId: string): Promise<DesignObject[]> {
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
  async function createArtboard(
    name: string,
    width: number = 1920,
    height: number = 1080
  ): Promise<Artboard> {
    const artboard: Artboard = await electronAPI.invoke('design:create-artboard', {
      project_id: currentProject.value!.id,
      name,
      width,
      height,
    });

    artboards.value.push(artboard);
    return artboard;
  }

  /**
   * 切换画板
   */
  async function switchArtboard(artboardId: string): Promise<void> {
    // 如果当前有画板，先保存
    if (currentArtboard.value) {
      // 由 Canvas 组件负责调用 saveArtboard
    }

    await loadArtboard(artboardId);
  }

  /**
   * 保存画板
   */
  async function saveArtboard(objects: DesignObject[]): Promise<{ success: boolean } | undefined> {
    if (!currentArtboard.value) {
      return;
    }

    saving.value = true;
    try {
      await electronAPI.invoke('design:save-artboard', {
        artboard_id: currentArtboard.value.id,
        objects,
      });

      return { success: true };
    } finally {
      saving.value = false;
    }
  }

  /**
   * 设置激活工具
   */
  function setActiveTool(tool: ToolType): void {
    activeTool.value = tool;
  }

  /**
   * 设置选中对象
   */
  function setSelectedObjects(objects: DesignObject[]): void {
    selectedObjects.value = objects;
  }

  /**
   * 更新对象属性
   */
  async function updateObjectProperties(
    objectId: string,
    properties: Partial<DesignObject>
  ): Promise<void> {
    await electronAPI.invoke('design:update-object', {
      id: objectId,
      ...properties,
    });
  }

  /**
   * 设置填充颜色
   */
  function setFillColor(color: string): void {
    currentFillColor.value = color;
  }

  /**
   * 设置描边颜色
   */
  function setStrokeColor(color: string): void {
    currentStrokeColor.value = color;
  }

  /**
   * 设置描边宽度
   */
  function setStrokeWidth(width: number): void {
    currentStrokeWidth.value = width;
  }

  /**
   * AI 生成设计
   */
  async function aiGenerateDesign(prompt: string): Promise<DesignObject[]> {
    loading.value = true;
    try {
      const context: AIGenerateContext = {
        artboardSize: {
          width: currentArtboard.value!.width,
          height: currentArtboard.value!.height,
        },
        tokens: designTokens.value,
        components: await electronAPI.invoke('design:get-components', {
          projectId: currentProject.value!.id,
        }),
      };

      const objects: DesignObject[] = await electronAPI.invoke('design:ai-generate', {
        prompt,
        context,
      });

      return objects;
    } finally {
      loading.value = false;
    }
  }

  /**
   * AI 优化设计
   */
  async function aiOptimizeDesign(objects: DesignObject[]): Promise<AIOptimizeSuggestion[]> {
    loading.value = true;
    try {
      const suggestions: AIOptimizeSuggestion[] = await electronAPI.invoke('design:ai-optimize', {
        objects,
        artboardSize: {
          width: currentArtboard.value!.width,
          height: currentArtboard.value!.height,
        },
      });

      return suggestions;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 添加到历史记录
   */
  function addToHistory(action: HistoryAction): void {
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
  function undo(): HistoryAction | null {
    if (canUndo.value) {
      const action = history.value.undoStack.pop()!;
      history.value.redoStack.push(action);
      return action;
    }
    return null;
  }

  /**
   * 重做
   */
  function redo(): HistoryAction | null {
    if (canRedo.value) {
      const action = history.value.redoStack.pop()!;
      history.value.undoStack.push(action);
      return action;
    }
    return null;
  }

  /**
   * 清空历史记录
   */
  function clearHistory(): void {
    history.value.undoStack = [];
    history.value.redoStack = [];
  }

  /**
   * 导出代码
   */
  async function exportCode(framework: 'react' | 'vue'): Promise<ExportCodeResult> {
    loading.value = true;
    try {
      const code: ExportCodeResult = await electronAPI.invoke('design:export-code', {
        artboardId: currentArtboard.value!.id,
        framework,
      });

      return code;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 广播变更（协作同步）
   */
  function broadcastChange(change: ChangeData): void {
    if (collaborationEnabled.value) {
      electronAPI.invoke('design:broadcast-change', {
        artboardId: currentArtboard.value!.id,
        change,
      });
    }
  }

  /**
   * 创建评论
   */
  async function createComment(commentData: CommentData): Promise<Comment> {
    const comment: Comment = await electronAPI.invoke('design:add-comment', {
      ...commentData,
      artboard_id: currentArtboard.value!.id,
      user_id: currentProject.value!.user_id,
    });

    return comment;
  }

  /**
   * 设置缩放
   */
  function setZoom(value: number): void {
    zoom.value = Math.max(10, Math.min(400, value));
  }

  /**
   * 切换网格显示
   */
  function toggleGrid(): void {
    showGrid.value = !showGrid.value;
  }

  /**
   * 复制选中对象
   */
  function copySelection(): void {
    clipboard.value = [...selectedObjects.value];
  }

  /**
   * 粘贴对象
   */
  function pasteFromClipboard(): DesignObject[] {
    return clipboard.value.map((obj) => ({
      ...obj,
      left: (obj.left || 0) + 20,
      top: (obj.top || 0) + 20,
    }));
  }

  /**
   * 重置状态
   */
  function reset(): void {
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
      borderRadius: [],
    };
  }

  // ========== 工具函数 ==========

  /**
   * 按类型分组 Design Tokens
   */
  function groupTokensByType(tokens: DesignToken[]): DesignTokens {
    return tokens.reduce(
      (acc, token) => {
        if (!acc[token.token_type]) {
          acc[token.token_type] = [];
        }
        acc[token.token_type].push(token);
        return acc;
      },
      {
        colors: [],
        typography: [],
        spacing: [],
        shadows: [],
        borderRadius: [],
      } as DesignTokens
    );
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
    reset,
  };
});
