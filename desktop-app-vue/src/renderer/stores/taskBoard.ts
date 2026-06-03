/**
 * TaskBoard Store - Pinia 状态管理
 * 管理团队任务看板系统的状态
 *
 * @module taskBoard-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 视图模式
 */
export type ViewMode = 'kanban' | 'list' | 'calendar' | 'timeline';

/**
 * 排序顺序
 */
export type SortOrder = 'asc' | 'desc';

/**
 * 任务状态
 */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

/**
 * 任务优先级
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Sprint 状态
 */
export type SprintStatus = 'planning' | 'active' | 'completed' | 'cancelled';

/**
 * 看板数据
 */
export interface Board {
  id: string;
  name: string;
  description?: string;
  orgId: string;
  createdAt: number;
  updatedAt?: number;
  settings?: Record<string, any>;
  [key: string]: any;
}

/**
 * 列数据
 */
export interface Column {
  id: string;
  boardId: string;
  name: string;
  position: number;
  wipLimit?: number;
  color?: string;
  [key: string]: any;
}

/**
 * 任务数据
 */
export interface Task {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeDid?: string;
  reporterDid?: string;
  labels?: string[];
  dueDate?: number;
  sprintId?: string;
  position: number;
  createdAt: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * Sprint 数据
 */
export interface Sprint {
  id: string;
  boardId: string;
  name: string;
  goal?: string;
  startDate?: number;
  endDate?: number;
  status: SprintStatus;
  [key: string]: any;
}

/**
 * 标签数据
 */
export interface Label {
  id: string;
  orgId: string;
  name: string;
  color: string;
  [key: string]: any;
}

/**
 * 报告数据
 */
export interface Report {
  id: string;
  orgId: string;
  type: 'daily' | 'weekly' | 'monthly';
  title: string;
  content?: string;
  aiSummary?: string;
  createdAt: number;
  [key: string]: any;
}

/**
 * 筛选条件
 */
export interface TaskFilters {
  assigneeDid: string | null;
  priority: TaskPriority | null;
  labels: string[];
  status: TaskStatus | null;
  searchQuery: string;
  sprintId: string | null;
}

/**
 * 分析数据
 */
export interface BoardAnalytics {
  tasksByStatus: Record<string, number>;
  tasksByPriority: Record<string, number>;
  tasksByAssignee: Record<string, number>;
  velocity: Array<{ sprint: string; points: number }>;
  burndown: Array<{ date: string; remaining: number }>;
  [key: string]: any;
}

/**
 * 加载状态
 */
export interface LoadingState {
  boards: boolean;
  board: boolean;
  tasks: boolean;
  task: boolean;
  sprints: boolean;
  reports: boolean;
  analytics: boolean;
}

/**
 * API 响应结果
 */
export interface TaskBoardApiResult {
  success: boolean;
  error?: string;
  boards?: Board[];
  board?: Board;
  columns?: Column[];
  tasks?: Task[];
  task?: Task;
  sprints?: Sprint[];
  labels?: Label[];
  reports?: Report[];
  analytics?: BoardAnalytics;
  boardId?: string;
  columnId?: string;
  taskId?: string;
  sprintId?: string;
  labelId?: string;
  reportId?: string;
  [key: string]: any;
}

/**
 * TaskBoard Store 状态
 */
export interface TaskBoardState {
  // 看板管理
  boards: Board[];
  currentBoard: Board | null;
  columns: Column[];
  // 任务管理
  tasks: Task[];
  currentTask: Task | null;
  taskDetailVisible: boolean;
  // Sprint 管理
  sprints: Sprint[];
  activeSprint: Sprint | null;
  // 标签管理
  labels: Label[];
  // 报告管理
  reports: Report[];
  // 视图设置
  viewMode: ViewMode;
  filters: TaskFilters;
  sortBy: string;
  sortOrder: SortOrder;
  // 分析数据
  analytics: BoardAnalytics;
  // 加载状态
  loading: LoadingState;
  // 错误状态
  error: string | null;
}

// ==================== Store ====================

export const useTaskBoardStore = defineStore('taskBoard', {
  state: (): TaskBoardState => ({
    // ==========================================
    // 看板管理
    // ==========================================

    // 所有看板列表
    boards: [],

    // 当前选中的看板
    currentBoard: null,

    // 当前看板的列
    columns: [],

    // ==========================================
    // 任务管理
    // ==========================================

    // 当前看板的任务
    tasks: [],

    // 当前选中的任务
    currentTask: null,

    // 任务详情抽屉是否打开
    taskDetailVisible: false,

    // ==========================================
    // Sprint 管理
    // ==========================================

    // 当前看板的 Sprint 列表
    sprints: [],

    // 当前活跃的 Sprint
    activeSprint: null,

    // ==========================================
    // 标签管理
    // ==========================================

    // 组织的标签列表
    labels: [],

    // ==========================================
    // 报告管理
    // ==========================================

    // 团队报告
    reports: [],

    // ==========================================
    // 视图设置
    // ==========================================

    // 视图模式: 'kanban' | 'list' | 'calendar' | 'timeline'
    viewMode: 'kanban',

    // 筛选条件
    filters: {
      assigneeDid: null,
      priority: null,
      labels: [],
      status: null,
      searchQuery: '',
      sprintId: null,
    },

    // 排序
    sortBy: 'position',
    sortOrder: 'asc',

    // ==========================================
    // 分析数据
    // ==========================================

    analytics: {
      tasksByStatus: {},
      tasksByPriority: {},
      tasksByAssignee: {},
      velocity: [],
      burndown: [],
    },

    // ==========================================
    // 加载状态
    // ==========================================

    loading: {
      boards: false,
      board: false,
      tasks: false,
      task: false,
      sprints: false,
      reports: false,
      analytics: false,
    },

    // ==========================================
    // 错误状态
    // ==========================================

    error: null,
  }),

  getters: {
    /**
     * 按列分组的任务
     */
    tasksByColumn(): Record<string, Task[]> {
      const grouped: Record<string, Task[]> = {};
      this.columns.forEach((column) => {
        grouped[column.id] = this.tasks.filter((task) => task.columnId === column.id);
      });
      return grouped;
    },

    /**
     * 根据筛选条件过滤后的任务
     */
    filteredTasks(): Task[] {
      let result = [...this.tasks];

      if (this.filters.assigneeDid) {
        result = result.filter((task) => task.assigneeDid === this.filters.assigneeDid);
      }

      if (this.filters.priority) {
        result = result.filter((task) => task.priority === this.filters.priority);
      }

      if (this.filters.labels.length > 0) {
        result = result.filter((task) =>
          this.filters.labels.some((label) => task.labels?.includes(label))
        );
      }

      if (this.filters.status) {
        result = result.filter((task) => task.status === this.filters.status);
      }

      if (this.filters.sprintId) {
        result = result.filter((task) => task.sprintId === this.filters.sprintId);
      }

      if (this.filters.searchQuery) {
        const query = this.filters.searchQuery.toLowerCase();
        result = result.filter(
          (task) =>
            task.title.toLowerCase().includes(query) ||
            (task.description && task.description.toLowerCase().includes(query))
        );
      }

      return result;
    },

    /**
     * 待办任务数量
     */
    todoCount(): number {
      return this.tasks.filter((task) => task.status === 'todo').length;
    },

    /**
     * 进行中任务数量
     */
    inProgressCount(): number {
      return this.tasks.filter((task) => task.status === 'in_progress').length;
    },

    /**
     * 已完成任务数量
     */
    completedCount(): number {
      return this.tasks.filter((task) => task.status === 'done').length;
    },

    /**
     * 过期任务数量
     */
    overdueCount(): number {
      const now = Date.now();
      return this.tasks.filter(
        (task) => task.dueDate && task.dueDate < now && task.status !== 'done'
      ).length;
    },

    /**
     * 是否正在加载
     */
    isLoading(): boolean {
      return Object.values(this.loading).some((loading) => loading);
    },
  },

  actions: {
    // ==========================================
    // 看板操作
    // ==========================================

    /**
     * 加载看板列表
     */
    async loadBoards(orgId: string, options: Record<string, any> = {}): Promise<TaskBoardApiResult> {
      this.loading.boards = true;
      this.error = null;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-boards', {
          orgId,
          ...options,
        });

        if (result.success) {
          this.boards = result.boards || [];
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载看板列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading.boards = false;
      }
    },

    /**
     * 创建看板
     */
    async createBoard(boardData: Partial<Board>): Promise<TaskBoardApiResult> {
      this.loading.boards = true;
      this.error = null;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:create-board', boardData);

        if (result.success && result.boardId) {
          this.boards.unshift({ id: result.boardId, ...boardData, createdAt: Date.now() } as Board);
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 创建看板失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading.boards = false;
      }
    },

    /**
     * 加载看板详情（包括列和任务）
     */
    async loadBoard(boardId: string): Promise<TaskBoardApiResult> {
      this.loading.board = true;
      this.error = null;

      try {
        // 加载看板详情
        const boardResult: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-board', { boardId });

        if (boardResult.success) {
          this.currentBoard = boardResult.board || null;
          this.columns = boardResult.columns || [];
        }

        // 加载任务
        await this.loadTasks(boardId);

        // 加载 Sprint
        await this.loadSprints(boardId);

        return boardResult;
      } catch (error) {
        console.error('[TaskBoardStore] 加载看板失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading.board = false;
      }
    },

    /**
     * 更新看板
     */
    async updateBoard(boardId: string, updates: Partial<Board>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:update-board', {
          boardId,
          updates,
        });

        if (result.success && this.currentBoard?.id === boardId) {
          this.currentBoard = { ...this.currentBoard, ...updates };
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 更新看板失败:', error);
        throw error;
      }
    },

    /**
     * 删除看板
     */
    async deleteBoard(boardId: string): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:delete-board', { boardId });

        if (result.success) {
          this.boards = this.boards.filter((b) => b.id !== boardId);
          if (this.currentBoard?.id === boardId) {
            this.currentBoard = null;
            this.columns = [];
            this.tasks = [];
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 删除看板失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 列操作
    // ==========================================

    /**
     * 创建列
     */
    async createColumn(boardId: string, columnData: Partial<Column>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:create-column', {
          boardId,
          ...columnData,
        });

        if (result.success && result.columnId) {
          this.columns.push({ id: result.columnId, boardId, ...columnData } as Column);
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 创建列失败:', error);
        throw error;
      }
    },

    /**
     * 更新列
     */
    async updateColumn(columnId: string, updates: Partial<Column>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:update-column', {
          columnId,
          updates,
        });

        if (result.success) {
          const index = this.columns.findIndex((c) => c.id === columnId);
          if (index !== -1) {
            this.columns[index] = { ...this.columns[index], ...updates };
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 更新列失败:', error);
        throw error;
      }
    },

    /**
     * 重新排序列
     */
    async reorderColumns(boardId: string, columnOrder: string[]): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:reorder-columns', {
          boardId,
          columnOrder,
        });

        if (result.success) {
          // 重新排序本地列
          this.columns.sort((a, b) => columnOrder.indexOf(a.id) - columnOrder.indexOf(b.id));
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 重新排序列失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 任务操作
    // ==========================================

    /**
     * 加载任务
     */
    async loadTasks(boardId: string, options: Record<string, any> = {}): Promise<TaskBoardApiResult> {
      this.loading.tasks = true;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-tasks', {
          boardId,
          ...options,
        });

        if (result.success) {
          this.tasks = result.tasks || [];
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载任务失败:', error);
        throw error;
      } finally {
        this.loading.tasks = false;
      }
    },

    /**
     * 创建任务
     */
    async createTask(taskData: Partial<Task>): Promise<TaskBoardApiResult> {
      this.loading.task = true;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:create-task', taskData);

        if (result.success && result.taskId) {
          this.tasks.push({ id: result.taskId, ...taskData, createdAt: Date.now() } as Task);
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 创建任务失败:', error);
        throw error;
      } finally {
        this.loading.task = false;
      }
    },

    /**
     * 更新任务
     */
    async updateTask(taskId: string, updates: Partial<Task>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:update-task', {
          taskId,
          updates,
        });

        if (result.success) {
          const index = this.tasks.findIndex((t) => t.id === taskId);
          if (index !== -1) {
            this.tasks[index] = { ...this.tasks[index], ...updates };
          }

          if (this.currentTask?.id === taskId) {
            this.currentTask = { ...this.currentTask, ...updates };
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 更新任务失败:', error);
        throw error;
      }
    },

    /**
     * 移动任务（拖拽）
     */
    async moveTask(taskId: string, targetColumnId: string, position: number): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:move-task', {
          taskId,
          targetColumnId,
          position,
        });

        if (result.success) {
          const task = this.tasks.find((t) => t.id === taskId);
          if (task) {
            task.columnId = targetColumnId;
            task.position = position;
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 移动任务失败:', error);
        throw error;
      }
    },

    /**
     * 删除任务
     */
    async deleteTask(taskId: string): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:delete-task', { taskId });

        if (result.success) {
          this.tasks = this.tasks.filter((t) => t.id !== taskId);
          if (this.currentTask?.id === taskId) {
            this.currentTask = null;
            this.taskDetailVisible = false;
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 删除任务失败:', error);
        throw error;
      }
    },

    /**
     * 打开任务详情
     */
    async openTaskDetail(taskId: string): Promise<TaskBoardApiResult> {
      this.loading.task = true;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-task', { taskId });

        if (result.success && result.task) {
          this.currentTask = result.task;
          this.taskDetailVisible = true;
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载任务详情失败:', error);
        throw error;
      } finally {
        this.loading.task = false;
      }
    },

    /**
     * 关闭任务详情
     */
    closeTaskDetail(): void {
      this.taskDetailVisible = false;
      this.currentTask = null;
    },

    // ==========================================
    // Sprint 操作
    // ==========================================

    /**
     * 加载 Sprint 列表
     */
    async loadSprints(boardId: string): Promise<TaskBoardApiResult> {
      this.loading.sprints = true;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-sprints', { boardId });

        if (result.success) {
          this.sprints = result.sprints || [];
          this.activeSprint = this.sprints.find((s) => s.status === 'active') || null;
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载 Sprint 失败:', error);
        throw error;
      } finally {
        this.loading.sprints = false;
      }
    },

    /**
     * 创建 Sprint
     */
    async createSprint(boardId: string, sprintData: Partial<Sprint>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:create-sprint', {
          boardId,
          ...sprintData,
        });

        if (result.success && result.sprintId) {
          this.sprints.push({ id: result.sprintId, boardId, ...sprintData } as Sprint);
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 创建 Sprint 失败:', error);
        throw error;
      }
    },

    /**
     * 开始 Sprint
     */
    async startSprint(sprintId: string): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:start-sprint', { sprintId });

        if (result.success) {
          const sprint = this.sprints.find((s) => s.id === sprintId);
          if (sprint) {
            sprint.status = 'active';
            this.activeSprint = sprint;
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 开始 Sprint 失败:', error);
        throw error;
      }
    },

    /**
     * 完成 Sprint
     */
    async completeSprint(sprintId: string): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:complete-sprint', { sprintId });

        if (result.success) {
          const sprint = this.sprints.find((s) => s.id === sprintId);
          if (sprint) {
            sprint.status = 'completed';
          }
          if (this.activeSprint?.id === sprintId) {
            this.activeSprint = null;
          }
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 完成 Sprint 失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 报告操作
    // ==========================================

    /**
     * 创建报告
     */
    async createReport(reportData: Partial<Report>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:create-report', reportData);

        if (result.success && result.reportId) {
          this.reports.unshift({ id: result.reportId, ...reportData } as Report);
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 创建报告失败:', error);
        throw error;
      }
    },

    /**
     * 加载报告
     */
    async loadReports(orgId: string, options: Record<string, any> = {}): Promise<TaskBoardApiResult> {
      this.loading.reports = true;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-reports', {
          orgId,
          ...options,
        });

        if (result.success) {
          this.reports = result.reports || [];
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载报告失败:', error);
        throw error;
      } finally {
        this.loading.reports = false;
      }
    },

    /**
     * 生成 AI 摘要
     */
    async generateAISummary(reportId: string): Promise<TaskBoardApiResult> {
      try {
        return await (window as any).electronAPI.invoke('task:generate-ai-summary', { reportId });
      } catch (error) {
        console.error('[TaskBoardStore] 生成 AI 摘要失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 分析操作
    // ==========================================

    /**
     * 加载看板分析数据
     */
    async loadAnalytics(boardId: string, options: Record<string, any> = {}): Promise<TaskBoardApiResult> {
      this.loading.analytics = true;

      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-board-analytics', {
          boardId,
          ...options,
        });

        if (result.success && result.analytics) {
          this.analytics = result.analytics;
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载分析数据失败:', error);
        throw error;
      } finally {
        this.loading.analytics = false;
      }
    },

    // ==========================================
    // 筛选和视图
    // ==========================================

    /**
     * 设置筛选条件
     */
    setFilters(filters: Partial<TaskFilters>): void {
      this.filters = { ...this.filters, ...filters };
    },

    /**
     * 清空筛选条件
     */
    clearFilters(): void {
      this.filters = {
        assigneeDid: null,
        priority: null,
        labels: [],
        status: null,
        searchQuery: '',
        sprintId: null,
      };
    },

    /**
     * 设置视图模式
     */
    setViewMode(mode: ViewMode): void {
      this.viewMode = mode;
    },

    // ==========================================
    // 标签操作
    // ==========================================

    /**
     * 加载标签
     */
    async loadLabels(orgId: string): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:get-labels', { orgId });

        if (result.success) {
          this.labels = result.labels || [];
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 加载标签失败:', error);
        throw error;
      }
    },

    /**
     * 创建标签
     */
    async createLabel(orgId: string, labelData: Partial<Label>): Promise<TaskBoardApiResult> {
      try {
        const result: TaskBoardApiResult = await (window as any).electronAPI.invoke('task:create-label', {
          orgId,
          ...labelData,
        });

        if (result.success && result.labelId) {
          this.labels.push({ id: result.labelId, orgId, ...labelData } as Label);
        }

        return result;
      } catch (error) {
        console.error('[TaskBoardStore] 创建标签失败:', error);
        throw error;
      }
    },

    // ==========================================
    // 重置
    // ==========================================

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
    },
  },
});
