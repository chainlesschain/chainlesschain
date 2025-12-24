const { EventEmitter } = require('events');

/**
 * 异步任务队列
 * 用于控制同步任务的并发执行
 */
class SyncQueue extends EventEmitter {
  constructor(maxConcurrency = 3) {
    super();
    this.queue = [];
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
  }

  /**
   * 将任务加入队列
   * @param {Function} task - 异步任务函数
   * @param {number} priority - 优先级（数字越大优先级越高）
   * @returns {Promise} 任务结果
   */
  enqueue(task, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, priority });
      // 按优先级排序（优先级高的先执行）
      this.queue.sort((a, b) => b.priority - a.priority);
      this.process();
    });
  }

  /**
   * 处理队列中的任务
   */
  async process() {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    this.activeCount++;

    try {
      const result = await item.task();
      item.resolve(result);
      this.emit('task:completed', result);
    } catch (error) {
      item.reject(error);
      this.emit('task:error', error);
    } finally {
      this.activeCount--;
      this.process();  // 处理下一个任务
    }
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue = [];
  }

  /**
   * 获取队列长度
   */
  get length() {
    return this.queue.length;
  }

  /**
   * 获取活跃任务数
   */
  get active() {
    return this.activeCount;
  }
}

module.exports = SyncQueue;
