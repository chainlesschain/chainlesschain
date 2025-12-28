/**
 * 综合修复脚本 - 完整解决项目路径问题
 *
 * 功能：
 * 1. 检查并修复系统配置
 * 2. 修复所有没有 root_path 的项目
 * 3. 创建项目目录并写入文件
 * 4. 验证修复结果
 */

const fs = require('fs').promises;
const path = require('path');
const Database = require('../src/main/database');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkSystemConfig() {
  log('\n========== 步骤 1: 检查系统配置 ==========', 'cyan');

  const projectRoot = path.join(__dirname, '..');
  const defaultProjectsPath = path.join(projectRoot, 'data', 'projects');

  log(`项目根目录: ${projectRoot}`);
  log(`默认项目路径: ${defaultProjectsPath}`);

  // 检查目录是否存在
  try {
    await fs.access(defaultProjectsPath);
    log('✓ 项目目录已存在', 'green');
  } catch (error) {
    log('创建项目目录...', 'yellow');
    await fs.mkdir(defaultProjectsPath, { recursive: true });
    log('✓ 项目目录已创建', 'green');
  }

  return defaultProjectsPath;
}

async function checkDatabase() {
  log('\n========== 步骤 2: 检查数据库 ==========', 'cyan');

  const dbPath = path.join(__dirname, '../data/chainlesschain.db');
  log(`数据库路径: ${dbPath}`);

  try {
    await fs.access(dbPath);
    log('✓ 数据库文件存在', 'green');

    const stats = await fs.stat(dbPath);
    log(`  大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    return dbPath;
  } catch (error) {
    log('❌ 数据库文件不存在', 'red');
    log('请先启动应用创建数据库', 'yellow');
    return null;
  }
}

async function getProjectStats(database) {
  const allProjects = database.db.prepare('SELECT * FROM projects').all();
  const brokenProjects = allProjects.filter(p => !p.root_path || p.root_path === '');

  return {
    total: allProjects.length,
    broken: brokenProjects.length,
    ok: allProjects.length - brokenProjects.length,
    projects: brokenProjects
  };
}

async function fixProjects(database, projectsRootPath) {
  log('\n========== 步骤 3: 修复项目 ==========', 'cyan');

  const stats = await getProjectStats(database);

  log(`总项目数: ${stats.total}`);
  log(`需要修复: ${stats.broken} 个`, stats.broken > 0 ? 'yellow' : 'green');
  log(`正常项目: ${stats.ok} 个`, 'green');

  if (stats.broken === 0) {
    log('\n✓ 所有项目都正常，无需修复！', 'green');
    return { fixed: 0, failed: 0, details: [] };
  }

  log('\n开始修复...\n', 'yellow');

  const results = {
    fixed: 0,
    failed: 0,
    details: []
  };

  for (let i = 0; i < stats.projects.length; i++) {
    const project = stats.projects[i];
    const num = i + 1;

    log(`[${num}/${stats.broken}] 修复项目: ${project.name}`, 'blue');
    log(`  ID: ${project.id}`);
    log(`  类型: ${project.project_type}`);

    try {
      // 创建项目目录
      const projectPath = path.join(projectsRootPath, project.id);
      log(`  → 创建目录: ${projectPath}`, 'cyan');
      await fs.mkdir(projectPath, { recursive: true });

      // 更新数据库
      database.db.run(
        'UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?',
        [projectPath, Date.now(), project.id]
      );
      log(`  → 更新 root_path`, 'cyan');

      // 获取项目文件
      const projectFiles = database.db.prepare(
        'SELECT * FROM project_files WHERE project_id = ?'
      ).all(project.id);

      if (projectFiles && projectFiles.length > 0) {
        log(`  → 写入 ${projectFiles.length} 个文件...`, 'cyan');

        let fileSuccess = 0;
        let fileFailed = 0;

        for (const file of projectFiles) {
          try {
            const filePath = path.join(projectPath, file.file_path || file.file_name);

            // 确保目录存在
            await fs.mkdir(path.dirname(filePath), { recursive: true });

            // 写入文件
            await fs.writeFile(filePath, file.content || '', 'utf8');

            // 更新文件的 fs_path
            database.db.run(
              'UPDATE project_files SET fs_path = ? WHERE id = ?',
              [filePath, file.id]
            );

            fileSuccess++;
          } catch (fileError) {
            log(`    ✗ ${file.file_name}: ${fileError.message}`, 'red');
            fileFailed++;
          }
        }

        log(`  ✓ 文件写入完成: ${fileSuccess} 成功, ${fileFailed} 失败`,
            fileFailed > 0 ? 'yellow' : 'green');
      } else {
        log(`  (无文件)`, 'cyan');
      }

      results.fixed++;
      results.details.push({
        name: project.name,
        id: project.id,
        status: 'success',
        path: projectPath
      });

      log(`  ✓ 项目修复完成\n`, 'green');

    } catch (error) {
      log(`  ✗ 修复失败: ${error.message}\n`, 'red');
      results.failed++;
      results.details.push({
        name: project.name,
        id: project.id,
        status: 'failed',
        error: error.message
      });
    }

    // 每修复一个项目后短暂暂停
    await sleep(100);
  }

  // 保存数据库
  database.saveToFile();

  return results;
}

async function verifyFix(database) {
  log('\n========== 步骤 4: 验证修复结果 ==========', 'cyan');

  const stats = await getProjectStats(database);

  log(`总项目数: ${stats.total}`);
  log(`未修复的: ${stats.broken} 个`, stats.broken > 0 ? 'red' : 'green');
  log(`正常项目: ${stats.ok} 个`, 'green');

  if (stats.broken > 0) {
    log('\n⚠ 还有项目未修复：', 'yellow');
    stats.projects.forEach(p => {
      log(`  - ${p.name} (${p.id})`);
    });
    return false;
  }

  log('\n✓ 所有项目已正确设置 root_path！', 'green');
  return true;
}

async function main() {
  log('============================================================', 'cyan');
  log('综合修复脚本 - 修复项目路径问题', 'cyan');
  log('============================================================', 'cyan');

  try {
    // 1. 检查系统配置
    const projectsRootPath = await checkSystemConfig();

    // 2. 检查数据库
    const dbPath = await checkDatabase();
    if (!dbPath) {
      process.exit(1);
    }

    // 3. 初始化数据库
    const database = new Database(dbPath);

    // 4. 修复项目
    const results = await fixProjects(database, projectsRootPath);

    // 5. 验证修复
    const verified = await verifyFix(database);

    // 6. 输出结果
    log('\n============================================================', 'cyan');
    log('修复完成！', 'green');
    log('============================================================', 'cyan');
    log(`修复成功: ${results.fixed} 个`, 'green');
    log(`修复失败: ${results.failed} 个`, results.failed > 0 ? 'red' : 'green');

    if (results.failed > 0) {
      log('\n失败的项目：', 'red');
      results.details
        .filter(d => d.status === 'failed')
        .forEach(d => {
          log(`  - ${d.name}: ${d.error}`, 'red');
        });
    }

    log('\n下一步：', 'yellow');
    log('1. 重启桌面应用');
    log('2. 打开任意项目');
    log('3. 检查控制台是否显示: [ProjectDetail] 文件系统监听已启动');
    log('4. 尝试用外部编辑器修改文件，测试自动刷新功能');

    // 关闭数据库
    if (database.db) {
      database.db.close();
    }

    process.exit(verified ? 0 : 1);

  } catch (error) {
    log(`\n❌ 执行失败: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// 运行
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
