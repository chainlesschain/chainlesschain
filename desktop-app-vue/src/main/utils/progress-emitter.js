/**
 * 统一进度通知系统
 *
 * 核心功能：
 * - 标准化进度事件格式
 * - 多任务并发追踪
 * - 层级进度聚合（子任务 -> 父任务）
 * - 进度持久化（可选）
 * - IPC 自动转发（Electron）
 *
 * v0.18.0: 新建文件，统一多媒体处理的进度通知
 */

const { logger } = require("./logger.js");
const { EventEmitter } = require("events");

/**
 * 进度阶段枚举
 */
const ProgressStage = {
  PENDING: "pending", // 等待中
  PREPARING: "preparing", // 准备中
  PROCESSING: "processing", // 处理中
  FINALIZING: "finalizing", // 收尾中
  COMPLETED: "completed", // 已完成
  FAILED: "failed", // 失败
  CANCELLED: "cancelled", // 已取消
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  autoForwardToIPC: true, // 自动转发到 IPC（Electron）
  persistProgress: false, // 持久化进度
  throttleInterval: 100, // 节流间隔（毫秒）
  enableHierarchy: true, // 启用层级进度
};

const KIB = 1024;

const DEFAULT_PROGRESS_LIMITS = Object.freeze({
  maxTasks: 128,
  maxTaskIdBytes: 256,
  maxTitleBytes: KIB,
  maxDescriptionBytes: 8 * KIB,
  maxMessageBytes: 8 * KIB,
  maxMetadataBytes: 64 * KIB,
  maxResultBytes: 64 * KIB,
  maxChildTasks: 128,
  maxTotalSteps: 1_000_000,
});

const HARD_PROGRESS_LIMITS = Object.freeze({
  maxTasks: 1024,
  maxTaskIdBytes: KIB,
  maxTitleBytes: 4 * KIB,
  maxDescriptionBytes: 32 * KIB,
  maxMessageBytes: 32 * KIB,
  maxMetadataBytes: 256 * KIB,
  maxResultBytes: 256 * KIB,
  maxChildTasks: 512,
  maxTotalSteps: 10_000_000,
});

const TERMINAL_PROGRESS_STAGES = new Set([
  ProgressStage.COMPLETED,
  ProgressStage.FAILED,
  ProgressStage.CANCELLED,
]);
const VALID_PROGRESS_STAGES = new Set(Object.values(ProgressStage));

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function createProgressError(result) {
  const error = new Error(result.error);
  Object.assign(error, result);
  return error;
}

function truncateUtf8(value, maxBytes) {
  const normalized = typeof value === "string" ? value : String(value ?? "");
  const bytes = Buffer.from(normalized, "utf8");
  if (bytes.length <= maxBytes) {
    return normalized;
  }
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

function prepareJsonWithinLimit(value, maxBytes, fallback = {}) {
  try {
    const serialized = JSON.stringify(value);
    if (
      typeof serialized !== "string" ||
      Buffer.byteLength(serialized, "utf8") > maxBytes
    ) {
      return { accepted: false, value: fallback };
    }
    return { accepted: true, value: JSON.parse(serialized) };
  } catch {
    return { accepted: false, value: fallback };
  }
}

function normalizeFiniteNumber(value, fallback) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

/**
 * 统一进度通知器类
 */
class ProgressEmitter extends EventEmitter {
  constructor(config = {}) {
    super();
    const normalizedConfig = config && typeof config === "object" ? config : {};
    this.config = { ...DEFAULT_CONFIG, ...normalizedConfig };
    this.limits = Object.freeze(
      Object.fromEntries(
        Object.keys(DEFAULT_PROGRESS_LIMITS).map((key) => [
          key,
          normalizeLimit(
            normalizedConfig[key],
            DEFAULT_PROGRESS_LIMITS[key],
            HARD_PROGRESS_LIMITS[key],
          ),
        ]),
      ),
    );

    // 任务追踪
    this.tasks = new Map();
    this.taskHierarchy = new Map(); // taskId -> parentTaskId
    this.cleanupTimers = new Map();
    this.droppedTasks = 0;
    this.droppedPayloads = 0;

    // 节流控制
    this.lastEmitTime = new Map();

    // IPC 窗口引用（Electron）
    this.mainWindow = null;

    logger.info("[ProgressEmitter] 初始化统一进度通知系统");
  }

  /**
   * 设置主窗口（用于 IPC 转发）
   * @param {BrowserWindow} window - Electron 主窗口
   */
  setMainWindow(window) {
    this.mainWindow = window;
    logger.info("[ProgressEmitter] IPC 转发已启用");
  }

  /**
   * 创建任务追踪器
   * @param {string} taskId - 任务唯一标识
   * @param {Object} options - 任务选项
   * @returns {Object} 任务追踪器
   */
  createTracker(taskId, options = {}) {
    const idValidation = this.validateTaskId(taskId);
    if (!idValidation.accepted) {
      throw createProgressError(idValidation);
    }
    if (this.tasks.has(taskId)) {
      throw createProgressError({
        accepted: false,
        error: `Task ${taskId} already exists`,
        code: "ALREADY_EXISTS",
        scope: "progress_tasks",
      });
    }
    const normalizedOptions =
      options && typeof options === "object" ? options : {};
    const {
      title = taskId, // 任务标题
      description = "", // 任务描述
      totalSteps = 100, // 总步数（用于计算百分比）
      parentTaskId = null, // 父任务ID（层级进度）
      metadata = {}, // 元数据
    } = normalizedOptions;

    let normalizedParentTaskId = null;
    if (parentTaskId !== null && parentTaskId !== undefined) {
      const parentValidation = this.validateTaskId(parentTaskId);
      if (!parentValidation.accepted) {
        throw createProgressError(parentValidation);
      }
      normalizedParentTaskId = parentTaskId;
      const parentTask = this.tasks.get(parentTaskId);
      if (
        parentTask &&
        parentTask.childTasks.length >= this.limits.maxChildTasks
      ) {
        this.droppedTasks += 1;
        throw createProgressError({
          accepted: false,
          error: "Progress child task capacity exceeded",
          code: "OVERLOADED",
          scope: "progress_child_tasks",
          retryAfterMs: 1000,
          limit: { maxChildTasks: this.limits.maxChildTasks },
        });
      }
    }

    const preparedMetadata = prepareJsonWithinLimit(
      metadata,
      this.limits.maxMetadataBytes,
      {},
    );
    if (!preparedMetadata.accepted) {
      this.droppedPayloads += 1;
    }

    while (this.tasks.size >= this.limits.maxTasks) {
      if (!this.evictOldestTerminalTask()) {
        this.droppedTasks += 1;
        throw createProgressError({
          accepted: false,
          error: "Progress task capacity exceeded",
          code: "OVERLOADED",
          scope: "progress_tasks",
          retryAfterMs: 1000,
          limit: { maxTasks: this.limits.maxTasks },
        });
      }
    }

    // 初始化任务信息
    const taskInfo = {
      taskId,
      title: truncateUtf8(title, this.limits.maxTitleBytes),
      description: truncateUtf8(description, this.limits.maxDescriptionBytes),
      stage: ProgressStage.PENDING,
      percent: 0,
      currentStep: 0,
      totalSteps: normalizeLimit(totalSteps, 100, this.limits.maxTotalSteps),
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      message: "",
      metadata: preparedMetadata.value,
      parentTaskId: normalizedParentTaskId,
      childTasks: [],
      error: null,
    };

    this.tasks.set(taskId, taskInfo);

    // 设置层级关系
    if (normalizedParentTaskId) {
      this.taskHierarchy.set(taskId, normalizedParentTaskId);
      const parent = this.tasks.get(normalizedParentTaskId);
      if (parent) {
        parent.childTasks.push(taskId);
      }
    }

    // 发送初始事件
    this.emitProgress(taskId, {
      stage: ProgressStage.PENDING,
      percent: 0,
      message: truncateUtf8(
        `任务创建: ${taskInfo.title}`,
        this.limits.maxMessageBytes,
      ),
    });

    // 返回追踪器对象
    return {
      /**
       * 更新步进（自动计算百分比）
       * @param {string} message - 进度消息
       * @param {number} increment - 步进增量（默认1）
       */
      step: (message = "", increment = 1) => {
        const task = this.tasks.get(taskId);
        if (!task) {
          return;
        }

        const normalizedIncrement = normalizeFiniteNumber(increment, 1);
        task.currentStep = Math.min(
          Math.max(task.currentStep + normalizedIncrement, 0),
          task.totalSteps,
        );
        task.percent = Math.round((task.currentStep / task.totalSteps) * 100);
        task.message = truncateUtf8(message, this.limits.maxMessageBytes);

        this.emitProgress(taskId, {
          percent: task.percent,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          message: task.message,
        });
      },

      /**
       * 直接设置百分比
       * @param {number} percent - 百分比 (0-100)
       * @param {string} message - 进度消息
       */
      setPercent: (percent, message = "") => {
        const task = this.tasks.get(taskId);
        if (!task) {
          return;
        }

        task.percent = Math.min(
          Math.max(normalizeFiniteNumber(percent, task.percent), 0),
          100,
        );
        task.currentStep = Math.round((task.percent / 100) * task.totalSteps);
        task.message = truncateUtf8(message, this.limits.maxMessageBytes);

        this.emitProgress(taskId, {
          percent: task.percent,
          message: task.message,
        });
      },

      /**
       * 设置任务阶段
       * @param {string} stage - 阶段（使用 ProgressStage 枚举）
       * @param {string} message - 消息
       */
      setStage: (stage, message = "") => {
        const task = this.tasks.get(taskId);
        if (!task || TERMINAL_PROGRESS_STAGES.has(task.stage)) {
          return;
        }

        if (!VALID_PROGRESS_STAGES.has(stage)) {
          return;
        }
        task.stage = stage;
        task.message = truncateUtf8(message, this.limits.maxMessageBytes);
        if (TERMINAL_PROGRESS_STAGES.has(stage)) {
          task.endTime = Date.now();
          task.duration = task.endTime - task.startTime;
          if (stage === ProgressStage.COMPLETED) {
            task.percent = 100;
          }
        }

        this.emitProgress(taskId, {
          stage: stage,
          percent: task.percent,
          message: task.message,
          duration: task.duration,
        });
        if (TERMINAL_PROGRESS_STAGES.has(stage)) {
          this.updateParentProgress(taskId);
          this.scheduleTaskRemoval(
            taskId,
            stage === ProgressStage.FAILED ? 10000 : 5000,
          );
        }
      },

      /**
       * 任务完成
       * @param {Object} result - 任务结果
       */
      complete: (result = {}) => {
        const task = this.tasks.get(taskId);
        if (!task || TERMINAL_PROGRESS_STAGES.has(task.stage)) {
          return;
        }

        const preparedResult = prepareJsonWithinLimit(
          result,
          this.limits.maxResultBytes,
          {},
        );
        if (!preparedResult.accepted) {
          this.droppedPayloads += 1;
        }

        task.stage = ProgressStage.COMPLETED;
        task.percent = 100;
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        task.message = truncateUtf8(
          preparedResult.value?.message || "任务完成",
          this.limits.maxMessageBytes,
        );

        this.emitProgress(taskId, {
          stage: ProgressStage.COMPLETED,
          percent: 100,
          message: task.message,
          result: preparedResult.value,
          duration: task.duration,
        });

        // 如果有父任务，更新父任务进度
        this.updateParentProgress(taskId);

        // 延迟清理（5秒后）
        this.scheduleTaskRemoval(taskId, 5000);
      },

      /**
       * 任务失败
       * @param {Error|string} error - 错误信息
       */
      error: (error) => {
        const task = this.tasks.get(taskId);
        if (!task || TERMINAL_PROGRESS_STAGES.has(task.stage)) {
          return;
        }

        const errorMessage = truncateUtf8(
          error instanceof Error ? error.message : error,
          this.limits.maxMessageBytes,
        );

        task.stage = ProgressStage.FAILED;
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        task.error = errorMessage;
        task.message = truncateUtf8(
          `任务失败: ${errorMessage}`,
          this.limits.maxMessageBytes,
        );

        this.emitProgress(taskId, {
          stage: ProgressStage.FAILED,
          message: task.message,
          error: errorMessage,
          duration: task.duration,
        });

        // 更新父任务
        this.updateParentProgress(taskId);

        // 延迟清理（10秒后）
        this.scheduleTaskRemoval(taskId, 10000);
      },

      /**
       * 取消任务
       * @param {string} reason - 取消原因
       */
      cancel: (reason = "用户取消") => {
        const task = this.tasks.get(taskId);
        if (!task || TERMINAL_PROGRESS_STAGES.has(task.stage)) {
          return;
        }

        const normalizedReason = truncateUtf8(
          reason,
          this.limits.maxMessageBytes,
        );

        task.stage = ProgressStage.CANCELLED;
        task.endTime = Date.now();
        task.duration = task.endTime - task.startTime;
        task.message = truncateUtf8(
          `任务已取消: ${normalizedReason}`,
          this.limits.maxMessageBytes,
        );

        this.emitProgress(taskId, {
          stage: ProgressStage.CANCELLED,
          message: task.message,
          duration: task.duration,
        });

        // 延迟清理（5秒后）
        this.scheduleTaskRemoval(taskId, 5000);
      },

      /**
       * 获取任务信息
       * @returns {Object} 任务信息
       */
      getInfo: () => {
        return this.getTask(taskId);
      },
    };
  }

  validateTaskId(taskId) {
    if (typeof taskId !== "string" || taskId.length === 0) {
      return {
        accepted: false,
        error: "taskId must be a non-empty string",
        code: "INVALID_ARGUMENT",
      };
    }
    if (Buffer.byteLength(taskId, "utf8") > this.limits.maxTaskIdBytes) {
      return {
        accepted: false,
        error: "taskId is too large",
        code: "OVERLOADED",
        scope: "progress_task_id",
        retryAfterMs: 1000,
        limit: { maxTaskIdBytes: this.limits.maxTaskIdBytes },
      };
    }
    return { accepted: true, taskId };
  }

  hasTask(taskId) {
    return this.tasks.has(taskId);
  }

  evictOldestTerminalTask() {
    for (const [taskId, task] of this.tasks.entries()) {
      if (TERMINAL_PROGRESS_STAGES.has(task.stage)) {
        this.removeTask(taskId);
        return true;
      }
    }
    return false;
  }

  scheduleTaskRemoval(taskId, delayMs) {
    if (!this.tasks.has(taskId)) {
      return false;
    }
    if (this.cleanupTimers.has(taskId)) {
      clearTimeout(this.cleanupTimers.get(taskId));
    }
    const boundedDelayMs = Math.max(
      0,
      Math.min(normalizeFiniteNumber(delayMs, 5000), 60_000),
    );
    const cleanupTimer = setTimeout(() => {
      this.cleanupTimers.delete(taskId);
      this.removeTask(taskId);
    }, boundedDelayMs);
    cleanupTimer.unref?.();
    this.cleanupTimers.set(taskId, cleanupTimer);
    return true;
  }

  /**
   * 发送进度事件（带节流）
   * @param {string} taskId - 任务ID
   * @param {Object} progress - 进度数据
   */
  emitProgress(taskId, progress) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    // 更新任务信息
    const retainedProgress = { ...progress };
    delete retainedProgress.result;
    Object.assign(task, retainedProgress);

    // 节流控制（除非是完成/失败/取消事件）
    const now = Date.now();
    const lastEmit = this.lastEmitTime.get(taskId) || 0;
    const isTerminalStage = TERMINAL_PROGRESS_STAGES.has(task.stage);

    if (!isTerminalStage && now - lastEmit < this.config.throttleInterval) {
      return; // 节流跳过
    }

    this.lastEmitTime.set(taskId, now);

    // 构建事件数据
    const eventData = {
      taskId: taskId,
      title: task.title,
      description: task.description,
      stage: task.stage,
      percent: task.percent,
      currentStep: task.currentStep,
      totalSteps: task.totalSteps,
      message: task.message,
      startTime: task.startTime,
      duration: task.duration,
      metadata: JSON.parse(JSON.stringify(task.metadata)),
      ...progress,
    };

    // 发送本地事件
    this.emit("progress", eventData);
    this.emit(`progress:${taskId}`, eventData);

    // IPC 转发（Electron）
    if (
      this.config.autoForwardToIPC &&
      this.mainWindow &&
      this.mainWindow.webContents
    ) {
      try {
        this.mainWindow.webContents.send("task-progress", eventData);
        this.mainWindow.webContents.send(`task-progress:${taskId}`, eventData);
      } catch (error) {
        logger.warn("[ProgressEmitter] IPC 转发失败:", error.message);
      }
    }

    // 持久化（可选）
    if (this.config.persistProgress) {
      this.persistTaskProgress(taskId, eventData);
    }
  }

  /**
   * 更新父任务进度（聚合子任务）
   * @param {string} childTaskId - 子任务ID
   */
  updateParentProgress(childTaskId) {
    if (!this.config.enableHierarchy) {
      return;
    }

    const parentTaskId = this.taskHierarchy.get(childTaskId);
    if (!parentTaskId) {
      return;
    }

    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask) {
      return;
    }

    // 聚合所有子任务的进度
    const childIds = parentTask.childTasks;
    if (childIds.length === 0) {
      return;
    }

    let totalPercent = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (const childId of childIds) {
      const childTask = this.tasks.get(childId);
      if (!childTask) {
        continue;
      }

      totalPercent += childTask.percent;

      if (childTask.stage === ProgressStage.COMPLETED) {
        completedCount++;
      } else if (childTask.stage === ProgressStage.FAILED) {
        failedCount++;
      }
    }

    // 计算父任务进度
    const avgPercent = Math.round(totalPercent / childIds.length);

    // 更新父任务
    parentTask.percent = avgPercent;
    parentTask.currentStep = Math.round(
      (avgPercent / 100) * parentTask.totalSteps,
    );

    // 如果所有子任务完成，父任务也完成
    if (completedCount === childIds.length) {
      parentTask.stage = ProgressStage.COMPLETED;
    } else if (failedCount > 0) {
      parentTask.stage = ProgressStage.PROCESSING; // 有失败但继续
    }

    this.emitProgress(parentTaskId, {
      percent: avgPercent,
      message: `子任务进度: ${completedCount}/${childIds.length} 已完成`,
    });
    if (parentTask.stage === ProgressStage.COMPLETED) {
      this.scheduleTaskRemoval(parentTaskId, 5000);
    }
  }

  /**
   * 持久化任务进度（可选）
   * @param {string} taskId - 任务ID
   * @param {Object} eventData - 事件数据
   */
  async persistTaskProgress(taskId, eventData) {
    if (!this.config.persistProgress) {
      return;
    }

    try {
      // 尝试使用数据库持久化
      const { getDatabase } = require("../database");
      const db = getDatabase();

      if (db) {
        // 确保表存在
        await db.run(`
          CREATE TABLE IF NOT EXISTS task_progress (
            task_id TEXT PRIMARY KEY,
            task_name TEXT,
            stage TEXT,
            percent INTEGER,
            message TEXT,
            details TEXT,
            started_at INTEGER,
            updated_at INTEGER
          )
        `);

        const taskInfo = this.tasks.get(taskId);
        const now = Date.now();

        await db.run(
          `INSERT OR REPLACE INTO task_progress
           (task_id, task_name, stage, percent, message, details, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            taskInfo?.taskName || "Unknown",
            eventData.stage || ProgressStage.PROCESSING,
            eventData.percent || 0,
            eventData.message || "",
            JSON.stringify(eventData.details || {}),
            taskInfo?.startTime || now,
            now,
          ],
        );

        logger.debug(
          `[ProgressEmitter] 进度已持久化: ${taskId} - ${eventData.percent}%`,
        );
      }
    } catch (error) {
      // 持久化失败不影响主流程
      logger.warn(`[ProgressEmitter] 进度持久化失败: ${error.message}`);
    }
  }

  /**
   * 移除任务
   * @param {string} taskId - 任务ID
   */
  removeTask(taskId) {
    if (this.cleanupTimers.has(taskId)) {
      clearTimeout(this.cleanupTimers.get(taskId));
      this.cleanupTimers.delete(taskId);
    }

    const task = this.tasks.get(taskId);
    if (task?.parentTaskId) {
      const parentTask = this.tasks.get(task.parentTaskId);
      if (parentTask) {
        parentTask.childTasks = parentTask.childTasks.filter(
          (childTaskId) => childTaskId !== taskId,
        );
      }
    }
    for (const childTaskId of task?.childTasks || []) {
      this.taskHierarchy.delete(childTaskId);
      const childTask = this.tasks.get(childTaskId);
      if (childTask) {
        childTask.parentTaskId = null;
      }
    }

    const removed = this.tasks.delete(taskId);
    this.taskHierarchy.delete(taskId);
    this.lastEmitTime.delete(taskId);
    if (removed) {
      this.emit("task-removed", { taskId });
    }
    return removed;
  }

  /**
   * 获取所有活动任务
   * @returns {Array} 任务列表
   */
  getActiveTasks() {
    const tasks = [];
    for (const taskInfo of this.tasks.values()) {
      tasks.push(JSON.parse(JSON.stringify(taskInfo)));
    }
    return tasks;
  }

  /**
   * 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {Object|null} 任务信息
   */
  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? JSON.parse(JSON.stringify(task)) : null;
  }

  getStats() {
    return {
      taskCount: this.tasks.size,
      hierarchyCount: this.taskHierarchy.size,
      cleanupTimerCount: this.cleanupTimers.size,
      droppedTasks: this.droppedTasks,
      droppedPayloads: this.droppedPayloads,
      limits: this.limits,
    };
  }

  /**
   * 清空所有任务
   */
  clearAll() {
    const removedTaskIds = [...this.tasks.keys()];
    for (const cleanupTimer of this.cleanupTimers.values()) {
      clearTimeout(cleanupTimer);
    }
    this.cleanupTimers.clear();
    this.tasks.clear();
    this.taskHierarchy.clear();
    this.lastEmitTime.clear();
    for (const taskId of removedTaskIds) {
      this.emit("task-removed", { taskId });
    }
    logger.info("[ProgressEmitter] 所有任务已清空");
  }
}

// 导出枚举和类
ProgressEmitter.Stage = ProgressStage;
ProgressEmitter.DEFAULT_LIMITS = DEFAULT_PROGRESS_LIMITS;
ProgressEmitter.HARD_LIMITS = HARD_PROGRESS_LIMITS;

module.exports = ProgressEmitter;
