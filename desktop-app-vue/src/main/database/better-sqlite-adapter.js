/**
 * Better-SQLite3 适配器
 * 用于开发环境，直接使用 better-sqlite3-multiple-ciphers
 */

// Try to load better-sqlite3-multiple-ciphers first, fallback to better-sqlite3
let Database;
try {
  Database = require('better-sqlite3-multiple-ciphers');
  console.log('[BetterSQLiteAdapter] 使用 better-sqlite3-multiple-ciphers');
} catch (e) {
  try {
    Database = require('better-sqlite3');
    console.log('[BetterSQLiteAdapter] 使用 better-sqlite3');
  } catch (err) {
    throw new Error('Neither better-sqlite3-multiple-ciphers nor better-sqlite3 available: ' + err.message);
  }
}
const fs = require('fs');
const path = require('path');

class BetterSQLiteAdapter {
  constructor(options = {}) {
    this.dbPath = options.dbPath;
    this.db = null;
  }

  /**
   * 创建数据库
   */
  async createDatabase() {
    console.log('[BetterSQLiteAdapter] 使用 better-sqlite3 创建数据库:', this.dbPath);

    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 创建数据库
    this.db = new Database(this.dbPath);

    // 添加兼容性方法
    this.db.saveToFile = () => {
      // better-sqlite3 自动保存，不需要手动操作
      console.log('[BetterSQLiteAdapter] 数据自动保存到文件');
    };

    // 包装 prepare 方法，为 statement 添加兼容性标记
    const originalPrepare = this.db.prepare.bind(this.db);
    this.db.prepare = (sql) => {
      const stmt = originalPrepare(sql);

      // 添加兼容性标记
      if (!stmt.__betterSqliteCompat) {
        stmt.__betterSqliteCompat = true;

        // better-sqlite3 没有 free() 方法，添加空实现
        if (!stmt.free) {
          stmt.free = () => {
            // better-sqlite3 的 statement 会自动释放，无需手动操作
          };
        }
      }

      return stmt;
    };

    // 添加数据库级别的兼容性标记
    this.db.__betterSqliteCompat = true;

    return this.db;
  }

  /**
   * 保存数据库（better-sqlite3自动保存，此方法仅用于兼容性）
   */
  saveDatabase(db) {
    // better-sqlite3 自动保存，不需要手动操作
  }

  /**
   * 获取数据库引擎名称
   */
  getEngine() {
    return 'better-sqlite3';
  }

  /**
   * 关闭数据库
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * 创建 Better-SQLite3 适配器
 */
async function createBetterSQLiteAdapter(options) {
  const adapter = new BetterSQLiteAdapter(options);
  await adapter.createDatabase();
  return adapter;
}

module.exports = {
  BetterSQLiteAdapter,
  createBetterSQLiteAdapter
};
