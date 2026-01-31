/**
 * SQL 安全测试
 * 测试 SQL 注入防御
 */

const SqlSecurity = require('../../../src/main/database/sql-security.js');

describe('SqlSecurity - SQL注入防御', () => {
  describe('validateOrder', () => {
    test('应该允许有效的排序方向', () => {
      expect(SqlSecurity.validateOrder('ASC')).toBe('ASC');
      expect(SqlSecurity.validateOrder('DESC')).toBe('DESC');
      expect(SqlSecurity.validateOrder('asc')).toBe('ASC');
      expect(SqlSecurity.validateOrder('desc')).toBe('DESC');
    });

    test('应该拒绝无效的排序方向', () => {
      expect(() => SqlSecurity.validateOrder('INVALID')).toThrow('非法的排序方向');
      expect(() => SqlSecurity.validateOrder('ASC; DROP TABLE users')).toThrow();
      expect(() => SqlSecurity.validateOrder('ASC OR 1=1')).toThrow();
    });

    test('应该处理空值', () => {
      expect(() => SqlSecurity.validateOrder('')).toThrow();
      expect(() => SqlSecurity.validateOrder(null)).toThrow();
      expect(() => SqlSecurity.validateOrder(undefined)).toThrow();
    });
  });

  describe('validateTableName', () => {
    const allowedTables = ['users', 'projects', 'notes'];

    test('应该允许有效的表名', () => {
      expect(SqlSecurity.validateTableName('users', allowedTables)).toBe('users');
      expect(SqlSecurity.validateTableName('projects', allowedTables)).toBe('projects');
      expect(SqlSecurity.validateTableName('notes', allowedTables)).toBe('notes');
    });

    test('应该允许包含下划线的表名', () => {
      const tables = ['project_files', 'user_settings'];
      expect(SqlSecurity.validateTableName('project_files', tables)).toBe('project_files');
    });

    test('应该拒绝不在白名单的表名', () => {
      expect(() => SqlSecurity.validateTableName('malicious', allowedTables)).toThrow('不允许访问的表');
      expect(() => SqlSecurity.validateTableName('admin_table', allowedTables)).toThrow();
    });

    test('应该拒绝包含非法字符的表名', () => {
      expect(() => SqlSecurity.validateTableName('users; DROP TABLE users', allowedTables)).toThrow('非法的表名');
      expect(() => SqlSecurity.validateTableName('users-2', allowedTables)).toThrow('非法的表名');
      expect(() => SqlSecurity.validateTableName('users.admin', allowedTables)).toThrow('非法的表名');
      expect(() => SqlSecurity.validateTableName('users OR 1=1', allowedTables)).toThrow('非法的表名');
    });

    test('应该拒绝空值和无效类型', () => {
      expect(() => SqlSecurity.validateTableName('', allowedTables)).toThrow(); // 空字符串会被正则拒绝
      expect(() => SqlSecurity.validateTableName(null, allowedTables)).toThrow('表名无效');
      expect(() => SqlSecurity.validateTableName(undefined, allowedTables)).toThrow('表名无效');
      expect(() => SqlSecurity.validateTableName(123, allowedTables)).toThrow('表名无效');
    });
  });

  describe('validateColumnName', () => {
    test('应该允许有效的列名', () => {
      expect(SqlSecurity.validateColumnName('id')).toBe('id');
      expect(SqlSecurity.validateColumnName('user_name')).toBe('user_name');
      expect(SqlSecurity.validateColumnName('created_at')).toBe('created_at');
      expect(SqlSecurity.validateColumnName('_private')).toBe('_private');
    });

    test('应该验证列名白名单', () => {
      const allowed = ['id', 'name', 'email'];
      expect(SqlSecurity.validateColumnName('id', allowed)).toBe('id');
      expect(() => SqlSecurity.validateColumnName('password', allowed)).toThrow('不允许的列');
    });

    test('应该拒绝非法列名', () => {
      expect(() => SqlSecurity.validateColumnName('name; DROP TABLE users')).toThrow('非法的列名');
      expect(() => SqlSecurity.validateColumnName('name-2')).toThrow('非法的列名');
      expect(() => SqlSecurity.validateColumnName('name.field')).toThrow('非法的列名');
    });

    test('应该拒绝空值', () => {
      expect(() => SqlSecurity.validateColumnName('')).toThrow(); // 空字符串会被正则拒绝
      expect(() => SqlSecurity.validateColumnName(null)).toThrow('列名无效');
    });
  });

  describe('validateLimit', () => {
    test('应该允许有效的LIMIT值', () => {
      expect(SqlSecurity.validateLimit(10)).toBe(10);
      expect(SqlSecurity.validateLimit(100)).toBe(100);
      expect(SqlSecurity.validateLimit('50')).toBe(50);
      expect(SqlSecurity.validateLimit(0)).toBe(0);
    });

    test('应该限制最大LIMIT值', () => {
      expect(SqlSecurity.validateLimit(2000)).toBe(1000); // 默认最大1000
      expect(SqlSecurity.validateLimit(500, 100)).toBe(100); // 自定义最大100
    });

    test('应该拒绝无效的LIMIT值', () => {
      expect(() => SqlSecurity.validateLimit(-1)).toThrow('LIMIT必须是非负整数');
      expect(() => SqlSecurity.validateLimit('abc')).toThrow('LIMIT必须是非负整数');
      expect(() => SqlSecurity.validateLimit(null)).toThrow('LIMIT必须是非负整数');
    });
  });

  describe('validateOffset', () => {
    test('应该允许有效的OFFSET值', () => {
      expect(SqlSecurity.validateOffset(0)).toBe(0);
      expect(SqlSecurity.validateOffset(10)).toBe(10);
      expect(SqlSecurity.validateOffset('50')).toBe(50);
    });

    test('应该拒绝无效的OFFSET值', () => {
      expect(() => SqlSecurity.validateOffset(-1)).toThrow('OFFSET必须是非负整数');
      expect(() => SqlSecurity.validateOffset('abc')).toThrow('OFFSET必须是非负整数');
    });
  });

  describe('containsSqlInjectionPattern', () => {
    test('应该检测经典SQL注入模式', () => {
      expect(SqlSecurity.containsSqlInjectionPattern("'; DROP TABLE users; --")).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("' OR '1'='1")).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("' OR 1=1 --")).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("admin' --")).toBe(true);
    });

    test('应该检测UNION注入', () => {
      expect(SqlSecurity.containsSqlInjectionPattern("' UNION SELECT * FROM users --")).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("1' UNION SELECT password FROM admin")).toBe(true);
    });

    test('应该检测注释模式', () => {
      expect(SqlSecurity.containsSqlInjectionPattern("value --")).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("value /* comment */")).toBe(true);
    });

    test('应该检测存储过程调用', () => {
      expect(SqlSecurity.containsSqlInjectionPattern("'; EXEC sp_executesql")).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("'; EXECUTE xp_cmdshell")).toBe(true);
    });

    test('应该允许正常的输入', () => {
      expect(SqlSecurity.containsSqlInjectionPattern("John Doe")).toBe(false);
      expect(SqlSecurity.containsSqlInjectionPattern("user@example.com")).toBe(false);
      expect(SqlSecurity.containsSqlInjectionPattern("Project #123")).toBe(false);
    });

    test('应该处理空值', () => {
      expect(SqlSecurity.containsSqlInjectionPattern('')).toBe(false);
      expect(SqlSecurity.containsSqlInjectionPattern(null)).toBe(false);
      expect(SqlSecurity.containsSqlInjectionPattern(undefined)).toBe(false);
    });
  });

  describe('buildLikePattern', () => {
    test('应该转义LIKE特殊字符', () => {
      expect(SqlSecurity.buildLikePattern('%test')).toBe('%\\%test%');
      expect(SqlSecurity.buildLikePattern('_test')).toBe('%\\_test%');
      expect(SqlSecurity.buildLikePattern('\\test')).toBe('%\\\\test%');
    });

    test('应该限制搜索词长度', () => {
      const longTerm = 'a'.repeat(200);
      const result = SqlSecurity.buildLikePattern(longTerm);
      expect(result.length).toBeLessThanOrEqual(102); // %{100 chars}%
    });

    test('应该处理空值', () => {
      expect(SqlSecurity.buildLikePattern('')).toBe('%');
      expect(SqlSecurity.buildLikePattern(null)).toBe('%');
      expect(SqlSecurity.buildLikePattern(undefined)).toBe('%');
    });
  });

  describe('validateSearchKeyword', () => {
    test('应该允许正常的搜索词', () => {
      expect(SqlSecurity.validateSearchKeyword('test')).toBe('test');
      expect(SqlSecurity.validateSearchKeyword('hello world')).toBe('hello world');
      expect(SqlSecurity.validateSearchKeyword('user@example.com')).toBe('user@example.com');
    });

    test('应该拒绝包含SQL注入模式的关键词', () => {
      expect(() => SqlSecurity.validateSearchKeyword("' OR 1=1 --")).toThrow('搜索关键词包含非法字符');
      expect(() => SqlSecurity.validateSearchKeyword("'; DROP TABLE users")).toThrow('搜索关键词包含非法字符');
    });

    test('应该限制关键词长度', () => {
      const longKeyword = 'a'.repeat(300);
      const result = SqlSecurity.validateSearchKeyword(longKeyword);
      expect(result.length).toBe(200);
    });

    test('应该处理空值', () => {
      expect(SqlSecurity.validateSearchKeyword('')).toBe('');
      expect(SqlSecurity.validateSearchKeyword(null)).toBe('');
    });
  });

  describe('buildSafeWhereClause', () => {
    const allowedFields = ['id', 'name', 'email', 'status'];

    test('应该构建安全的WHERE子句', () => {
      const filters = { name: 'John', status: 'active' };
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(filters, allowedFields);

      expect(whereClause).toBe('WHERE name = ? AND status = ?');
      expect(params).toEqual(['John', 'active']);
    });

    test('应该处理NULL值', () => {
      const filters = { name: null };
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(filters, allowedFields);

      expect(whereClause).toBe('WHERE name IS NULL');
      expect(params).toEqual([]);
    });

    test('应该处理数组值(IN查询)', () => {
      const filters = { status: ['active', 'pending'] };
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(filters, allowedFields);

      expect(whereClause).toBe('WHERE status IN (?, ?)');
      expect(params).toEqual(['active', 'pending']);
    });

    test('应该忽略不在白名单的字段', () => {
      const filters = { name: 'John', malicious: 'DROP TABLE' };
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(filters, allowedFields);

      expect(whereClause).toBe('WHERE name = ?');
      expect(params).toEqual(['John']);
    });

    test('应该处理空过滤条件', () => {
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause({}, allowedFields);

      expect(whereClause).toBe('');
      expect(params).toEqual([]);
    });
  });

  describe('getAllowedTables', () => {
    test('应该返回允许的表名列表', () => {
      const tables = SqlSecurity.getAllowedTables();

      expect(Array.isArray(tables)).toBe(true);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables).toContain('projects');
      expect(tables).toContain('notes');
      expect(tables).toContain('messages');
    });

    test('所有表名应该符合命名规范', () => {
      const tables = SqlSecurity.getAllowedTables();

      tables.forEach(table => {
        expect(table).toMatch(/^[a-z_][a-z0-9_]*$/);
      });
    });
  });

  describe('真实SQL注入攻击场景', () => {
    test('应该阻止经典的OR 1=1注入', () => {
      const maliciousInput = "admin' OR '1'='1";

      expect(SqlSecurity.containsSqlInjectionPattern(maliciousInput)).toBe(true);
      expect(() => SqlSecurity.validateSearchKeyword(maliciousInput)).toThrow();
    });

    test('应该阻止UNION SELECT注入', () => {
      const maliciousInput = "' UNION SELECT password FROM users --";

      expect(SqlSecurity.containsSqlInjectionPattern(maliciousInput)).toBe(true);
      expect(() => SqlSecurity.validateSearchKeyword(maliciousInput)).toThrow();
    });

    test('应该阻止DROP TABLE注入', () => {
      const maliciousInput = "'; DROP TABLE users; --";

      expect(SqlSecurity.containsSqlInjectionPattern(maliciousInput)).toBe(true);
      expect(() => SqlSecurity.validateSearchKeyword(maliciousInput)).toThrow();
    });

    test('应该阻止注释绕过', () => {
      const maliciousInput = "admin' --";

      expect(SqlSecurity.containsSqlInjectionPattern(maliciousInput)).toBe(true);
    });

    test('应该阻止批处理注入', () => {
      const maliciousInput = "'; DELETE FROM users WHERE '1'='1";

      expect(SqlSecurity.containsSqlInjectionPattern(maliciousInput)).toBe(true);
      expect(() => SqlSecurity.validateSearchKeyword(maliciousInput)).toThrow();
    });

    test('应该阻止存储过程调用', () => {
      const maliciousInputs = [
        "'; EXEC sp_executesql",
        "'; EXECUTE xp_cmdshell 'dir'",
      ];

      maliciousInputs.forEach(input => {
        expect(SqlSecurity.containsSqlInjectionPattern(input)).toBe(true);
      });
    });
  });

  describe('边界条件测试', () => {
    test('应该处理极长的输入', () => {
      const longInput = 'a'.repeat(10000);

      expect(() => SqlSecurity.validateSearchKeyword(longInput)).not.toThrow();
      const result = SqlSecurity.validateSearchKeyword(longInput);
      expect(result.length).toBeLessThanOrEqual(200);
    });

    test('应该处理特殊Unicode字符', () => {
      const unicodeInput = '中文搜索词';

      expect(SqlSecurity.validateSearchKeyword(unicodeInput)).toBe(unicodeInput);
    });

    test('应该处理混合大小写', () => {
      expect(SqlSecurity.validateOrder('AsC')).toBe('ASC');
      expect(SqlSecurity.validateOrder('DeSc')).toBe('DESC');
    });
  });
});
