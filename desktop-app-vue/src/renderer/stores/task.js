import { logger, createLogger } from "@/utils/logger";
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { message } from "ant-design-vue";

/**
 * 任务管理Store - Phase 1
 * 负责管理任务的CRUD操作、评论、变更历史和看板
 */
export const useTaskStore = defineStore("task", () => {
  // ==================== Helper Functions ====================

  /**
   * 安全解析 JSON 字符串
   * @param {string|any} value - 要解析的值
   * @param {any} defaultValue - 解析失败时的默认值
   * @returns {any} 解析后的值或默认值
   */
  function safeParseJSON(value, defaultValue = null) {
    if (value == null) {
      return defaultValue;
    }
    if (typeof value !== "string") {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn("[TaskStore] JSON 解析失败:", error.message);
      return defaultValue;
    }
  }

  // ==================== State ====================

  // 任务列表
  const tasks = ref([]);

  // 当前查看的任务详情
  const currentTask = ref(null);

  // 任务评论列表（当前任务）
  const currentTaskComments = ref([]);

  // 任务变更历史（当前任务）
  const currentTaskChanges = ref([]);

  // 任务看板列表
  const boards = ref([]);

  // 当前激活的看板
  const currentBoard = ref(null);

  // 加载状态
  const loading = ref(false);

  // 任务详情对话框可见性
  const taskDetailVisible = ref(false);

  // 创建任务对话框可见性
  const createTaskVisible = ref(false);

  // 筛选条件
  const filters = ref({
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
  const tasksByStatus = computed(() => {
    const groups = {
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
  const tasksByPriority = computed(() => {
    const groups = {
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
  const myTasks = computed(() => {
    // TODO: 获取当前用户DID
    // return tasks.value.filter(task => task.assigned_to === currentUserDID);
    return tasks.value;
  });

  /**
   * 进行中的任务
   */
  const inProgressTasks = computed(() => {
    return tasks.value.filter((task) => task.status === "in_progress");
  });

  /**
   * 待处理的任务
   */
  const pendingTasks = computed(() => {
    return tasks.value.filter((task) => task.status === "pending");
  });

  /**
   * 已完成的任务
   */
  const completedTasks = computed(() => {
    return tasks.value.filter((task) => task.status === "completed");
  });

  /**
   * 过期的任务
   */
  const overdueTasks = computed(() => {
    const now = Date.now();
    return tasks.value.filter((task) => {
      return (
        task.due_date && task.due_date < now && task.status !== "completed"
      );
    });
  });

  /**
   * 任务统计
   */
  const taskStats = computed(() => {
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
   * @param {object} queryFilters - 查询筛选条件
   */
  async function loadTasks(queryFilters = {}) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:list", {
        filters: {
          ...filters.value,
          ...queryFilters,
        },
      });

      if (result.success) {
        // 解析JSON字段
        tasks.value = (result.tasks || []).map((task) => ({
          ...task,
          collaborators: safeParseJSON(task.collaborators, []),
          labels: safeParseJSON(task.labels, []),
          blocked_by: safeParseJSON(task.blocked_by, []),
        }));

        logger.info("[TaskStore] 任务列表加载成功", tasks.value.length);
      } else {
        message.error(`加载任务列表失败: ${result.error}`);
        logger.error("[TaskStore] 加载任务列表失败:", result.error);
      }
    } catch (error) {
      message.error("加载任务列表异常");
      logger.error("[TaskStore] 加载任务列表异常:", error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建任务
   * @param {object} taskData - 任务数据
   */
  async function createTask(taskData) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:create", {
        taskData,
      });

      if (result.success) {
        message.success("任务创建成功");
        logger.info("[TaskStore] 任务创建成功:", result.task);

        // 重新加载任务列表
        await loadTasks();

        return result.task;
      } else {
        message.error(`创建任务失败: ${result.error}`);
        logger.error("[TaskStore] 创建任务失败:", result.error);
        return null;
      }
    } catch (error) {
      message.error("创建任务异常");
      logger.error("[TaskStore] 创建任务异常:", error);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 更新任务
   * @param {string} taskId - 任务ID
   * @param {object} updates - 更新数据
   */
  async function updateTask(taskId, updates) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:update", {
        taskId,
        updates,
      });

      if (result.success) {
        message.success("任务更新成功");
        logger.info("[TaskStore] 任务更新成功");

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
        logger.error("[TaskStore] 更新任务失败:", result.error);
        return false;
      }
    } catch (error) {
      message.error("更新任务异常");
      logger.error("[TaskStore] 更新任务异常:", error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 删除任务
   * @param {string} taskId - 任务ID
   */
  async function deleteTask(taskId) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:delete", {
        taskId,
      });

      if (result.success) {
        message.success("任务已删除");
        logger.info("[TaskStore] 任务删除成功");

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
        logger.error("[TaskStore] 删除任务失败:", result.error);
        return false;
      }
    } catch (error) {
      message.error("删除任务异常");
      logger.error("[TaskStore] 删除任务异常:", error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 加载任务详情
   * @param {string} taskId - 任务ID
   */
  async function loadTaskDetail(taskId) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:detail", {
        taskId,
      });

      if (result.success) {
        // 解析JSON字段
        currentTask.value = {
          ...result.task,
          collaborators: safeParseJSON(result.task?.collaborators, []),
          labels: safeParseJSON(result.task?.labels, []),
          blocked_by: safeParseJSON(result.task?.blocked_by, []),
        };

        logger.info("[TaskStore] 任务详情加载成功");

        // 同时加载评论和变更历史
        await loadTaskComments(taskId);
        await loadTaskChanges(taskId);
      } else {
        message.error(`加载任务详情失败: ${result.error}`);
        logger.error("[TaskStore] 加载任务详情失败:", result.error);
      }
    } catch (error) {
      message.error("加载任务详情异常");
      logger.error("[TaskStore] 加载任务详情异常:", error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 分配任务
   * @param {string} taskId - 任务ID
   * @param {string} assignedTo - 被分配人DID
   */
  async function assignTask(taskId, assignedTo) {
    try {
      const result = await window.ipc.invoke("tasks:assign", {
        taskId,
        assignedTo,
      });

      if (result.success) {
        message.success("任务已分配");
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
      message.error("分配任务异常");
      logger.error("[TaskStore] 分配任务异常:", error);
      return false;
    }
  }

  /**
   * 变更任务状态
   * @param {string} taskId - 任务ID
   * @param {string} status - 新状态
   */
  async function changeStatus(taskId, status) {
    try {
      const result = await window.ipc.invoke("tasks:changeStatus", {
        taskId,
        status,
      });

      if (result.success) {
        message.success("状态变更成功");
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
      message.error("变更状态异常");
      logger.error("[TaskStore] 变更状态异常:", error);
      return false;
    }
  }

  /**
   * 加载任务评论
   * @param {string} taskId - 任务ID
   */
  async function loadTaskComments(taskId) {
    try {
      const result = await window.ipc.invoke("tasks:comment:list", {
        taskId,
      });

      if (result.success) {
        // 解析JSON字段
        currentTaskComments.value = (result.comments || []).map((comment) => ({
          ...comment,
          mentions: safeParseJSON(comment?.mentions, []),
          attachments: safeParseJSON(comment?.attachments, []),
        }));

        logger.info(
          "[TaskStore] 评论加载成功",
          currentTaskComments.value.length,
        );
      } else {
        logger.error("[TaskStore] 加载评论失败:", result.error);
      }
    } catch (error) {
      logger.error("[TaskStore] 加载评论异常:", error);
    }
  }

  /**
   * 添加任务评论
   * @param {string} taskId - 任务ID
   * @param {string} content - 评论内容
   * @param {Array} mentions - @提及的用户DID列表
   */
  async function addComment(taskId, content, mentions = []) {
    try {
      const result = await window.ipc.invoke("tasks:comment:add", {
        taskId,
        content,
        mentions,
      });

      if (result.success) {
        message.success("评论已添加");
        await loadTaskComments(taskId);
        return true;
      } else {
        message.error(`添加评论失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error("添加评论异常");
      logger.error("[TaskStore] 添加评论异常:", error);
      return false;
    }
  }

  /**
   * 删除任务评论
   * @param {string} commentId - 评论ID
   */
  async function deleteComment(commentId) {
    try {
      const result = await window.ipc.invoke("tasks:comment:delete", {
        commentId,
      });

      if (result.success) {
        message.success("评论已删除");
        if (currentTask.value) {
          await loadTaskComments(currentTask.value.id);
        }
        return true;
      } else {
        message.error(`删除评论失败: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error("删除评论异常");
      logger.error("[TaskStore] 删除评论异常:", error);
      return false;
    }
  }

  /**
   * 加载任务变更历史
   * @param {string} taskId - 任务ID
   */
  async function loadTaskChanges(taskId) {
    try {
      const result = await window.ipc.invoke("tasks:getHistory", {
        taskId,
      });

      if (result.success) {
        currentTaskChanges.value = result.changes || [];
        logger.info(
          "[TaskStore] 变更历史加载成功",
          currentTaskChanges.value.length,
        );
      } else {
        logger.error("[TaskStore] 加载变更历史失败:", result.error);
      }
    } catch (error) {
      logger.error("[TaskStore] 加载变更历史异常:", error);
    }
  }

  /**
   * 加载任务看板列表
   * @param {string} orgId - 组织ID
   * @param {string} workspaceId - 工作区ID（可选）
   */
  async function loadBoards(orgId, workspaceId = null) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:board:list", {
        orgId,
        workspaceId,
      });

      if (result.success) {
        // 解析JSON字段
        boards.value = (result.boards || []).map((board) => ({
          ...board,
          columns: safeParseJSON(board?.columns, []),
          filters: safeParseJSON(board?.filters, {}),
        }));

        logger.info("[TaskStore] 看板列表加载成功", boards.value.length);

        // 如果当前没有选中看板，自动选中第一个
        if (!currentBoard.value && boards.value.length > 0) {
          currentBoard.value = boards.value[0];
        }
      } else {
        message.error(`加载看板列表失败: ${result.error}`);
        logger.error("[TaskStore] 加载看板列表失败:", result.error);
      }
    } catch (error) {
      message.error("加载看板列表异常");
      logger.error("[TaskStore] 加载看板列表异常:", error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建任务看板
   * @param {string} orgId - 组织ID
   * @param {object} boardData - 看板数据
   */
  async function createBoard(orgId, boardData) {
    loading.value = true;

    try {
      const result = await window.ipc.invoke("tasks:board:create", {
        orgId,
        boardData,
      });

      if (result.success) {
        message.success("看板创建成功");
        logger.info("[TaskStore] 看板创建成功:", result.board);

        // 重新加载看板列表
        await loadBoards(orgId, boardData.workspace_id);

        return result.board;
      } else {
        message.error(`创建看板失败: ${result.error}`);
        logger.error("[TaskStore] 创建看板失败:", result.error);
        return null;
      }
    } catch (error) {
      message.error("创建看板异常");
      logger.error("[TaskStore] 创建看板异常:", error);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 更新筛选条件
   * @param {object} newFilters - 新的筛选条件
   */
  function updateFilters(newFilters) {
    filters.value = {
      ...filters.value,
      ...newFilters,
    };
    loadTasks();
  }

  /**
   * 清除筛选条件
   */
  function clearFilters() {
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
   * @param {string} taskId - 任务ID
   */
  async function openTaskDetail(taskId) {
    await loadTaskDetail(taskId);
    taskDetailVisible.value = true;
  }

  /**
   * 关闭任务详情
   */
  function closeTaskDetail() {
    taskDetailVisible.value = false;
    currentTask.value = null;
    currentTaskComments.value = [];
    currentTaskChanges.value = [];
  }

  /**
   * 重置Store
   */
  function reset() {
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
