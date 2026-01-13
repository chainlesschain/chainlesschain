/**
 * 数据库性能优化模块
 *
 * 功能：
 * - 查询性能监控
 * - 查询缓存
 * - 批量操作优化
 * - 索引建议
 * - 慢查询日志
 * - 数据库统计信息
 */

const { getLogger } = require('./logger');
const logger = getLogger('DatabaseOptimizer');

/**
 * 查询缓存类
 */
class QueryCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 60000; // 默认60秒
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * 生成缓存键
   */
  generateKey(sql, params = []) {
    return `${sql}:${JSON.stringify(params)}`;
  }

  /**
   * 获取缓存
   */
  get(sql, params = []) {
    const key = this.generateKey(sql, params);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data;
  }

  /**
   * 设置缓存
   */
  set(sql, params = [], data) {
    const key = this.generateKey(sql, params);

    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 使缓存失效（支持模式匹配）
   */
  invalidate(pattern) {
    if (!pattern) {
      this.clear();
      return;
    }

    const keys = Array.from(this.cache.keys());
    const regex = new RegExp(pattern);

    keys.forEach(key => {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }
}

/**
 * 数据库性能优化器类
 */
class DatabaseOptimizer {
  constructor(db, options = {}) {
    this.db = db;
    this.options = {
      // 是否启用查询缓存
      enableCache: options.enableCache !== false,

      // 缓存配置
      cacheMaxSize: options.cacheMaxSize || 1000,
      cacheTTL: options.cacheTTL || 60000,

      // 慢查询阈值（毫秒）
      slowQueryThreshold: options.slowQueryThreshold || 100,

      // 是否记录慢查询
      logSlowQueries: options.logSlowQueries !== false,

      // 是否启用批量操作优化
      enableBatchOptimization: options.enableBatchOptimization !== false,

      // 批量操作大小
      batchSize: options.batchSize || 100
    };

    // 查询缓存
    this.queryCache = new QueryCache({
      maxSize: this.options.cacheMaxSize,
      ttl: this.options.cacheTTL
    });

    // 性能统计
    this.stats = {
      totalQueries: 0,
      slowQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalQueryTime: 0,
      avgQueryTime: 0,
      slowQueryLog: []
    };

    // 索引建议
    this.indexSuggestions = [];
  }

  /**
   * 执行查询（带性能监控）
   */
  async query(sql, params = [], options = {}) {
    const startTime = Date.now();
    const useCache = options.cache !== false && this.options.enableCache;

    try {
      // 尝试从缓存获取
      if (useCache && this.isSelectQuery(sql)) {
        const cached = this.queryCache.get(sql, params);
        if (cached !== null) {
          this.stats.cacheHits++;
          logger.debug('Query cache hit', { sql: sql.substring(0, 100) });
          return cached;
        }
        this.stats.cacheMisses++;
      }

      // 执行查询
      let result;
      if (this.isSelectQuery(sql)) {
        result = this.db.all(sql, params);
      } else {
        result = this.db.run(sql, params);
      }

      // 记录性能
      const duration = Date.now() - startTime;
      this.recordQueryPerformance(sql, params, duration);

      // 缓存结果
      if (useCache && this.isSelectQuery(sql)) {
        this.queryCache.set(sql, params, result);
      }

      return result;
    } catch (error) {
      logger.error('Query execution failed', {
        sql: sql.substring(0, 200),
        params,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 判断是否为SELECT查询
   */
  isSelectQuery(sql) {
    return sql.trim().toUpperCase().startsWith('SELECT');
  }

  /**
   * 记录查询性能
   */
  recordQueryPerformance(sql, params, duration) {
    this.stats.totalQueries++;
    this.stats.totalQueryTime += duration;
    this.stats.avgQueryTime = this.stats.totalQueryTime / this.stats.totalQueries;

    // 记录慢查询
    if (duration > this.options.slowQueryThreshold) {
      this.stats.slowQueries++;

      const slowQuery = {
        sql: sql.substring(0, 500),
        params,
        duration,
        timestamp: new Date().toISOString()
      };

      this.stats.slowQueryLog.push(slowQuery);

      // 限制慢查询日志大小
      if (this.stats.slowQueryLog.length > 100) {
        this.stats.slowQueryLog.shift();
      }

      if (this.options.logSlowQueries) {
        logger.warn('Slow query detected', {
          duration: `${duration}ms`,
          sql: sql.substring(0, 200)
        });
      }

      // 生成索引建议
      this.generateIndexSuggestion(sql, duration);
    }
  }

  /**
   * 生成索引建议
   */
  generateIndexSuggestion(sql, duration) {
    // 简单的索引建议逻辑
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*=/i);
    if (whereMatch) {
      const column = whereMatch[1];
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        const suggestion = {
          table,
          column,
          sql: `CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table}(${column});`,
          reason: `Slow query (${duration}ms) with WHERE clause on ${column}`,
          timestamp: new Date().toISOString()
        };

        // 避免重复建议
        const exists = this.indexSuggestions.some(s =>
          s.table === table && s.column === column
        );

        if (!exists) {
          this.indexSuggestions.push(suggestion);
          logger.info('Index suggestion generated', suggestion);
        }
      }
    }
  }

  /**
   * 批量插入优化
   */
  async batchInsert(table, records, options = {}) {
    if (!records || records.length === 0) {
      return { success: true, inserted: 0 };
    }

    const batchSize = options.batchSize || this.options.batchSize;
    const columns = Object.keys(records[0]);
    const placeholders = columns.map(() => '?').join(', ');

    let inserted = 0;
    const startTime = Date.now();

    try {
      // 开始事务
      this.db.run('BEGIN TRANSACTION');

      // 准备语句
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

      // 分批插入
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        for (const record of batch) {
          const values = columns.map(col => record[col]);
          this.db.run(sql, values);
          inserted++;
        }
      }

      // 提交事务
      this.db.run('COMMIT');

      const duration = Date.now() - startTime;
      logger.info('Batch insert completed', {
        table,
        records: inserted,
        duration: `${duration}ms`,
        rate: `${(inserted / duration * 1000).toFixed(0)} records/sec`
      });

      // 使缓存失效
      this.queryCache.invalidate(`SELECT.*FROM ${table}`);

      return {
        success: true,
        inserted,
        duration
      };
    } catch (error) {
      // 回滚事务
      try {
        this.db.run('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed', rollbackError);
      }

      logger.error('Batch insert failed', {
        table,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 批量更新优化
   */
  async batchUpdate(table, updates, idColumn = 'id', options = {}) {
    if (!updates || updates.length === 0) {
      return { success: true, updated: 0 };
    }

    const batchSize = options.batchSize || this.options.batchSize;
    let updated = 0;
    const startTime = Date.now();

    try {
      // 开始事务
      this.db.run('BEGIN TRANSACTION');

      // 分批更新
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);

        for (const record of batch) {
          const { [idColumn]: id, ...fields } = record;
          const columns = Object.keys(fields);
          const setClause = columns.map(col => `${col} = ?`).join(', ');
          const values = [...columns.map(col => fields[col]), id];

          const sql = `UPDATE ${table} SET ${setClause} WHERE ${idColumn} = ?`;
          this.db.run(sql, values);
          updated++;
        }
      }

      // 提交事务
      this.db.run('COMMIT');

      const duration = Date.now() - startTime;
      logger.info('Batch update completed', {
        table,
        records: updated,
        duration: `${duration}ms`
      });

      // 使缓存失效
      this.queryCache.invalidate(`SELECT.*FROM ${table}`);

      return {
        success: true,
        updated,
        duration
      };
    } catch (error) {
      // 回滚事务
      try {
        this.db.run('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed', rollbackError);
      }

      logger.error('Batch update failed', {
        table,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 分析表性能
   */
  analyzeTable(tableName) {
    try {
      // 获取表信息
      const tableInfo = this.db.all(`PRAGMA table_info(${tableName})`);

      // 获取索引信息
      const indexes = this.db.all(`PRAGMA index_list(${tableName})`);

      // 获取表统计
      const count = this.db.get(`SELECT COUNT(*) as count FROM ${tableName}`);

      // 分析索引使用情况
      const indexDetails = indexes.map(index => {
        const columns = this.db.all(`PRAGMA index_info(${index.name})`);
        return {
          name: index.name,
          unique: index.unique === 1,
          columns: columns.map(c => c.name)
        };
      });

      return {
        table: tableName,
        columns: tableInfo.length,
        indexes: indexes.length,
        indexDetails,
        rowCount: count.count,
        suggestions: this.generateTableSuggestions(tableName, tableInfo, indexes)
      };
    } catch (error) {
      logger.error('Table analysis failed', {
        table: tableName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 生成表优化建议
   */
  generateTableSuggestions(tableName, columns, indexes) {
    const suggestions = [];

    // 检查是否有主键
    const hasPrimaryKey = columns.some(col => col.pk === 1);
    if (!hasPrimaryKey) {
      suggestions.push({
        type: 'warning',
        message: `Table ${tableName} has no primary key`
      });
    }

    // 检查索引数量
    if (indexes.length === 0) {
      suggestions.push({
        type: 'info',
        message: `Table ${tableName} has no indexes, consider adding indexes for frequently queried columns`
      });
    }

    return suggestions;
  }

  /**
   * 优化数据库
   */
  async optimize() {
    logger.info('Starting database optimization');

    try {
      // VACUUM - 重建数据库文件，回收空间
      logger.info('Running VACUUM');
      this.db.run('VACUUM');

      // ANALYZE - 更新查询优化器统计信息
      logger.info('Running ANALYZE');
      this.db.run('ANALYZE');

      // 清空查询缓存
      this.queryCache.clear();

      logger.info('Database optimization completed');

      return {
        success: true,
        message: 'Database optimized successfully'
      };
    } catch (error) {
      logger.error('Database optimization failed', error);
      throw error;
    }
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      ...this.stats,
      cache: this.queryCache.getStats(),
      indexSuggestions: this.indexSuggestions
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalQueries: 0,
      slowQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalQueryTime: 0,
      avgQueryTime: 0,
      slowQueryLog: []
    };
    this.indexSuggestions = [];
  }

  /**
   * 获取慢查询日志
   */
  getSlowQueries(limit = 20) {
    return this.stats.slowQueryLog.slice(-limit);
  }

  /**
   * 获取索引建议
   */
  getIndexSuggestions() {
    return this.indexSuggestions;
  }

  /**
   * 应用索引建议
   */
  applyIndexSuggestion(suggestion) {
    try {
      this.db.run(suggestion.sql);
      logger.info('Index created', {
        table: suggestion.table,
        column: suggestion.column
      });

      // 从建议列表中移除
      this.indexSuggestions = this.indexSuggestions.filter(s =>
        !(s.table === suggestion.table && s.column === suggestion.column)
      );

      return { success: true };
    } catch (error) {
      logger.error('Failed to create index', {
        suggestion,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 应用所有索引建议
   */
  applyAllIndexSuggestions() {
    const results = [];

    for (const suggestion of this.indexSuggestions) {
      try {
        this.applyIndexSuggestion(suggestion);
        results.push({
          success: true,
          suggestion
        });
      } catch (error) {
        results.push({
          success: false,
          suggestion,
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = {
  DatabaseOptimizer,
  QueryCache
};
