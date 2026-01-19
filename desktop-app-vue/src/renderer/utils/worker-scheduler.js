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

/**
 * Worker Pool Manager
 * Worker池管理器
 */
export class WorkerPool {
  constructor(workerScript, options = {}) {
    this.workerScript = workerScript;
    this.options = {
      size: options.size || navigator.hardwareConcurrency || 4,
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
  init() {
    for (let i = 0; i < this.options.size; i++) {
      const worker = this.createWorker(i);
      this.workers.push(worker);
      this.available.push(worker);
    }

    if (this.options.debug) {
      console.log(`[WorkerPool] Created pool with ${this.options.size} workers`);
    }
  }

  /**
   * Create worker
   */
  createWorker(id) {
    const worker = new Worker(this.workerScript);

    worker.poolId = id;
    worker.tasksCompleted = 0;
    worker.currentTask = null;
    worker.idleTimer = null;

    worker.addEventListener('message', (event) => {
      this.handleWorkerMessage(worker, event);
    });

    worker.addEventListener('error', (error) => {
      this.handleWorkerError(worker, error);
    });

    return worker;
  }

  /**
   * Execute task
   */
  async execute(data, options = {}) {
    const {
      priority = 'normal',
      timeout = 30000,
      retries = 0,
    } = options;

    return new Promise((resolve, reject) => {
      const task = {
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
  enqueueTask(task) {
    // Check queue limit
    if (this.taskQueue.length >= this.options.maxTasks) {
      task.reject(new Error('Task queue is full'));
      return;
    }

    this.taskQueue.push(task);

    // Sort by priority
    this.sortQueue();

    if (this.options.debug) {
      console.log(`[WorkerPool] Task ${task.id} enqueued (priority: ${task.priority})`);
    }
  }

  /**
   * Sort queue by priority
   */
  sortQueue() {
    const priorityMap = { high: 3, normal: 2, low: 1 };

    this.taskQueue.sort((a, b) => {
      const priorityDiff = priorityMap[b.priority] - priorityMap[a.priority];
      if (priorityDiff !== 0) {return priorityDiff;}

      // Same priority, FIFO
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Process task queue
   */
  processQueue() {
    while (this.taskQueue.length > 0 && this.available.length > 0) {
      const task = this.taskQueue.shift();
      const worker = this.available.shift();

      this.executeTask(worker, task);
    }
  }

  /**
   * Execute task on worker
   */
  executeTask(worker, task) {
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
    worker.postMessage({
      type: 'task',
      id: task.id,
      data: task.data,
    });

    if (this.options.debug) {
      console.log(`[WorkerPool] Task ${task.id} assigned to worker ${worker.poolId}`);
    }
  }

  /**
   * Handle worker message
   */
  handleWorkerMessage(worker, event) {
    const { type, id, data, error } = event.data;

    if (type === 'result') {
      const task = worker.currentTask;

      if (!task || task.id !== id) {
        console.warn(`[WorkerPool] Received result for unknown task: ${id}`);
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
  handleTaskSuccess(worker, task, result) {
    worker.tasksCompleted++;
    task.resolve(result);

    if (this.options.debug) {
      const duration = Date.now() - task.createdAt;
      console.log(`[WorkerPool] Task ${task.id} completed in ${duration}ms`);
    }

    this.releaseWorker(worker);
  }

  /**
   * Handle task error
   */
  handleTaskError(worker, task, error) {
    if (task.remainingRetries > 0) {
      task.remainingRetries--;

      if (this.options.debug) {
        console.log(`[WorkerPool] Retrying task ${task.id} (${task.remainingRetries} retries left)`);
      }

      // Re-enqueue task
      this.enqueueTask(task);
      this.releaseWorker(worker);
      this.processQueue();
    } else {
      task.reject(new Error(error || 'Worker task failed'));

      if (this.options.debug) {
        console.error(`[WorkerPool] Task ${task.id} failed:`, error);
      }

      this.releaseWorker(worker);
    }
  }

  /**
   * Handle task timeout
   */
  handleTaskTimeout(worker, task) {
    console.warn(`[WorkerPool] Task ${task.id} timed out after ${task.timeout}ms`);

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
  handleWorkerError(worker, error) {
    console.error(`[WorkerPool] Worker ${worker.poolId} error:`, error);

    if (worker.currentTask) {
      this.handleTaskError(worker, worker.currentTask, error.message);
    }
  }

  /**
   * Release worker
   */
  releaseWorker(worker) {
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
        console.log(`[WorkerPool] Worker ${worker.poolId} has been idle for ${this.options.idleTimeout}ms`);
      }
    }, this.options.idleTimeout);

    // Process next task
    this.processQueue();
  }

  /**
   * Terminate all workers
   */
  terminate() {
    this.workers.forEach((worker) => {
      worker.terminate();
    });

    this.workers = [];
    this.available = [];
    this.busy = [];
    this.taskQueue = [];

    if (this.options.debug) {
      console.log('[WorkerPool] Pool terminated');
    }
  }

  /**
   * Get pool stats
   */
  getStats() {
    return {
      total: this.workers.length,
      available: this.available.length,
      busy: this.busy.length,
      queued: this.taskQueue.length,
      tasksCompleted: this.workers.reduce((sum, w) => sum + w.tasksCompleted, 0),
    };
  }
}

/**
 * Task Scheduler
 * 任务调度器
 */
export class TaskScheduler {
  constructor() {
    this.pools = new Map();
    this.scheduledTasks = new Map();
  }

  /**
   * Register worker pool
   */
  registerPool(name, workerScript, options) {
    if (this.pools.has(name)) {
      console.warn(`[TaskScheduler] Pool "${name}" already exists`);
      return;
    }

    const pool = new WorkerPool(workerScript, options);
    this.pools.set(name, pool);

    console.log(`[TaskScheduler] Registered pool: ${name}`);
  }

  /**
   * Schedule task
   */
  async schedule(poolName, data, options = {}) {
    const pool = this.pools.get(poolName);

    if (!pool) {
      throw new Error(`Pool "${poolName}" not found`);
    }

    return pool.execute(data, options);
  }

  /**
   * Schedule recurring task
   */
  scheduleRecurring(poolName, data, interval, options = {}) {
    const taskId = `${poolName}-${Date.now()}`;

    const execute = async () => {
      try {
        await this.schedule(poolName, data, options);
      } catch (error) {
        console.error(`[TaskScheduler] Recurring task error:`, error);
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
  cancelRecurring(taskId) {
    const task = this.scheduledTasks.get(taskId);

    if (task) {
      clearInterval(task.intervalId);
      this.scheduledTasks.delete(taskId);
      console.log(`[TaskScheduler] Cancelled recurring task: ${taskId}`);
    }
  }

  /**
   * Get pool
   */
  getPool(name) {
    return this.pools.get(name);
  }

  /**
   * Get all pool stats
   */
  getAllStats() {
    const stats = {};

    this.pools.forEach((pool, name) => {
      stats[name] = pool.getStats();
    });

    return stats;
  }

  /**
   * Terminate all pools
   */
  terminate() {
    this.pools.forEach((pool) => {
      pool.terminate();
    });

    this.pools.clear();
    this.scheduledTasks.forEach((task) => {
      clearInterval(task.intervalId);
    });
    this.scheduledTasks.clear();

    console.log('[TaskScheduler] All pools terminated');
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
