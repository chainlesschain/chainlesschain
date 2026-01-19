/**
 * 更新工具的JSON Schema
 * 将详细的参数和返回值Schema更新到数据库
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const DatabaseManager = require('../database');
const toolSchemas = require('./tool-schemas');

async function updateToolSchemas() {
  let db = null;

  try {
    logger.info('[Update Schemas] 开始更新工具Schema...\n');

    // 初始化数据库
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
    logger.info(`[Update Schemas] 数据库路径: ${dbPath}`);

    db = new DatabaseManager(dbPath, {
      encryptionEnabled: false,
    });

    await db.initialize();
    logger.info('[Update Schemas] 数据库连接成功\n');

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    logger.info(`[Update Schemas] 待更新工具数量: ${Object.keys(toolSchemas).length}\n`);

    for (const [toolName, schema] of Object.entries(toolSchemas)) {
      try {
        // 检查工具是否存在
        const tool = await db.get('SELECT id, name FROM tools WHERE name = ?', [toolName]);

        if (!tool) {
          logger.info(`  ⚠️  工具不存在，跳过: ${toolName}`);
          skipped++;
          continue;
        }

        // 更新schema
        const parametersSchema = JSON.stringify(schema.parameters || {});
        const returnsSchema = JSON.stringify(schema.returns || {});
        const examples = JSON.stringify(schema.examples || []);

        await db.run(`
          UPDATE tools
          SET parameters_schema = ?,
              return_schema = ?,
              examples = ?,
              description = ?,
              updated_at = ?
          WHERE name = ?
        `, [
          parametersSchema,
          returnsSchema,
          examples,
          schema.description || tool.description,
          Date.now(),
          toolName
        ]);

        logger.info(`  ✅ 已更新: ${toolName}`);
        updated++;

      } catch (error) {
        logger.error(`  ❌ 更新失败: ${toolName}`, error.message);
        failed++;
      }
    }

    logger.info('\n========================================');
    logger.info('  Schema更新完成');
    logger.info('========================================');
    logger.info(`更新: ${updated} 个`);
    logger.info(`跳过: ${skipped} 个`);
    logger.info(`失败: ${failed} 个`);
    logger.info('========================================\n');

    // 验证更新结果
    const toolsWithSchema = await db.all(`
      SELECT name,
             length(parameters_schema) as param_length,
             length(return_schema) as return_length,
             length(examples) as examples_length
      FROM tools
      WHERE handler_path LIKE '%additional-tools-v3-handler%'
      ORDER BY name
    `);

    logger.info('[Update Schemas] Schema验证:\n');
    toolsWithSchema.forEach(tool => {
      const hasParams = tool.param_length > 2;  // Not just "{}"
      const hasReturns = tool.return_length > 2;
      const hasExamples = tool.examples_length > 2;

      const status = hasParams && hasReturns ? '✅' : '⚠️';
      logger.info(`  ${status} ${tool.name}: params=${hasParams}, returns=${hasReturns}, examples=${hasExamples}`);
    });

  } catch (error) {
    logger.error('\n[Update Schemas] 更新失败:', error);
    process.exit(1);
  } finally {
    if (db && db.db) {
      await db.db.close();
      logger.info('\n[Update Schemas] 数据库连接已关闭');
    }
  }
}

// 运行更新
if (require.main === module) {
  updateToolSchemas();
}

module.exports = updateToolSchemas;
