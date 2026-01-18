/**
 * 测试数据库数据完整性
 * 使用应用的 DatabaseManager 来访问加密数据库
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Mock app for testing
if (!app || !app.getPath) {
  global.app = {
    isPackaged: false,
    getPath: (name) => {
      if (name === 'userData') {
        return path.join(__dirname, '..', '..');
      }
      return require('os').tmpdir();
    }
  };
}

const DatabaseManager = require('./database');

async function checkDatabase() {
  console.log('=== 数据库数据完整性检查 ===\n');

  const dbPath = path.join(__dirname, '..', '..', 'data', 'chainlesschain.db');
  console.log('数据库路径:', dbPath);
  console.log('文件是否存在:', fs.existsSync(dbPath));

  if (!fs.existsSync(dbPath)) {
    console.log('\n❌ 数据库文件不存在！');
    return;
  }

  const stats = fs.statSync(dbPath);
  console.log('文件大小:', (stats.size / 1024).toFixed(2), 'KB');
  console.log('最后修改时间:', stats.mtime);

  try {
    // 使用默认密码
    const DEFAULT_PASSWORD = '123456';
    const dbManager = new DatabaseManager(dbPath, {
      password: DEFAULT_PASSWORD,
      encryptionEnabled: true
    });

    console.log('\n正在初始化数据库...');
    await dbManager.initialize();
    console.log('✅ 数据库初始化成功\n');

    // 检查项目数据
    console.log('--- 检查项目数据 ---');
    try {
      const projects = await dbManager.query('SELECT * FROM projects LIMIT 5');
      console.log(`项目数量（前5条）: ${projects.length}`);
      if (projects.length > 0) {
        projects.forEach(p => {
          console.log(`  - ${p.name || p.title || 'Untitled'} (ID: ${p.id})`);
        });
      } else {
        console.log('  ⚠️ 没有找到项目数据');
      }
    } catch (err) {
      console.log('  ⚠️ 项目表可能不存在:', err.message);
    }

    // 检查笔记数据
    console.log('\n--- 检查笔记数据 ---');
    try {
      const notes = await dbManager.query('SELECT * FROM notes LIMIT 5');
      console.log(`笔记数量（前5条）: ${notes.length}`);
      if (notes.length > 0) {
        notes.forEach(n => {
          console.log(`  - ${n.title || 'Untitled'} (ID: ${n.id})`);
        });
      } else {
        console.log('  ⚠️ 没有找到笔记数据');
      }
    } catch (err) {
      console.log('  ⚠️ 笔记表可能不存在:', err.message);
    }

    // 检查技能数据
    console.log('\n--- 检查技能数据 ---');
    try {
      const skills = await dbManager.query('SELECT * FROM skills LIMIT 5');
      console.log(`技能数量（前5条）: ${skills.length}`);
      if (skills.length > 0) {
        skills.forEach(s => {
          console.log(`  - ${s.name} (级别: ${s.level || 'N/A'})`);
        });
      } else {
        console.log('  ⚠️ 没有找到技能数据');
      }
    } catch (err) {
      console.log('  ⚠️ 技能表可能不存在:', err.message);
    }

    // 检查所有表
    console.log('\n--- 数据库表列表 ---');
    try {
      const tables = await dbManager.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);
      console.log(`共有 ${tables.length} 个表:`);
      tables.forEach(t => {
        console.log(`  - ${t.name}`);
      });
    } catch (err) {
      console.log('  ⚠️ 无法获取表列表:', err.message);
    }

    // 检查每个表的记录数
    console.log('\n--- 各表记录数统计 ---');
    try {
      const tables = await dbManager.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);

      for (const table of tables) {
        try {
          const result = await dbManager.query(`SELECT COUNT(*) as count FROM ${table.name}`);
          const count = result[0]?.count || 0;
          if (count > 0) {
            console.log(`  ✅ ${table.name}: ${count} 条记录`);
          } else {
            console.log(`  ⚠️ ${table.name}: 0 条记录（空表）`);
          }
        } catch (err) {
          console.log(`  ❌ ${table.name}: 无法查询 (${err.message})`);
        }
      }
    } catch (err) {
      console.log('  ⚠️ 无法统计表记录数:', err.message);
    }

    console.log('\n✅ 数据库检查完成');

  } catch (error) {
    console.error('\n❌ 数据库检查失败:', error.message);
    console.error('详细错误:', error);
  }
}

// 运行检查
checkDatabase().catch(console.error);
