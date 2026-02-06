/**
 * Web Worker Manager
 * 管理Web Workers的生命周期和通信
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * Worker 选项
 */
export interface WorkerOptions {
  type?: 'module' | 'classic';
  credentials?: RequestCredentials;
  name?: string;
}

/**
 * Worker 信息
 */
export interface WorkerInfo {
  name: string;
  instance: Worker;
  path: string | URL;
  ready: boolean;
  tasks: number;
  errors: number;
  createdAt: number;
}

/**
 * 待处理任务
 */
export interface PendingTask<T = any> {
  resolve: (value: TaskResult<T>) => void;
  reject: (reason?: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  workerName: string;
  type: string;
  startTime: number;
}

/**
 * 任务选项
 */
export interface TaskOptions {
  timeout?: number;
}

/**
 * Worker 消息
 */
export interface WorkerMessage<T = any> {
  id: number;
  type: string;
  payload?: T;
  result?: WorkerResult<T>;
}

/**
 * Worker 结果
 */
export interface WorkerResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 任务结果
 */
export interface TaskResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  workerName: string;
}

/**
 * Worker 统计信息
 */
export interface WorkerStats {
  name: string;
  ready: boolean;
  tasks: number;
  errors: number;
  uptime: number;
  pendingTasks: number;
}

/**
 * 全局统计信息
 */
export interface GlobalStats {
  totalWorkers: number;
  totalTasks: number;
  totalErrors: number;
  pendingTasks: number;
  workers: WorkerStats[];
}

/**
 * 文件解析选项
 */
export interface FileParseOptions {
  encoding?: string;
  maxSize?: number;
  [key: string]: any;
}

/**
 * 文件解析结果
 */
export interface FileParseResult {
  success: boolean;
  data?: any;
  metadata?: Record<string, any>;
  error?: string;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  success: boolean;
  matches?: Array<{
    line: number;
    column: number;
    text: string;
    context?: string;
  }>;
  error?: string;
}

/**
 * 语法高亮选项
 */
export interface HighlightOptions {
  theme?: string;
  lineNumbers?: boolean;
  tabSize?: number;
  [key: string]: any;
}

/**
 * 语法高亮结果
 */
export interface HighlightResult {
  success: boolean;
  tokens?: Array<{
    type: string;
    value: string;
    line: number;
    column: number;
  }>;
  html?: string;
  error?: string;
}

/**
 * 代码结构结果
 */
export interface CodeStructureResult {
  success: boolean;
  structure?: {
    functions?: Array<{ name: string; line: number; params: string[] }>;
    classes?: Array<{ name: string; line: number; methods: string[] }>;
    imports?: Array<{ module: string; line: number }>;
    exports?: Array<{ name: string; line: number }>;
  };
  error?: string;
}

// ==================== WorkerManager 类 ====================

/**
 * Web Worker Manager
 * 管理Web Workers的生命周期和通信
 */
export class WorkerManager {
  private workers: Map<string, WorkerInfo>;
  private pendingTasks: Map<number, PendingTask>;
  private taskIdCounter: number;

  constructor() {
    this.workers = new Map();
    this.pendingTasks = new Map();
    this.taskIdCounter = 0;
  }

  /**
   * 创建Worker
   * @param name - Worker名称
   * @param workerPath - Worker文件路径
   * @param options - Worker选项
   * @returns Promise<Worker>
   */
  async createWorker(name: string, workerPath: string | URL, options: WorkerOptions = {}): Promise<Worker> {
    if (this.workers.has(name)) {
      logger.warn(`Worker "${name}" already exists`);
      return this.workers.get(name)!.instance;
    }

    try {
      const worker = new Worker(workerPath, { type: 'module', ...options });

      const workerInfo: WorkerInfo = {
        name,
        instance: worker,
        path: workerPath,
        ready: false,
        tasks: 0,
        errors: 0,
        createdAt: Date.now(),
      };

      // 监听Worker消息
      worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
        this.handleWorkerMessage(name, event);
      });

      // 监听Worker错误
      worker.addEventListener('error', (error: ErrorEvent) => {
        this.handleWorkerError(name, error);
      });

      // 等待Worker就绪
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Worker "${name}" initialization timeout`));
        }, 5000);

        const readyHandler = (event: MessageEvent<WorkerMessage>): void => {
          if (event.data.type === 'ready') {
            clearTimeout(timeout);
            workerInfo.ready = true;
            resolve();
          }
        };

        worker.addEventListener('message', readyHandler, { once: true });
      });

      this.workers.set(name, workerInfo);
      logger.info(`Worker "${name}" created and ready`);

      return worker;
    } catch (error) {
      logger.error(`Failed to create worker "${name}":`, error);
      throw error;
    }
  }

  /**
   * 获取Worker
   * @param name - Worker名称
   * @returns Worker或null
   */
  getWorker(name: string): Worker | null {
    const workerInfo = this.workers.get(name);
    return workerInfo?.instance || null;
  }

  /**
   * 向Worker发送任务
   * @param workerName - Worker名称
   * @param type - 任务类型
   * @param payload - 任务数据
   * @param options - 选项
   * @returns Promise<TaskResult>
   */
  async sendTask<T = any, P = any>(
    workerName: string,
    type: string,
    payload: P,
    options: TaskOptions = {}
  ): Promise<TaskResult<T>> {
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
   */
  private handleWorkerMessage(workerName: string, event: MessageEvent<WorkerMessage>): void {
    const { id, type, result } = event.data;

    // 跳过ready消息
    if (type === 'ready') {
      return;
    }

    const task = this.pendingTasks.get(id);

    if (!task) {
      logger.warn(`Received message for unknown task ${id}`);
      return;
    }

    // 清除超时
    clearTimeout(task.timeoutId);

    // 计算执行时间
    const duration = Date.now() - task.startTime;

    // 移除待处理任务
    this.pendingTasks.delete(id);

    // 解析结果
    if (result?.success) {
      task.resolve({
        ...result,
        duration,
        workerName,
      });
    } else {
      task.reject(new Error(result?.error || 'Worker task failed'));
    }
  }

  /**
   * 处理Worker错误
   */
  private handleWorkerError(workerName: string, error: ErrorEvent): void {
    logger.error(`Worker "${workerName}" error:`, error);

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
   * @param name - Worker名称
   */
  terminateWorker(name: string): void {
    const workerInfo = this.workers.get(name);

    if (!workerInfo) {
      logger.warn(`Worker "${name}" not found`);
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

    logger.info(`Worker "${name}" terminated`);
  }

  /**
   * 终止所有Workers
   */
  terminateAll(): void {
    this.workers.forEach((_, name) => {
      this.terminateWorker(name);
    });
  }

  /**
   * 获取Worker统计信息
   * @param name - Worker名称
   * @returns WorkerStats或null
   */
  getWorkerStats(name: string): WorkerStats | null {
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
   * @returns GlobalStats
   */
  getAllStats(): GlobalStats {
    const stats: GlobalStats = {
      totalWorkers: this.workers.size,
      totalTasks: 0,
      totalErrors: 0,
      pendingTasks: this.pendingTasks.size,
      workers: [],
    };

    this.workers.forEach((workerInfo, name) => {
      stats.totalTasks += workerInfo.tasks;
      stats.totalErrors += workerInfo.errors;
      const workerStats = this.getWorkerStats(name);
      if (workerStats) {
        stats.workers.push(workerStats);
      }
    });

    return stats;
  }
}

// 导出单例实例
export const workerManager = new WorkerManager();

// ==================== FileWorkerHelper 类 ====================

/**
 * 文件处理Worker包装器
 * 提供便捷的文件处理方法
 */
export class FileWorkerHelper {
  private workerManager: WorkerManager;
  private workerName: string;
  private initialized: boolean;

  constructor(manager: WorkerManager) {
    this.workerManager = manager;
    this.workerName = 'file-parser';
    this.initialized = false;
  }

  /**
   * 初始化Worker
   */
  async init(): Promise<void> {
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
      logger.error('Failed to initialize file worker:', error);
      throw error;
    }
  }

  /**
   * 解析文件
   * @param content - 文件内容
   * @param fileType - 文件类型
   * @param options - 选项
   * @returns Promise<TaskResult<FileParseResult>>
   */
  async parseFile(
    content: string,
    fileType: string,
    options: FileParseOptions = {}
  ): Promise<TaskResult<FileParseResult>> {
    await this.init();
    return this.workerManager.sendTask<FileParseResult>(this.workerName, 'parse', {
      content,
      fileType,
      options,
    });
  }

  /**
   * 提取元数据
   * @param content - 文件内容
   * @returns Promise<TaskResult<FileParseResult>>
   */
  async extractMetadata(content: string): Promise<TaskResult<FileParseResult>> {
    await this.init();
    return this.workerManager.sendTask<FileParseResult>(this.workerName, 'extract-metadata', {
      content,
    });
  }

  /**
   * 搜索文件内容
   * @param content - 文件内容
   * @param pattern - 搜索模式
   * @param flags - 正则标志
   * @returns Promise<TaskResult<SearchResult>>
   */
  async searchContent(
    content: string,
    pattern: string,
    flags: string = 'gi'
  ): Promise<TaskResult<SearchResult>> {
    await this.init();
    return this.workerManager.sendTask<SearchResult>(this.workerName, 'search', {
      content,
      pattern,
      flags,
    });
  }

  /**
   * 销毁Worker
   */
  destroy(): void {
    if (this.initialized) {
      this.workerManager.terminateWorker(this.workerName);
      this.initialized = false;
    }
  }
}

// ==================== SyntaxWorkerHelper 类 ====================

/**
 * 语法高亮Worker包装器
 */
export class SyntaxWorkerHelper {
  private workerManager: WorkerManager;
  private workerName: string;
  private initialized: boolean;

  constructor(manager: WorkerManager) {
    this.workerManager = manager;
    this.workerName = 'syntax-highlighter';
    this.initialized = false;
  }

  /**
   * 初始化Worker
   */
  async init(): Promise<void> {
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
      logger.error('Failed to initialize syntax worker:', error);
      throw error;
    }
  }

  /**
   * 语法高亮
   * @param code - 代码内容
   * @param language - 语言类型
   * @param options - 选项
   * @returns Promise<TaskResult<HighlightResult>>
   */
  async highlight(
    code: string,
    language: string,
    options: HighlightOptions = {}
  ): Promise<TaskResult<HighlightResult>> {
    await this.init();
    return this.workerManager.sendTask<HighlightResult>(this.workerName, 'highlight', {
      code,
      language,
      options,
    });
  }

  /**
   * 生成HTML高亮代码
   * @param code - 代码内容
   * @param language - 语言类型
   * @param options - 选项
   * @returns Promise<TaskResult<HighlightResult>>
   */
  async highlightHTML(
    code: string,
    language: string,
    options: HighlightOptions = {}
  ): Promise<TaskResult<HighlightResult>> {
    await this.init();
    return this.workerManager.sendTask<HighlightResult>(this.workerName, 'highlight-html', {
      code,
      language,
      options,
    });
  }

  /**
   * 提取代码结构
   * @param code - 代码内容
   * @param language - 语言类型
   * @returns Promise<TaskResult<CodeStructureResult>>
   */
  async extractStructure(
    code: string,
    language: string
  ): Promise<TaskResult<CodeStructureResult>> {
    await this.init();
    return this.workerManager.sendTask<CodeStructureResult>(this.workerName, 'extract-structure', {
      code,
      language,
    });
  }

  /**
   * 销毁Worker
   */
  destroy(): void {
    if (this.initialized) {
      this.workerManager.terminateWorker(this.workerName);
      this.initialized = false;
    }
  }
}

// 导出便捷实例
export const fileWorker = new FileWorkerHelper(workerManager);
export const syntaxWorker = new SyntaxWorkerHelper(workerManager);
