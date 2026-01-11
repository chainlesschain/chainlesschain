/**
 * 文件处理工具模块 - 大文件性能优化
 * 提供流式处理、分块读写、内存管理等功能
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const os = require('os');

// 配置常量
const CONFIG = {
  // 大文件阈值（10MB）
  LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,
  // 默认chunk大小（1MB）
  DEFAULT_CHUNK_SIZE: 1 * 1024 * 1024,
  // 最大并发数
  MAX_CONCURRENCY: 4,
  // 内存使用阈值（80%）
  MEMORY_THRESHOLD: 0.8,
};

class FileHandler {
  constructor(options = {}) {
    this.options = {
      chunkSize: options.chunkSize || CONFIG.DEFAULT_CHUNK_SIZE,
      maxConcurrency: options.maxConcurrency || CONFIG.MAX_CONCURRENCY,
      memoryThreshold: options.memoryThreshold || CONFIG.MEMORY_THRESHOLD,
    };
  }

  /**
   * 检查是否为大文件
   */
  async isLargeFile(filePath) {
    try {
      const stats = await fsPromises.stat(filePath);
      return stats.size > CONFIG.LARGE_FILE_THRESHOLD;
    } catch (error) {
      console.error('[FileHandler] 检查文件大小失败:', error);
      return false;
    }
  }

  /**
   * 获取文件大小
   */
  async getFileSize(filePath) {
    // Validate file path
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path: path must be a non-empty string');
    }

    // Check if path is absolute and not just '/'
    if (!path.isAbsolute(filePath) || filePath === '/' || filePath === '\\') {
      throw new Error(`Invalid file path: ${filePath}. Path must be absolute and point to a file.`);
    }

    const stats = await fsPromises.stat(filePath);

    // Ensure it's a file, not a directory
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    return stats.size;
  }

  /**
   * 检查可用内存
   */
  checkAvailableMemory() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const usageRatio = 1 - freeMem / totalMem;

    return {
      freeMem,
      totalMem,
      usageRatio,
      isAvailable: usageRatio < this.options.memoryThreshold,
    };
  }

  /**
   * 流式读取文件
   * @param {string} filePath - 文件路径
   * @param {Function} onChunk - 处理每个chunk的回调函数
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 读取结果
   */
  async readFileStream(filePath, onChunk, options = {}) {
    const startTime = Date.now();
    const fileSize = await this.getFileSize(filePath);
    let processedSize = 0;
    let chunkCount = 0;

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath, {
        highWaterMark: options.chunkSize || this.options.chunkSize,
        encoding: options.encoding || null,
      });

      const chunks = [];

      readStream.on('data', async (chunk) => {
        chunkCount++;
        processedSize += chunk.length;

        // 暂停流以处理当前chunk
        readStream.pause();

        try {
          // 调用处理回调
          const result = await onChunk(chunk, {
            chunkIndex: chunkCount - 1,
            chunkSize: chunk.length,
            processedSize,
            totalSize: fileSize,
            progress: (processedSize / fileSize) * 100,
          });

          if (result !== false) {
            chunks.push(result || chunk);
          }

          // 检查内存使用情况
          const memStatus = this.checkAvailableMemory();
          if (!memStatus.isAvailable) {
            console.warn('[FileHandler] 内存使用率过高，暂停处理');
            await this.waitForMemory();
          }

          // 恢复流
          readStream.resume();
        } catch (error) {
          readStream.destroy();
          reject(error);
        }
      });

      readStream.on('end', () => {
        const duration = Date.now() - startTime;
        console.log(
          `[FileHandler] 流式读取完成: ${filePath}, ` +
            `大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB, ` +
            `耗时: ${duration}ms, ` +
            `分片数: ${chunkCount}`
        );

        resolve({
          success: true,
          filePath,
          fileSize,
          chunkCount,
          duration,
          chunks: options.returnChunks ? chunks : null,
        });
      });

      readStream.on('error', (error) => {
        console.error('[FileHandler] 流式读取失败:', error);
        reject(error);
      });
    });
  }

  /**
   * 流式写入文件
   * @param {string} filePath - 文件路径
   * @param {AsyncIterable|Array} dataSource - 数据源（支持异步迭代器或数组）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 写入结果
   */
  async writeFileStream(filePath, dataSource, options = {}) {
    const startTime = Date.now();
    let writtenSize = 0;
    let chunkCount = 0;

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath, {
        flags: options.append ? 'a' : 'w',
        encoding: options.encoding || 'utf8',
      });

      const processData = async () => {
        try {
          // 判断数据源类型
          const isIterable = Symbol.asyncIterator in Object(dataSource) || Symbol.iterator in Object(dataSource);

          if (isIterable) {
            for await (const chunk of dataSource) {
              if (!writeStream.write(chunk)) {
                // 等待drain事件
                await new Promise((resolveDrain) => writeStream.once('drain', resolveDrain));
              }
              writtenSize += Buffer.byteLength(chunk);
              chunkCount++;

              // 检查内存
              const memStatus = this.checkAvailableMemory();
              if (!memStatus.isAvailable) {
                await this.waitForMemory();
              }
            }
          } else {
            // 假设是数组
            for (const chunk of dataSource) {
              if (!writeStream.write(chunk)) {
                await new Promise((resolveDrain) => writeStream.once('drain', resolveDrain));
              }
              writtenSize += Buffer.byteLength(chunk);
              chunkCount++;
            }
          }

          writeStream.end();
        } catch (error) {
          writeStream.destroy();
          reject(error);
        }
      };

      writeStream.on('finish', () => {
        const duration = Date.now() - startTime;
        console.log(
          `[FileHandler] 流式写入完成: ${filePath}, ` +
            `大小: ${(writtenSize / 1024 / 1024).toFixed(2)}MB, ` +
            `耗时: ${duration}ms, ` +
            `分片数: ${chunkCount}`
        );

        resolve({
          success: true,
          filePath,
          writtenSize,
          chunkCount,
          duration,
        });
      });

      writeStream.on('error', (error) => {
        console.error('[FileHandler] 流式写入失败:', error);
        reject(error);
      });

      processData();
    });
  }

  /**
   * 复制大文件（使用流）
   */
  async copyLargeFile(sourcePath, destPath, options = {}) {
    const startTime = Date.now();
    const fileSize = await this.getFileSize(sourcePath);

    try {
      const readStream = fs.createReadStream(sourcePath);
      const writeStream = fs.createWriteStream(destPath);

      // 添加进度监控
      let copiedSize = 0;
      readStream.on('data', (chunk) => {
        copiedSize += chunk.length;
        if (options.onProgress) {
          options.onProgress({
            copiedSize,
            totalSize: fileSize,
            progress: (copiedSize / fileSize) * 100,
          });
        }
      });

      await pipeline(readStream, writeStream);

      const duration = Date.now() - startTime;
      console.log(
        `[FileHandler] 文件复制完成: ${sourcePath} -> ${destPath}, ` +
          `大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB, ` +
          `耗时: ${duration}ms`
      );

      return {
        success: true,
        sourcePath,
        destPath,
        fileSize,
        duration,
      };
    } catch (error) {
      console.error('[FileHandler] 文件复制失败:', error);
      throw error;
    }
  }

  /**
   * 分块处理文件
   * @param {string} filePath - 文件路径
   * @param {Function} processor - 处理函数
   * @param {Object} options - 选项
   */
  async processInChunks(filePath, processor, options = {}) {
    const results = [];
    const isLarge = await this.isLargeFile(filePath);

    if (!isLarge && !options.forceChunking) {
      // 小文件直接读取
      const content = await fsPromises.readFile(filePath, options.encoding || 'utf8');
      const result = await processor(content, { isFullFile: true });
      return {
        success: true,
        results: [result],
        strategy: 'full-read',
      };
    }

    // 大文件使用流式处理
    await this.readFileStream(
      filePath,
      async (chunk, meta) => {
        const result = await processor(chunk, meta);
        results.push(result);
      },
      options
    );

    return {
      success: true,
      results,
      strategy: 'chunked',
    };
  }

  /**
   * 批量处理文件（带并发控制）
   */
  async processBatch(files, processor, options = {}) {
    const concurrency = options.concurrency || this.options.maxConcurrency;
    const results = [];
    const errors = [];

    // 创建并发队列
    const queue = [...files];
    const processing = [];

    while (queue.length > 0 || processing.length > 0) {
      // 填充处理队列
      while (processing.length < concurrency && queue.length > 0) {
        const file = queue.shift();
        const task = this.processWithRetry(file, processor, options).then(
          (result) => {
            results.push(result);
            return result;
          },
          (error) => {
            errors.push({ file, error });
            return null;
          }
        );

        processing.push(task);
      }

      // 等待至少一个完成
      if (processing.length > 0) {
        const completed = await Promise.race(processing);
        const index = processing.findIndex((p) => p === completed);
        processing.splice(index, 1);
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      total: files.length,
      succeeded: results.length,
      failed: errors.length,
    };
  }

  /**
   * 带重试的处理
   */
  async processWithRetry(file, processor, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await processor(file);
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        console.warn(`[FileHandler] 处理失败，重试 ${attempt}/${maxRetries}:`, file, error.message);
        await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  /**
   * 等待内存释放
   */
  async waitForMemory(timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const memStatus = this.checkAvailableMemory();
      if (memStatus.isAvailable) {
        return true;
      }

      // 触发垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }

      // 等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.warn('[FileHandler] 等待内存释放超时');
    return false;
  }

  /**
   * 创建Transform流处理器
   */
  createTransformStream(transformFn) {
    return new Transform({
      async transform(chunk, encoding, callback) {
        try {
          const result = await transformFn(chunk);
          callback(null, result);
        } catch (error) {
          callback(error);
        }
      },
    });
  }

  /**
   * 获取文件处理统计信息
   */
  getStats() {
    const memStatus = this.checkAvailableMemory();

    return {
      memory: {
        free: `${(memStatus.freeMem / 1024 / 1024).toFixed(2)}MB`,
        total: `${(memStatus.totalMem / 1024 / 1024).toFixed(2)}MB`,
        usageRatio: `${(memStatus.usageRatio * 100).toFixed(2)}%`,
        isAvailable: memStatus.isAvailable,
      },
      config: {
        chunkSize: `${(this.options.chunkSize / 1024).toFixed(0)}KB`,
        maxConcurrency: this.options.maxConcurrency,
        memoryThreshold: `${(this.options.memoryThreshold * 100).toFixed(0)}%`,
      },
    };
  }
}

// 单例实例
let fileHandlerInstance = null;

/**
 * 获取FileHandler单例
 */
function getFileHandler(options) {
  if (!fileHandlerInstance) {
    fileHandlerInstance = new FileHandler(options);
  }
  return fileHandlerInstance;
}

module.exports = {
  FileHandler,
  getFileHandler,
  CONFIG,
};
