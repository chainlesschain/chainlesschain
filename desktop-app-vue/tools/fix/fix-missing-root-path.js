/**
 * 修复缺少 root_path 的项目
 * 这个脚本会检查所有项目，并为缺少 root_path 的项目自动设置正确的路径
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// 数据库路径
const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');

// 项目根目录配置
const projectsRootPath = path.join(__dirname, '..', 'data', 'projects');

async function fixMissingRootPaths() {
  try {
    if (!fs.existsSync(dbPath)) {
      console.error('错误：数据库文件不存在:', dbPath);
      process.exit(1);
    }

    console.log('打开数据库:', dbPath);

    // 初始化 sql.js
    const SQL = await initSqlJs({
      locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
    });

    // 读取数据库文件
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // 获取所有项目
    const result = db.exec('SELECT id, name, project_type, root_path FROM projects');

    if (!result || result.length === 0 || !result[0].values) {
      console.log('没有找到任何项目');
      return;
    }

    const projects = result[0].values.map(row => ({
      id: row[0],
      name: row[1],
      project_type: row[2],
      root_path: row[3]
    }));

    console.log(`\n找到 ${projects.length} 个项目`);

    let fixedCount = 0;
    let alreadySetCount = 0;

    for (const project of projects) {
      console.log(`\n检查项目: ${project.name} (${project.id})`);
      console.log(`  类型: ${project.project_type}`);
      console.log(`  当前 root_path: ${project.root_path || '(未设置)'}`);

      if (!project.root_path) {
        // 构建默认路径
        const defaultRootPath = path.join(projectsRootPath, project.id);

        console.log(`  ✓ 设置 root_path: ${defaultRootPath}`);

        // 创建目录（如果不存在）
        if (!fs.existsSync(defaultRootPath)) {
          fs.mkdirSync(defaultRootPath, { recursive: true });
          console.log(`  ✓ 创建目录: ${defaultRootPath}`);
        }

        // 更新数据库
        db.run('UPDATE projects SET root_path = ? WHERE id = ?', [defaultRootPath, project.id]);

        fixedCount++;
        console.log(`  ✓ 已修复`);
      } else {
        alreadySetCount++;
        console.log(`  ✓ 已设置，无需修复`);
      }
    }

    // 保存数据库
    const data = db.export();
    fs.writeFileSync(dbPath, data);

    db.close();

    console.log(`\n修复完成！`);
    console.log(`  已修复: ${fixedCount} 个项目`);
    console.log(`  已设置: ${alreadySetCount} 个项目`);
    console.log(`  总计: ${projects.length} 个项目`);

  } catch (error) {
    console.error('修复失败:', error);
    console.error('错误堆栈:', error.stack);
    process.exit(1);
  }
}

// 运行修复
fixMissingRootPaths();
