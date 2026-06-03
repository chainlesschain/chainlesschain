/**
 * database-soft-delete — extracted from database.js as part of H3 split (v0.45.33).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

const SqlSecurity = require("./sql-security");

function softDelete(dbManager, logger, tableName, id) {
  try {
    // ✅ 安全验证：防止SQL注入
    const safeTableName = SqlSecurity.validateTableName(
      tableName,
      SqlSecurity.getAllowedTables(),
    );

    const stmt = dbManager.db.prepare(
      `UPDATE ${safeTableName}
       SET deleted = 1,
           updated_at = ?,
           sync_status = 'pending'
       WHERE id = ?`,
    );

    stmt.run(Date.now(), id);
    stmt.free();

    dbManager.saveToFile();
    logger.info(`[Database] 软删除记录: table=${tableName}, id=${id}`);
    return true;
  } catch (error) {
    logger.error(`[Database] 软删除失败: table=${tableName}, id=${id}`, error);
    return false;
  }
}

function batchSoftDelete(dbManager, logger, tableName, ids) {
  let success = 0;
  let failed = 0;

  for (const id of ids) {
    if (dbManager.softDelete(tableName, id)) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed };
}

function restoreSoftDeleted(dbManager, logger, tableName, id) {
  try {
    // ✅ 安全验证：防止SQL注入
    const safeTableName = SqlSecurity.validateTableName(
      tableName,
      SqlSecurity.getAllowedTables(),
    );

    const stmt = dbManager.db.prepare(
      `UPDATE ${safeTableName}
       SET deleted = 0,
           updated_at = ?,
           sync_status = 'pending'
       WHERE id = ?`,
    );

    stmt.run(Date.now(), id);
    stmt.free();

    dbManager.saveToFile();
    logger.info(`[Database] 恢复软删除记录: table=${tableName}, id=${id}`);
    return true;
  } catch (error) {
    logger.error(`[Database] 恢复失败: table=${tableName}, id=${id}`, error);
    return false;
  }
}

function cleanupSoftDeleted(dbManager, logger, tableName, olderThanDays = 30) {
  const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  try {
    // ✅ 安全验证：防止SQL注入
    const safeTableName = SqlSecurity.validateTableName(
      tableName,
      SqlSecurity.getAllowedTables(),
    );

    const stmt = dbManager.db.prepare(
      `DELETE FROM ${safeTableName}
       WHERE deleted = 1
         AND updated_at < ?`,
    );

    const info = stmt.run(cutoffTime);
    stmt.free();

    const deletedCount = info.changes || 0;

    if (deletedCount > 0) {
      dbManager.saveToFile();
      logger.info(`[Database] 清理${tableName}表: ${deletedCount}条记录`);
    }

    return { deleted: deletedCount, tableName };
  } catch (error) {
    logger.error(`[Database] 清理失败: table=${tableName}`, error);
    return { deleted: 0, tableName, error: error.message };
  }
}

function cleanupAllSoftDeleted(dbManager, logger, olderThanDays = 30) {
  const syncTables = [
    "projects",
    "project_files",
    "knowledge_items",
    "project_collaborators",
    "project_comments",
    "project_tasks",
  ];

  const results = [];
  let totalDeleted = 0;

  for (const tableName of syncTables) {
    const result = dbManager.cleanupSoftDeleted(tableName, olderThanDays);
    results.push(result);
    totalDeleted += result.deleted;
  }

  logger.info(`[Database] 总共清理 ${totalDeleted} 条软删除记录`);

  return results;
}

function getSoftDeletedStats(dbManager, logger) {
  const syncTables = [
    "projects",
    "project_files",
    "knowledge_items",
    "project_collaborators",
    "project_comments",
    "project_tasks",
  ];

  const stats = {
    total: 0,
    byTable: {},
  };

  for (const tableName of syncTables) {
    try {
      // ✅ 安全验证：即使是内部表名也验证
      const safeTableName = SqlSecurity.validateTableName(
        tableName,
        SqlSecurity.getAllowedTables(),
      );

      const stmt = dbManager.db.prepare(
        `SELECT COUNT(*) as count FROM ${safeTableName} WHERE deleted = 1`,
      );

      stmt.step();
      const count = stmt.getAsObject().count || 0;
      stmt.free();

      stats.byTable[tableName] = count;
      stats.total += count;
    } catch (error) {
      logger.error(`[Database] 统计失败: table=${tableName}`, error);
      stats.byTable[tableName] = 0;
    }
  }

  return stats;
}

function startPeriodicCleanup(
  dbManager,
  logger,
  intervalHours = 24,
  retentionDays = 30,
) {
  logger.info(
    `[Database] 启动定期清理: 每${intervalHours}小时清理${retentionDays}天前的软删除记录`,
  );

  // 立即执行一次
  dbManager.cleanupAllSoftDeleted(retentionDays);

  // 定期执行
  const timer = setInterval(
    () => {
      logger.info("[Database] 执行定期清理任务...");
      dbManager.cleanupAllSoftDeleted(retentionDays);
    },
    intervalHours * 60 * 60 * 1000,
  );

  return timer;
}

module.exports = {
  softDelete,
  batchSoftDelete,
  restoreSoftDeleted,
  cleanupSoftDeleted,
  cleanupAllSoftDeleted,
  getSoftDeletedStats,
  startPeriodicCleanup,
};
