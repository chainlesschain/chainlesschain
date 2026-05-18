/**
 * 手动修复数据库同步字段
 * 运行此脚本添加缺失的 sync_status, synced_at, deleted 列
 */

const path = require('path');
const fs = require('fs');

// 检查 sql.js 是否可用
let Database;
try {
  const initSqlJs = require('sql.js');
  console.log('[FixDB] sql.js 已加载');

  (async () => {
    const SQL = await initSqlJs();

    // 数据库文件路径（使用实际的 AppData 路径）
    const appDataPath = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
    const dbPath = path.join(appDataPath, 'chainlesschain-desktop-vue', 'data', 'chainlesschain.db');

    if (!fs.existsSync(dbPath)) {
      console.error('[FixDB] 数据库文件不存在:', dbPath);
      console.log('[FixDB] 提示：数据库文件可能在其他位置，或者应用尚未创建数据库');
      process.exit(1);
    }

    console.log('[FixDB] 正在读取数据库:', dbPath);
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('[FixDB] 数据库已打开，开始添加同步字段...\n');

    // 辅助函数：检查列是否存在
    function hasColumn(tableName, columnName) {
      const result = db.exec(`PRAGMA table_info(${tableName})`);
      if (result.length === 0) return false;

      const columns = result[0].values;
      return columns.some(col => col[1] === columnName);
    }

    // 辅助函数：安全添加列
    function addColumn(tableName, columnName, columnDef) {
      if (hasColumn(tableName, columnName)) {
        console.log(`  ✓ ${tableName}.${columnName} 已存在，跳过`);
        return false;
      }

      try {
        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
        console.log(`  ✅ ${tableName}.${columnName} 添加成功`);
        return true;
      } catch (error) {
        console.error(`  ❌ ${tableName}.${columnName} 添加失败:`, error.message);
        return false;
      }
    }

    let changeCount = 0;

    // 为 project_files 表添加同步字段
    console.log('📦 处理 project_files 表:');
    changeCount += addColumn('project_files', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('project_files', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('project_files', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 为 knowledge_items 表添加同步字段
    console.log('\n📚 处理 knowledge_items 表:');
    changeCount += addColumn('knowledge_items', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('knowledge_items', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('knowledge_items', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 为 projects 表添加同步字段（如果缺失）
    console.log('\n🗂️  处理 projects 表:');
    changeCount += addColumn('projects', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('projects', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('projects', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 为 conversations 表添加同步字段（如果缺失）
    console.log('\n💬 处理 conversations 表:');
    changeCount += addColumn('conversations', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('conversations', 'synced_at', 'INTEGER') ? 1 : 0;

    // 为 messages 表添加同步字段（如果缺失）
    console.log('\n📨 处理 messages 表:');
    changeCount += addColumn('messages', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('messages', 'synced_at', 'INTEGER') ? 1 : 0;

    // 为 project_collaborators 表添加同步字段
    console.log('\n👥 处理 project_collaborators 表:');
    changeCount += addColumn('project_collaborators', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('project_collaborators', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('project_collaborators', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 为 project_comments 表添加同步字段
    console.log('\n💭 处理 project_comments 表:');
    changeCount += addColumn('project_comments', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('project_comments', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('project_comments', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 为 project_tasks 表添加同步字段
    console.log('\n✅ 处理 project_tasks 表:');
    changeCount += addColumn('project_tasks', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('project_tasks', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('project_tasks', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 为 project_conversations 表添加同步字段
    console.log('\n🗣️  处理 project_conversations 表:');
    changeCount += addColumn('project_conversations', 'sync_status', "TEXT DEFAULT 'pending'") ? 1 : 0;
    changeCount += addColumn('project_conversations', 'synced_at', 'INTEGER') ? 1 : 0;
    changeCount += addColumn('project_conversations', 'deleted', 'INTEGER DEFAULT 0') ? 1 : 0;

    // 保存数据库
    if (changeCount > 0) {
      console.log(`\n💾 保存数据库更改 (${changeCount} 个新列)...`);
      const data = db.export();
      const backupPath = dbPath + '.backup-' + Date.now();

      // 备份原数据库
      fs.copyFileSync(dbPath, backupPath);
      console.log('  📋 已备份原数据库到:', backupPath);

      // 写入新数据库
      fs.writeFileSync(dbPath, data);
      console.log('  ✅ 数据库更新完成！');
    } else {
      console.log('\n✨ 所有同步字段已存在，无需修改');
    }

    db.close();
    console.log('\n🎉 数据库修复完成！可以重新启动应用了。\n');

  })().catch(error => {
    console.error('[FixDB] 执行失败:', error);
    process.exit(1);
  });

} catch (error) {
  console.error('[FixDB] 无法加载 sql.js:', error.message);
  console.log('\n请先安装依赖: npm install');
  process.exit(1);
}
