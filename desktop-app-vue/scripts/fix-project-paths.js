/**
 * 修复已存在项目的路径问题
 *
 * 此脚本会：
 * 1. 扫描所有 root_path 为 null 的项目
 * 2. 为这些项目创建目录并设置 root_path
 * 3. 将项目文件写入文件系统
 */

const path = require('path');
const fs = require('fs').promises;
const Database = require('../src/main/database');

async function fixProjectPaths() {
  console.log('='.repeat(60));
  console.log('修复项目路径工具');
  console.log('='.repeat(60));
  console.log();

  // 初始化数据库
  const dbPath = path.join(__dirname, '../data/chainlesschain.db');
  console.log('数据库路径:', dbPath);

  // 检查数据库是否存在
  try {
    await fs.access(dbPath);
  } catch (error) {
    console.error('❌ 数据库文件不存在:', dbPath);
    console.error('请先启动应用创建数据库');
    process.exit(1);
  }

  const database = new Database(dbPath);

  try {
    // 获取所有项目
    const allProjects = database.db.prepare('SELECT * FROM projects').all();
    console.log(`找到 ${allProjects.length} 个项目`);
    console.log();

    // 筛选出 root_path 为 null 的项目
    const projectsNeedFix = allProjects.filter(p => !p.root_path);

    if (projectsNeedFix.length === 0) {
      console.log('✓ 所有项目的路径都已正确设置！');
      return;
    }

    console.log(`需要修复的项目: ${projectsNeedFix.length} 个`);
    console.log('-'.repeat(60));

    for (const project of projectsNeedFix) {
      console.log();
      console.log(`项目: ${project.name} (${project.id})`);
      console.log(`  类型: ${project.project_type}`);
      console.log(`  当前 root_path: ${project.root_path}`);

      // 确定项目根目录
      const projectsRoot = path.join(__dirname, '../data/projects');
      const projectRootPath = path.join(projectsRoot, project.id);

      try {
        // 创建项目目录
        await fs.mkdir(projectRootPath, { recursive: true });
        console.log(`  ✓ 创建目录: ${projectRootPath}`);

        // 更新数据库中的 root_path
        database.db.run(
          'UPDATE projects SET root_path = ? WHERE id = ?',
          [projectRootPath, project.id]
        );
        console.log(`  ✓ 更新 root_path`);

        // 获取项目文件
        const projectFiles = database.db.prepare(
          'SELECT * FROM project_files WHERE project_id = ?'
        ).all(project.id);

        if (projectFiles && projectFiles.length > 0) {
          console.log(`  找到 ${projectFiles.length} 个文件，开始写入文件系统...`);

          for (const file of projectFiles) {
            try {
              const filePath = path.join(projectRootPath, file.file_path || file.file_name);

              // 确保文件目录存在
              await fs.mkdir(path.dirname(filePath), { recursive: true });

              // 写入文件内容
              await fs.writeFile(filePath, file.content || '', 'utf8');

              // 更新文件的 fs_path
              database.db.run(
                'UPDATE project_files SET fs_path = ? WHERE id = ?',
                [filePath, file.id]
              );

              console.log(`    ✓ ${file.file_name}`);
            } catch (fileError) {
              console.error(`    ✗ 写入文件失败: ${file.file_name}`, fileError.message);
            }
          }
        } else {
          console.log(`  (项目没有文件)`);
        }

        console.log(`  ✓ 项目修复完成`);

      } catch (error) {
        console.error(`  ✗ 修复失败:`, error.message);
      }
    }

    // 保存数据库
    database.saveToFile();
    console.log();
    console.log('='.repeat(60));
    console.log(`✓ 完成！成功修复 ${projectsNeedFix.length} 个项目`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('执行失败:', error);
    process.exit(1);
  } finally {
    // 关闭数据库连接
    if (database.db) {
      database.db.close();
    }
  }
}

// 运行修复
fixProjectPaths().catch(error => {
  console.error('发生错误:', error);
  process.exit(1);
});
