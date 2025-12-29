/**
 * 数据库迁移工具
 *
 * 负责从 sql.js 迁移到 SQLCipher
 * 支持数据完整性校验和回滚
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { createEncryptedDatabase, createUnencryptedDatabase } = require('./sqlcipher-wrapper');

/**
 * 迁移状态
 */
const MigrationStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back'
};

/**
 * 数据库迁移器类
 */
class DatabaseMigrator {
  constructor(options = {}) {
    this.sourcePath = options.sourcePath;       // sql.js 数据库路径
    this.targetPath = options.targetPath;       // SQLCipher 数据库路径
    this.encryptionKey = options.encryptionKey; // 加密密钥
    this.backupPath = options.backupPath;       // 备份路径
    this.status = MigrationStatus.NOT_STARTED;
    this.SQL = null;
  }

  /**
   * 初始化 sql.js
   */
  async initSqlJs() {
    if (this.SQL) {
      return;
    }

    this.SQL = await initSqlJs({
      locateFile: file => {
        // 在开发环境中查找 WASM 文件
        const possiblePaths = [
          path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
          path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file)
        ];

        for (const filePath of possiblePaths) {
          if (fs.existsSync(filePath)) {
            return filePath;
          }
        }

        return file;
      }
    });
  }

  /**
   * 检查是否需要迁移
   * @returns {boolean}
   */
  needsMigration() {
    // 如果源数据库不存在，不需要迁移
    if (!fs.existsSync(this.sourcePath)) {
      return false;
    }

    // 如果目标数据库已存在，不需要迁移
    if (fs.existsSync(this.targetPath)) {
      return false;
    }

    return true;
  }

  /**
   * 创建备份
   */
  async createBackup() {
    if (!fs.existsSync(this.sourcePath)) {
      throw new Error('源数据库不存在');
    }

    const backupPath = this.backupPath || `${this.sourcePath}.backup.${Date.now()}`;

    try {
      fs.copyFileSync(this.sourcePath, backupPath);
      console.log('[Migration] 备份已创建:', backupPath);
      this.backupPath = backupPath;
      return backupPath;
    } catch (error) {
      throw new Error(`创建备份失败: ${error.message}`);
    }
  }

  /**
   * 获取表结构
   * @param {Object} db - 数据库实例
   * @returns {Array} 表列表
   */
  getTables(db) {
    const stmt = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const tables = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      tables.push({
        name: row.name,
        sql: row.sql
      });
    }
    stmt.free();

    return tables;
  }

  /**
   * 获取索引定义
   * @param {Object} db - 数据库实例
   * @returns {Array} 索引列表
   */
  getIndexes(db) {
    const stmt = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type='index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const indexes = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.sql) { // 跳过自动创建的索引
        indexes.push({
          name: row.name,
          sql: row.sql
        });
      }
    }
    stmt.free();

    return indexes;
  }

  /**
   * 获取表数据
   * @param {Object} db - 数据库实例
   * @param {string} tableName - 表名
   * @returns {Array} 数据行
   */
  getTableData(db, tableName) {
    const stmt = db.prepare(`SELECT * FROM "${tableName}"`);
    const data = [];

    while (stmt.step()) {
      data.push(stmt.getAsObject());
    }
    stmt.free();

    return data;
  }

  /**
   * 执行迁移
   */
  async migrate() {
    console.log('[Migration] 开始数据库迁移...');
    this.status = MigrationStatus.IN_PROGRESS;

    try {
      // 1. 初始化 sql.js
      await this.initSqlJs();

      // 2. 创建备份
      await this.createBackup();

      // 3. 加载源数据库（sql.js）
      console.log('[Migration] 加载源数据库:', this.sourcePath);
      const sourceBuffer = fs.readFileSync(this.sourcePath);
      const sourceDb = new this.SQL.Database(sourceBuffer);

      // 4. 创建目标数据库（SQLCipher）
      console.log('[Migration] 创建目标数据库:', this.targetPath);
      const targetDb = this.encryptionKey
        ? createEncryptedDatabase(this.targetPath, this.encryptionKey)
        : createUnencryptedDatabase(this.targetPath);

      targetDb.open();

      // 5. 迁移表结构
      console.log('[Migration] 迁移表结构...');
      const tables = this.getTables(sourceDb);

      for (const table of tables) {
        console.log(`[Migration] 创建表: ${table.name}`);
        targetDb.exec(table.sql);
      }

      // 6. 迁移数据
      console.log('[Migration] 迁移数据...');
      for (const table of tables) {
        const data = this.getTableData(sourceDb, table.name);

        if (data.length === 0) {
          console.log(`[Migration] 表 ${table.name} 无数据`);
          continue;
        }

        console.log(`[Migration] 迁移表 ${table.name}，共 ${data.length} 行`);

        // 准备插入语句
        const columns = Object.keys(data[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const insertSql = `INSERT INTO "${table.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

        // 批量插入
        const insertStmt = targetDb.prepare(insertSql);
        targetDb.getHandle().transaction(() => {
          for (const row of data) {
            const values = columns.map(col => row[col]);
            insertStmt.run(values);
          }
        })();
        insertStmt.free();
      }

      // 7. 迁移索引
      console.log('[Migration] 迁移索引...');
      const indexes = this.getIndexes(sourceDb);

      for (const index of indexes) {
        console.log(`[Migration] 创建索引: ${index.name}`);
        try {
          targetDb.exec(index.sql);
        } catch (error) {
          console.warn(`[Migration] 索引创建失败: ${index.name}`, error.message);
        }
      }

      // 8. 验证数据完整性
      console.log('[Migration] 验证数据完整性...');
      await this.verifyMigration(sourceDb, targetDb, tables);

      // 9. 清理
      sourceDb.close();
      targetDb.close();

      // 10. 重命名文件
      const oldDbPath = `${this.sourcePath}.old`;
      fs.renameSync(this.sourcePath, oldDbPath);
      console.log('[Migration] 原数据库已重命名为:', oldDbPath);

      this.status = MigrationStatus.COMPLETED;
      console.log('[Migration] 迁移完成！');

      return {
        success: true,
        tablesCount: tables.length,
        backupPath: this.backupPath,
        oldDbPath
      };
    } catch (error) {
      this.status = MigrationStatus.FAILED;
      console.error('[Migration] 迁移失败:', error);

      // 尝试清理失败的目标数据库
      if (fs.existsSync(this.targetPath)) {
        try {
          fs.unlinkSync(this.targetPath);
        } catch (cleanupError) {
          console.error('[Migration] 清理失败的目标数据库时出错:', cleanupError);
        }
      }

      throw new Error(`数据库迁移失败: ${error.message}`);
    }
  }

  /**
   * 验证迁移的数据完整性
   * @param {Object} sourceDb - 源数据库
   * @param {Object} targetDb - 目标数据库
   * @param {Array} tables - 表列表
   */
  async verifyMigration(sourceDb, targetDb, tables) {
    for (const table of tables) {
      // 检查行数
      const sourceCountStmt = sourceDb.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`);
      sourceCountStmt.step();
      const sourceCount = sourceCountStmt.getAsObject().count;
      sourceCountStmt.free();

      const targetCountStmt = targetDb.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`);
      const targetCountResult = targetCountStmt.get();
      const targetCount = targetCountResult ? targetCountResult[0] : 0;
      targetCountStmt.free();

      if (sourceCount !== targetCount) {
        throw new Error(
          `表 ${table.name} 数据行数不匹配: 源=${sourceCount}, 目标=${targetCount}`
        );
      }

      console.log(`[Migration] 验证表 ${table.name}: ${sourceCount} 行 ✓`);
    }
  }

  /**
   * 回滚迁移
   */
  async rollback() {
    console.log('[Migration] 回滚迁移...');

    try {
      // 如果备份存在，恢复备份
      if (this.backupPath && fs.existsSync(this.backupPath)) {
        // 删除目标数据库
        if (fs.existsSync(this.targetPath)) {
          fs.unlinkSync(this.targetPath);
        }

        // 恢复备份
        fs.copyFileSync(this.backupPath, this.sourcePath);
        console.log('[Migration] 已从备份恢复数据库');

        this.status = MigrationStatus.ROLLED_BACK;
        return true;
      } else {
        console.warn('[Migration] 备份文件不存在，无法回滚');
        return false;
      }
    } catch (error) {
      console.error('[Migration] 回滚失败:', error);
      throw new Error(`回滚失败: ${error.message}`);
    }
  }

  /**
   * 删除备份
   */
  deleteBackup() {
    if (this.backupPath && fs.existsSync(this.backupPath)) {
      try {
        fs.unlinkSync(this.backupPath);
        console.log('[Migration] 备份已删除:', this.backupPath);
        return true;
      } catch (error) {
        console.error('[Migration] 删除备份失败:', error);
        return false;
      }
    }
    return false;
  }
}

/**
 * 快速迁移函数
 * @param {Object} options - 迁移选项
 * @returns {Promise<Object>} 迁移结果
 */
async function migrateDatabase(options) {
  const migrator = new DatabaseMigrator(options);

  if (!migrator.needsMigration()) {
    console.log('[Migration] 不需要迁移');
    return { success: true, skipped: true };
  }

  return await migrator.migrate();
}

module.exports = {
  DatabaseMigrator,
  MigrationStatus,
  migrateDatabase
};
