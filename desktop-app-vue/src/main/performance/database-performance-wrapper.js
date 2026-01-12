const { performance } = require('perf_hooks');
const { getPerformanceMonitor } = require('./performance-monitor');

/**
 * 数据库性能包装器
 * 自动跟踪所有数据库查询的性能
 */
class DatabasePerformanceWrapper {
  constructor(database) {
    this.database = database;
    this.performanceMonitor = getPerformanceMonitor();
  }

  /**
   * 包装查询方法
   */
  async query(sql, params = []) {
    const startTime = performance.now();

    try {
      const result = await this.database.query(sql, params);
      const duration = performance.now() - startTime;

      // 记录查询性能
      this.performanceMonitor.recordDatabaseQuery(sql, duration, {
        rowCount: Array.isArray(result) ? result.length : 0
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.performanceMonitor.recordDatabaseQuery(sql, duration, { error: error.message });
      throw error;
    }
  }

  /**
   * 包装执行方法
   */
  async execute(sql, params = []) {
    const startTime = performance.now();

    try {
      const result = await this.database.execute(sql, params);
      const duration = performance.now() - startTime;

      this.performanceMonitor.recordDatabaseQuery(sql, duration, {
        changes: result?.changes || 0
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.performanceMonitor.recordDatabaseQuery(sql, duration, { error: error.message });
      throw error;
    }
  }

  /**
   * 包装run方法
   */
  async run(sql, params = []) {
    const startTime = performance.now();

    try {
      const result = await this.database.run(sql, params);
      const duration = performance.now() - startTime;

      this.performanceMonitor.recordDatabaseQuery(sql, duration);

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.performanceMonitor.recordDatabaseQuery(sql, duration, { error: error.message });
      throw error;
    }
  }

  /**
   * 包装get方法
   */
  async get(sql, params = []) {
    const startTime = performance.now();

    try {
      const result = await this.database.get(sql, params);
      const duration = performance.now() - startTime;

      this.performanceMonitor.recordDatabaseQuery(sql, duration);

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.performanceMonitor.recordDatabaseQuery(sql, duration, { error: error.message });
      throw error;
    }
  }

  /**
   * 包装all方法
   */
  async all(sql, params = []) {
    const startTime = performance.now();

    try {
      const result = await this.database.all(sql, params);
      const duration = performance.now() - startTime;

      this.performanceMonitor.recordDatabaseQuery(sql, duration, {
        rowCount: result?.length || 0
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.performanceMonitor.recordDatabaseQuery(sql, duration, { error: error.message });
      throw error;
    }
  }

  /**
   * 代理其他方法到原始数据库对象
   */
  _proxyMethod(methodName) {
    return (...args) => {
      if (typeof this.database[methodName] === 'function') {
        return this.database[methodName](...args);
      }
      throw new Error(`Method ${methodName} not found on database`);
    };
  }
}

/**
 * 创建数据库性能包装器
 */
function wrapDatabaseWithPerformanceMonitoring(database) {
  const wrapper = new DatabasePerformanceWrapper(database);

  // 代理所有其他方法
  return new Proxy(wrapper, {
    get(target, prop) {
      // 如果包装器有这个方法，使用包装器的
      if (prop in target && typeof target[prop] === 'function') {
        return target[prop].bind(target);
      }

      // 否则代理到原始数据库对象
      if (prop in target.database) {
        const value = target.database[prop];
        if (typeof value === 'function') {
          return value.bind(target.database);
        }
        return value;
      }

      return undefined;
    }
  });
}

module.exports = {
  DatabasePerformanceWrapper,
  wrapDatabaseWithPerformanceMonitoring
};
