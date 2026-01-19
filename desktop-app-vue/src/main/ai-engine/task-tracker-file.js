/**
 * 任务追踪文件系统
 *
 * 基于 Manus AI 的 todo.md 机制，实现文件系统持久化的任务追踪。
 *
 * 核心原则（来自 Manus Blog）：
 * 1. 将任务目标"重述"到上下文末尾 - 解决"丢失中间"问题
 * 2. 使用文件系统作为扩展记忆 - 支持长时间任务
 * 3. 保存中间结果 - 支持任务恢复
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

const fs = require("fs-extra");
const path = require("path");
const EventEmitter = require("events");

/**
 * 任务追踪文件管理器
 */
class TaskTrackerFile extends EventEmitter {
  constructor(options = {}) {
    super();

    // 工作空间目录
    this.workspaceDir = options.workspaceDir || this._getDefaultWorkspaceDir();

    // 文件路径
    this.todoPath = path.join(this.workspaceDir, "todo.md");
    this.contextPath = path.join(this.workspaceDir, "context.md");
    this.historyDir = path.join(this.workspaceDir, "task-history");

    // 配置
    this.config = {
      // 是否自动保存
      autoSave: options.autoSave !== false,
      // 保存间隔（毫秒）
      saveInterval: options.saveInterval || 5000,
      // 是否保留历史
      preserveHistory: options.preserveHistory !== false,
      // 最大历史任务数
      maxHistory: options.maxHistory || 50,
    };

    // 当前任务状态
    this.currentTask = null;

    // 自动保存定时器
    this._saveTimer = null;

    // 初始化工作空间
    this._initWorkspace();
  }

  /**
   * 获取默认工作空间目录
   * @private
   */
  _getDefaultWorkspaceDir() {
    const { app } = require("electron");
    try {
      return path.join(app.getPath("userData"), ".chainlesschain", "tasks");
    } catch {
      // 非 Electron 环境
      return path.join(process.cwd(), ".chainlesschain", "tasks");
    }
  }

  /**
   * 初始化工作空间
   * @private
   */
  async _initWorkspace() {
    try {
      await fs.ensureDir(this.workspaceDir);
      await fs.ensureDir(this.historyDir);
      console.log(`[TaskTrackerFile] 工作空间已初始化: ${this.workspaceDir}`);
    } catch (error) {
      console.error("[TaskTrackerFile] 工作空间初始化失败:", error);
    }
  }

  // ==========================================
  // 任务生命周期管理
  // ==========================================

  /**
   * 创建新任务
   * @param {Object} plan - 任务计划
   * @param {string} plan.objective - 任务目标
   * @param {Array} plan.steps - 任务步骤
   * @param {Object} plan.metadata - 元数据
   * @returns {Object} 创建的任务
   */
  async createTask(plan) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.currentTask = {
      id: taskId,
      objective: plan.objective,
      steps: plan.steps.map((step, index) => ({
        index,
        description: typeof step === "string" ? step : step.description,
        status: "pending",
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
      })),
      currentStep: 0,
      status: "created",
      metadata: plan.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 写入 todo.md
    await this.updateTodoFile("created");

    // 保存任务数据
    await this._saveTaskData();

    this.emit("task-created", this.currentTask);

    console.log(`[TaskTrackerFile] 任务已创建: ${taskId}`);
    return this.currentTask;
  }

  /**
   * 开始任务
   */
  async startTask() {
    if (!this.currentTask) {
      throw new Error("没有活动任务");
    }

    this.currentTask.status = "in_progress";
    this.currentTask.startedAt = Date.now();
    this.currentTask.updatedAt = Date.now();

    // 标记第一个步骤为进行中
    if (this.currentTask.steps.length > 0) {
      this.currentTask.steps[0].status = "in_progress";
      this.currentTask.steps[0].startedAt = Date.now();
    }

    await this.updateTodoFile("in_progress");
    await this._saveTaskData();

    // 启动自动保存
    this._startAutoSave();

    this.emit("task-started", this.currentTask);

    return this.currentTask;
  }

  /**
   * 更新任务进度
   * @param {number} stepIndex - 步骤索引
   * @param {string} status - 状态 (in_progress, completed, failed, skipped)
   * @param {Object} result - 步骤结果
   */
  async updateProgress(stepIndex, status, result = null) {
    if (!this.currentTask) {
      throw new Error("没有活动任务");
    }

    const step = this.currentTask.steps[stepIndex];
    if (!step) {
      throw new Error(`步骤 ${stepIndex} 不存在`);
    }

    step.status = status;
    step.result = result;
    step.updatedAt = Date.now();

    if (status === "in_progress") {
      step.startedAt = step.startedAt || Date.now();
      this.currentTask.currentStep = stepIndex;
    } else if (status === "completed" || status === "failed") {
      step.completedAt = Date.now();
    }

    this.currentTask.updatedAt = Date.now();

    await this.updateTodoFile(status);
    await this._saveTaskData();

    this.emit("progress-updated", { task: this.currentTask, step, stepIndex });

    return this.currentTask;
  }

  /**
   * 完成当前步骤并进入下一步
   * @param {Object} result - 步骤结果
   */
  async completeCurrentStep(result = null) {
    if (!this.currentTask) {
      throw new Error("没有活动任务");
    }

    const currentStep = this.currentTask.currentStep;

    // 完成当前步骤
    await this.updateProgress(currentStep, "completed", result);

    // 如果还有下一步，自动开始
    const nextStep = currentStep + 1;
    if (nextStep < this.currentTask.steps.length) {
      await this.updateProgress(nextStep, "in_progress");
    } else {
      // 所有步骤完成
      await this.completeTask();
    }

    return this.currentTask;
  }

  /**
   * 完成任务
   * @param {Object} result - 任务结果
   */
  async completeTask(result = null) {
    if (!this.currentTask) {
      throw new Error("没有活动任务");
    }

    this.currentTask.status = "completed";
    this.currentTask.completedAt = Date.now();
    this.currentTask.updatedAt = Date.now();
    this.currentTask.result = result;

    // 停止自动保存
    this._stopAutoSave();

    await this.updateTodoFile("completed");
    await this._saveTaskData();

    // 归档到历史
    if (this.config.preserveHistory) {
      await this._archiveTask();
    }

    this.emit("task-completed", this.currentTask);

    const completedTask = this.currentTask;
    this.currentTask = null;

    // 清理 todo.md
    await this._cleanupTodoFile();

    return completedTask;
  }

  /**
   * 取消任务
   * @param {string} reason - 取消原因
   */
  async cancelTask(reason = "用户取消") {
    if (!this.currentTask) {
      throw new Error("没有活动任务");
    }

    this.currentTask.status = "cancelled";
    this.currentTask.cancelledAt = Date.now();
    this.currentTask.updatedAt = Date.now();
    this.currentTask.cancelReason = reason;

    // 停止自动保存
    this._stopAutoSave();

    await this.updateTodoFile("cancelled");
    await this._saveTaskData();

    // 归档到历史
    if (this.config.preserveHistory) {
      await this._archiveTask();
    }

    this.emit("task-cancelled", this.currentTask);

    const cancelledTask = this.currentTask;
    this.currentTask = null;

    // 清理 todo.md
    await this._cleanupTodoFile();

    return cancelledTask;
  }

  /**
   * 记录步骤错误
   * @param {number} stepIndex - 步骤索引
   * @param {Error} error - 错误对象
   */
  async recordStepError(stepIndex, error) {
    if (!this.currentTask) {return;}

    const step = this.currentTask.steps[stepIndex];
    if (!step) {return;}

    step.error = {
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
    };

    step.status = "failed";
    step.completedAt = Date.now();

    await this.updateTodoFile("error");
    await this._saveTaskData();

    this.emit("step-error", { task: this.currentTask, step, stepIndex, error });
  }

  // ==========================================
  // todo.md 文件管理
  // ==========================================

  /**
   * 更新 todo.md 文件
   * Manus 策略：每次迭代更新，将目标"重述"到上下文末尾
   * @param {string} status - 当前状态
   */
  async updateTodoFile(status = "in_progress") {
    if (!this.currentTask) {return;}

    const content = this._generateTodoContent(status);

    try {
      await fs.writeFile(this.todoPath, content, "utf-8");
      console.log(`[TaskTrackerFile] todo.md 已更新: ${status}`);
    } catch (error) {
      console.error("[TaskTrackerFile] 更新 todo.md 失败:", error);
    }
  }

  /**
   * 生成 todo.md 内容
   * @private
   */
  _generateTodoContent(status) {
    const task = this.currentTask;
    const lines = [];

    // 标题
    lines.push("# Task Progress");
    lines.push("");
    lines.push(`> Last updated: ${new Date().toISOString()}`);
    lines.push(`> Status: **${status.toUpperCase()}**`);
    lines.push("");

    // 任务目标（重点突出）
    lines.push("## 🎯 Current Objective");
    lines.push("");
    lines.push(`> **${task.objective}**`);
    lines.push("");

    // 步骤列表
    lines.push("## 📋 Steps");
    lines.push("");

    task.steps.forEach((step, index) => {
      let marker;
      let statusEmoji;

      switch (step.status) {
        case "completed":
          marker = "[x]";
          statusEmoji = "✅";
          break;
        case "in_progress":
          marker = "[>]";
          statusEmoji = "🔄";
          break;
        case "failed":
          marker = "[!]";
          statusEmoji = "❌";
          break;
        case "skipped":
          marker = "[-]";
          statusEmoji = "⏭️";
          break;
        default:
          marker = "[ ]";
          statusEmoji = "⏳";
      }

      const stepLine = `${marker} **Step ${index + 1}**: ${step.description} ${statusEmoji}`;
      lines.push(stepLine);

      // 如果有错误，显示错误信息
      if (step.error) {
        lines.push(`    - Error: ${step.error.message}`);
      }

      // 如果有结果摘要，显示
      if (step.result && typeof step.result === "object" && step.result.summary) {
        lines.push(`    - Result: ${step.result.summary}`);
      }
    });

    lines.push("");

    // 当前焦点（最重要的部分 - 注意力操纵）
    lines.push("## 🔥 Current Focus");
    lines.push("");

    if (task.currentStep < task.steps.length) {
      const currentStepObj = task.steps[task.currentStep];
      lines.push(`> **Working on Step ${task.currentStep + 1}**: ${currentStepObj.description}`);
      lines.push("");
      lines.push("### What to do:");
      lines.push(`1. Complete: ${currentStepObj.description}`);

      if (task.currentStep < task.steps.length - 1) {
        lines.push(`2. Then proceed to: ${task.steps[task.currentStep + 1].description}`);
      } else {
        lines.push("2. This is the final step. Complete the task after this.");
      }
    } else {
      lines.push("> All steps completed. Finalizing task...");
    }

    lines.push("");

    // 元数据
    if (task.metadata && Object.keys(task.metadata).length > 0) {
      lines.push("## 📊 Metadata");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(task.metadata, null, 2));
      lines.push("```");
      lines.push("");
    }

    // 任务统计
    const completedSteps = task.steps.filter((s) => s.status === "completed").length;
    const failedSteps = task.steps.filter((s) => s.status === "failed").length;
    const progress = Math.round((completedSteps / task.steps.length) * 100);

    lines.push("## 📈 Progress");
    lines.push("");
    lines.push(`- Completed: ${completedSteps}/${task.steps.length} (${progress}%)`);
    if (failedSteps > 0) {
      lines.push(`- Failed: ${failedSteps}`);
    }
    lines.push(`- Started: ${new Date(task.createdAt).toLocaleString()}`);
    if (task.startedAt) {
      const elapsed = Date.now() - task.startedAt;
      lines.push(`- Elapsed: ${this._formatDuration(elapsed)}`);
    }

    lines.push("");

    // 再次重述目标（Manus 关键策略）
    lines.push("---");
    lines.push("");
    lines.push("**Remember the objective**: " + task.objective);

    return lines.join("\n");
  }

  /**
   * 格式化持续时间
   * @private
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 读取 todo.md 内容，用于注入到 prompt 末尾
   * @returns {Promise<string|null>}
   */
  async getTodoContext() {
    try {
      if (await fs.pathExists(this.todoPath)) {
        return await fs.readFile(this.todoPath, "utf-8");
      }
    } catch (error) {
      console.error("[TaskTrackerFile] 读取 todo.md 失败:", error);
    }
    return null;
  }

  /**
   * 获取当前任务的上下文摘要（用于 prompt）
   * @returns {Object|null}
   */
  getTaskContextForPrompt() {
    if (!this.currentTask) {return null;}

    const task = this.currentTask;
    const currentStep = task.steps[task.currentStep];

    return {
      objective: task.objective,
      currentStep: task.currentStep + 1,
      totalSteps: task.steps.length,
      currentStepDescription: currentStep?.description || "",
      completedSteps: task.steps
        .filter((s) => s.status === "completed")
        .map((s) => s.description),
      remainingSteps: task.steps
        .slice(task.currentStep)
        .map((s) => s.description),
      status: task.status,
    };
  }

  // ==========================================
  // 中间结果管理
  // ==========================================

  /**
   * 保存中间结果到文件（可恢复）
   * @param {number} stepIndex - 步骤索引
   * @param {Object} result - 结果数据
   */
  async saveIntermediateResult(stepIndex, result) {
    if (!this.currentTask) {return;}

    const resultPath = path.join(
      this.workspaceDir,
      `step_${stepIndex}_result.json`
    );

    try {
      await fs.writeJson(resultPath, {
        taskId: this.currentTask.id,
        stepIndex,
        result,
        savedAt: Date.now(),
      }, { spaces: 2 });

      console.log(`[TaskTrackerFile] 中间结果已保存: step_${stepIndex}`);
    } catch (error) {
      console.error("[TaskTrackerFile] 保存中间结果失败:", error);
    }
  }

  /**
   * 加载中间结果
   * @param {number} stepIndex - 步骤索引
   * @returns {Promise<Object|null>}
   */
  async loadIntermediateResult(stepIndex) {
    const resultPath = path.join(
      this.workspaceDir,
      `step_${stepIndex}_result.json`
    );

    try {
      if (await fs.pathExists(resultPath)) {
        return await fs.readJson(resultPath);
      }
    } catch (error) {
      console.error("[TaskTrackerFile] 加载中间结果失败:", error);
    }

    return null;
  }

  // ==========================================
  // 任务持久化和恢复
  // ==========================================

  /**
   * 保存任务数据
   * @private
   */
  async _saveTaskData() {
    if (!this.currentTask) {return;}

    const dataPath = path.join(this.workspaceDir, "current_task.json");

    try {
      await fs.writeJson(dataPath, this.currentTask, { spaces: 2 });
    } catch (error) {
      console.error("[TaskTrackerFile] 保存任务数据失败:", error);
    }
  }

  /**
   * 加载未完成的任务（用于恢复）
   * @returns {Promise<Object|null>}
   */
  async loadUnfinishedTask() {
    const dataPath = path.join(this.workspaceDir, "current_task.json");

    try {
      if (await fs.pathExists(dataPath)) {
        const task = await fs.readJson(dataPath);

        // 只恢复未完成的任务
        if (task.status === "in_progress" || task.status === "created") {
          this.currentTask = task;
          console.log(`[TaskTrackerFile] 已恢复任务: ${task.id}`);
          return task;
        }
      }
    } catch (error) {
      console.error("[TaskTrackerFile] 加载任务失败:", error);
    }

    return null;
  }

  /**
   * 归档已完成的任务
   * @private
   */
  async _archiveTask() {
    if (!this.currentTask) {return;}

    const archivePath = path.join(
      this.historyDir,
      `${this.currentTask.id}.json`
    );

    try {
      await fs.writeJson(archivePath, this.currentTask, { spaces: 2 });

      // 清理旧历史
      await this._cleanupHistory();

      console.log(`[TaskTrackerFile] 任务已归档: ${this.currentTask.id}`);
    } catch (error) {
      console.error("[TaskTrackerFile] 归档任务失败:", error);
    }
  }

  /**
   * 清理旧历史
   * @private
   */
  async _cleanupHistory() {
    try {
      const files = await fs.readdir(this.historyDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      if (jsonFiles.length > this.config.maxHistory) {
        // 按时间排序
        const sorted = jsonFiles.sort();
        const toDelete = sorted.slice(0, jsonFiles.length - this.config.maxHistory);

        for (const file of toDelete) {
          await fs.remove(path.join(this.historyDir, file));
        }

        console.log(`[TaskTrackerFile] 清理了 ${toDelete.length} 个历史任务`);
      }
    } catch (error) {
      console.error("[TaskTrackerFile] 清理历史失败:", error);
    }
  }

  /**
   * 获取任务历史
   * @param {number} limit - 限制数量
   * @returns {Promise<Array>}
   */
  async getTaskHistory(limit = 10) {
    try {
      const files = await fs.readdir(this.historyDir);
      const jsonFiles = files
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit);

      const tasks = [];
      for (const file of jsonFiles) {
        const task = await fs.readJson(path.join(this.historyDir, file));
        tasks.push(task);
      }

      return tasks;
    } catch (error) {
      console.error("[TaskTrackerFile] 获取历史失败:", error);
      return [];
    }
  }

  // ==========================================
  // 自动保存
  // ==========================================

  /**
   * 启动自动保存
   * @private
   */
  _startAutoSave() {
    if (!this.config.autoSave) {return;}

    this._stopAutoSave();

    this._saveTimer = setInterval(async () => {
      if (this.currentTask && this.currentTask.status === "in_progress") {
        await this._saveTaskData();
        await this.updateTodoFile(this.currentTask.status);
      }
    }, this.config.saveInterval);

    console.log("[TaskTrackerFile] 自动保存已启动");
  }

  /**
   * 停止自动保存
   * @private
   */
  _stopAutoSave() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
      console.log("[TaskTrackerFile] 自动保存已停止");
    }
  }

  /**
   * 清理 todo.md 文件
   * @private
   */
  async _cleanupTodoFile() {
    try {
      if (await fs.pathExists(this.todoPath)) {
        // 不删除，而是写入完成标记
        const content = `# Task Completed\n\nNo active task. Ready for new tasks.\n`;
        await fs.writeFile(this.todoPath, content, "utf-8");
      }

      // 清理中间结果文件
      const files = await fs.readdir(this.workspaceDir);
      for (const file of files) {
        if (file.startsWith("step_") && file.endsWith("_result.json")) {
          await fs.remove(path.join(this.workspaceDir, file));
        }
      }

      // 删除 current_task.json
      const currentTaskPath = path.join(this.workspaceDir, "current_task.json");
      if (await fs.pathExists(currentTaskPath)) {
        await fs.remove(currentTaskPath);
      }
    } catch (error) {
      console.error("[TaskTrackerFile] 清理失败:", error);
    }
  }

  // ==========================================
  // 状态查询
  // ==========================================

  /**
   * 获取当前任务
   * @returns {Object|null}
   */
  getCurrentTask() {
    return this.currentTask;
  }

  /**
   * 检查是否有活动任务
   * @returns {boolean}
   */
  hasActiveTask() {
    return (
      this.currentTask &&
      (this.currentTask.status === "in_progress" ||
        this.currentTask.status === "created")
    );
  }

  /**
   * 获取工作空间目录
   * @returns {string}
   */
  getWorkspaceDir() {
    return this.workspaceDir;
  }

  /**
   * 销毁实例
   */
  destroy() {
    this._stopAutoSave();
    this.removeAllListeners();
  }
}

// 单例
let taskTrackerInstance = null;

/**
 * 获取 TaskTrackerFile 单例
 * @param {Object} options - 配置选项
 * @returns {TaskTrackerFile}
 */
function getTaskTrackerFile(options = {}) {
  if (!taskTrackerInstance) {
    taskTrackerInstance = new TaskTrackerFile(options);
  }
  return taskTrackerInstance;
}

/**
 * 创建新的 TaskTrackerFile 实例（非单例）
 * @param {Object} options - 配置选项
 * @returns {TaskTrackerFile}
 */
function createTaskTrackerFile(options = {}) {
  return new TaskTrackerFile(options);
}

module.exports = {
  TaskTrackerFile,
  getTaskTrackerFile,
  createTaskTrackerFile,
};
