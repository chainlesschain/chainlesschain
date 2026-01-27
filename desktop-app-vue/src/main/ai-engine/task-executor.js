/**
 * AI任务并行执行器
 * 支持依赖分析、并发控制、优先级队列
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const os = require('os');
const { CriticalPathOptimizer } = require('./critical-path-optimizer.js');

/**
 * 自动阶段转换管理器
 * 根据任务执行状态自动切换工具掩码阶段
 */
class AutoPhaseTransition {
  constructor(options = {}) {
    this.functionCaller = options.functionCaller;
    this.taskExecutor = options.taskExecutor;
    this.enabled = options.enabled !== false; // 默认启用
    this.currentPhase = 'planning';

    this.stats = {
      totalTransitions: 0,
      successfulTransitions: 0,
      failedTransitions: 0,
    };

    if (this.enabled && this.taskExecutor) {
      this.setupListeners();
      logger.info('[AutoPhaseTransition] 自动阶段转换已启用');
    }
  }

  /**
   * 设置事件监听器
   */
  setupListeners() {
    // 任务开始执行 → 切换到executing阶段
    this.taskExecutor.on('execution-started', () => {
      this.maybeTransition('executing', '任务开始执行');
    });

    // 所有任务完成 → 切换到validating阶段
    this.taskExecutor.on('execution-completed', () => {
      this.maybeTransition('validating', '所有任务执行完成');
    });

    // 执行失败 → 保持当前阶段或回退到planning
    this.taskExecutor.on('execution-failed', () => {
      logger.warn('[AutoPhaseTransition] 任务执行失败，保持当前阶段');
    });
  }

  /**
   * 尝试切换阶段
   */
  maybeTransition(targetPhase, reason = '') {
    if (!this.enabled) {
      return false;
    }

    if (!this.shouldTransition(targetPhase)) {
      logger.debug(`[AutoPhaseTransition] 阶段转换被拒绝: ${this.currentPhase} → ${targetPhase}`);
      return false;
    }

    logger.info(`[AutoPhaseTransition] 自动切换阶段: ${this.currentPhase} → ${targetPhase} (${reason})`);

    this.stats.totalTransitions++;

    try {
      // 调用 FunctionCaller 的 transitionToPhase 方法
      if (this.functionCaller) {
        const success = this.functionCaller.transitionToPhase(targetPhase);
        if (success) {
          this.currentPhase = targetPhase;
          this.stats.successfulTransitions++;
          logger.info(`[AutoPhaseTransition] ✅ 阶段切换成功: ${targetPhase}`);
          return true;
        } else {
          this.stats.failedTransitions++;
          logger.warn(`[AutoPhaseTransition] ❌ 阶段切换失败: ${targetPhase}`);
          return false;
        }
      }
    } catch (error) {
      this.stats.failedTransitions++;
      logger.error('[AutoPhaseTransition] 阶段切换异常:', error);
      return false;
    }

    return false;
  }

  /**
   * 判断是否允许转换
   */
  shouldTransition(targetPhase) {
    // 阶段转换状态机
    const transitions = {
      planning: ['executing'],                      // 规划 → 执行
      executing: ['validating', 'executing'],       // 执行 → 验证 或 重新执行
      validating: ['executing', 'committing'],      // 验证 → 重新执行 或 提交
      committing: ['planning'],                     // 提交 → 规划（新任务）
    };

    const allowedTransitions = transitions[this.currentPhase] || [];
    return allowedTransitions.includes(targetPhase);
  }

  /**
   * 手动切换阶段
   */
  manualTransition(targetPhase, reason = '手动触发') {
    return this.maybeTransition(targetPhase, reason);
  }

  /**
   * 重置到初始阶段
   */
  reset() {
    this.currentPhase = 'planning';
    logger.info('[AutoPhaseTransition] 重置到planning阶段');
  }

  /**
   * 获取当前阶段
   */
  getCurrentPhase() {
    return this.currentPhase;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentPhase: this.currentPhase,
      successRate: this.stats.totalTransitions > 0
        ? ((this.stats.successfulTransitions / this.stats.totalTransitions) * 100).toFixed(2)
        : '0.00',
    };
  }
}

/**
 * 任务执行器配置
 */
const EXECUTOR_CONFIG = {
  // 最大并发数
  MAX_CONCURRENCY: 3,
  // 任务超时时间（5分钟）
  TASK_TIMEOUT: 5 * 60 * 1000,
  // 重试次数
  MAX_RETRIES: 2,
  // 重试延迟（毫秒）
  RETRY_DELAY: 1000,
};

/**
 * 动态并发控制器
 * 根据CPU和内存使用率自动调整并发数
 */
class DynamicConcurrencyController {
  constructor(options = {}) {
    this.minConcurrency = options.minConcurrency || 1;
    this.maxConcurrency = options.maxConcurrency || 8;
    this.currentConcurrency = options.initialConcurrency || 3;

    // 资源阈值配置
    this.cpuLowThreshold = options.cpuLowThreshold || 50;   // CPU使用率低于50%时增加并发
    this.cpuHighThreshold = options.cpuHighThreshold || 90; // CPU使用率高于90%时减少并发
    this.memoryThreshold = options.memoryThreshold || 85;   // 内存使用率高于85%时减少并发

    // 采样配置
    this.sampleInterval = options.sampleInterval || 1000; // 采样间隔1秒
    this.sampleCount = options.sampleCount || 5;          // 采样次数

    // 调整策略
    this.increaseStep = options.increaseStep || 1;
    this.decreaseStep = options.decreaseStep || 1;

    // 采样数据
    this.cpuSamples = [];
    this.memorySamples = [];
    this.lastSampleTime = 0;

    // 统计信息
    this.stats = {
      adjustments: 0,
      increases: 0,
      decreases: 0,
      avgCpu: 0,
      avgMemory: 0,
    };

    logger.info(`[DynamicConcurrency] 初始化完成，初始并发数: ${this.currentConcurrency}, 范围: [${this.minConcurrency}, ${this.maxConcurrency}]`);
  }

  /**
   * 获取CPU使用率（百分比）
   */
  getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - (100 * idle / total);

    return Math.round(usage);
  }

  /**
   * 获取内存使用率（百分比）
   */
  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usage = (usedMem / totalMem) * 100;

    return Math.round(usage);
  }

  /**
   * 采样系统资源
   */
  async sampleSystemResources() {
    const now = Date.now();

    // 避免频繁采样
    if (now - this.lastSampleTime < this.sampleInterval) {
      return;
    }

    this.lastSampleTime = now;

    const cpuUsage = this.getCpuUsage();
    const memUsage = this.getMemoryUsage();

    this.cpuSamples.push(cpuUsage);
    this.memorySamples.push(memUsage);

    // 保持固定采样窗口
    if (this.cpuSamples.length > this.sampleCount) {
      this.cpuSamples.shift();
      this.memorySamples.shift();
    }

    logger.debug(`[DynamicConcurrency] 资源采样 - CPU: ${cpuUsage}%, 内存: ${memUsage}%`);
  }

  /**
   * 计算平均值
   */
  getAverage(samples) {
    if (samples.length === 0) return 0;
    const sum = samples.reduce((a, b) => a + b, 0);
    return Math.round(sum / samples.length);
  }

  /**
   * 调整并发数
   */
  async adjustConcurrency() {
    await this.sampleSystemResources();

    // 等待收集足够的样本
    if (this.cpuSamples.length < 3) {
      logger.debug(`[DynamicConcurrency] 样本不足，跳过调整 (${this.cpuSamples.length}/${this.sampleCount})`);
      return this.currentConcurrency;
    }

    const avgCpu = this.getAverage(this.cpuSamples);
    const avgMemory = this.getAverage(this.memorySamples);

    this.stats.avgCpu = avgCpu;
    this.stats.avgMemory = avgMemory;

    const oldConcurrency = this.currentConcurrency;
    let adjustment = 0;
    let reason = '';

    // 决策逻辑
    if (avgMemory > this.memoryThreshold) {
      // 内存压力过大，降低并发
      adjustment = -this.decreaseStep;
      reason = `内存使用率过高 (${avgMemory}% > ${this.memoryThreshold}%)`;
    } else if (avgCpu > this.cpuHighThreshold) {
      // CPU压力过大，降低并发
      adjustment = -this.decreaseStep;
      reason = `CPU使用率过高 (${avgCpu}% > ${this.cpuHighThreshold}%)`;
    } else if (avgCpu < this.cpuLowThreshold && avgMemory < this.memoryThreshold - 15) {
      // CPU和内存都有余量，增加并发
      adjustment = this.increaseStep;
      reason = `系统资源充足 (CPU: ${avgCpu}%, 内存: ${avgMemory}%)`;
    }

    if (adjustment !== 0) {
      this.currentConcurrency = Math.max(
        this.minConcurrency,
        Math.min(this.maxConcurrency, this.currentConcurrency + adjustment)
      );

      if (this.currentConcurrency !== oldConcurrency) {
        this.stats.adjustments++;
        if (adjustment > 0) {
          this.stats.increases++;
        } else {
          this.stats.decreases++;
        }

        logger.info(`[DynamicConcurrency] 并发数调整: ${oldConcurrency} → ${this.currentConcurrency} (${reason})`);
      }
    } else {
      logger.debug(`[DynamicConcurrency] 并发数保持: ${this.currentConcurrency} (CPU: ${avgCpu}%, 内存: ${avgMemory}%)`);
    }

    return this.currentConcurrency;
  }

  /**
   * 获取当前并发数
   */
  getCurrentConcurrency() {
    return this.currentConcurrency;
  }

  /**
   * 手动设置并发数
   */
  setConcurrency(value) {
    const newValue = Math.max(this.minConcurrency, Math.min(this.maxConcurrency, value));
    logger.info(`[DynamicConcurrency] 手动设置并发数: ${this.currentConcurrency} → ${newValue}`);
    this.currentConcurrency = newValue;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentConcurrency: this.currentConcurrency,
      cpuSamples: this.cpuSamples.length,
      memorySamples: this.memorySamples.length,
    };
  }

  /**
   * 重置统计
   */
  reset() {
    this.cpuSamples = [];
    this.memorySamples = [];
    this.stats = {
      adjustments: 0,
      increases: 0,
      decreases: 0,
      avgCpu: 0,
      avgMemory: 0,
    };
  }
}

/**
 * 智能重试策略
 * 支持指数退避、错误分类、抖动(jitter)
 */
class SmartRetryStrategy {
  constructor(options = {}) {
    // 基础配置
    this.baseDelay = options.baseDelay || 1000;           // 基础延迟1秒
    this.maxDelay = options.maxDelay || 30000;            // 最大延迟30秒
    this.backoffMultiplier = options.backoffMultiplier || 2; // 指数退避倍数
    this.jitterFactor = options.jitterFactor || 0.1;      // 抖动因子10%
    this.maxRetries = options.maxRetries || 3;            // 最大重试次数

    // 不可重试的错误类型（正则表达式）
    this.nonRetryableErrors = options.nonRetryableErrors || [
      /authentication.*failed/i,      // 认证失败
      /unauthorized/i,                // 未授权
      /forbidden/i,                   // 禁止访问
      /not.*found/i,                  // 资源不存在
      /invalid.*input/i,              // 无效输入
      /validation.*error/i,           // 验证错误
      /syntax.*error/i,               // 语法错误
      /permission.*denied/i,          // 权限拒绝
      /quota.*exceeded/i,             // 配额超限
      /rate.*limit.*permanent/i,      // 永久限流
    ];

    // 可重试的错误类型（优先级高于nonRetryable）
    this.retryableErrors = options.retryableErrors || [
      /timeout/i,                     // 超时
      /network.*error/i,              // 网络错误
      /connection.*refused/i,         // 连接被拒
      /econnrefused/i,                // 连接被拒（系统级）
      /enotfound/i,                   // 域名解析失败
      /etimedout/i,                   // 超时（系统级）
      /rate.*limit/i,                 // 限流（但非永久）
      /503.*service.*unavailable/i,   // 服务不可用
      /502.*bad.*gateway/i,           // 网关错误
      /500.*internal.*server/i,       // 服务器内部错误
      /temporarily.*unavailable/i,    // 临时不可用
    ];

    // 统计信息
    this.stats = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      nonRetryableErrors: 0,
      totalDelay: 0,
    };
  }

  /**
   * 判断错误是否可重试
   */
  isRetryable(error) {
    const errorMessage = error.message || error.toString();

    // 优先检查显式可重试
    for (const pattern of this.retryableErrors) {
      if (pattern.test(errorMessage)) {
        logger.debug(`[SmartRetry] 错误可重试（匹配规则: ${pattern}）: ${errorMessage}`);
        return true;
      }
    }

    // 检查不可重试
    for (const pattern of this.nonRetryableErrors) {
      if (pattern.test(errorMessage)) {
        logger.debug(`[SmartRetry] 错误不可重试（匹配规则: ${pattern}）: ${errorMessage}`);
        this.stats.nonRetryableErrors++;
        return false;
      }
    }

    // 默认可重试（保守策略）
    logger.debug(`[SmartRetry] 错误未匹配规则，默认可重试: ${errorMessage}`);
    return true;
  }

  /**
   * 计算重试延迟（指数退避 + 抖动）
   */
  calculateDelay(attemptNumber) {
    // 指数退避: baseDelay * (backoffMultiplier ^ attemptNumber)
    let delay = this.baseDelay * Math.pow(this.backoffMultiplier, attemptNumber - 1);

    // 限制最大延迟
    delay = Math.min(delay, this.maxDelay);

    // 添加抖动（±jitterFactor）
    const jitter = delay * this.jitterFactor * (Math.random() * 2 - 1);
    delay = delay + jitter;

    // 确保非负
    delay = Math.max(0, delay);

    logger.debug(`[SmartRetry] 计算重试延迟 - 尝试次数: ${attemptNumber}, 延迟: ${Math.round(delay)}ms`);

    return Math.round(delay);
  }

  /**
   * 执行重试延迟
   */
  async delay(attemptNumber) {
    const delayMs = this.calculateDelay(attemptNumber);
    this.stats.totalDelay += delayMs;

    logger.info(`[SmartRetry] 等待 ${delayMs}ms 后重试（尝试 #${attemptNumber}）`);

    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(error, currentAttempt) {
    // 超过最大重试次数
    if (currentAttempt >= this.maxRetries) {
      logger.debug(`[SmartRetry] 已达最大重试次数 (${currentAttempt}/${this.maxRetries})`);
      return false;
    }

    // 检查错误类型
    if (!this.isRetryable(error)) {
      logger.debug(`[SmartRetry] 错误类型不可重试`);
      return false;
    }

    return true;
  }

  /**
   * 记录重试成功
   */
  recordSuccess() {
    this.stats.successfulRetries++;
    this.stats.totalRetries++;
  }

  /**
   * 记录重试失败
   */
  recordFailure() {
    this.stats.failedRetries++;
    this.stats.totalRetries++;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalRetries > 0
        ? ((this.stats.successfulRetries / this.stats.totalRetries) * 100).toFixed(2)
        : '0.00',
      averageDelay: this.stats.totalRetries > 0
        ? Math.round(this.stats.totalDelay / this.stats.totalRetries)
        : 0,
    };
  }

  /**
   * 重置统计
   */
  reset() {
    this.stats = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      nonRetryableErrors: 0,
      totalDelay: 0,
    };
  }
}

/**
 * 任务状态
 */
const TaskStatus = {
  PENDING: 'pending',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * 任务节点
 */
class TaskNode {
  constructor(task, config = {}) {
    this.id = task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.task = task;
    this.status = TaskStatus.PENDING;
    this.dependencies = task.dependencies || [];
    this.dependents = []; // 依赖于此任务的任务列表
    this.priority = task.priority || 0;
    this.retries = 0;
    this.maxRetries = config.maxRetries || EXECUTOR_CONFIG.MAX_RETRIES;
    this.startTime = null;
    this.endTime = null;
    this.result = null;
    this.error = null;
  }

  /**
   * 检查是否可以执行
   */
  isReady(completedTasks) {
    if (this.status !== TaskStatus.PENDING) {
      return false;
    }

    // 检查所有依赖是否已完成
    return this.dependencies.every((depId) => completedTasks.has(depId));
  }

  /**
   * 标记为可执行
   */
  markReady() {
    if (this.status === TaskStatus.PENDING) {
      this.status = TaskStatus.READY;
    }
  }

  /**
   * 开始执行
   */
  markRunning() {
    this.status = TaskStatus.RUNNING;
    this.startTime = Date.now();
  }

  /**
   * 标记完成
   */
  markCompleted(result) {
    this.status = TaskStatus.COMPLETED;
    this.endTime = Date.now();
    this.result = result;
  }

  /**
   * 标记失败
   */
  markFailed(error) {
    this.status = TaskStatus.FAILED;
    this.endTime = Date.now();
    this.error = error;
  }

  /**
   * 获取执行时长
   */
  getDuration() {
    if (this.startTime && this.endTime) {
      return this.endTime - this.startTime;
    }
    return null;
  }
}

/**
 * 任务执行器
 */
class TaskExecutor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      ...EXECUTOR_CONFIG,
      ...config,
    };

    this.taskGraph = new Map(); // 任务图：taskId => TaskNode
    this.completedTasks = new Set(); // 已完成的任务ID集合
    this.runningTasks = new Set(); // 正在运行的任务ID集合
    this.failedTasks = new Set(); // 失败的任务ID集合

    this.isExecuting = false;
    this.cancelled = false;

    // 动态并发控制器（可选）
    this.useDynamicConcurrency = config.useDynamicConcurrency !== false; // 默认启用
    if (this.useDynamicConcurrency) {
      this.concurrencyController = new DynamicConcurrencyController({
        minConcurrency: config.minConcurrency || 1,
        maxConcurrency: config.maxConcurrency || 8,
        initialConcurrency: config.MAX_CONCURRENCY || 3,
        cpuLowThreshold: config.cpuLowThreshold || 50,
        cpuHighThreshold: config.cpuHighThreshold || 90,
        memoryThreshold: config.memoryThreshold || 85,
      });
      logger.info('[TaskExecutor] 动态并发控制已启用');
    } else {
      this.concurrencyController = null;
      logger.info(`[TaskExecutor] 使用固定并发数: ${this.config.MAX_CONCURRENCY}`);
    }

    // 智能重试策略（可选）
    this.useSmartRetry = config.useSmartRetry !== false; // 默认启用
    if (this.useSmartRetry) {
      this.retryStrategy = new SmartRetryStrategy({
        baseDelay: config.retryBaseDelay || 1000,
        maxDelay: config.retryMaxDelay || 30000,
        backoffMultiplier: config.retryBackoffMultiplier || 2,
        jitterFactor: config.retryJitterFactor || 0.1,
        maxRetries: config.MAX_RETRIES || this.config.MAX_RETRIES,
        retryableErrors: config.retryableErrors,
        nonRetryableErrors: config.nonRetryableErrors,
      });
      logger.info('[TaskExecutor] 智能重试策略已启用');
    } else {
      this.retryStrategy = null;
      logger.info(`[TaskExecutor] 使用固定重试延迟: ${this.config.RETRY_DELAY}ms`);
    }

    // 关键路径优化器（可选）
    this.useCriticalPath = config.useCriticalPath !== false; // 默认启用
    if (this.useCriticalPath) {
      this.criticalPathOptimizer = new CriticalPathOptimizer({
        priorityBoost: config.criticalPriorityBoost || 2.0,
        slackThreshold: config.criticalSlackThreshold || 1000,
      });
      logger.info('[TaskExecutor] 关键路径优化已启用');
    } else {
      this.criticalPathOptimizer = null;
      logger.info('[TaskExecutor] 关键路径优化已禁用');
    }

    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalDuration: 0,
    };
  }

  /**
   * 添加任务
   */
  addTask(task) {
    const node = new TaskNode(task, this.config);
    this.taskGraph.set(node.id, node);
    this.stats.total++;

    logger.info(`[TaskExecutor] 添加任务: ${node.id}, 依赖: [${node.dependencies.join(', ')}]`);

    return node.id;
  }

  /**
   * 批量添加任务
   */
  addTasks(tasks) {
    const taskIds = [];

    for (const task of tasks) {
      const taskId = this.addTask(task);
      taskIds.push(taskId);
    }

    // 构建依赖图
    this.buildDependencyGraph();

    return taskIds;
  }

  /**
   * 构建依赖图
   */
  buildDependencyGraph() {
    // 清空所有节点的dependents
    for (const node of this.taskGraph.values()) {
      node.dependents = [];
    }

    // 构建依赖关系
    for (const node of this.taskGraph.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.taskGraph.get(depId);
        if (depNode) {
          depNode.dependents.push(node.id);
        } else {
          logger.warn(`[TaskExecutor] 任务 ${node.id} 的依赖 ${depId} 不存在`);
        }
      }
    }
  }

  /**
   * 检测循环依赖
   */
  detectCyclicDependencies() {
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (nodeId) => {
      if (recursionStack.has(nodeId)) {
        return true; // 发现循环
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.taskGraph.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (hasCycle(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.taskGraph.keys()) {
      if (hasCycle(nodeId)) {
        throw new Error(`检测到循环依赖，涉及任务: ${nodeId}`);
      }
    }

    logger.info('[TaskExecutor] 依赖检查通过，无循环依赖');
  }

  /**
   * 获取可执行的任务
   */
  getReadyTasks() {
    const readyTasks = [];

    for (const node of this.taskGraph.values()) {
      if (node.isReady(this.completedTasks)) {
        node.markReady();
        readyTasks.push(node);
      }
    }

    // 按优先级排序（优先级高的先执行）
    readyTasks.sort((a, b) => b.priority - a.priority);

    return readyTasks;
  }

  /**
   * 执行单个任务
   */
  async executeTask(node, executor) {
    const taskId = node.id;

    logger.info(`[TaskExecutor] 开始执行任务: ${taskId}`);

    node.markRunning();
    this.runningTasks.add(taskId);

    this.emit('task-started', {
      taskId,
      task: node.task,
      attempt: node.retries + 1,
    });

    try {
      // 创建超时Promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('任务执行超时')), this.config.TASK_TIMEOUT);
      });

      // 执行任务
      const executionPromise = executor(node.task);

      // 竞速：先完成的胜出
      const result = await Promise.race([executionPromise, timeoutPromise]);

      // 成功
      node.markCompleted(result);
      this.runningTasks.delete(taskId);
      this.completedTasks.add(taskId);
      this.stats.completed++;
      this.stats.totalDuration += node.getDuration();

      logger.info(`[TaskExecutor] 任务完成: ${taskId}, 耗时: ${node.getDuration()}ms`);

      this.emit('task-completed', {
        taskId,
        task: node.task,
        result,
        duration: node.getDuration(),
      });

      return result;
    } catch (error) {
      logger.error(`[TaskExecutor] 任务失败: ${taskId}, 错误:`, error.message);

      // 智能重试逻辑
      if (this.useSmartRetry && this.retryStrategy) {
        // 使用智能重试策略
        if (this.retryStrategy.shouldRetry(error, node.retries + 1)) {
          node.retries++;
          node.status = TaskStatus.PENDING;
          this.runningTasks.delete(taskId);

          logger.info(`[TaskExecutor] 任务智能重试 (${node.retries}/${node.maxRetries}): ${taskId}`);

          this.emit('task-retry', {
            taskId,
            task: node.task,
            attempt: node.retries,
            error: error.message,
            retryStrategy: 'smart',
          });

          // 使用智能延迟（指数退避 + 抖动）
          await this.retryStrategy.delay(node.retries);

          const retryResult = await this.executeTask(node, executor);

          // 重试成功
          if (retryResult !== undefined) {
            this.retryStrategy.recordSuccess();
          }

          return retryResult;
        } else {
          // 错误不可重试或已达最大次数
          logger.warn(`[TaskExecutor] 任务不可重试: ${taskId}, 原因: ${error.message}`);
          this.retryStrategy.recordFailure();
        }
      } else {
        // 使用传统固定延迟重试
        if (node.retries < node.maxRetries) {
          node.retries++;
          node.status = TaskStatus.PENDING;
          this.runningTasks.delete(taskId);

          logger.info(`[TaskExecutor] 任务重试 (${node.retries}/${node.maxRetries}): ${taskId}`);

          this.emit('task-retry', {
            taskId,
            task: node.task,
            attempt: node.retries,
            error: error.message,
            retryStrategy: 'fixed',
          });

          // 固定延迟重试
          await new Promise((resolve) => setTimeout(resolve, this.config.RETRY_DELAY * node.retries));

          return await this.executeTask(node, executor);
        }
      }

      // 失败
      node.markFailed(error);
      this.runningTasks.delete(taskId);
      this.failedTasks.add(taskId);
      this.stats.failed++;

      this.emit('task-failed', {
        taskId,
        task: node.task,
        error: error.message,
        duration: node.getDuration(),
      });

      throw error;
    }
  }

  /**
   * 并行执行所有任务
   */
  async executeAll(executor, options = {}) {
    if (this.isExecuting) {
      throw new Error('任务执行器已在运行中');
    }

    this.isExecuting = true;
    this.cancelled = false;

    const initialConcurrency = this.useDynamicConcurrency
      ? this.concurrencyController.getCurrentConcurrency()
      : this.config.MAX_CONCURRENCY;

    logger.info(`[TaskExecutor] 开始执行任务图，共 ${this.taskGraph.size} 个任务`);
    logger.info(`[TaskExecutor] 并发控制: ${this.useDynamicConcurrency ? '动态' : '固定'}, 初始并发数: ${initialConcurrency}`);

    // 检测循环依赖
    this.detectCyclicDependencies();

    this.emit('execution-started', {
      totalTasks: this.taskGraph.size,
    });

    const results = new Map();
    const errors = new Map();

    try {
      while (this.completedTasks.size + this.failedTasks.size < this.taskGraph.size) {
        if (this.cancelled) {
          throw new Error('执行已取消');
        }

        // 获取可执行的任务
        let readyTasks = this.getReadyTasks();

        // 应用关键路径优化（如果启用）
        if (this.useCriticalPath && this.criticalPathOptimizer && readyTasks.length > 1) {
          const tasksForOptimization = readyTasks.map(node => ({
            id: node.id,
            duration: node.estimatedDuration || 1000,
            dependencies: node.dependencies,
            priority: node.priority || 0,
            estimatedDuration: node.estimatedDuration || 1000,
          }));

          const optimizedTasks = this.criticalPathOptimizer.optimize(tasksForOptimization);

          // 重新排序readyTasks
          const taskOrder = new Map(optimizedTasks.map((t, index) => [t.id, index]));
          readyTasks.sort((a, b) => {
            const orderA = taskOrder.get(a.id) ?? 999;
            const orderB = taskOrder.get(b.id) ?? 999;
            return orderA - orderB;
          });

          logger.debug(`[TaskExecutor] 关键路径优化已应用，任务顺序: [${readyTasks.map(n => n.id).join(', ')}]`);
        }

        if (readyTasks.length === 0 && this.runningTasks.size === 0) {
          // 没有可执行的任务，且没有正在运行的任务
          // 可能存在未满足依赖的任务
          logger.warn('[TaskExecutor] 无法继续执行，可能存在依赖问题');
          break;
        }

        // 动态调整并发数（如果启用）
        let currentMaxConcurrency = this.config.MAX_CONCURRENCY;
        if (this.useDynamicConcurrency && this.concurrencyController) {
          currentMaxConcurrency = await this.concurrencyController.adjustConcurrency();
        }

        // 限制并发数
        const availableSlots = currentMaxConcurrency - this.runningTasks.size;
        const tasksToExecute = readyTasks.slice(0, availableSlots);

        if (tasksToExecute.length === 0) {
          // 没有空闲槽位，等待
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        // 并发执行任务
        const executionPromises = tasksToExecute.map((node) =>
          this.executeTask(node, executor)
            .then((result) => {
              results.set(node.id, result);
            })
            .catch((error) => {
              errors.set(node.id, error);

              // 如果设置了失败即停止
              if (options.stopOnFailure) {
                this.cancelled = true;
              }
            })
        );

        await Promise.allSettled(executionPromises);

        // 更新进度
        const progress = ((this.completedTasks.size + this.failedTasks.size) / this.taskGraph.size) * 100;

        this.emit('progress', {
          completed: this.completedTasks.size,
          failed: this.failedTasks.size,
          total: this.taskGraph.size,
          progress: progress.toFixed(2),
        });
      }

      logger.info('[TaskExecutor] 任务图执行完成');
      logger.info(`[TaskExecutor] 成功: ${this.stats.completed}, 失败: ${this.stats.failed}`);

      this.emit('execution-completed', {
        results,
        errors,
        stats: this.getStats(),
      });

      return {
        success: errors.size === 0,
        results,
        errors,
        stats: this.getStats(),
      };
    } catch (error) {
      logger.error('[TaskExecutor] 执行失败:', error);

      this.emit('execution-failed', {
        error: error.message,
        results,
        errors,
      });

      throw error;
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * 取消执行
   */
  cancel() {
    this.cancelled = true;
    this.stats.cancelled = this.taskGraph.size - this.completedTasks.size - this.failedTasks.size;

    logger.info('[TaskExecutor] 执行已取消');

    this.emit('execution-cancelled', {
      completed: this.completedTasks.size,
      cancelled: this.stats.cancelled,
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = {
      ...this.stats,
      averageDuration: this.stats.completed > 0 ? (this.stats.totalDuration / this.stats.completed).toFixed(2) : 0,
      successRate: this.stats.total > 0 ? ((this.stats.completed / this.stats.total) * 100).toFixed(2) : 0,
    };

    // 如果启用了动态并发，添加并发控制器统计
    if (this.useDynamicConcurrency && this.concurrencyController) {
      stats.concurrency = this.concurrencyController.getStats();
    }

    // 如果启用了智能重试，添加重试策略统计
    if (this.useSmartRetry && this.retryStrategy) {
      stats.retry = this.retryStrategy.getStats();
    }

    return stats;
  }

  /**
   * 重置执行器
   */
  reset() {
    this.taskGraph.clear();
    this.completedTasks.clear();
    this.runningTasks.clear();
    this.failedTasks.clear();

    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      totalDuration: 0,
    };

    this.isExecuting = false;
    this.cancelled = false;
  }

  /**
   * 可视化任务图
   */
  visualize() {
    logger.info('\n=== 任务执行图 ===\n');

    for (const node of this.taskGraph.values()) {
      const statusIcon = {
        [TaskStatus.PENDING]: '⏸️',
        [TaskStatus.READY]: '🔵',
        [TaskStatus.RUNNING]: '🔄',
        [TaskStatus.COMPLETED]: '✅',
        [TaskStatus.FAILED]: '❌',
        [TaskStatus.CANCELLED]: '⛔',
      }[node.status];

      logger.info(`${statusIcon} ${node.id}`);
      logger.info(`   优先级: ${node.priority}`);
      logger.info(`   依赖: [${node.dependencies.join(', ') || '无'}]`);
      logger.info(`   被依赖: [${node.dependents.join(', ') || '无'}]`);

      if (node.getDuration()) {
        logger.info(`   耗时: ${node.getDuration()}ms`);
      }

      logger.info('');
    }
  }
}

module.exports = {
  TaskExecutor,
  AutoPhaseTransition,
  DynamicConcurrencyController,
  SmartRetryStrategy,
  TaskStatus,
  TaskNode,
  EXECUTOR_CONFIG,
};
