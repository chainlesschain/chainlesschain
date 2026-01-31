const { logger } = require('../utils/logger.js');

/**
 * 同步锁管理器
 * 防止重复同步和竞态条件
 */
class SyncLockManager {
  constructor() {
    // 项目ID -> 锁信息
    this.locks = new Map();

    // 防抖计时器
    this.debounceTimers = new Map();

    // 默认防抖延迟 (毫秒)
    this.defaultDebounceDelay = 1000;
  }

  /**
   * 尝试获取锁
   * @param {string} projectId - 项目ID
   * @param {string} operation - 操作类型 (sync, sync-one, etc.)
   * @returns {boolean} 是否成功获取锁
   */
  tryAcquire(projectId, operation = 'sync') {
    const lockKey = `${projectId}:${operation}`;

    if (this.locks.has(lockKey)) {
      const lock = this.locks.get(lockKey);
      logger.warn(`[SyncLock] 锁已被占用: ${lockKey}, 开始时间: ${new Date(lock.startTime).toISOString()}`);
      return false;
    }

    // 获取锁
    this.locks.set(lockKey, {
      projectId,
      operation,
      startTime: Date.now(),
      pid: process.pid
    });

    logger.info(`[SyncLock] ✅ 获取锁成功: ${lockKey}`);
    return true;
  }

  /**
   * 释放锁
   * @param {string} projectId - 项目ID
   * @param {string} operation - 操作类型
   */
  release(projectId, operation = 'sync') {
    const lockKey = `${projectId}:${operation}`;

    if (this.locks.has(lockKey)) {
      const lock = this.locks.get(lockKey);
      const duration = Date.now() - lock.startTime;

      this.locks.delete(lockKey);
      logger.info(`[SyncLock] 🔓 释放锁成功: ${lockKey}, 持续时间: ${duration}ms`);
    }
  }

  /**
   * 检查是否持有锁
   * @param {string} projectId - 项目ID
   * @param {string} operation - 操作类型
   * @returns {boolean}
   */
  isLocked(projectId, operation = 'sync') {
    const lockKey = `${projectId}:${operation}`;
    return this.locks.has(lockKey);
  }

  /**
   * 获取锁信息
   * @param {string} projectId - 项目ID
   * @param {string} operation - 操作类型
   * @returns {Object|null}
   */
  getLockInfo(projectId, operation = 'sync') {
    const lockKey = `${projectId}:${operation}`;
    return this.locks.get(lockKey) || null;
  }

  /**
   * 强制释放过期锁（超过指定时间）
   * @param {number} maxAge - 最大锁定时间 (毫秒)，默认 5 分钟
   * @returns {number} 释放的锁数量
   */
  releaseExpiredLocks(maxAge = 5 * 60 * 1000) {
    const now = Date.now();
    let released = 0;

    for (const [lockKey, lock] of this.locks.entries()) {
      if (now - lock.startTime > maxAge) {
        logger.warn(`[SyncLock] ⚠️ 释放过期锁: ${lockKey}, 已持续 ${now - lock.startTime}ms`);
        this.locks.delete(lockKey);
        released++;
      }
    }

    return released;
  }

  /**
   * 防抖执行（避免频繁同步）
   * @param {string} key - 防抖键
   * @param {Function} fn - 要执行的函数
   * @param {number} delay - 延迟时间 (毫秒)
   * @returns {Promise}
   */
  debounce(key, fn, delay = this.defaultDebounceDelay) {
    return new Promise((resolve, reject) => {
      // 清除之前的计时器
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }

      // 设置新的计时器
      const timer = setTimeout(async () => {
        this.debounceTimers.delete(key);

        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);

      this.debounceTimers.set(key, timer);

      logger.info(`[SyncLock] ⏱️ 防抖延迟 ${delay}ms: ${key}`);
    });
  }

  /**
   * 取消防抖
   * @param {string} key - 防抖键
   */
  cancelDebounce(key) {
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
      this.debounceTimers.delete(key);
      logger.info(`[SyncLock] ❌ 取消防抖: ${key}`);
    }
  }

  /**
   * 包装函数，自动管理锁
   * @param {string} projectId - 项目ID
   * @param {string} operation - 操作类型
   * @param {Function} fn - 要执行的函数
   * @param {Object} options - 选项
   * @param {boolean} options.throwOnLocked - 锁被占用时是否抛出错误
   * @param {number} options.debounce - 防抖延迟 (毫秒)
   * @returns {Promise}
   */
  async withLock(projectId, operation, fn, options = {}) {
    const {
      throwOnLocked = true,
      debounce = 0
    } = options;

    // 防抖
    if (debounce > 0) {
      const debounceKey = `${projectId}:${operation}`;
      return this.debounce(debounceKey, async () => {
        return this._executeLocked(projectId, operation, fn, throwOnLocked);
      }, debounce);
    }

    return this._executeLocked(projectId, operation, fn, throwOnLocked);
  }

  /**
   * 执行加锁的函数
   * @private
   */
  async _executeLocked(projectId, operation, fn, throwOnLocked) {
    // 尝试获取锁
    if (!this.tryAcquire(projectId, operation)) {
      if (throwOnLocked) {
        const lockInfo = this.getLockInfo(projectId, operation);
        const duration = Date.now() - lockInfo.startTime;

        throw new Error(
          `项目 ${projectId} 正在${operation}中，请稍后重试 (已运行 ${Math.round(duration / 1000)}秒)`
        );
      }

      // 不抛出错误，返回特殊结果
      return {
        success: false,
        skipped: true,
        reason: 'locked'
      };
    }

    try {
      // 执行函数
      const result = await fn();
      return result;
    } finally {
      // 确保释放锁
      this.release(projectId, operation);
    }
  }

  /**
   * 获取所有锁的状态
   * @returns {Object}
   */
  getStats() {
    return {
      activeLocks: this.locks.size,
      activeDebounces: this.debounceTimers.size,
      locks: Array.from(this.locks.entries()).map(([key, lock]) => ({
        key,
        ...lock,
        duration: Date.now() - lock.startTime
      }))
    };
  }

  /**
   * 清理所有锁和计时器
   */
  cleanup() {
    // 清理所有锁
    this.locks.clear();

    // 清理所有防抖计时器
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    logger.info('[SyncLock] 🧹 清理完成');
  }
}

// 单例模式
let syncLockManagerInstance = null;

function getSyncLockManager() {
  if (!syncLockManagerInstance) {
    syncLockManagerInstance = new SyncLockManager();

    // 定期清理过期锁 (每分钟)
    setInterval(() => {
      const released = syncLockManagerInstance.releaseExpiredLocks();
      if (released > 0) {
        logger.info(`[SyncLock] 🧹 定期清理释放了 ${released} 个过期锁`);
      }
    }, 60 * 1000);
  }

  return syncLockManagerInstance;
}

module.exports = {
  SyncLockManager,
  getSyncLockManager
};
