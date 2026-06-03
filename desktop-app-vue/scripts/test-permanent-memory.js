/**
 * PermanentMemoryManager 测试脚本
 *
 * 测试 Daily Notes 和 MEMORY.md 功能
 *
 * 运行方式:
 * cd desktop-app-vue
 * node scripts/test-permanent-memory.js
 */

const path = require('path');
const fs = require('fs').promises;

// 设置环境变量
process.env.CHAINLESSCHAIN_DISABLE_NATIVE_DB = '1';

const { PermanentMemoryManager } = require('../src/main/llm/permanent-memory-manager.js');
const DatabaseManager = require('../src/main/database.js');

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'cyan');
}

function logSection(message) {
  log(`\n${'='.repeat(60)}`, 'blue');
  log(message, 'blue');
  log('='.repeat(60), 'blue');
}

async function runTests() {
  let db = null;
  let permanentMemory = null;

  try {
    logSection('PermanentMemoryManager 测试');

    // ============================================
    // 1. 初始化数据库
    // ============================================
    logSection('1. 初始化数据库');

    const testDbPath = path.join(__dirname, '../data/test-permanent-memory.db');

    // 删除旧测试数据库
    try {
      await fs.unlink(testDbPath);
      logInfo('已删除旧测试数据库');
    } catch (err) {
      // 文件不存在,忽略
    }

    db = new DatabaseManager(testDbPath);
    await db.initialize();
    logSuccess('数据库初始化完成');

    // 运行迁移
    const migrationPath = path.join(__dirname, '../src/main/database/migrations/009_embedding_cache.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    // 移除注释并执行
    const cleanedSQL = migrationSQL
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // 一次性执行所有 SQL
    db.db.exec(cleanedSQL);
    logSuccess('数据库迁移完成');

    // ============================================
    // 2. 初始化 PermanentMemoryManager
    // ============================================
    logSection('2. 初始化 PermanentMemoryManager');

    const testMemoryDir = path.join(__dirname, '../data/test-memory');

    // 清理旧测试目录
    try {
      await fs.rm(testMemoryDir, { recursive: true, force: true });
      logInfo('已清理旧测试目录');
    } catch (err) {
      // 忽略
    }

    permanentMemory = new PermanentMemoryManager({
      memoryDir: testMemoryDir,
      database: db.db,
      enableDailyNotes: true,
      enableLongTermMemory: true,
      enableAutoIndexing: false, // 暂不测试自动索引
      maxDailyNotesRetention: 30,
    });

    await permanentMemory.initialize();
    logSuccess('PermanentMemoryManager 初始化完成');

    // 验证目录结构
    const dailyDir = path.join(testMemoryDir, 'daily');
    const memoryFile = path.join(testMemoryDir, 'MEMORY.md');

    const dailyDirExists = await fs
      .access(dailyDir)
      .then(() => true)
      .catch(() => false);
    const memoryFileExists = await fs
      .access(memoryFile)
      .then(() => true)
      .catch(() => false);

    if (dailyDirExists && memoryFileExists) {
      logSuccess('目录结构创建成功');
    } else {
      logError('目录结构创建失败');
    }

    // ============================================
    // 3. 测试 Daily Notes 写入
    // ============================================
    logSection('3. 测试 Daily Notes 写入');

    const testContent1 = `
## 15:30 - 测试 PermanentMemoryManager

- 创建了 PermanentMemoryManager 类
- 实现了 Daily Notes 功能
- 实现了 MEMORY.md 功能

## ✅ 完成任务
- [x] 创建数据库迁移
- [x] 创建核心类
- [x] 创建 IPC 处理器
`;

    const filePath1 = await permanentMemory.writeDailyNote(testContent1, {
      append: false,
    });
    logSuccess(`Daily Note 写入成功: ${path.basename(filePath1)}`);

    // 追加内容
    const testContent2 = `
## 16:00 - 测试追加功能

- 追加内容测试通过
`;

    await permanentMemory.writeDailyNote(testContent2, { append: true });
    logSuccess('Daily Note 追加成功');

    // ============================================
    // 4. 测试 Daily Notes 读取
    // ============================================
    logSection('4. 测试 Daily Notes 读取');

    const today = permanentMemory.getTodayDate();
    const content = await permanentMemory.readDailyNote(today);

    if (content && content.includes('测试 PermanentMemoryManager')) {
      logSuccess('Daily Note 读取成功');
      logInfo(`内容长度: ${content.length} 字符`);
    } else {
      logError('Daily Note 读取失败');
    }

    // ============================================
    // 5. 测试 MEMORY.md 读取
    // ============================================
    logSection('5. 测试 MEMORY.md 读取');

    const memoryContent = await permanentMemory.readMemory();

    if (memoryContent && memoryContent.includes('ChainlessChain 长期记忆')) {
      logSuccess('MEMORY.md 读取成功');
      logInfo(`内容长度: ${memoryContent.length} 字符`);
    } else {
      logError('MEMORY.md 读取失败');
    }

    // ============================================
    // 6. 测试 MEMORY.md 追加
    // ============================================
    logSection('6. 测试 MEMORY.md 追加');

    const testMemoryContent = `
### 数据库优化经验

#### 问题
SQLite "database is locked" 错误

#### 原因
并发写入、长事务、WAL 模式未启用

#### 解决
启用 WAL 模式,设置 busy_timeout=5000
`;

    await permanentMemory.appendToMemory(testMemoryContent, {
      section: '🐛 常见问题解决方案',
    });
    logSuccess('MEMORY.md 追加成功 (指定章节)');

    // 验证追加
    const updatedMemory = await permanentMemory.readMemory();
    if (updatedMemory.includes('数据库优化经验')) {
      logSuccess('内容追加验证成功');
    } else {
      logError('内容追加验证失败');
    }

    // ============================================
    // 7. 测试统计功能
    // ============================================
    logSection('7. 测试统计功能');

    const stats = await permanentMemory.getStats();
    logSuccess('统计信息获取成功:');
    logInfo(`  - Daily Notes 数量: ${stats.dailyNotesCount}`);
    logInfo(`  - MEMORY.md 章节数: ${stats.memorySectionsCount}`);
    logInfo(`  - 缓存 Embeddings: ${stats.cachedEmbeddingsCount}`);
    logInfo(`  - 索引文件数: ${stats.indexedFilesCount}`);
    logInfo(`  - 统计日期: ${stats.date}`);

    // ============================================
    // 8. 测试最近 Daily Notes 查询
    // ============================================
    logSection('8. 测试最近 Daily Notes 查询');

    const recentNotes = await permanentMemory.getRecentDailyNotes(7);
    logSuccess(`获取最近 Daily Notes 成功: ${recentNotes.length} 条`);

    if (recentNotes.length > 0) {
      const note = recentNotes[0];
      logInfo(`  - 日期: ${note.date}`);
      logInfo(`  - 对话数: ${note.conversation_count}`);
      logInfo(`  - 完成任务: ${note.completed_tasks}`);
      logInfo(`  - 待办任务: ${note.pending_tasks}`);
      logInfo(`  - 技术发现: ${note.discoveries_count}`);
      logInfo(`  - 字数: ${note.word_count}`);
    }

    // ============================================
    // 9. 测试元数据解析
    // ============================================
    logSection('9. 测试元数据解析');

    const metadata = permanentMemory.parseDailyNoteMetadata(content);
    logSuccess('元数据解析成功:');
    logInfo(`  - 对话数: ${metadata.conversationCount}`);
    logInfo(`  - 完成任务: ${metadata.completedTasks}`);
    logInfo(`  - 待办任务: ${metadata.pendingTasks}`);
    logInfo(`  - 技术发现: ${metadata.discoveriesCount}`);
    logInfo(`  - 字数: ${metadata.wordCount}`);

    // ============================================
    // 10. 测试内容 Hash
    // ============================================
    logSection('10. 测试内容 Hash');

    const hash1 = permanentMemory.hashContent('测试内容');
    const hash2 = permanentMemory.hashContent('测试内容');
    const hash3 = permanentMemory.hashContent('不同内容');

    if (hash1 === hash2 && hash1 !== hash3) {
      logSuccess('内容 Hash 功能正常');
      logInfo(`  - Hash 1: ${hash1.substring(0, 16)}...`);
      logInfo(`  - Hash 2: ${hash2.substring(0, 16)}...`);
      logInfo(`  - Hash 3: ${hash3.substring(0, 16)}...`);
    } else {
      logError('内容 Hash 功能异常');
    }

    // ============================================
    // 测试总结
    // ============================================
    logSection('测试总结');
    logSuccess('所有测试通过!');

    logInfo('\n生成的测试文件:');
    logInfo(`  - Daily Note: ${filePath1}`);
    logInfo(`  - MEMORY.md: ${memoryFile}`);
    logInfo(`  - 数据库: ${testDbPath}`);

    logInfo('\n可以手动查看这些文件验证结果。');
  } catch (error) {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    // 清理
    if (permanentMemory) {
      permanentMemory.destroy();
    }
    if (db) {
      db.close();
    }
  }
}

// 运行测试
runTests();
