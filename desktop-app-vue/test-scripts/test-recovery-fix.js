/**
 * 项目恢复修复测试脚本
 * 测试同步逻辑是否正确保护本地待同步的项目
 */

const path = require('path');
const Database = require('better-sqlite3');

console.log('ChainlessChain 项目恢复修复测试');
console.log('==================================\n');

// 数据库路径
const dbPath = path.join(__dirname, '..', 'data', 'chainlesschain.db');
console.log('数据库路径:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });

  console.log('\n1. 检查项目统计');
  console.log('----------------------------------------');

  // 统计项目状态
  const totalProjects = db.prepare('SELECT COUNT(*) as count FROM projects').get();
  const activeProjects = db.prepare('SELECT COUNT(*) as count FROM projects WHERE deleted = 0').get();
  const deletedProjects = db.prepare('SELECT COUNT(*) as count FROM projects WHERE deleted = 1').get();

  console.log(`总项目数: ${totalProjects.count}`);
  console.log(`活跃项目: ${activeProjects.count}`);
  console.log(`已删除项目: ${deletedProjects.count}`);

  console.log('\n2. 检查待同步的项目');
  console.log('----------------------------------------');

  // 检查待同步的项目
  const pendingProjects = db.prepare(`
    SELECT
      id, name, sync_status, synced_at, deleted,
      datetime(created_at/1000, 'unixepoch', 'localtime') as created_time,
      datetime(updated_at/1000, 'unixepoch', 'localtime') as updated_time
    FROM projects
    WHERE sync_status = 'pending'
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  if (pendingProjects.length > 0) {
    console.log(`找到 ${pendingProjects.length} 个待同步的项目:\n`);
    pendingProjects.forEach((p, index) => {
      console.log(`${index + 1}. ${p.name}`);
      console.log(`   ID: ${p.id}`);
      console.log(`   状态: ${p.deleted === 0 ? '正常' : '已删除'}`);
      console.log(`   同步状态: ${p.sync_status}`);
      console.log(`   同步时间: ${p.synced_at || '从未同步'}`);
      console.log(`   创建时间: ${p.created_time}`);
      console.log(`   更新时间: ${p.updated_time}`);
      console.log('');
    });

    // 检查是否有被错误删除的待同步项目
    const wronglyDeleted = pendingProjects.filter(p => p.deleted === 1 && !p.synced_at);
    if (wronglyDeleted.length > 0) {
      console.log(`⚠️  警告: 发现 ${wronglyDeleted.length} 个被错误删除的待同步项目！`);
      console.log('这些项目需要恢复。运行以下命令恢复：');
      console.log('  node recover-projects.js --auto\n');
    } else {
      console.log('✓ 没有发现被错误删除的待同步项目\n');
    }
  } else {
    console.log('没有待同步的项目\n');
  }

  console.log('\n3. 检查最近删除的项目');
  console.log('----------------------------------------');

  // 检查最近删除的项目
  const recentlyDeleted = db.prepare(`
    SELECT
      id, name, sync_status, synced_at,
      datetime(created_at/1000, 'unixepoch', 'localtime') as created_time,
      datetime(updated_at/1000, 'unixepoch', 'localtime') as updated_time
    FROM projects
    WHERE deleted = 1
    ORDER BY updated_at DESC
    LIMIT 5
  `).all();

  if (recentlyDeleted.length > 0) {
    console.log(`找到 ${recentlyDeleted.length} 个最近删除的项目:\n`);
    recentlyDeleted.forEach((p, index) => {
      const neverSynced = !p.synced_at;
      const status = neverSynced ? '⚠️  可能被错误删除（从未同步）' : '✓ 正常删除（已同步过）';

      console.log(`${index + 1}. ${p.name}`);
      console.log(`   ID: ${p.id}`);
      console.log(`   同步状态: ${p.sync_status}`);
      console.log(`   同步时间: ${p.synced_at || '从未同步'}`);
      console.log(`   评估: ${status}`);
      console.log(`   创建时间: ${p.created_time}`);
      console.log(`   删除时间: ${p.updated_time}`);
      console.log('');
    });

    // 统计可能被错误删除的项目
    const possiblyWrong = recentlyDeleted.filter(p => !p.synced_at);
    if (possiblyWrong.length > 0) {
      console.log(`⚠️  发现 ${possiblyWrong.length} 个可能被错误删除的项目`);
      console.log('运行恢复工具检查：node recover-projects.js\n');
    }
  } else {
    console.log('没有删除的项目\n');
  }

  console.log('\n4. 检查项目文件完整性');
  console.log('----------------------------------------');

  // 检查是否有项目目录
  const fs = require('fs');
  const projectsWithFiles = db.prepare(`
    SELECT id, name, root_path, deleted
    FROM projects
    WHERE root_path IS NOT NULL
    LIMIT 10
  `).all();

  let filesExistCount = 0;
  let filesMissingCount = 0;
  let deletedButFilesExist = 0;

  projectsWithFiles.forEach(p => {
    if (fs.existsSync(p.root_path)) {
      filesExistCount++;
      if (p.deleted === 1) {
        deletedButFilesExist++;
      }
    } else {
      filesMissingCount++;
    }
  });

  console.log(`检查了 ${projectsWithFiles.length} 个项目的文件目录:`);
  console.log(`  目录存在: ${filesExistCount}`);
  console.log(`  目录缺失: ${filesMissingCount}`);

  if (deletedButFilesExist > 0) {
    console.log(`\n⚠️  警告: ${deletedButFilesExist} 个项目被标记为删除但文件目录仍存在！`);
    console.log('这些项目很可能被错误删除，可以恢复。');
    console.log('运行: node recover-projects.js --auto\n');
  }

  console.log('\n5. 总结');
  console.log('----------------------------------------');

  const hasIssues = (
    (pendingProjects.filter(p => p.deleted === 1 && !p.synced_at).length > 0) ||
    (recentlyDeleted.filter(p => !p.synced_at).length > 0) ||
    (deletedButFilesExist > 0)
  );

  if (hasIssues) {
    console.log('状态: ⚠️  发现问题');
    console.log('\n建议操作:');
    console.log('1. 运行恢复工具扫描: node recover-projects.js');
    console.log('2. 自动恢复所有项目: node recover-projects.js --auto');
    console.log('3. 重启应用程序');
    console.log('\n修复说明: 请查看 PROJECT_RECOVERY_FIX.md');
  } else {
    console.log('状态: ✓ 一切正常');
    console.log('没有发现需要恢复的项目。');
  }

  db.close();
} catch (error) {
  console.error('\n错误:', error.message);
  console.error('\n可能的原因:');
  console.error('  1. 数据库文件不存在');
  console.error('  2. 数据库文件已加密');
  console.error('  3. 应用程序正在运行');
  process.exit(1);
}
