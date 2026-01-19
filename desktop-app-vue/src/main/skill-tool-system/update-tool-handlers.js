/**
 * 更新工具的handler_path字段
 * 为29个V3工具设置正确的handler路径
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const DatabaseManager = require('../database');
const additionalToolsV3 = require('./additional-tools-v3');

async function updateToolHandlers() {
  let db = null;

  try {
    logger.info('[Update Tool Handlers] 开始更新工具handler路径...\n');

    // 初始化数据库
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
    logger.info(`[Update Tool Handlers] 数据库路径: ${dbPath}`);

    db = new DatabaseManager(dbPath, {
      encryptionEnabled: false,
    });

    await db.initialize();
    logger.info('[Update Tool Handlers] 数据库连接成功\n');

    const handlerPath = 'skill-tool-system/additional-tools-v3-handler.js';
    let updated = 0;
    let failed = 0;

    logger.info('[Update Tool Handlers] 正在更新工具...\n');

    for (const tool of additionalToolsV3) {
      try {
        // 更新handler_path
        const result = await db.run(
          'UPDATE tools SET handler_path = ?, updated_at = ? WHERE id = ?',
          [handlerPath, Date.now(), tool.id]
        );

        if (result.changes > 0) {
          logger.info(`  ✅ 已更新: ${tool.name} (${tool.id})`);
          updated++;
        } else {
          logger.info(`  ⚠️  未找到: ${tool.name} (${tool.id})`);
        }

      } catch (error) {
        logger.error(`  ❌ 更新失败: ${tool.name}`, error.message);
        failed++;
      }
    }

    // 验证更新结果
    logger.info('\n[Update Tool Handlers] 验证更新结果...\n');

    const toolsWithHandler = await db.all(
      'SELECT id, name, handler_path FROM tools WHERE handler_path = ?',
      [handlerPath]
    );

    logger.info(`[Update Tool Handlers] 已设置handler_path的工具数量: ${toolsWithHandler.length}`);

    if (toolsWithHandler.length > 0) {
      logger.info('\n工具列表:');
      toolsWithHandler.forEach(tool => {
        logger.info(`  - ${tool.name}: ${tool.handler_path}`);
      });
    }

    logger.info('\n========================================');
    logger.info('  更新完成汇总');
    logger.info('========================================');
    logger.info(`更新: ${updated} 个`);
    logger.info(`失败: ${failed} 个`);
    logger.info(`数据库中V3工具: ${toolsWithHandler.length} 个`);
    logger.info('========================================\n');

  } catch (error) {
    logger.error('[Update Tool Handlers] 更新失败:', error);
    process.exit(1);
  } finally {
    if (db && db.db) {
      await db.db.close();
      logger.info('[Update Tool Handlers] 数据库连接已关闭');
    }
  }
}

// 运行更新
updateToolHandlers();
