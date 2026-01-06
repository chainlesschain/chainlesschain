/**
 * Web Worker Manager
 * 管理Web Workers的生命周期和通信
 */

export class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.pendingTasks = new Map();
    this.taskIdCounter = 0;
  }

  /**
   * 创建Worker
   * @param {string} name - Worker名称
   * @param {string} workerPath - Worker文件路径
   * @param {Object} options - Worker选项
   * @returns {Promise<Worker>}
   */
  async createWorker(name, workerPath, options = {}) {
    if (this.workers.has(name)) {
      console.warn(`Worker "${name}" already exists`);
      return this.workers.get(name).instance;
    }

    try {
      const worker = new Worker(workerPath, { type: 'module', ...options });

      const workerInfo = {
        name,
        instance: worker,
        path: workerPath,
        ready: false,
        tasks: 0,
        errors: 0,
        createdAt: Date.now(),
      };

      // 监听Worker消息
      worker.addEventListener('message', (event) => {
        this.handleWorkerMessage(name, event);
      });

      // 监听Worker错误
      worker.addEventListener('error', (error) => {
        this.handleWorkerError(name, error);
      });

      // 等待Worker就绪
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Worker "${name}" initialization timeout`));
        }, 5000);

        const readyHandler = (event) => {
          if (event.data.type === 'ready') {
            clearTimeout(timeout);
            workerInfo.ready = true;
            resolve();
          }
        };

        worker.addEventListener('message', readyHandler, { once: true });
      });

      this.workers.set(name, workerInfo);
      console.log(`Worker "${name}" created and ready`);

      return worker;
    } catch (error) {
      console.error(`Failed to create worker "${name}":`, error);
      throw error;
    }
  }

  /**
   * 获取Worker
   * @param {string} name - Worker名称
   * @returns {Worker|null}
   */
  getWorker(name) {
    const workerInfo = this.workers.get(name);
    return workerInfo?.instance || null;
  }

  /**
   * 向Worker发送任务
   * @param {string} workerName - Worker名称
   * @param {string} type - 任务类型
   * @param {Object} payload - 任务数据
   * @param {Object} options - 选项
   * @returns {Promise<any>}
   */
  async sendTask(workerName, type, payload, options = {}) {
    const workerInfo = this.workers.get(workerName);

    if (!workerInfo) {
      throw new Error(`Worker "${workerName}" not found`);
    }

    if (!workerInfo.ready) {
      throw new Error(`Worker "${workerName}" is not ready`);
    }

    const taskId = ++this.taskIdCounter;
    const timeout = options.timeout || 30000; // 默认30秒超时

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        reject(new Error(`Task ${taskId} timeout after ${timeout}ms`));
      }, timeout);

      // 保存待处理任务
      this.pendingTasks.set(taskId, {
        resolve,
        reject,
        timeoutId,
        workerName,
        type,
        startTime: Date.now(),
      });

      // 发送消息到Worker
      workerInfo.instance.postMessage({
        id: taskId,
        type,
        payload,
      });

      workerInfo.tasks++;
    });
  }

  /**
   * 处理Worker消息
   * @private
   */
  handleWorkerMessage(workerName, event) {
    const { id, type, result } = event.data;

    // 跳过ready消息
    if (type === 'ready') {
      return;
    }

    const task = this.pendingTasks.get(id);

    if (!task) {
      console.warn(`Received message for unknown task ${id}`);
      return;
    }

    // 清除超时
    clearTimeout(task.timeoutId);

    // 计算执行时间
    const duration = Date.now() - task.startTime;

    // 移除待处理任务
    this.pendingTasks.delete(id);

    // 解析结果
    if (result.success) {
      task.resolve({
        ...result,
        duration,
        workerName,
      });
    } else {
      task.reject(new Error(result.error || 'Worker task failed'));
    }
  }

  /**
   * 处理Worker错误
   * @private
   */
  handleWorkerError(workerName, error) {
    console.error(`Worker "${workerName}" error:`, error);

    const workerInfo = this.workers.get(workerName);
    if (workerInfo) {
      workerInfo.errors++;
    }

    // 拒绝所有待处理的任务
    this.pendingTasks.forEach((task, taskId) => {
      if (task.workerName === workerName) {
        clearTimeout(task.timeoutId);
        task.reject(new Error(`Worker "${workerName}" encountered an error`));
        this.pendingTasks.delete(taskId);
      }
    });
  }

  /**
   * 终止Worker
   * @param {string} name - Worker名称
   */
  terminateWorker(name) {
    const workerInfo = this.workers.get(name);

    if (!workerInfo) {
      console.warn(`Worker "${name}" not found`);
      return;
    }

    // 拒绝所有待处理的任务
    this.pendingTasks.forEach((task, taskId) => {
      if (task.workerName === name) {
        clearTimeout(task.timeoutId);
        task.reject(new Error(`Worker "${name}" terminated`));
        this.pendingTasks.delete(taskId);
      }
    });

    // 终止Worker
    workerInfo.instance.terminate();
    this.workers.delete(name);

    console.log(`Worker "${name}" terminated`);
  }

  /**
   * 终止所有Workers
   */
  terminateAll() {
    this.workers.forEach((_, name) => {
      this.terminateWorker(name);
    });
  }

  /**
   * 获取Worker统计信息
   * @param {string} name - Worker名称
   * @returns {Object|null}
   */
  getWorkerStats(name) {
    const workerInfo = this.workers.get(name);

    if (!workerInfo) {
      return null;
    }

    return {
      name: workerInfo.name,
      ready: workerInfo.ready,
      tasks: workerInfo.tasks,
      errors: workerInfo.errors,
      uptime: Date.now() - workerInfo.createdAt,
      pendingTasks: Array.from(this.pendingTasks.values()).filter(
        task => task.workerName === name
      ).length,
    };
  }

  /**
   * 获取所有Workers统计信息
   * @returns {Object}
   */
  getAllStats() {
    const stats = {
      totalWorkers: this.workers.size,
      totalTasks: 0,
      totalErrors: 0,
      pendingTasks: this.pendingTasks.size,
      workers: [],
    };

    this.workers.forEach((workerInfo, name) => {
      stats.totalTasks += workerInfo.tasks;
      stats.totalErrors += workerInfo.errors;
      stats.workers.push(this.getWorkerStats(name));
    });

    return stats;
  }
}

// 导出单例实例
export const workerManager = new WorkerManager();

/**
 * 文件处理Worker包装器
 * 提供便捷的文件处理方法
 */
export class FileWorkerHelper {
  constructor(workerManager) {
    this.workerManager = workerManager;
    this.workerName = 'file-parser';
    this.initialized = false;
  }

  /**
   * 初始化Worker
   */
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      await this.workerManager.createWorker(
        this.workerName,
        new URL('../workers/file-parser.worker.js', import.meta.url)
      );
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize file worker:', error);
      throw error;
    }
  }

  /**
   * 解析文件
   * @param {string} content - 文件内容
   * @param {string} fileType - 文件类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async parseFile(content, fileType, options = {}) {
    await this.init();
    return this.workerManager.sendTask(this.workerName, 'parse', {
      content,
      fileType,
      options,
    });
  }

  /**
   * 提取元数据
   * @param {string} content - 文件内容
   * @returns {Promise<Object>}
   */
  async extractMetadata(content) {
    await this.init();
    return this.workerManager.sendTask(this.workerName, 'extract-metadata', {
      content,
    });
  }

  /**
   * 搜索文件内容
   * @param {string} content - 文件内容
   * @param {string} pattern - 搜索模式
   * @param {string} flags - 正则标志
   * @returns {Promise<Object>}
   */
  async searchContent(content, pattern, flags = 'gi') {
    await this.init();
    return this.workerManager.sendTask(this.workerName, 'search', {
      content,
      pattern,
      flags,
    });
  }

  /**
   * 销毁Worker
   */
  destroy() {
    if (this.initialized) {
      this.workerManager.terminateWorker(this.workerName);
      this.initialized = false;
    }
  }
}

/**
 * 语法高亮Worker包装器
 */
export class SyntaxWorkerHelper {
  constructor(workerManager) {
    this.workerManager = workerManager;
    this.workerName = 'syntax-highlighter';
    this.initialized = false;
  }

  /**
   * 初始化Worker
   */
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      await this.workerManager.createWorker(
        this.workerName,
        new URL('../workers/syntax-highlighter.worker.js', import.meta.url)
      );
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize syntax worker:', error);
      throw error;
    }
  }

  /**
   * 语法高亮
   * @param {string} code - 代码内容
   * @param {string} language - 语言类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async highlight(code, language, options = {}) {
    await this.init();
    return this.workerManager.sendTask(this.workerName, 'highlight', {
      code,
      language,
      options,
    });
  }

  /**
   * 生成HTML高亮代码
   * @param {string} code - 代码内容
   * @param {string} language - 语言类型
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async highlightHTML(code, language, options = {}) {
    await this.init();
    return this.workerManager.sendTask(this.workerName, 'highlight-html', {
      code,
      language,
      options,
    });
  }

  /**
   * 提取代码结构
   * @param {string} code - 代码内容
   * @param {string} language - 语言类型
   * @returns {Promise<Object>}
   */
  async extractStructure(code, language) {
    await this.init();
    return this.workerManager.sendTask(this.workerName, 'extract-structure', {
      code,
      language,
    });
  }

  /**
   * 销毁Worker
   */
  destroy() {
    if (this.initialized) {
      this.workerManager.terminateWorker(this.workerName);
      this.initialized = false;
    }
  }
}

// 导出便捷实例
export const fileWorker = new FileWorkerHelper(workerManager);
export const syntaxWorker = new SyntaxWorkerHelper(workerManager);
