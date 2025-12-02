/**
 * 数据库测试脚本
 * 用于测试数据库功能是否正常
 */

const path = require('path');
const fs = require('fs');

// 临时设置 app.getPath
const { app } = require('electron');
if (!app) {
  // 如果不在 Electron 环境中，模拟 app.getPath
  const os = require('os');
  global.app = {
    getPath: (name) => {
      if (name === 'userData') {
        return path.join(os.tmpdir(), 'chainlesschain-test');
      }
      return os.tmpdir();
    },
  };
}

const DatabaseManager = require('../src/main/database');

async function testDatabase() {
  console.log('=== 开始数据库测试 ===\n');

  try {
    // 1. 初始化数据库
    console.log('1. 初始化数据库...');
    const db = new DatabaseManager();
    db.initialize();
    console.log('✓ 数据库初始化成功');
    console.log('  数据库路径:', db.getDatabasePath());
    console.log();

    // 2. 添加知识库项
    console.log('2. 添加知识库项...');
    const item1 = db.addKnowledgeItem({
      title: '测试笔记1',
      type: 'note',
      content: '这是第一个测试笔记的内容',
    });
    console.log('✓ 添加成功:', item1.title);

    const item2 = db.addKnowledgeItem({
      title: '测试文档',
      type: 'document',
      content: '这是一个测试文档，包含一些重要信息',
    });
    console.log('✓ 添加成功:', item2.title);

    const item3 = db.addKnowledgeItem({
      title: '测试对话',
      type: 'conversation',
      content: '这是一个AI对话记录',
    });
    console.log('✓ 添加成功:', item3.title);
    console.log();

    // 3. 查询所有项目
    console.log('3. 查询所有知识库项...');
    const allItems = db.getKnowledgeItems();
    console.log(`✓ 查询到 ${allItems.length} 个项目`);
    allItems.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.title} (${item.type})`);
    });
    console.log();

    // 4. 根据ID查询
    console.log('4. 根据ID查询...');
    const item = db.getKnowledgeItemById(item1.id);
    console.log('✓ 查询成功:', item.title);
    console.log();

    // 5. 更新项目
    console.log('5. 更新知识库项...');
    const updated = db.updateKnowledgeItem(item1.id, {
      title: '测试笔记1（已更新）',
      content: '这是更新后的内容',
    });
    console.log('✓ 更新成功:', updated.title);
    console.log();

    // 6. 搜索功能
    console.log('6. 测试搜索功能...');
    const searchResults = db.searchKnowledge('测试');
    console.log(`✓ 搜索到 ${searchResults.length} 个结果`);
    searchResults.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.title}`);
    });
    console.log();

    // 7. 创建标签
    console.log('7. 创建标签...');
    const tag1 = db.createTag('工作', '#1890ff');
    console.log('✓ 创建标签:', tag1.name);

    const tag2 = db.createTag('学习', '#52c41a');
    console.log('✓ 创建标签:', tag2.name);
    console.log();

    // 8. 为知识库项添加标签
    console.log('8. 为知识库项添加标签...');
    db.addTagToKnowledge(item1.id, tag1.id);
    db.addTagToKnowledge(item1.id, tag2.id);
    const tags = db.getKnowledgeTags(item1.id);
    console.log(`✓ 项目 "${item1.title}" 的标签:`, tags.map((t) => t.name).join(', '));
    console.log();

    // 9. 获取统计信息
    console.log('9. 获取统计信息...');
    const stats = db.getStatistics();
    console.log('✓ 统计数据:');
    console.log('  总数:', stats.total);
    console.log('  今日新增:', stats.today);
    console.log('  按类型分布:', stats.byType);
    console.log();

    // 10. 删除项目
    console.log('10. 删除知识库项...');
    const deleted = db.deleteKnowledgeItem(item3.id);
    console.log('✓ 删除成功:', deleted);

    const afterDelete = db.getKnowledgeItems();
    console.log(`✓ 删除后剩余 ${afterDelete.length} 个项目`);
    console.log();

    // 11. 备份数据库
    console.log('11. 备份数据库...');
    const backupPath = path.join(path.dirname(db.getDatabasePath()), 'chainlesschain-backup.db');
    await db.backup(backupPath);
    console.log('✓ 备份成功');
    console.log('  备份路径:', backupPath);
    console.log();

    // 关闭数据库
    db.close();

    console.log('=== 所有测试通过 ✓ ===\n');
  } catch (error) {
    console.error('✗ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testDatabase();
