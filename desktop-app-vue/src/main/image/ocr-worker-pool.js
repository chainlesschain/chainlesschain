/**
 * OCR Worker 池管理器
 *
 * 解决单Worker顺序处理瓶颈，提供并发OCR能力
 *
 * v0.18.0: 新建文件
 *
 * 核心功能：
 * - 多Worker并发处理（基于CPU核心数）
 * - 任务队列自动管理
 * - 批量OCR优化
 * - Worker生命周期管理
 */

const { logger, createLogger } = require('../utils/logger.js');
const { EventEmitter } = require('events');
const os = require('os');

class OCRWorkerPool extends EventEmitter {
  constructor(options = {}) {
    super();

    // Worker池配置
    this.maxWorkers = options.maxWorkers || Math.min(os.cpus().length, 4);
    this.language = options.language || 'chi_sim+eng';
    this.workerPath = options.workerPath || null; // Tesseract.js worker路径（可选）

    // Worker管理
    this.workers = [];
    this.busyWorkers = new Set();
    this.queue = [];

    // 统计信息
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      totalTime: 0,
      currentQueueSize: 0,
    };

    // 状态
    this.isInitialized = false;
    this.isShuttingDown = false;

    logger.info(`[OCRWorkerPool] 初始化: maxWorkers=${this.maxWorkers}, language=${this.language}`);
  }

  /**
   * 初始化Worker池
   * @param {string} lang - 语言代码 (默认: 'chi_sim+eng')
   * @returns {Promise<void>}
   */
  async initialize(lang) {
    if (this.isInitialized) {
      logger.warn('[OCRWorkerPool] 已初始化，跳过');
      return;
    }

    if (lang) {
      this.language = lang;
    }

    try {
      // 动态加载Tesseract.js
      const Tesseract = require('tesseract.js');

      logger.info(`[OCRWorkerPool] 并发创建 ${this.maxWorkers} 个Workers...`);
      const startTime = Date.now();

      // 并发创建所有Workers
      const workerPromises = [];
      for (let i = 0; i < this.maxWorkers; i++) {
        const promise = Tesseract.createWorker(this.language, 1, {
          logger: (m) => {
            // 仅记录重要日志（加载进度、初始化）
            if (m.status === 'loading language' || m.status === 'initializing tesseract') {
              this.emit('worker-init-progress', {
                workerId: i,
                status: m.status,
                progress: m.progress,
              });
            }
          },
          ...(this.workerPath && { workerPath: this.workerPath }),
        }).then((worker) => {
          logger.info(`[OCRWorkerPool] Worker ${i} 初始化完成`);
          return worker;
        });

        workerPromises.push(promise);
      }

      this.workers = await Promise.all(workerPromises);

      const duration = Date.now() - startTime;
      logger.info(
        `[OCRWorkerPool] 所有Workers初始化完成: ` +
          `${this.workers.length}个Workers, 耗时: ${duration}ms`
      );

      this.isInitialized = true;
      this.emit('initialized', {
        workerCount: this.workers.length,
        language: this.language,
        duration: duration,
      });
    } catch (error) {
      logger.error('[OCRWorkerPool] 初始化失败:', error);
      throw new Error(`OCR Worker池初始化失败: ${error.message}`);
    }
  }

  /**
   * 识别单张图片
   * @param {string|Buffer} image - 图片路径或Buffer
   * @param {Object} options - 识别选项
   * @returns {Promise<Object>} OCR结果
   */
  async recognize(image, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Worker池未初始化，请先调用initialize()');
    }

    if (this.isShuttingDown) {
      throw new Error('Worker池正在关闭中');
    }

    return new Promise((resolve, reject) => {
      const task = {
        image,
        options,
        resolve,
        reject,
        startTime: Date.now(),
      };

      this.queue.push(task);
      this.stats.currentQueueSize = this.queue.length;

      // 触发队列处理
      this.processQueue();
    });
  }

  /**
   * 批量识别图片
   * @param {Array<string|Buffer>} images - 图片列表
   * @param {Object} options - 识别选项
   * @returns {Promise<Array<Object>>} OCR结果列表
   */
  async recognizeBatch(images, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Worker池未初始化，请先调用initialize()');
    }

    logger.info(`[OCRWorkerPool] 批量识别开始: ${images.length}张图片`);
    const startTime = Date.now();

    try {
      // 并发识别所有图片（自动使用Worker池管理）
      const results = await Promise.all(
        images.map((image, index) =>
          this.recognize(image, options)
            .then((result) => ({
              success: true,
              index,
              ...result,
            }))
            .catch((error) => ({
              success: false,
              index,
              error: error.message,
            }))
        )
      );

      const duration = Date.now() - startTime;
      const successCount = results.filter((r) => r.success).length;

      logger.info(
        `[OCRWorkerPool] 批量识别完成: ` +
          `${successCount}/${images.length}成功, 耗时: ${duration}ms, ` +
          `平均: ${(duration / images.length).toFixed(0)}ms/张`
      );

      this.emit('batch-complete', {
        total: images.length,
        succeeded: successCount,
        failed: images.length - successCount,
        duration: duration,
        avgTimePerImage: duration / images.length,
      });

      return results;
    } catch (error) {
      logger.error('[OCRWorkerPool] 批量识别失败:', error);
      throw error;
    }
  }

  /**
   * 处理任务队列（内部方法）
   */
  async processQueue() {
    // 如果没有空闲Worker或队列为空，直接返回
    if (this.queue.length === 0 || this.busyWorkers.size >= this.workers.length) {
      return;
    }

    // 找到空闲Worker
    let idleWorkerIndex = -1;
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.busyWorkers.has(i)) {
        idleWorkerIndex = i;
        break;
      }
    }

    if (idleWorkerIndex === -1) {
      return; // 无空闲Worker
    }

    // 从队列取出任务
    const task = this.queue.shift();
    this.stats.currentQueueSize = this.queue.length;

    if (!task) {
      return;
    }

    // 标记Worker为忙碌
    this.busyWorkers.add(idleWorkerIndex);
    const worker = this.workers[idleWorkerIndex];

    try {
      // 执行OCR
      const result = await worker.recognize(task.image, task.options);

      // 统计
      const duration = Date.now() - task.startTime;
      this.stats.totalProcessed++;
      this.stats.totalTime += duration;

      this.emit('task-complete', {
        workerId: idleWorkerIndex,
        queueSize: this.queue.length,
        duration: duration,
      });

      // 返回结果
      task.resolve({
        text: result.data.text,
        confidence: result.data.confidence,
        duration: duration,
        workerId: idleWorkerIndex,
      });
    } catch (error) {
      logger.error(`[OCRWorkerPool] Worker ${idleWorkerIndex} 识别失败:`, error);

      this.stats.totalErrors++;

      this.emit('task-error', {
        workerId: idleWorkerIndex,
        error: error.message,
      });

      task.reject(error);
    } finally {
      // 释放Worker
      this.busyWorkers.delete(idleWorkerIndex);

      // 继续处理队列（递归）
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    return {
      ...this.stats,
      totalWorkers: this.workers.length,
      busyWorkers: this.busyWorkers.size,
      idleWorkers: this.workers.length - this.busyWorkers.size,
      avgTimePerImage: this.stats.totalProcessed > 0 ? this.stats.totalTime / this.stats.totalProcessed : 0,
      successRate:
        this.stats.totalProcessed + this.stats.totalErrors > 0
          ? (this.stats.totalProcessed / (this.stats.totalProcessed + this.stats.totalErrors)) * 100
          : 0,
    };
  }

  /**
   * 关闭Worker池
   * @returns {Promise<void>}
   */
  async terminate() {
    if (this.isShuttingDown) {
      logger.warn('[OCRWorkerPool] 已在关闭中');
      return;
    }

    this.isShuttingDown = true;
    logger.info('[OCRWorkerPool] 开始关闭Workers...');

    try {
      // 等待所有任务完成（最多等待5秒）
      const waitStart = Date.now();
      while (this.queue.length > 0 || this.busyWorkers.size > 0) {
        if (Date.now() - waitStart > 5000) {
          logger.warn('[OCRWorkerPool] 等待任务完成超时，强制关闭');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 并发关闭所有Workers
      await Promise.all(
        this.workers.map((worker, i) =>
          worker.terminate().then(() => {
            logger.info(`[OCRWorkerPool] Worker ${i} 已关闭`);
          })
        )
      );

      this.workers = [];
      this.queue = [];
      this.busyWorkers.clear();
      this.isInitialized = false;

      logger.info('[OCRWorkerPool] 所有Workers已关闭');
      this.emit('terminated');
    } catch (error) {
      logger.error('[OCRWorkerPool] 关闭失败:', error);
      throw error;
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      totalTime: 0,
      currentQueueSize: 0,
    };
  }
}

module.exports = OCRWorkerPool;
