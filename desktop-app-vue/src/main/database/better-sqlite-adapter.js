/**
 * Better-SQLite3 适配器
 * 用于开发环境，直接使用 better-sqlite3 而不需要加密
 */

const Database = require('better-sqlite3');
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

    return this.db;
  }

  /**
   * 保存数据库（better-sqlite3自动保存，此方法仅用于兼容性）
   */
  saveDatabase(db) {
    // better-sqlite3 自动保存，不需要手动操作
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
