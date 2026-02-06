/**
 * Web Workers Task Scheduler
 * Web Workers任务调度系统
 *
 * Features:
 * - Worker pool management
 * - Task queue with priority
 * - Load balancing
 * - Task cancellation and timeout
 * - Error handling and retry
 * - Worker health monitoring
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 任务优先级
 */
export type TaskPriority = 'high' | 'normal' | 'low';

/**
 * 优先级映射
 */
export const PriorityMap: Record<TaskPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Worker Pool 选项
 */
export interface WorkerPoolOptions {
  /** Pool 大小，默认为 navigator.hardwareConcurrency 或 4 */
  size?: number;
  /** 最大任务数，默认 100 */
  maxTasks?: number;
  /** 空闲超时时间（毫秒），默认 30000 */
  idleTimeout?: number;
  /** 是否开启调试日志 */
  debug?: boolean;
}

/**
 * 任务选项
 */
export interface TaskExecuteOptions {
  /** 任务优先级 */
  priority?: TaskPriority;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
}

/**
 * 任务
 */
export interface Task<T = any, R = any> {
  id: number;
  data: T;
  priority: TaskPriority;
  timeout: number;
  retries: number;
  remainingRetries: number;
  resolve: (value: R) => void;
  reject: (reason?: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

/**
 * Worker 消息类型
 */
export interface WorkerTaskMessage<T = any> {
  type: 'task';
  id: number;
  data: T;
}

/**
 * Worker 结果消息
 */
export interface WorkerResultMessage<T = any> {
  type: 'result';
  id: number;
  data?: T;
  error?: string;
}

/**
 * Pool Worker 扩展接口
 */
export interface PoolWorker extends Worker {
  poolId: number;
  tasksCompleted: number;
  currentTask: Task | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Worker Pool 统计信息
 */
export interface PoolStats {
  /** 总Worker数 */
  total: number;
  /** 可用Worker数 */
  available: number;
  /** 繁忙Worker数 */
  busy: number;
  /** 队列中任务数 */
  queued: number;
  /** 完成的任务总数 */
  tasksCompleted: number;
}

/**
 * 定时任务信息
 */
export interface ScheduledTask<T = any> {
  poolName: string;
  data: T;
  interval: number;
  intervalId: ReturnType<typeof setInterval>;
}

/**
 * 所有Pool统计信息
 */
export type AllPoolStats = Record<string, PoolStats>;

// ==================== WorkerPool 类 ====================

/**
 * Worker Pool Manager
 * Worker池管理器
 */
export class WorkerPool {
  private workerScript: string | URL;
  private options: Required<WorkerPoolOptions>;
  private workers: PoolWorker[];
  private available: PoolWorker[];
  private busy: PoolWorker[];
  private taskQueue: Task[];
  private taskId: number;

  constructor(workerScript: string | URL, options: WorkerPoolOptions = {}) {
    this.workerScript = workerScript;
    this.options = {
      size: options.size || (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) || 4,
      maxTasks: options.maxTasks || 100,
      idleTimeout: options.idleTimeout || 30000, // 30s
      debug: options.debug || false,
    };

    this.workers = [];
    this.available = [];
    this.busy = [];
    this.taskQueue = [];
    this.taskId = 0;

    this.init();
  }

  /**
   * Initialize worker pool
   */
  private init(): void {
    for (let i = 0; i < this.options.size; i++) {
      const worker = this.createWorker(i);
      this.workers.push(worker);
      this.available.push(worker);
    }

    if (this.options.debug) {
      logger.info(`[WorkerPool] Created pool with ${this.options.size} workers`);
    }
  }

  /**
   * Create worker
   */
  private createWorker(id: number): PoolWorker {
    const worker = new Worker(this.workerScript) as PoolWorker;

    worker.poolId = id;
    worker.tasksCompleted = 0;
    worker.currentTask = null;
    worker.idleTimer = null;

    worker.addEventListener('message', (event: MessageEvent<WorkerResultMessage>) => {
      this.handleWorkerMessage(worker, event);
    });

    worker.addEventListener('error', (error: ErrorEvent) => {
      this.handleWorkerError(worker, error);
    });

    return worker;
  }

  /**
   * Execute task
   */
  async execute<T = any, R = any>(data: T, options: TaskExecuteOptions = {}): Promise<R> {
    const {
      priority = 'normal',
      timeout = 30000,
      retries = 0,
    } = options;

    return new Promise<R>((resolve, reject) => {
      const task: Task<T, R> = {
        id: ++this.taskId,
        data,
        priority,
        timeout,
        retries,
        remainingRetries: retries,
        resolve,
        reject,
        timeoutId: null,
        createdAt: Date.now(),
      };

      // Add to queue
      this.enqueueTask(task);

      // Try to execute immediately
      this.processQueue();
    });
  }

  /**
   * Enqueue task
   */
  private enqueueTask(task: Task): void {
    // Check queue limit
    if (this.taskQueue.length >= this.options.maxTasks) {
      task.reject(new Error('Task queue is full'));
      return;
    }

    this.taskQueue.push(task);

    // Sort by priority
    this.sortQueue();

    if (this.options.debug) {
      logger.info(`[WorkerPool] Task ${task.id} enqueued (priority: ${task.priority})`);
    }
  }

  /**
   * Sort queue by priority
   */
  private sortQueue(): void {
    this.taskQueue.sort((a, b) => {
      const priorityDiff = PriorityMap[b.priority] - PriorityMap[a.priority];
      if (priorityDiff !== 0) { return priorityDiff; }

      // Same priority, FIFO
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Process task queue
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0 && this.available.length > 0) {
      const task = this.taskQueue.shift()!;
      const worker = this.available.shift()!;

      this.executeTask(worker, task);
    }
  }

  /**
   * Execute task on worker
   */
  private executeTask(worker: PoolWorker, task: Task): void {
    worker.currentTask = task;
    this.busy.push(worker);

    // Clear idle timer
    if (worker.idleTimer) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = null;
    }

    // Set timeout
    if (task.timeout) {
      task.timeoutId = setTimeout(() => {
        this.handleTaskTimeout(worker, task);
      }, task.timeout);
    }

    // Send task to worker
    const message: WorkerTaskMessage = {
      type: 'task',
      id: task.id,
      data: task.data,
    };
    worker.postMessage(message);

    if (this.options.debug) {
      logger.info(`[WorkerPool] Task ${task.id} assigned to worker ${worker.poolId}`);
    }
  }

  /**
   * Handle worker message
   */
  private handleWorkerMessage(worker: PoolWorker, event: MessageEvent<WorkerResultMessage>): void {
    const { type, id, data, error } = event.data;

    if (type === 'result') {
      const task = worker.currentTask;

      if (!task || task.id !== id) {
        logger.warn(`[WorkerPool] Received result for unknown task: ${id}`);
        return;
      }

      // Clear timeout
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
        task.timeoutId = null;
      }

      // Handle result
      if (error) {
        this.handleTaskError(worker, task, error);
      } else {
        this.handleTaskSuccess(worker, task, data);
      }
    }
  }

  /**
   * Handle task success
   */
  private handleTaskSuccess<T>(worker: PoolWorker, task: Task<any, T>, result: T): void {
    worker.tasksCompleted++;
    task.resolve(result);

    if (this.options.debug) {
      const duration = Date.now() - task.createdAt;
      logger.info(`[WorkerPool] Task ${task.id} completed in ${duration}ms`);
    }

    this.releaseWorker(worker);
  }

  /**
   * Handle task error
   */
  private handleTaskError(worker: PoolWorker, task: Task, error: string): void {
    if (task.remainingRetries > 0) {
      task.remainingRetries--;

      if (this.options.debug) {
        logger.info(`[WorkerPool] Retrying task ${task.id} (${task.remainingRetries} retries left)`);
      }

      // Re-enqueue task
      this.enqueueTask(task);
      this.releaseWorker(worker);
      this.processQueue();
    } else {
      task.reject(new Error(error || 'Worker task failed'));

      if (this.options.debug) {
        logger.error(`[WorkerPool] Task ${task.id} failed:`, error);
      }

      this.releaseWorker(worker);
    }
  }

  /**
   * Handle task timeout
   */
  private handleTaskTimeout(worker: PoolWorker, task: Task): void {
    logger.warn(`[WorkerPool] Task ${task.id} timed out after ${task.timeout}ms`);

    // Terminate worker (it's stuck)
    worker.terminate();

    // Create new worker
    const newWorker = this.createWorker(worker.poolId);
    const index = this.workers.indexOf(worker);
    this.workers[index] = newWorker;

    // Remove from busy
    const busyIndex = this.busy.indexOf(worker);
    if (busyIndex > -1) {
      this.busy.splice(busyIndex, 1);
    }

    // Add new worker to available
    this.available.push(newWorker);

    // Retry task if retries available
    this.handleTaskError(newWorker, task, 'Task timeout');
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(worker: PoolWorker, error: ErrorEvent): void {
    logger.error(`[WorkerPool] Worker ${worker.poolId} error:`, error);

    if (worker.currentTask) {
      this.handleTaskError(worker, worker.currentTask, error.message);
    }
  }

  /**
   * Release worker
   */
  private releaseWorker(worker: PoolWorker): void {
    worker.currentTask = null;

    // Move from busy to available
    const busyIndex = this.busy.indexOf(worker);
    if (busyIndex > -1) {
      this.busy.splice(busyIndex, 1);
    }

    this.available.push(worker);

    // Set idle timer
    worker.idleTimer = setTimeout(() => {
      // Worker has been idle for too long, could terminate if needed
      if (this.options.debug) {
        logger.info(`[WorkerPool] Worker ${worker.poolId} has been idle for ${this.options.idleTimeout}ms`);
      }
    }, this.options.idleTimeout);

    // Process next task
    this.processQueue();
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    this.workers.forEach((worker) => {
      worker.terminate();
    });

    this.workers = [];
    this.available = [];
    this.busy = [];
    this.taskQueue = [];

    if (this.options.debug) {
      logger.info('[WorkerPool] Pool terminated');
    }
  }

  /**
   * Get pool stats
   */
  getStats(): PoolStats {
    return {
      total: this.workers.length,
      available: this.available.length,
      busy: this.busy.length,
      queued: this.taskQueue.length,
      tasksCompleted: this.workers.reduce((sum, w) => sum + w.tasksCompleted, 0),
    };
  }
}

// ==================== TaskScheduler 类 ====================

/**
 * Task Scheduler
 * 任务调度器
 */
export class TaskScheduler {
  private pools: Map<string, WorkerPool>;
  private scheduledTasks: Map<string, ScheduledTask>;

  constructor() {
    this.pools = new Map();
    this.scheduledTasks = new Map();
  }

  /**
   * Register worker pool
   */
  registerPool(name: string, workerScript: string | URL, options?: WorkerPoolOptions): void {
    if (this.pools.has(name)) {
      logger.warn(`[TaskScheduler] Pool "${name}" already exists`);
      return;
    }

    const pool = new WorkerPool(workerScript, options);
    this.pools.set(name, pool);

    logger.info(`[TaskScheduler] Registered pool: ${name}`);
  }

  /**
   * Schedule task
   */
  async schedule<T = any, R = any>(
    poolName: string,
    data: T,
    options: TaskExecuteOptions = {}
  ): Promise<R> {
    const pool = this.pools.get(poolName);

    if (!pool) {
      throw new Error(`Pool "${poolName}" not found`);
    }

    return pool.execute<T, R>(data, options);
  }

  /**
   * Schedule recurring task
   */
  scheduleRecurring<T = any>(
    poolName: string,
    data: T,
    interval: number,
    options: TaskExecuteOptions = {}
  ): string {
    const taskId = `${poolName}-${Date.now()}`;

    const execute = async (): Promise<void> => {
      try {
        await this.schedule(poolName, data, options);
      } catch (error) {
        logger.error(`[TaskScheduler] Recurring task error:`, error);
      }
    };

    const intervalId = setInterval(execute, interval);

    this.scheduledTasks.set(taskId, {
      poolName,
      data,
      interval,
      intervalId,
    });

    // Execute immediately
    execute();

    return taskId;
  }

  /**
   * Cancel recurring task
   */
  cancelRecurring(taskId: string): void {
    const task = this.scheduledTasks.get(taskId);

    if (task) {
      clearInterval(task.intervalId);
      this.scheduledTasks.delete(taskId);
      logger.info(`[TaskScheduler] Cancelled recurring task: ${taskId}`);
    }
  }

  /**
   * Get pool
   */
  getPool(name: string): WorkerPool | undefined {
    return this.pools.get(name);
  }

  /**
   * Get all pool stats
   */
  getAllStats(): AllPoolStats {
    const stats: AllPoolStats = {};

    this.pools.forEach((pool, name) => {
      stats[name] = pool.getStats();
    });

    return stats;
  }

  /**
   * Terminate all pools
   */
  terminate(): void {
    this.pools.forEach((pool) => {
      pool.terminate();
    });

    this.pools.clear();
    this.scheduledTasks.forEach((task) => {
      clearInterval(task.intervalId);
    });
    this.scheduledTasks.clear();

    logger.info('[TaskScheduler] All pools terminated');
  }
}

// Global task scheduler instance
export const taskScheduler = new TaskScheduler();

/**
 * Export default object
 */
export default {
  WorkerPool,
  TaskScheduler,
  taskScheduler,
};
