const { logger } = require('../utils/logger.js');

/**
 * SQL 安全验证工具
 * 防止 SQL 注入攻击
 */
class SqlSecurity {
  /**
   * 验证排序方向
   * @param {string} order - 排序方向
   * @returns {string} 安全的排序方向
   * @throws {Error} 如果不是有效值
   */
  static validateOrder(order) {
    const validOrders = ['ASC', 'DESC', 'asc', 'desc'];
    const normalized = String(order || '').toUpperCase();

    if (!validOrders.map(v => v.toUpperCase()).includes(normalized)) {
      logger.error('[SqlSecurity] 非法的排序方向:', order);
      throw new Error(`非法的排序方向: ${order}`);
    }

    return normalized;
  }

  /**
   * 验证表名（白名单模式）
   * @param {string} tableName - 表名
   * @param {string[]} allowedTables - 允许的表名列表
   * @returns {string} 安全的表名
   * @throws {Error} 如果表名不在白名单中
   */
  static validateTableName(tableName, allowedTables) {
    if (!tableName || typeof tableName !== 'string') {
      throw new Error('表名无效');
    }

    // 检查是否只包含字母、数字和下划线
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      logger.error('[SqlSecurity] 非法的表名:', tableName);
      throw new Error(`非法的表名: ${tableName}`);
    }

    // 白名单验证
    if (allowedTables && !allowedTables.includes(tableName)) {
      logger.error('[SqlSecurity] 表名不在白名单中:', tableName);
      throw new Error(`不允许访问的表: ${tableName}`);
    }

    return tableName;
  }

  /**
   * 验证列名
   * @param {string} columnName - 列名
   * @param {string[]} allowedColumns - 允许的列名列表（可选）
   * @returns {string} 安全的列名
   * @throws {Error} 如果列名无效
   */
  static validateColumnName(columnName, allowedColumns = null) {
    if (!columnName || typeof columnName !== 'string') {
      throw new Error('列名无效');
    }

    // 检查是否只包含字母、数字和下划线
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
      logger.error('[SqlSecurity] 非法的列名:', columnName);
      throw new Error(`非法的列名: ${columnName}`);
    }

    // 白名单验证（可选）
    if (allowedColumns && !allowedColumns.includes(columnName)) {
      logger.error('[SqlSecurity] 列名不在白名单中:', columnName);
      throw new Error(`不允许的列: ${columnName}`);
    }

    return columnName;
  }

  /**
   * 验证LIMIT值
   * @param {number} limit - LIMIT值
   * @param {number} maxLimit - 最大LIMIT值（默认1000）
   * @returns {number} 安全的LIMIT值
   * @throws {Error} 如果值无效
   */
  static validateLimit(limit, maxLimit = 1000) {
    const num = parseInt(limit, 10);

    if (isNaN(num) || num < 0) {
      throw new Error('LIMIT必须是非负整数');
    }

    if (num > maxLimit) {
      logger.warn('[SqlSecurity] LIMIT超过最大值，已限制:', { limit: num, maxLimit });
      return maxLimit;
    }

    return num;
  }

  /**
   * 验证OFFSET值
   * @param {number} offset - OFFSET值
   * @returns {number} 安全的OFFSET值
   * @throws {Error} 如果值无效
   */
  static validateOffset(offset) {
    const num = parseInt(offset, 10);

    if (isNaN(num) || num < 0) {
      throw new Error('OFFSET必须是非负整数');
    }

    return num;
  }

  /**
   * 检测SQL注入模式
   * @param {string} input - 用户输入
   * @returns {boolean} 是否包含SQL注入模式
   */
  static containsSqlInjectionPattern(input) {
    if (!input || typeof input !== 'string') {
      return false;
    }

    // SQL注入关键字和模式
    const dangerousPatterns = [
      /;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|EXECUTE)\s+/i,
      /UNION\s+SELECT/i,
      /--\s*$/,           // SQL注释
      /\/\*.*\*\//,       // 多行注释
      /'\s*OR\s*'1'\s*=\s*'1/i,
      /'\s*OR\s*1\s*=\s*1/i,
      /\bxp_\w+/i,        // SQL Server扩展存储过程
      /\bsp_\w+/i,        // SQL Server系统存储过程
      /\bEXEC\s*\(/i,
      /\bEXECUTE\s*\(/i,
    ];

    return dangerousPatterns.some(pattern => pattern.test(input));
  }

  /**
   * 清理字符串输入（仅用于日志/显示，不要用于SQL）
   * @param {string} input - 输入字符串
   * @returns {string} 清理后的字符串
   */
  static sanitizeString(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }

    // 移除危险字符
    return input
      .replace(/[^\w\s\-@.]/g, '') // 只保留字母、数字、空格、连字符、@、点
      .substring(0, 1000); // 限制长度
  }

  /**
   * 构建安全的LIKE模式
   * @param {string} searchTerm - 搜索词
   * @returns {string} 安全的LIKE模式
   */
  static buildLikePattern(searchTerm) {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return '%';
    }

    // 转义LIKE特殊字符
    const escaped = searchTerm
      .replace(/\\/g, '\\\\')  // 反斜杠
      .replace(/%/g, '\\%')    // 百分号
      .replace(/_/g, '\\_')    // 下划线
      .substring(0, 100);      // 限制长度

    return `%${escaped}%`;
  }

  /**
   * 验证搜索关键词
   * @param {string} keyword - 搜索关键词
   * @returns {string} 安全的搜索关键词
   */
  static validateSearchKeyword(keyword) {
    if (!keyword || typeof keyword !== 'string') {
      return '';
    }

    // 检查SQL注入模式
    if (this.containsSqlInjectionPattern(keyword)) {
      logger.error('[SqlSecurity] 检测到SQL注入模式:', keyword);
      throw new Error('搜索关键词包含非法字符');
    }

    // 限制长度
    return keyword.substring(0, 200);
  }

  /**
   * 获取允许的表名列表
   * @returns {string[]} 允许的表名
   */
  static getAllowedTables() {
    return [
      // 项目相关
      'projects',
      'project_files',
      'project_tasks',
      'project_conversations',
      'project_templates',

      // 笔记和知识库
      'notes',
      'note_versions',
      'knowledge_base',

      // 对话和消息
      'chat_conversations',
      'messages',
      'conversation_contexts',

      // 社交
      'social_posts',
      'social_comments',
      'social_likes',
      'social_follows',

      // DID和联系人
      'did_identities',
      'contacts',
      'contact_groups',

      // P2P和同步
      'p2p_messages',
      'p2p_peers',
      'sync_queue',

      // LLM和AI
      'llm_providers',
      'llm_performance_logs',
      'llm_sessions',

      // 其他
      'settings',
      'tags',
      'categories',
      'templates',
      'skills',
      'tools',
      'notifications',
    ];
  }

  /**
   * 验证并构建安全的WHERE子句参数
   * @param {Object} filters - 过滤条件
   * @param {string[]} allowedFields - 允许的字段列表
   * @returns {Object} { whereClause, params }
   */
  static buildSafeWhereClause(filters, allowedFields) {
    if (!filters || typeof filters !== 'object') {
      return { whereClause: '', params: [] };
    }

    const conditions = [];
    const params = [];

    for (const [field, value] of Object.entries(filters)) {
      // 验证字段名
      if (!allowedFields.includes(field)) {
        logger.warn('[SqlSecurity] 过滤字段不在白名单:', field);
        continue;
      }

      // 验证列名格式
      try {
        this.validateColumnName(field);
      } catch (error) {
        logger.error('[SqlSecurity] 非法的列名:', field);
        continue;
      }

      // 处理不同类型的值
      if (value === null) {
        conditions.push(`${field} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map(() => '?').join(', ');
        conditions.push(`${field} IN (${placeholders})`);
        params.push(...value);
      } else {
        conditions.push(`${field} = ?`);
        params.push(value);
      }
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    return { whereClause, params };
  }
}

module.exports = SqlSecurity;
