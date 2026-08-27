/**
 * 流式输出控制器
 * 提供暂停、恢复、取消等流式输出控制功能
 *
 * @module stream-controller
 * @description 管理流式输出的生命周期，支持AbortController和自定义控制逻辑
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");

const KIB = 1024;
const MIB = KIB * KIB;

const DEFAULT_STREAM_CONTROLLER_LIMITS = Object.freeze({
  maxBufferedChunks: 1000,
  maxBufferedBytes: 4 * MIB,
  maxBufferedChunkBytes: 256 * KIB,
  maxPauseWaiters: 128,
});

const HARD_STREAM_CONTROLLER_LIMITS = Object.freeze({
  maxBufferedChunks: 10_000,
  maxBufferedBytes: 16 * MIB,
  maxBufferedChunkBytes: MIB,
  maxPauseWaiters: 1024,
});

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

function prepareBufferedChunk(chunk, maxBytes) {
  try {
    if (typeof chunk === "string") {
      const bytes = Buffer.byteLength(chunk, "utf8");
      return bytes <= maxBytes ? { value: chunk, bytes } : null;
    }
    const serialized = JSON.stringify(chunk);
    if (typeof serialized !== "string") {
      return null;
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > maxBytes) {
      return null;
    }
    return { value: JSON.parse(serialized), bytes };
  } catch {
    return null;
  }
}

/**
 * 流式输出状态
 */
const StreamStatus = {
  IDLE: "idle", // 空闲
  RUNNING: "running", // 运行中
  PAUSED: "paused", // 已暂停
  CANCELLED: "cancelled", // 已取消
  COMPLETED: "completed", // 已完成
  ERROR: "error", // 错误
};

/**
 * 流式输出控制器类
 */
class StreamController extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    const maxBufferedBytes = normalizeLimit(
      options.maxBufferedBytes,
      DEFAULT_STREAM_CONTROLLER_LIMITS.maxBufferedBytes,
      HARD_STREAM_CONTROLLER_LIMITS.maxBufferedBytes,
    );
    const maxBufferedChunkBytes = Math.min(
      maxBufferedBytes,
      normalizeLimit(
        options.maxBufferedChunkBytes,
        DEFAULT_STREAM_CONTROLLER_LIMITS.maxBufferedChunkBytes,
        HARD_STREAM_CONTROLLER_LIMITS.maxBufferedChunkBytes,
      ),
    );
    this.bufferLimits = Object.freeze({
      maxBufferedChunks: normalizeLimit(
        options.maxBufferedChunks,
        DEFAULT_STREAM_CONTROLLER_LIMITS.maxBufferedChunks,
        HARD_STREAM_CONTROLLER_LIMITS.maxBufferedChunks,
      ),
      maxBufferedBytes,
      maxBufferedChunkBytes,
      maxPauseWaiters: normalizeLimit(
        options.maxPauseWaiters,
        DEFAULT_STREAM_CONTROLLER_LIMITS.maxPauseWaiters,
        HARD_STREAM_CONTROLLER_LIMITS.maxPauseWaiters,
      ),
    });
    this.status = StreamStatus.IDLE;
    this.abortController = new AbortController();
    this.isPaused = false;
    this.totalChunks = 0;
    this.processedChunks = 0;
    this.buffer = [];
    this.bufferEntryBytes = [];
    this.bufferedBytes = 0;
    this.droppedBufferedChunks = 0;
    this.droppedPausedChunks = 0;
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
    this.emit("start", { timestamp: this.startTime });
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
      const resumed = await this.waitForResume();
      if (!resumed) {
        return false;
      }
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
      this.retainBufferedChunk(chunk);
    }

    this.emit("chunk", {
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
    this.emit("pause", { timestamp: Date.now() });
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
    this.releasePauseWaiters(true);

    this.emit("resume", { timestamp: Date.now() });
  }

  /**
   * 等待恢复
   * @returns {Promise<boolean>} Whether processing should resume
   */
  waitForResume() {
    return new Promise((resolve) => {
      if (!this.isPaused) {
        resolve(true);
        return;
      }

      if (this.pauseResolvers.length >= this.bufferLimits.maxPauseWaiters) {
        this.droppedPausedChunks += 1;
        resolve(false);
        return;
      }

      this.pauseResolvers.push(resolve);
    });
  }

  releasePauseWaiters(resumed) {
    while (this.pauseResolvers.length > 0) {
      const resolve = this.pauseResolvers.shift();
      resolve(resumed);
    }
  }

  /**
   * 取消流式输出
   * @param {string} reason - 取消原因
   */
  cancel(reason = "用户取消") {
    if (
      this.status === StreamStatus.CANCELLED ||
      this.status === StreamStatus.COMPLETED
    ) {
      return;
    }

    this.abortController.abort(reason);
    this.status = StreamStatus.CANCELLED;
    this.isPaused = false;
    this.endTime = Date.now();

    // 清空暂停等待队列
    this.releasePauseWaiters(false);

    this.emit("cancel", {
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
    this.isPaused = false;
    this.endTime = Date.now();
    this.releasePauseWaiters(false);

    const stats = this.getStats();

    this.emit("complete", {
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
    this.isPaused = false;
    this.endTime = Date.now();
    this.releasePauseWaiters(false);

    // 使用 stream-error 而非 error，避免 Node.js EventEmitter
    // 在无监听器时抛出 ERR_UNHANDLED_ERROR
    this.emit("stream-error", {
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
    const duration = this.endTime
      ? this.endTime - this.startTime
      : Date.now() - this.startTime;

    return {
      status: this.status,
      totalChunks: this.totalChunks,
      processedChunks: this.processedChunks,
      duration,
      throughput: duration > 0 ? (this.processedChunks / duration) * 1000 : 0, // chunks/秒
      averageChunkTime:
        this.processedChunks > 0 ? duration / this.processedChunks : 0,
      startTime: this.startTime,
      endTime: this.endTime,
      isPaused: this.isPaused,
      bufferedChunks: this.buffer.length,
      bufferedBytes: this.bufferedBytes,
      droppedBufferedChunks: this.droppedBufferedChunks,
      pauseWaiters: this.pauseResolvers.length,
      droppedPausedChunks: this.droppedPausedChunks,
      bufferLimits: this.bufferLimits,
    };
  }

  /**
   * Retain a JSON-safe chunk inside the configured count and byte ring.
   * @param {*} chunk - Stream chunk
   * @returns {boolean} Whether the chunk was retained
   */
  retainBufferedChunk(chunk) {
    const prepared = prepareBufferedChunk(
      chunk,
      this.bufferLimits.maxBufferedChunkBytes,
    );
    if (!prepared) {
      this.droppedBufferedChunks += 1;
      return false;
    }

    while (
      this.buffer.length >= this.bufferLimits.maxBufferedChunks ||
      this.bufferedBytes + prepared.bytes > this.bufferLimits.maxBufferedBytes
    ) {
      if (this.buffer.length === 0) {
        this.droppedBufferedChunks += 1;
        return false;
      }
      this.buffer.shift();
      this.bufferedBytes -= this.bufferEntryBytes.shift();
      this.droppedBufferedChunks += 1;
    }
    this.buffer.push(prepared.value);
    this.bufferEntryBytes.push(prepared.bytes);
    this.bufferedBytes += prepared.bytes;
    return true;
  }

  /**
   * 获取缓冲的内容
   * @returns {Array} 缓冲的chunks
   */
  getBuffer() {
    return JSON.parse(JSON.stringify(this.buffer));
  }

  /**
   * 清空缓冲
   */
  clearBuffer() {
    this.buffer = [];
    this.bufferEntryBytes = [];
    this.bufferedBytes = 0;
  }

  /**
   * 重置控制器
   */
  reset() {
    this.releasePauseWaiters(false);
    this.status = StreamStatus.IDLE;
    this.abortController = new AbortController();
    this.isPaused = false;
    this.totalChunks = 0;
    this.processedChunks = 0;
    this.buffer = [];
    this.bufferEntryBytes = [];
    this.bufferedBytes = 0;
    this.droppedBufferedChunks = 0;
    this.droppedPausedChunks = 0;
    this.startTime = null;
    this.endTime = null;
    this.pauseResolvers = [];

    this.emit("reset");
  }

  /**
   * 销毁控制器
   */
  destroy() {
    this.cancel("控制器销毁");
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
  DEFAULT_STREAM_CONTROLLER_LIMITS,
  HARD_STREAM_CONTROLLER_LIMITS,
  StreamController,
  StreamStatus,
  createStreamController,
};
