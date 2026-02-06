/**
 * Task Store - 任务管理
 * 负责管理任务的CRUD操作、评论、变更历史和看板
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { message } from 'ant-design-vue';
import { useIdentityStore } from './identityStore';

// ==================== 类型定义 ====================

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * 任务优先级
 */
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';

/**
 * 任务
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to?: string;
  created_by?: string;
  workspace_id?: string;
  org_id?: string;
  due_date?: number;
  collaborators: string[];
  labels: string[];
  blocked_by: string[];
  created_at: number;
  updated_at: number;
  [key: string]: any;
}

/**
 * 任务评论
 */
export interface TaskComment {
  id: string;
  task_id: string;
  author_did: string;
  content: string;
  mentions: string[];
  attachments: any[];
  created_at: number;
  updated_at?: number;
}

/**
 * 任务变更历史
 */
export interface TaskChange {
  id: string;
  task_id: string;
  changed_by: string;
  field: string;
  old_value: any;
  new_value: any;
  changed_at: number;
}

/**
 * 任务看板
 */
export interface TaskBoard {
  id: string;
  name: string;
  org_id: string;
  workspace_id?: string;
  columns: BoardColumn[];
  filters: Record<string, any>;
  created_at: number;
  updated_at?: number;
}

/**
 * 看板列
 */
export interface BoardColumn {
  id: string;
  name: string;
  status: TaskStatus;
  color?: string;
  limit?: number;
}

/**
 * 任务筛选条件
 */
export interface TaskFilters {
  status: TaskStatus | null;
  priority: TaskPriority | null;
  assigned_to: string | null;
  workspace_id: string | null;
  org_id: string | null;
}

/**
 * 按状态分组的任务
 */
export interface TasksByStatus {
  pending: Task[];
  in_progress: Task[];
  completed: Task[];
  cancelled: Task[];
}

/**
 * 按优先级分组的任务
 */
export interface TasksByPriority {
  urgent: Task[];
  high: Task[];
  medium: Task[];
  low: Task[];
}

/**
 * 任务统计
 */
export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  overdue: number;
}

/**
 * IPC 结果
 */
interface IpcResult<T = any> {
  success: boolean;
  tasks?: Task[];
  task?: Task;
  comments?: TaskComment[];
  changes?: TaskChange[];
  boards?: TaskBoard[];
  board?: TaskBoard;
  error?: string;
}

// ==================== Helper Functions ====================

/**
 * 安全解析 JSON 字符串
 */
function safeParseJSON<T = any>(value: string | T | null | undefined, defaultValue: T): T {
  if (value == null) {
    return defaultValue;
  }
  if (typeof value !== 'string') {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.warn('[TaskStore] JSON 解析失败:', (error as Error).message);
    return defaultValue;
  }
}

// ==================== Store ====================

export const useTaskStore = defineStore('task', () => {
  // ==================== State ====================

  // 任务列表
  const tasks: Ref<Task[]> = ref([]);

  // 当前查看的任务详情
  const currentTask: Ref<Task | null> = ref(null);

  // 任务评论列表（当前任务）
  const currentTaskComments: Ref<TaskComment[]> = ref([]);

  // 任务变更历史（当前任务）
  const currentTaskChanges: Ref<TaskChange[]> = ref([]);

  // 任务看板列表
  const boards: Ref<TaskBoard[]> = ref([]);

  // 当前激活的看板
  const currentBoard: Ref<TaskBoard | null> = ref(null);

  // 加载状态
  const loading: Ref<boolean> = ref(false);

  // 任务详情对话框可见性
  const taskDetailVisible: Ref<boolean> = ref(false);

  // 创建任务对话框可见性
  const createTaskVisible: Ref<boolean> = ref(false);

  // 筛选条件
  const filters: Ref<TaskFilters> = ref({
    status: null,
    priority: null,
    assigned_to: null,
    workspace_id: null,
    org_id: null,
  });

  // ==================== Getters ====================

  /**
   * 按状态分组的任务
   */
  const tasksByStatus: ComputedRef<TasksByStatus> = computed(() => {
    const groups: TasksByStatus = {
      pending: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    };

    tasks.value.forEach((task) => {
      if (groups[task.status]) {
        groups[task.status].push(task);
      }
    });

    return groups;
  });

  /**
   * 按优先级分组的任务
   */
  const tasksByPriority: ComputedRef<TasksByPriority> = computed(() => {
    const groups: TasksByPriority = {
      urgent: [],
      high: [],
      medium: [],
      low: [],
    };

    tasks.value.forEach((task) => {
      if (groups[task.priority]) {
        groups[task.priority].push(task);
      }
    });

    return groups;
  });

  /**
   * 我的任务（已分配给当前用户）
   */
  const myTasks: ComputedRef<Task[]> = computed(() => {
    const identityStore = useIdentityStore();
    const currentUserDID = identityStore.currentUserDID;
    if (!currentUserDID) {
      return tasks.value;
    }
    return tasks.value.filter((task) => task.assigned_to === currentUserDID);
  });

  /**
   * 进行中的任务
   */
  const inProgressTasks: ComputedRef<Task[]> = computed(() => {
    return tasks.value.filter((task) => task.status === 'in_progress');
  });

  /**
   * 待处理的任务
   */
  const pendingTasks: ComputedRef<Task[]> = computed(() => {
    return tasks.value.filter((task) => task.status === 'pending');
  });

  /**
   * 已完成的任务
   */
  const completedTasks: ComputedRef<Task[]> = computed(() => {
    return tasks.value.filter((task) => task.status === 'completed');
  });

  /**
   * 过期的任务
   */
  const overdueTasks: ComputedRef<Task[]> = computed(() => {
    const now = Date.now();
    return tasks.value.filter((task) => {
      return task.due_date && task.due_date < now && task.status !== 'completed';
    });
  });

  /**
   * 任务统计
   */
  const taskStats: ComputedRef<TaskStats> = computed(() => {
    return {
      total: tasks.value.length,
      pending: pendingTasks.value.length,
      inProgress: inProgressTasks.value.length,
      completed: completedTasks.value.length,
      overdue: overdueTasks.value.length,
    };
  });

  // ==================== Actions ====================

  /**
   * 加载任务列表
   */
  async function loadTasks(queryFilters: Partial<TaskFilters> = {}): Promise<void> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:list', {
        filters: {
          ...filters.value,
          ...queryFilters,
        },
      });

      if (result.success) {
        // 解析JSON字段
        tasks.value = (result.tasks || []).map((task) => ({
          ...task,
          collaborators: safeParseJSON<string[]>(task.collaborators as any, []),
          labels: safeParseJSON<string[]>(task.labels as any, []),
          blocked_by: safeParseJSON<string[]>(task.blocked_by as any, []),
        }));

        logger.info('[TaskStore] 任务列表加载成功', tasks.value.length);
      } else {
        message.error(`加载任务列表失败: ${result.error}`);
        logger.error('[TaskStore] 加载任务列表失败:', result.error);
      }
    } catch (error) {
      message.error('加载任务列表异常');
      logger.error('[TaskStore] 加载任务列表异常:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建任务
   */
  async function createTask(taskData: Partial<Task>): Promise<Task | null> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:create', {
        taskData,
      });

      if (result.success) {
        message.success('任务创建成功');
        logger.info('[TaskStore] 任务创建成功:', result.task);

        // 重新加载任务列表
        await loadTasks();

        return result.task || null;
      } else {
        message.error(`创建任务失败: ${result.error}`);
        logger.error('[TaskStore] 创建任务失败:', result.error);
        return null;
      }
    } catch (error) {
      message.error('创建任务异常');
      logger.error('[TaskStore] 创建任务异常:', error as any);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 更新任务
   */
  async function updateTask(taskId: string, updates: Partial<Task>): Promise<boolean> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:update', {
        taskId,
        updates,
      });

      if (result.success) {
        message.success('任务更新成功');
        logger.info('[TaskStore] 任务更新成功');

        // 更新本地缓存
        const index = tasks.value.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          tasks.value[index] = {
            ...tasks.value[index],
            ...updates,
            updated_at: Date.now(),
          };
        }

        // 如果更新的是当前任务，同步更新
        if (currentTask.value?.id === taskId) {
          currentTask.value = {
            ...currentTask.value,
            ...updates,
            updated_at: Date.now(),
          };
        }

        return true;
      } else {
        message.error(`更新任务失败: ${result.error}`);
        logger.error('[TaskStore] 更新任务失败:', result.error);
        return false;
      }
    } catch (error) {
      message.error('更新任务异常');
      logger.error('[TaskStore] 更新任务异常:', error as any);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 删除任务
   */
  async function deleteTask(taskId: string): Promise<boolean> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:delete', {
        taskId,
      });

      if (result.success) {
        message.success('任务已删除');
        logger.info('[TaskStore] 任务删除成功');

        // 从列表中移除
        const index = tasks.value.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          tasks.value.splice(index, 1);
        }

        // 如果删除的是当前任务，关闭详情对话框
        if (currentTask.value?.id === taskId) {
          currentTask.value = null;
          taskDetailVisible.value = false;
        }

        return true;
      } else {
        message.error(`删除任务失败: ${result.error}`);
        logger.error('[TaskStore] 删除任务失败:', result.error);
        return false;
      }
    } catch (error) {
      message.error('删除任务异常');
      logger.error('[TaskStore] 删除任务异常:', error as any);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载任务详情
   */
  async function loadTaskDetail(taskId: string): Promise<void> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:detail', {
        taskId,
      });

      if (result.success && result.task) {
        // 解析JSON字段
        currentTask.value = {
          ...result.task,
          collaborators: safeParseJSON<string[]>(result.task.collaborators as any, []),
          labels: safeParseJSON<string[]>(result.task.labels as any, []),
          blocked_by: safeParseJSON<string[]>(result.task.blocked_by as any, []),
        };

        logger.info('[TaskStore] 任务详情加载成功');

        // 同时加载评论和变更历史
        await loadTaskComments(taskId);
        await loadTaskChanges(taskId);
      } else {
        message.error(`加载任务详情失败: ${result.error}`);
        logger.error('[TaskStore] 加载任务详情失败:', result.error);
      }
    } catch (error) {
      message.error('加载任务详情异常');
      logger.error('[TaskStore] 加载任务详情异常:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 分配任务
   */
  async function assignTask(taskId: string, assignedTo: string): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:assign', {
        taskId,
        assignedTo,
      });

      if (result.success) {
        message.success('任务已分配');
        await loadTasks();
        if (currentTask.value?.id === taskId) {
          await loadTaskDetail(taskId);
        }
        return true;
      } else {
        message.error(`分配任务失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('分配任务异常');
      logger.error('[TaskStore] 分配任务异常:', error as any);
      return false;
    }
  }

  /**
   * 变更任务状态
   */
  async function changeStatus(taskId: string, status: TaskStatus): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:changeStatus', {
        taskId,
        status,
      });

      if (result.success) {
        message.success('状态变更成功');
        await loadTasks();
        if (currentTask.value?.id === taskId) {
          await loadTaskDetail(taskId);
        }
        return true;
      } else {
        message.error(`变更状态失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('变更状态异常');
      logger.error('[TaskStore] 变更状态异常:', error as any);
      return false;
    }
  }

  /**
   * 加载任务评论
   */
  async function loadTaskComments(taskId: string): Promise<void> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:comment:list', {
        taskId,
      });

      if (result.success) {
        // 解析JSON字段
        currentTaskComments.value = (result.comments || []).map((comment) => ({
          ...comment,
          mentions: safeParseJSON<string[]>(comment.mentions as any, []),
          attachments: safeParseJSON<any[]>(comment.attachments as any, []),
        }));

        logger.info('[TaskStore] 评论加载成功', currentTaskComments.value.length);
      } else {
        logger.error('[TaskStore] 加载评论失败:', result.error);
      }
    } catch (error) {
      logger.error('[TaskStore] 加载评论异常:', error as any);
    }
  }

  /**
   * 添加任务评论
   */
  async function addComment(
    taskId: string,
    content: string,
    mentions: string[] = []
  ): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:comment:add', {
        taskId,
        content,
        mentions,
      });

      if (result.success) {
        message.success('评论已添加');
        await loadTaskComments(taskId);
        return true;
      } else {
        message.error(`添加评论失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('添加评论异常');
      logger.error('[TaskStore] 添加评论异常:', error as any);
      return false;
    }
  }

  /**
   * 删除任务评论
   */
  async function deleteComment(commentId: string): Promise<boolean> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:comment:delete', {
        commentId,
      });

      if (result.success) {
        message.success('评论已删除');
        if (currentTask.value) {
          await loadTaskComments(currentTask.value.id);
        }
        return true;
      } else {
        message.error(`删除评论失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error('删除评论异常');
      logger.error('[TaskStore] 删除评论异常:', error as any);
      return false;
    }
  }

  /**
   * 加载任务变更历史
   */
  async function loadTaskChanges(taskId: string): Promise<void> {
    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:getHistory', {
        taskId,
      });

      if (result.success) {
        currentTaskChanges.value = result.changes || [];
        logger.info('[TaskStore] 变更历史加载成功', currentTaskChanges.value.length);
      } else {
        logger.error('[TaskStore] 加载变更历史失败:', result.error);
      }
    } catch (error) {
      logger.error('[TaskStore] 加载变更历史异常:', error as any);
    }
  }

  /**
   * 加载任务看板列表
   */
  async function loadBoards(orgId: string, workspaceId: string | null = null): Promise<void> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:board:list', {
        orgId,
        workspaceId,
      });

      if (result.success) {
        // 解析JSON字段
        boards.value = (result.boards || []).map((board) => ({
          ...board,
          columns: safeParseJSON<BoardColumn[]>(board.columns as any, []),
          filters: safeParseJSON<Record<string, any>>(board.filters as any, {}),
        }));

        logger.info('[TaskStore] 看板列表加载成功', boards.value.length);

        // 如果当前没有选中看板，自动选中第一个
        if (!currentBoard.value && boards.value.length > 0) {
          currentBoard.value = boards.value[0];
        }
      } else {
        message.error(`加载看板列表失败: ${result.error}`);
        logger.error('[TaskStore] 加载看板列表失败:', result.error);
      }
    } catch (error) {
      message.error('加载看板列表异常');
      logger.error('[TaskStore] 加载看板列表异常:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建任务看板
   */
  async function createBoard(
    orgId: string,
    boardData: Partial<TaskBoard>
  ): Promise<TaskBoard | null> {
    loading.value = true;

    try {
      const result: IpcResult = await (window as any).ipc.invoke('tasks:board:create', {
        orgId,
        boardData,
      });

      if (result.success) {
        message.success('看板创建成功');
        logger.info('[TaskStore] 看板创建成功:', result.board);

        // 重新加载看板列表
        await loadBoards(orgId, boardData.workspace_id || null);

        return result.board || null;
      } else {
        message.error(`创建看板失败: ${result.error}`);
        logger.error('[TaskStore] 创建看板失败:', result.error);
        return null;
      }
    } catch (error) {
      message.error('创建看板异常');
      logger.error('[TaskStore] 创建看板异常:', error as any);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 更新筛选条件
   */
  function updateFilters(newFilters: Partial<TaskFilters>): void {
    filters.value = {
      ...filters.value,
      ...newFilters,
    };
    loadTasks();
  }

  /**
   * 清除筛选条件
   */
  function clearFilters(): void {
    filters.value = {
      status: null,
      priority: null,
      assigned_to: null,
      workspace_id: null,
      org_id: null,
    };
    loadTasks();
  }

  /**
   * 打开任务详情
   */
  async function openTaskDetail(taskId: string): Promise<void> {
    await loadTaskDetail(taskId);
    taskDetailVisible.value = true;
  }

  /**
   * 关闭任务详情
   */
  function closeTaskDetail(): void {
    taskDetailVisible.value = false;
    currentTask.value = null;
    currentTaskComments.value = [];
    currentTaskChanges.value = [];
  }

  /**
   * 重置Store
   */
  function reset(): void {
    tasks.value = [];
    currentTask.value = null;
    currentTaskComments.value = [];
    currentTaskChanges.value = [];
    boards.value = [];
    currentBoard.value = null;
    loading.value = false;
    taskDetailVisible.value = false;
    createTaskVisible.value = false;
    filters.value = {
      status: null,
      priority: null,
      assigned_to: null,
      workspace_id: null,
      org_id: null,
    };
  }

  // ==================== 返回 ====================

  return {
    // State
    tasks,
    currentTask,
    currentTaskComments,
    currentTaskChanges,
    boards,
    currentBoard,
    loading,
    taskDetailVisible,
    createTaskVisible,
    filters,

    // Getters
    tasksByStatus,
    tasksByPriority,
    myTasks,
    inProgressTasks,
    pendingTasks,
    completedTasks,
    overdueTasks,
    taskStats,

    // Actions
    loadTasks,
    createTask,
    updateTask,
    deleteTask,
    loadTaskDetail,
    assignTask,
    changeStatus,
    loadTaskComments,
    addComment,
    deleteComment,
    loadTaskChanges,
    loadBoards,
    createBoard,
    updateFilters,
    clearFilters,
    openTaskDetail,
    closeTaskDetail,
    reset,
  };
});
