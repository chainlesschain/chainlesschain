/**
 * 流式输出控制器
 * 提供暂停、恢复、取消等流式输出控制功能
 *
 * @module stream-controller
 * @description 管理流式输出的生命周期，支持AbortController和自定义控制逻辑
 */

const { logger, createLogger } = require('../utils/logger.js');
const { EventEmitter } = require('events');

/**
 * 流式输出状态
 */
const StreamStatus = {
  IDLE: 'idle',         // 空闲
  RUNNING: 'running',   // 运行中
  PAUSED: 'paused',     // 已暂停
  CANCELLED: 'cancelled', // 已取消
  COMPLETED: 'completed', // 已完成
  ERROR: 'error',       // 错误
};

/**
 * 流式输出控制器类
 */
class StreamController extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.status = StreamStatus.IDLE;
    this.abortController = new AbortController();
    this.isPaused = false;
    this.totalChunks = 0;
    this.processedChunks = 0;
    this.buffer = [];
    this.startTime = null;
    this.endTime = null;
    this.pauseResolvers = [];
  }

  /**
   * 获取AbortSignal
   */
  get signal() {
    return this.abortController.signal;
  }

  /**
   * 开始流式输出
   */
  start() {
    if (this.status !== StreamStatus.IDLE) {
      throw new Error(`无法开始：当前状态为 ${this.status}`);
    }

    this.status = StreamStatus.RUNNING;
    this.startTime = Date.now();
    this.emit('start', { timestamp: this.startTime });
  }

  /**
   * 处理chunk
   * @param {Object} chunk - chunk数据
   * @returns {Promise<boolean>} 是否继续处理
   */
  async processChunk(chunk) {
    // 检查是否已取消
    if (this.abortController.signal.aborted) {
      this.status = StreamStatus.CANCELLED;
      return false;
    }

    // 如果暂停，等待恢复
    if (this.isPaused) {
      await this.waitForResume();
    }

    // 再次检查取消状态
    if (this.abortController.signal.aborted) {
      this.status = StreamStatus.CANCELLED;
      return false;
    }

    this.totalChunks++;
    this.processedChunks++;

    // 如果启用缓冲，添加到缓冲区
    if (this.options.enableBuffering) {
      this.buffer.push(chunk);
    }

    this.emit('chunk', {
      chunk,
      index: this.processedChunks,
      total: this.totalChunks,
    });

    return true;
  }

  /**
   * 暂停流式输出
   */
  pause() {
    if (this.status !== StreamStatus.RUNNING) {
      logger.warn(`[StreamController] 无法暂停：当前状态为 ${this.status}`);
      return;
    }

    this.isPaused = true;
    this.status = StreamStatus.PAUSED;
    this.emit('pause', { timestamp: Date.now() });
  }

  /**
   * 恢复流式输出
   */
  resume() {
    if (this.status !== StreamStatus.PAUSED) {
      logger.warn(`[StreamController] 无法恢复：当前状态为 ${this.status}`);
      return;
    }

    this.isPaused = false;
    this.status = StreamStatus.RUNNING;

    // 解析所有等待中的promise
    while (this.pauseResolvers.length > 0) {
      const resolve = this.pauseResolvers.shift();
      resolve();
    }

    this.emit('resume', { timestamp: Date.now() });
  }

  /**
   * 等待恢复
   * @returns {Promise<void>}
   */
  waitForResume() {
    return new Promise((resolve) => {
      if (!this.isPaused) {
        resolve();
        return;
      }

      this.pauseResolvers.push(resolve);
    });
  }

  /**
   * 取消流式输出
   * @param {string} reason - 取消原因
   */
  cancel(reason = '用户取消') {
    if (this.status === StreamStatus.CANCELLED || this.status === StreamStatus.COMPLETED) {
      return;
    }

    this.abortController.abort(reason);
    this.status = StreamStatus.CANCELLED;
    this.endTime = Date.now();

    // 清空暂停等待队列
    while (this.pauseResolvers.length > 0) {
      const resolve = this.pauseResolvers.shift();
      resolve();
    }

    this.emit('cancel', {
      reason,
      timestamp: this.endTime,
      processedChunks: this.processedChunks,
    });
  }

  /**
   * 完成流式输出
   * @param {Object} result - 最终结果
   */
  complete(result = {}) {
    if (this.status === StreamStatus.CANCELLED) {
      return;
    }

    this.status = StreamStatus.COMPLETED;
    this.endTime = Date.now();

    const stats = this.getStats();

    this.emit('complete', {
      result,
      stats,
      timestamp: this.endTime,
    });
  }

  /**
   * 标记错误
   * @param {Error} error - 错误对象
   */
  error(error) {
    this.status = StreamStatus.ERROR;
    this.endTime = Date.now();

    this.emit('error', {
      error,
      timestamp: this.endTime,
      processedChunks: this.processedChunks,
    });
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const duration = this.endTime ? (this.endTime - this.startTime) : (Date.now() - this.startTime);

    return {
      status: this.status,
      totalChunks: this.totalChunks,
      processedChunks: this.processedChunks,
      duration,
      throughput: duration > 0 ? (this.processedChunks / duration) * 1000 : 0, // chunks/秒
      averageChunkTime: this.processedChunks > 0 ? duration / this.processedChunks : 0,
      startTime: this.startTime,
      endTime: this.endTime,
      isPaused: this.isPaused,
    };
  }

  /**
   * 获取缓冲的内容
   * @returns {Array} 缓冲的chunks
   */
  getBuffer() {
    return [...this.buffer];
  }

  /**
   * 清空缓冲
   */
  clearBuffer() {
    this.buffer = [];
  }

  /**
   * 重置控制器
   */
  reset() {
    this.status = StreamStatus.IDLE;
    this.abortController = new AbortController();
    this.isPaused = false;
    this.totalChunks = 0;
    this.processedChunks = 0;
    this.buffer = [];
    this.startTime = null;
    this.endTime = null;
    this.pauseResolvers = [];

    this.emit('reset');
  }

  /**
   * 销毁控制器
   */
  destroy() {
    this.cancel('控制器销毁');
    this.removeAllListeners();
  }
}

/**
 * 创建流式输出控制器
 * @param {Object} options - 配置选项
 * @returns {StreamController} 控制器实例
 */
function createStreamController(options = {}) {
  return new StreamController(options);
}

module.exports = {
  StreamController,
  StreamStatus,
  createStreamController,
};
