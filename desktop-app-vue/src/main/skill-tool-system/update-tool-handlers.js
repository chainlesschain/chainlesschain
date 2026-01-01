/**
 * 更新工具的handler_path字段
 * 为29个V3工具设置正确的handler路径
 */

const path = require('path');
const DatabaseManager = require('../database');
const additionalToolsV3 = require('./additional-tools-v3');

async function updateToolHandlers() {
  let db = null;

  try {
    console.log('[Update Tool Handlers] 开始更新工具handler路径...\n');

    // 初始化数据库
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
    console.log(`[Update Tool Handlers] 数据库路径: ${dbPath}`);

    db = new DatabaseManager(dbPath, {
      encryptionEnabled: false,
    });

    await db.initialize();
    console.log('[Update Tool Handlers] 数据库连接成功\n');

    const handlerPath = 'skill-tool-system/additional-tools-v3-handler.js';
    let updated = 0;
    let failed = 0;

    console.log('[Update Tool Handlers] 正在更新工具...\n');

    for (const tool of additionalToolsV3) {
      try {
        // 更新handler_path
        const result = await db.run(
          'UPDATE tools SET handler_path = ?, updated_at = ? WHERE id = ?',
          [handlerPath, Date.now(), tool.id]
        );

        if (result.changes > 0) {
          console.log(`  ✅ 已更新: ${tool.name} (${tool.id})`);
          updated++;
        } else {
          console.log(`  ⚠️  未找到: ${tool.name} (${tool.id})`);
        }

      } catch (error) {
        console.error(`  ❌ 更新失败: ${tool.name}`, error.message);
        failed++;
      }
    }

    // 验证更新结果
    console.log('\n[Update Tool Handlers] 验证更新结果...\n');

    const toolsWithHandler = await db.all(
      'SELECT id, name, handler_path FROM tools WHERE handler_path = ?',
      [handlerPath]
    );

    console.log(`[Update Tool Handlers] 已设置handler_path的工具数量: ${toolsWithHandler.length}`);

    if (toolsWithHandler.length > 0) {
      console.log('\n工具列表:');
      toolsWithHandler.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.handler_path}`);
      });
    }

    console.log('\n========================================');
    console.log('  更新完成汇总');
    console.log('========================================');
    console.log(`更新: ${updated} 个`);
    console.log(`失败: ${failed} 个`);
    console.log(`数据库中V3工具: ${toolsWithHandler.length} 个`);
    console.log('========================================\n');

  } catch (error) {
    console.error('[Update Tool Handlers] 更新失败:', error);
    process.exit(1);
  } finally {
    if (db && db.db) {
      await db.db.close();
      console.log('[Update Tool Handlers] 数据库连接已关闭');
    }
  }
}

// 运行更新
updateToolHandlers();
