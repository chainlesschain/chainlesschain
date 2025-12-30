/**
 * 测试工具类
 *
 * 提供通用的测试辅助函数，包括：
 * 1. 断言辅助函数 - 简化常见断言
 * 2. 数据生成器 - 生成测试数据
 * 3. 异步测试辅助 - 处理异步操作
 * 4. Mock辅助 - 简化Mock创建
 * 5. 清理辅助 - 自动资源清理
 */

import { expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 断言辅助函数
 */
export const assertions = {
  /**
   * 断言记录存在于数据库
   */
  async recordExists(db, tableName, conditions) {
    const whereClause = Object.keys(conditions)
      .map(key => `${key} = ?`)
      .join(' AND ');
    const values = Object.values(conditions);

    const stmt = db.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${whereClause}`);
    const result = stmt.get(values);

    expect(result.count).toBeGreaterThan(0);
    return result.count > 0;
  },

  /**
   * 断言文件存在
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      expect.fail(`文件不存在: ${filePath}`);
      return false;
    }
  },

  /**
   * 断言目录存在
   */
  async directoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
      return true;
    } catch (error) {
      expect.fail(`目录不存在: ${dirPath}`);
      return false;
    }
  },

  /**
   * 断言对象结构匹配
   */
  objectMatchesStructure(obj, structure) {
    for (const [key, type] of Object.entries(structure)) {
      expect(obj).toHaveProperty(key);

      if (type === 'string') {
        expect(typeof obj[key]).toBe('string');
      } else if (type === 'number') {
        expect(typeof obj[key]).toBe('number');
      } else if (type === 'boolean') {
        expect(typeof obj[key]).toBe('boolean');
      } else if (type === 'array') {
        expect(Array.isArray(obj[key])).toBe(true);
      } else if (type === 'object') {
        expect(typeof obj[key]).toBe('object');
        expect(obj[key]).not.toBeNull();
      }
    }
  },

  /**
   * 断言数组包含指定属性的对象
   */
  arrayContainsObjectWith(array, properties) {
    const found = array.some(item => {
      return Object.entries(properties).every(([key, value]) => {
        return item[key] === value;
      });
    });

    expect(found).toBe(true);
    return found;
  },

  /**
   * 断言响应时间在指定范围内
   */
  responseTimeWithin(actualMs, expectedMs, tolerance = 0.2) {
    const minMs = expectedMs * (1 - tolerance);
    const maxMs = expectedMs * (1 + tolerance);

    expect(actualMs).toBeGreaterThanOrEqual(minMs);
    expect(actualMs).toBeLessThanOrEqual(maxMs);
  },

  /**
   * 断言错误类型
   */
  errorMatches(error, expectedMessage, expectedType = Error) {
    expect(error).toBeInstanceOf(expectedType);
    if (expectedMessage instanceof RegExp) {
      expect(error.message).toMatch(expectedMessage);
    } else {
      expect(error.message).toContain(expectedMessage);
    }
  }
};

/**
 * 异步测试辅助
 */
export const asyncHelpers = {
  /**
   * 等待指定时间
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 等待条件满足
   */
  async waitFor(condition, options = {}) {
    const { timeout = 5000, interval = 100 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const result = await condition();
        if (result) {
          return result;
        }
      } catch (error) {
        // 忽略条件检查中的错误，继续等待
      }
      await this.wait(interval);
    }

    throw new Error(`等待条件超时 (${timeout}ms)`);
  },

  /**
   * 等待事件触发
   */
  async waitForEvent(emitter, eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`等待事件 ${eventName} 超时`));
      }, timeout);

      emitter.once(eventName, (...args) => {
        clearTimeout(timer);
        resolve(args);
      });
    });
  },

  /**
   * 重试执行直到成功
   */
  async retry(fn, options = {}) {
    const { maxAttempts = 3, delay = 1000 } = options;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await this.wait(delay);
        }
      }
    }

    throw new Error(`重试${maxAttempts}次后失败: ${lastError.message}`);
  },

  /**
   * 并发执行多个异步任务
   */
  async concurrent(tasks, options = {}) {
    const { maxConcurrent = 5 } = options;
    const results = [];
    const queue = [...tasks];

    async function worker() {
      while (queue.length > 0) {
        const task = queue.shift();
        if (task) {
          results.push(await task());
        }
      }
    }

    const workers = Array.from({ length: Math.min(maxConcurrent, tasks.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }
};

/**
 * 文件系统辅助
 */
export const fileHelpers = {
  /**
   * 创建临时目录
   */
  async createTempDir(prefix = 'test-') {
    const tmpDir = path.join(__dirname, '..', '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });

    const tempPath = path.join(tmpDir, `${prefix}${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(tempPath, { recursive: true });

    return tempPath;
  },

  /**
   * 清理临时目录
   */
  async cleanupTempDir(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`清理临时目录失败: ${dirPath}`, error.message);
    }
  },

  /**
   * 复制文件到临时目录
   */
  async copyToTemp(sourcePath, tempDir) {
    const fileName = path.basename(sourcePath);
    const destPath = path.join(tempDir, fileName);
    await fs.copyFile(sourcePath, destPath);
    return destPath;
  },

  /**
   * 创建测试文件
   */
  async createTestFile(dirPath, fileName, content = '') {
    const filePath = path.join(dirPath, fileName);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  },

  /**
   * 读取测试文件
   */
  async readTestFile(filePath) {
    return await fs.readFile(filePath, 'utf-8');
  },

  /**
   * 列出目录下所有文件
   */
  async listFiles(dirPath, options = {}) {
    const { recursive = false, extension = null } = options;
    const files = [];

    async function scan(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && recursive) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          if (!extension || fullPath.endsWith(extension)) {
            files.push(fullPath);
          }
        }
      }
    }

    await scan(dirPath);
    return files;
  }
};

/**
 * Mock辅助
 */
export const mockHelpers = {
  /**
   * 创建Mock函数并记录调用
   */
  createMockWithHistory() {
    const history = [];
    const mock = (...args) => {
      history.push({ args, timestamp: Date.now() });
      return mock._returnValue;
    };

    mock.history = history;
    mock._returnValue = undefined;
    mock.returns = (value) => {
      mock._returnValue = value;
      return mock;
    };
    mock.getCallCount = () => history.length;
    mock.getCall = (index) => history[index];
    mock.getCalls = () => [...history];
    mock.reset = () => {
      history.length = 0;
      mock._returnValue = undefined;
    };

    return mock;
  },

  /**
   * 创建Spy用于监听方法调用
   */
  spy(obj, methodName) {
    const original = obj[methodName];
    const calls = [];

    obj[methodName] = function (...args) {
      calls.push({ args, context: this, timestamp: Date.now() });
      return original.apply(this, args);
    };

    obj[methodName].restore = () => {
      obj[methodName] = original;
    };
    obj[methodName].calls = calls;

    return obj[methodName];
  },

  /**
   * 创建存根（Stub）
   */
  stub(obj, methodName, implementation) {
    const original = obj[methodName];

    obj[methodName] = implementation || function () {
      return undefined;
    };

    obj[methodName].restore = () => {
      obj[methodName] = original;
    };

    return obj[methodName];
  }
};

/**
 * 性能测试辅助
 */
export const performanceHelpers = {
  /**
   * 测量函数执行时间
   */
  async measureTime(fn) {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const durationNs = end - start;
    const durationMs = Number(durationNs) / 1_000_000;

    return {
      result,
      durationMs,
      durationNs
    };
  },

  /**
   * 测量内存使用
   */
  measureMemory(fn) {
    const before = process.memoryUsage();
    const result = fn();
    const after = process.memoryUsage();

    return {
      result,
      heapUsedDelta: after.heapUsed - before.heapUsed,
      externalDelta: after.external - before.external,
      before,
      after
    };
  },

  /**
   * 性能基准测试
   */
  async benchmark(fn, options = {}) {
    const { iterations = 100, warmup = 10 } = options;
    const times = [];

    // 预热
    for (let i = 0; i < warmup; i++) {
      await fn();
    }

    // 实际测试
    for (let i = 0; i < iterations; i++) {
      const { durationMs } = await this.measureTime(fn);
      times.push(durationMs);
    }

    // 计算统计信息
    const sorted = times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);

    return {
      mean: sum / iterations,
      median: sorted[Math.floor(iterations / 2)],
      min: sorted[0],
      max: sorted[iterations - 1],
      p95: sorted[Math.floor(iterations * 0.95)],
      p99: sorted[Math.floor(iterations * 0.99)],
      samples: times
    };
  }
};

/**
 * 随机数据生成
 */
export const randomData = {
  /**
   * 生成随机字符串
   */
  string(length = 10, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  },

  /**
   * 生成随机整数
   */
  integer(min = 0, max = 100) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * 生成随机布尔值
   */
  boolean() {
    return Math.random() < 0.5;
  },

  /**
   * 从数组中随机选择
   */
  choice(array) {
    return array[Math.floor(Math.random() * array.length)];
  },

  /**
   * 生成随机日期
   */
  date(start = new Date(2020, 0, 1), end = new Date()) {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  },

  /**
   * 生成UUID
   */
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  /**
   * 生成随机邮箱
   */
  email() {
    const username = this.string(8).toLowerCase();
    const domains = ['example.com', 'test.com', 'mail.com'];
    return `${username}@${this.choice(domains)}`;
  },

  /**
   * 生成随机URL
   */
  url() {
    const protocols = ['http', 'https'];
    const domains = ['example.com', 'test.com', 'demo.org'];
    return `${this.choice(protocols)}://${this.choice(domains)}/${this.string(10)}`;
  }
};

/**
 * 资源清理管理器
 */
export class CleanupManager {
  constructor() {
    this.cleanups = [];
  }

  /**
   * 注册清理函数
   */
  register(cleanupFn) {
    this.cleanups.push(cleanupFn);
  }

  /**
   * 执行所有清理
   */
  async cleanup() {
    for (const fn of this.cleanups.reverse()) {
      try {
        await fn();
      } catch (error) {
        console.warn('清理失败:', error);
      }
    }
    this.cleanups = [];
  }

  /**
   * 注册临时目录清理
   */
  registerTempDir(dirPath) {
    this.register(() => fileHelpers.cleanupTempDir(dirPath));
  }

  /**
   * 注册文件清理
   */
  registerFile(filePath) {
    this.register(async () => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // 忽略文件不存在的错误
      }
    });
  }
}

/**
 * 导出所有工具
 */
export default {
  assertions,
  asyncHelpers,
  fileHelpers,
  mockHelpers,
  performanceHelpers,
  randomData,
  CleanupManager
};
