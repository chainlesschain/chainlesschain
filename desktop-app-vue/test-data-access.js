/**
 * 数据访问测试脚本
 * 测试应用能否正常读取数据库中的数据
 */
const path = require('path');
const fs = require('fs');

// Mock app for testing
global.app = {
  isPackaged: false,
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, '..', '..');
    }
    return require('os').tmpdir();
  }
};

const DatabaseManager = require('./src/main/database');

async function testDataAccess() {
  console.log('='.repeat(70));
  console.log('              数据访问测试工具');
  console.log('='.repeat(70));
  console.log();

  // 数据库路径
  const dbPath = path.join(
    'C:', 'Users', 'longfa', 'AppData', 'Roaming',
    'chainlesschain-desktop-vue', 'data', 'chainlesschain.db'
  );

  console.log('📁 数据库路径:', dbPath);
  console.log('📊 文件是否存在:', fs.existsSync(dbPath) ? '✅ 是' : '❌ 否');

  if (!fs.existsSync(dbPath)) {
    console.log('\n❌ 数据库文件不存在！测试终止。');
    return;
  }

  const stats = fs.statSync(dbPath);
  console.log('📦 文件大小:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('🕒 最后修改:', stats.mtime.toLocaleString('zh-CN'));
  console.log();

  try {
    // 创建数据库管理器（未加密模式）
    const dbManager = new DatabaseManager(dbPath, {
      password: '123456',
      encryptionEnabled: false  // 未加密
    });

    console.log('🔧 正在初始化数据库（未加密模式）...');
    await dbManager.initialize();
    console.log('✅ 数据库初始化成功');
    console.log();

    // 测试1: 检查项目数据
    console.log('─'.repeat(70));
    console.log('📊 测试 1: 项目数据');
    console.log('─'.repeat(70));
    try {
      const projectsResult = await dbManager.db.exec(`SELECT * FROM projects LIMIT 10`);

      if (projectsResult && projectsResult.length > 0 && projectsResult[0].values) {
        const projects = projectsResult[0].values;
        console.log(`✅ 找到 ${projects.length} 个项目（显示前10个）`);

        const columns = projectsResult[0].columns;
        const nameIdx = columns.indexOf('name');
        const idIdx = columns.indexOf('id');
        const createdIdx = columns.indexOf('created_at');

        console.log();
        projects.forEach((project, idx) => {
          const name = project[nameIdx] || '未命名';
          const id = project[idIdx] || 'N/A';
          const created = project[createdIdx] ? new Date(project[createdIdx]).toLocaleDateString('zh-CN') : 'N/A';
          console.log(`  ${idx + 1}. ${name}`);
          console.log(`     ID: ${id}, 创建时间: ${created}`);
        });
      } else {
        console.log('⚠️  项目表为空或无数据');
      }
    } catch (err) {
      console.log('❌ 读取项目数据失败:', err.message);
    }
    console.log();

    // 测试2: 检查笔记数据
    console.log('─'.repeat(70));
    console.log('📝 测试 2: 笔记数据');
    console.log('─'.repeat(70));
    try {
      const notesResult = await dbManager.db.exec(`SELECT * FROM notes LIMIT 10`);

      if (notesResult && notesResult.length > 0 && notesResult[0].values) {
        const notes = notesResult[0].values;
        console.log(`✅ 找到 ${notes.length} 条笔记（显示前10个）`);

        const columns = notesResult[0].columns;
        const titleIdx = columns.indexOf('title');
        const idIdx = columns.indexOf('id');
        const createdIdx = columns.indexOf('created_at');

        console.log();
        notes.forEach((note, idx) => {
          const title = note[titleIdx] || '未命名';
          const id = note[idIdx] || 'N/A';
          const created = note[createdIdx] ? new Date(note[createdIdx]).toLocaleDateString('zh-CN') : 'N/A';
          console.log(`  ${idx + 1}. ${title}`);
          console.log(`     ID: ${id}, 创建时间: ${created}`);
        });
      } else {
        console.log('⚠️  笔记表为空或无数据');
      }
    } catch (err) {
      console.log('❌ 读取笔记数据失败:', err.message);
    }
    console.log();

    // 测试3: 检查技能数据
    console.log('─'.repeat(70));
    console.log('💡 测试 3: 技能数据');
    console.log('─'.repeat(70));
    try {
      const skillsResult = await dbManager.db.exec(`SELECT * FROM skills LIMIT 10`);

      if (skillsResult && skillsResult.length > 0 && skillsResult[0].values) {
        const skills = skillsResult[0].values;
        console.log(`✅ 找到 ${skills.length} 个技能（显示前10个）`);

        const columns = skillsResult[0].columns;
        const nameIdx = columns.indexOf('name');
        const levelIdx = columns.indexOf('level');
        const categoryIdx = columns.indexOf('category');

        console.log();
        skills.forEach((skill, idx) => {
          const name = skill[nameIdx] || '未命名';
          const level = skill[levelIdx] || 'N/A';
          const category = skill[categoryIdx] || '未分类';
          console.log(`  ${idx + 1}. ${name} (${category}) - 等级: ${level}`);
        });
      } else {
        console.log('⚠️  技能表为空或无数据');
      }
    } catch (err) {
      console.log('❌ 读取技能数据失败:', err.message);
    }
    console.log();

    // 测试4: 统计所有表的记录数
    console.log('─'.repeat(70));
    console.log('📈 测试 4: 数据库统计信息');
    console.log('─'.repeat(70));
    try {
      const tablesResult = await dbManager.db.exec(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);

      if (tablesResult && tablesResult.length > 0 && tablesResult[0].values) {
        const tables = tablesResult[0].values.map(row => row[0]);
        console.log(`✅ 数据库共有 ${tables.length} 个表`);
        console.log();

        for (const tableName of tables) {
          try {
            const countResult = await dbManager.db.exec(`SELECT COUNT(*) as count FROM ${tableName}`);
            const count = countResult[0]?.values[0]?.[0] || 0;

            if (count > 0) {
              console.log(`  ✅ ${tableName.padEnd(30)} ${String(count).padStart(6)} 条记录`);
            } else {
              console.log(`  ⚪ ${tableName.padEnd(30)} ${String(count).padStart(6)} 条记录（空表）`);
            }
          } catch (err) {
            console.log(`  ❌ ${tableName.padEnd(30)} 无法统计`);
          }
        }
      }
    } catch (err) {
      console.log('❌ 获取表统计信息失败:', err.message);
    }
    console.log();

    console.log('='.repeat(70));
    console.log('✅ 数据访问测试完成！');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.error('详细错误:', error);
  }
}

// 运行测试
testDataAccess().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
