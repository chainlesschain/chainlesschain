/**
 * 可恢复处理器 - 错误恢复与断点续传
 *
 * 核心功能：
 * - 自动检查点保存（每10%进度）
 * - 指数退避重试（最多3次）
 * - 断点续传支持
 * - 错误日志记录
 *
 * v0.18.0: 新建文件，支持多媒体处理的容错性
 */

const { logger, createLogger } = require('./logger.js');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  maxRetries: 3,               // 最大重试次数
  retryDelay: 1000,            // 初始重试延迟（毫秒）
  checkpointInterval: 10,      // 检查点间隔（百分比）
  checkpointDir: null,         // 检查点目录（null = 使用临时目录）
  autoCleanup: true,           // 自动清理检查点
  cleanupDelay: 3600000,       // 清理延迟（1小时）
};

/**
 * 可恢复处理器类
 */
class ResumableProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 设置检查点目录
    this.checkpointDir = this.config.checkpointDir || path.join(
      os.tmpdir(),
      'chainlesschain-checkpoints'
    );

    // 活动任务追踪
    this.activeTasks = new Map();

    logger.info(`[ResumableProcessor] 初始化: checkpointDir=${this.checkpointDir}`);
  }

  /**
   * 初始化（确保检查点目录存在）
   */
  async initialize() {
    try {
      await fs.mkdir(this.checkpointDir, { recursive: true });
      logger.info('[ResumableProcessor] 检查点目录已创建');

      // 启动自动清理
      if (this.config.autoCleanup) {
        this.startAutoCleanup();
      }

      return true;
    } catch (error) {
      logger.error('[ResumableProcessor] 初始化失败:', error);
      return false;
    }
  }

  /**
   * 处理任务（带重试和断点续传）
   * @param {string} taskId - 任务唯一标识
   * @param {Function} processor - 处理函数 (progress, options) => Promise<result>
   * @param {Object} options - 处理选项
   * @returns {Promise<Object>} 处理结果
   */
  async processWithRetry(taskId, processor, options = {}) {
    const {
      resumeFromCheckpoint = true,  // 是否从检查点恢复
      onProgress = null,             // 进度回调
      metadata = {},                 // 任务元数据
    } = options;

    logger.info(`[ResumableProcessor] 开始任务: ${taskId}`);
    this.emit('task-start', { taskId, metadata });

    // 1. 尝试加载检查点
    let checkpoint = null;
    if (resumeFromCheckpoint) {
      checkpoint = await this.loadCheckpoint(taskId);
      if (checkpoint) {
        logger.info(
          `[ResumableProcessor] 从检查点恢复: ${taskId}, ` +
          `进度: ${checkpoint.progress}%`
        );
        this.emit('checkpoint-resume', {
          taskId,
          progress: checkpoint.progress,
          timestamp: checkpoint.timestamp,
        });
      }
    }

    // 初始进度
    let currentProgress = checkpoint ? checkpoint.progress : 0;
    let retries = 0;
    let lastError = null;

    // 2. 重试循环
    while (retries <= this.config.maxRetries) {
      try {
        // 记录活动任务
        this.activeTasks.set(taskId, {
          startTime: Date.now(),
          progress: currentProgress,
          retries: retries,
        });

        // 执行处理器
        const result = await processor(currentProgress, {
          // 进度回调（带检查点保存）
          onProgress: async (newProgress, progressData = {}) => {
            currentProgress = newProgress;

            // 更新活动任务进度
            const task = this.activeTasks.get(taskId);
            if (task) {
              task.progress = newProgress;
            }

            // 定期保存检查点
            if (
              newProgress % this.config.checkpointInterval === 0 ||
              newProgress >= 100
            ) {
              await this.saveCheckpoint(taskId, {
                progress: newProgress,
                timestamp: Date.now(),
                metadata: metadata,
                data: progressData,
              });

              this.emit('checkpoint-saved', {
                taskId,
                progress: newProgress,
              });
            }

            // 触发用户进度回调
            if (onProgress) {
              onProgress(newProgress, progressData);
            }

            // 触发进度事件
            this.emit('task-progress', {
              taskId,
              progress: newProgress,
              ...progressData,
            });
          },

          // 元数据
          metadata: metadata,

          // 检查点数据（如果有）
          checkpointData: checkpoint ? checkpoint.data : null,
        });

        // 3. 任务成功完成
        logger.info(`[ResumableProcessor] 任务完成: ${taskId}`);
        this.emit('task-complete', { taskId, result });

        // 清理检查点和活动任务
        await this.deleteCheckpoint(taskId);
        this.activeTasks.delete(taskId);

        return result;

      } catch (error) {
        lastError = error;
        retries++;

        logger.error(
          `[ResumableProcessor] 任务失败 [${retries}/${this.config.maxRetries}]: ${taskId}`,
          error.message
        );

        this.emit('task-retry', {
          taskId,
          retries: retries,
          maxRetries: this.config.maxRetries,
          error: error.message,
          progress: currentProgress,
        });

        // 如果还有重试次数，等待后重试
        if (retries <= this.config.maxRetries) {
          // 指数退避延迟
          const delay = this.config.retryDelay * Math.pow(2, retries - 1);
          logger.info(`[ResumableProcessor] 等待 ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // 4. 所有重试都失败
    logger.error(`[ResumableProcessor] 任务最终失败: ${taskId}`, lastError);
    this.emit('task-error', {
      taskId,
      error: lastError,
      retries: retries,
      progress: currentProgress,
    });

    // 保存失败检查点（用于调试）
    await this.saveCheckpoint(taskId, {
      progress: currentProgress,
      timestamp: Date.now(),
      error: lastError.message,
      stack: lastError.stack,
      metadata: metadata,
    });

    this.activeTasks.delete(taskId);

    throw new Error(
      `任务失败: ${taskId}, 已重试${retries}次, 错误: ${lastError.message}`
    );
  }

  /**
   * 保存检查点
   * @param {string} taskId - 任务ID
   * @param {Object} checkpointData - 检查点数据
   */
  async saveCheckpoint(taskId, checkpointData) {
    try {
      const checkpointPath = this.getCheckpointPath(taskId);
      const data = {
        taskId: taskId,
        ...checkpointData,
        savedAt: new Date().toISOString(),
      };

      await fs.writeFile(
        checkpointPath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );

      // logger.info(`[ResumableProcessor] 检查点已保存: ${taskId} (${checkpointData.progress}%)`);
      return true;
    } catch (error) {
      logger.error('[ResumableProcessor] 保存检查点失败:', error);
      return false;
    }
  }

  /**
   * 加载检查点
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object|null>} 检查点数据
   */
  async loadCheckpoint(taskId) {
    try {
      const checkpointPath = this.getCheckpointPath(taskId);

      // 检查文件是否存在
      try {
        await fs.access(checkpointPath);
      } catch {
        return null; // 文件不存在
      }

      const content = await fs.readFile(checkpointPath, 'utf-8');
      const data = JSON.parse(content);

      return data;
    } catch (error) {
      logger.error('[ResumableProcessor] 加载检查点失败:', error);
      return null;
    }
  }

  /**
   * 删除检查点
   * @param {string} taskId - 任务ID
   */
  async deleteCheckpoint(taskId) {
    try {
      const checkpointPath = this.getCheckpointPath(taskId);
      await fs.unlink(checkpointPath);
      // logger.info(`[ResumableProcessor] 检查点已删除: ${taskId}`);
      return true;
    } catch (error) {
      // 忽略文件不存在错误
      if (error.code !== 'ENOENT') {
        logger.error('[ResumableProcessor] 删除检查点失败:', error);
      }
      return false;
    }
  }

  /**
   * 获取检查点文件路径
   * @param {string} taskId - 任务ID
   * @returns {string} 文件路径
   */
  getCheckpointPath(taskId) {
    // 将 taskId 转换为安全的文件名（移除特殊字符）
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.checkpointDir, `${safeTaskId}.checkpoint.json`);
  }

  /**
   * 获取所有检查点
   * @returns {Promise<Array>} 检查点列表
   */
  async getAllCheckpoints() {
    try {
      const files = await fs.readdir(this.checkpointDir);
      const checkpoints = [];

      for (const file of files) {
        if (file.endsWith('.checkpoint.json')) {
          const filePath = path.join(this.checkpointDir, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            checkpoints.push({
              ...data,
              filePath: filePath,
            });
          } catch (error) {
            logger.warn(`[ResumableProcessor] 无法解析检查点: ${file}`, error);
          }
        }
      }

      return checkpoints;
    } catch (error) {
      logger.error('[ResumableProcessor] 获取检查点列表失败:', error);
      return [];
    }
  }

  /**
   * 清理过期检查点
   * @param {number} maxAge - 最大年龄（毫秒）
   * @returns {Promise<number>} 清理的数量
   */
  async cleanupOldCheckpoints(maxAge = this.config.cleanupDelay) {
    try {
      const checkpoints = await this.getAllCheckpoints();
      const now = Date.now();
      let cleaned = 0;

      for (const checkpoint of checkpoints) {
        const age = now - new Date(checkpoint.savedAt).getTime();

        if (age > maxAge) {
          try {
            await fs.unlink(checkpoint.filePath);
            cleaned++;
            logger.info(
              `[ResumableProcessor] 清理过期检查点: ${checkpoint.taskId} ` +
              `(${(age / 3600000).toFixed(1)}小时前)`
            );
          } catch (error) {
            logger.warn('[ResumableProcessor] 清理检查点失败:', error);
          }
        }
      }

      if (cleaned > 0) {
        logger.info(`[ResumableProcessor] 已清理 ${cleaned} 个过期检查点`);
      }

      return cleaned;
    } catch (error) {
      logger.error('[ResumableProcessor] 清理检查点失败:', error);
      return 0;
    }
  }

  /**
   * 启动自动清理定时器
   */
  startAutoCleanup() {
    // 每小时清理一次
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupOldCheckpoints();
    }, 3600000);

    logger.info('[ResumableProcessor] 自动清理定时器已启动（每小时）');
  }

  /**
   * 停止自动清理定时器
   */
  stopAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('[ResumableProcessor] 自动清理定时器已停止');
    }
  }

  /**
   * 获取活动任务列表
   * @returns {Array} 活动任务信息
   */
  getActiveTasks() {
    const tasks = [];
    for (const [taskId, taskInfo] of this.activeTasks.entries()) {
      tasks.push({
        taskId: taskId,
        ...taskInfo,
        duration: Date.now() - taskInfo.startTime,
      });
    }
    return tasks;
  }

  /**
   * 终止处理器
   */
  async terminate() {
    logger.info('[ResumableProcessor] 终止处理器...');

    // 停止自动清理
    this.stopAutoCleanup();

    // 保存所有活动任务的检查点
    for (const [taskId, taskInfo] of this.activeTasks.entries()) {
      await this.saveCheckpoint(taskId, {
        progress: taskInfo.progress,
        timestamp: Date.now(),
        interrupted: true,
      });
    }

    this.activeTasks.clear();

    logger.info('[ResumableProcessor] 处理器已终止');
  }
}

module.exports = ResumableProcessor;
