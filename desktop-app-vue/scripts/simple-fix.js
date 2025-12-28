/**
 * 简单修复脚本 - 使用 better-sqlite3 直接操作数据库
 */

const fs = require('fs').promises;
const path = require('path');
const Database = require('better-sqlite3');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('============================================================', 'cyan');
  log('项目路径修复工具 (简化版)', 'cyan');
  log('============================================================', 'cyan');
  log('');

  try {
    // 1. 设置路径
    const projectRoot = path.join(__dirname, '../..');
    const dbPath = path.join(projectRoot, 'data/chainlesschain.db');
    const projectsPath = path.join(projectRoot, 'data/projects');

    log('项目根目录: ' + projectRoot);
    log('数据库路径: ' + dbPath);
    log('项目存储路径: ' + projectsPath);
    log('');

    // 2. 检查数据库
    try {
      await fs.access(dbPath);
      log('✓ 数据库文件存在', 'green');
    } catch (error) {
      log('❌ 数据库文件不存在: ' + dbPath, 'red');
      log('请先启动应用创建数据库', 'yellow');
      process.exit(1);
    }

    // 3. 确保项目目录存在
    await fs.mkdir(projectsPath, { recursive: true });
    log('✓ 项目目录已就绪', 'green');
    log('');

    // 4. 打开数据库（只读模式检查，然后写入模式修复）
    log('正在打开数据库...', 'yellow');
    const db = new Database(dbPath);

    // 5. 查询需要修复的项目
    const brokenProjects = db.prepare(`
      SELECT id, name, project_type, root_path, created_at
      FROM projects
      WHERE (root_path IS NULL OR root_path = '')
      ORDER BY created_at DESC
    `).all();

    log(`找到 ${brokenProjects.length} 个需要修复的项目`, brokenProjects.length > 0 ? 'yellow' : 'green');

    if (brokenProjects.length === 0) {
      log('✓ 所有项目都有正确的路径！', 'green');
      db.close();
      process.exit(0);
    }

    log('');
    log('开始修复...', 'cyan');
    log('----------------------------------------');

    let fixed = 0;
    let failed = 0;

    // 6. 修复每个项目
    for (const project of brokenProjects) {
      log(`\n[${fixed + failed + 1}/${brokenProjects.length}] ${project.name}`, 'blue');
      log(`  ID: ${project.id}`);
      log(`  类型: ${project.project_type}`);

      try {
        // 创建项目目录
        const projectDir = path.join(projectsPath, project.id);
        await fs.mkdir(projectDir, { recursive: true });
        log(`  ✓ 创建目录: ${projectDir}`, 'green');

        // 更新数据库
        const updateStmt = db.prepare(`
          UPDATE projects
          SET root_path = ?, updated_at = ?
          WHERE id = ?
        `);

        updateStmt.run(projectDir, Date.now(), project.id);
        log(`  ✓ 更新 root_path`, 'green');

        // 获取项目文件
        const files = db.prepare(`
          SELECT id, file_name, file_path, content
          FROM project_files
          WHERE project_id = ?
        `).all(project.id);

        if (files && files.length > 0) {
          log(`  正在写入 ${files.length} 个文件...`, 'cyan');

          for (const file of files) {
            try {
              const filePath = path.join(projectDir, file.file_path || file.file_name);

              // 确保文件目录存在
              await fs.mkdir(path.dirname(filePath), { recursive: true });

              // 写入文件
              await fs.writeFile(filePath, file.content || '', 'utf8');

              // 更新文件的 fs_path
              db.prepare(`
                UPDATE project_files
                SET fs_path = ?
                WHERE id = ?
              `).run(filePath, file.id);

              log(`    ✓ ${file.file_name}`, 'green');
            } catch (fileError) {
              log(`    ✗ ${file.file_name}: ${fileError.message}`, 'red');
            }
          }
        } else {
          log(`  (项目无文件)`, 'cyan');
        }

        fixed++;
        log(`  ✓ 修复完成`, 'green');

      } catch (error) {
        log(`  ✗ 修复失败: ${error.message}`, 'red');
        failed++;
      }
    }

    // 7. 关闭数据库
    db.close();

    // 8. 显示结果
    log('');
    log('============================================================', 'cyan');
    log('修复完成！', 'green');
    log('============================================================', 'cyan');
    log(`成功: ${fixed} 个`, 'green');
    log(`失败: ${failed} 个`, failed > 0 ? 'red' : 'green');
    log('');
    log('下一步：', 'yellow');
    log('1. 重启桌面应用');
    log('2. 打开任意项目');
    log('3. 检查是否显示: [ProjectDetail] 文件系统监听已启动');
    log('');

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    log('', 'reset');
    log('❌ 执行失败: ' + error.message, 'red');
    console.error(error);
    process.exit(1);
  }
}

main();
